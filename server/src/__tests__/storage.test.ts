import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { WebSocket } from 'ws'
import { SqliteStore } from '../storage/index.js'
import { RoomManager } from '../rooms/manager.js'
import { TestClient, TestServer, startTestServer, connectClient } from './helpers.js'
import { WsMessageType, ChatMessage } from '../types/index.js'

function removeDir(dir: string): void {
  for (let i = 0; i < 5; i++) {
    try {
      removeDir(dir)
      return
    } catch {
      // Windows pode segurar o arquivo por um instante após fechar o SQLite.
    }
  }
}

describe('SqliteStore', () => {
  let dir: string
  let store: SqliteStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'voip-sqlite-'))
    store = new SqliteStore(join(dir, 'test.db'))
  })

  afterEach(() => {
    store.close()
    removeDir(dir)
  })

  it('persiste e carrega salas não-fixas', () => {
    store.saveRoom({ id: 'r1', name: 'Sala da Redação', createdAt: 1000, fixed: false, createdBy: 'u1', createdByName: 'Dono' })
    store.saveRoom({ id: 'r2', name: 'Sala do Plantão', createdAt: 2000, fixed: false })
    const rooms = store.loadRooms()
    expect(rooms.length).toBe(2)
    expect(rooms.find((r) => r.id === 'r1')).toMatchObject({
      name: 'Sala da Redação',
      fixed: false,
      createdBy: 'u1',
      createdByName: 'Dono',
    })
  })

  it('persiste e carrega mensagens com reações e mídia', () => {
    store.saveMessage('r1', {
      id: 'm1',
      userId: 'u1',
      userName: 'Ana',
      text: 'Olá',
      timestamp: 1000,
      reactions: [{ emoji: '👍', userIds: ['u2'] }],
    })
    store.saveMessage('r1', {
      id: 'm2',
      userId: 'u2',
      userName: 'Bruno',
      imageData: 'base64==',
      timestamp: 2000,
    })
    const msgs = store.loadMessages('r1')
    expect(msgs.length).toBe(2)
    expect(msgs[0]).toMatchObject({ id: 'm1', text: 'Olá', userId: 'u1' })
    expect(msgs[0].reactions).toEqual([{ emoji: '👍', userIds: ['u2'] }])
    expect(msgs[1].imageData).toBe('base64==')
  })

  it('deleta mensagem e sala (com suas mensagens)', () => {
    store.saveRoom({ id: 'r1', name: 'Sala', createdAt: 1, fixed: false })
    store.saveMessage('r1', { id: 'm1', userId: 'u1', userName: 'A', text: 'x', timestamp: 1 })
    store.deleteMessage('r1', 'm1')
    expect(store.loadMessages('r1')).toHaveLength(0)

    store.saveMessage('r1', { id: 'm2', userId: 'u1', userName: 'A', text: 'y', timestamp: 2 })
    store.deleteRoom('r1')
    expect(store.loadRooms()).toHaveLength(0)
    expect(store.loadMessages('r1')).toHaveLength(0)
  })

  it('atualiza mensagem existente no conflito de id', () => {
    store.saveMessage('r1', { id: 'm1', userId: 'u1', userName: 'A', text: 'antes', timestamp: 1 })
    store.saveMessage('r1', { id: 'm1', userId: 'u1', userName: 'A', text: 'depois', timestamp: 1, reactions: [{ emoji: '❤️', userIds: ['u2'] }] })
    const [msg] = store.loadMessages('r1')
    expect(msg.text).toBe('depois')
    expect(msg.reactions).toEqual([{ emoji: '❤️', userIds: ['u2'] }])
  })

  it('persiste e carrega mensagens privadas entre dois usuários', () => {
    store.savePrivateMessage({ id: 'p1', fromUserId: 'a', fromUserName: 'Ana', toUserId: 'b', toUserName: 'Bia', text: 'oi', timestamp: 1 })
    store.savePrivateMessage({ id: 'p2', fromUserId: 'b', fromUserName: 'Bia', toUserId: 'a', toUserName: 'Ana', text: 'olá', timestamp: 2 })
    const msgs = store.loadPrivateMessages('Ana', 'Bia')
    expect(msgs.length).toBe(2)
    expect(msgs[0].text).toBe('oi')
    expect(msgs[1].text).toBe('olá')
  })

  it('lista pares com quem houve conversa privada', () => {
    store.savePrivateMessage({ id: 'p1', fromUserId: 'a', fromUserName: 'Ana', toUserId: 'b', toUserName: 'Bia', text: 'oi', timestamp: 1 })
    store.savePrivateMessage({ id: 'p2', fromUserId: 'a', fromUserName: 'Ana', toUserId: 'c', toUserName: 'Carlos', text: 'op', timestamp: 2 })
    store.savePrivateMessage({ id: 'p3', fromUserId: 'b', fromUserName: 'Bia', toUserId: 'a', toUserName: 'Ana', text: 'opa', timestamp: 3 })
    expect(store.loadPrivateMessagesWith('Ana').sort()).toEqual(['Bia', 'Carlos'])
  })
})

describe('Persistência entre reinícios', () => {
  let dir: string
  let dbPath: string
  let server: TestServer
  const clients: TestClient[] = []

  async function freshClient(name: string, password = 'pass'): Promise<TestClient> {
    const c = await connectClient(server.port, name, password)
    clients.push(c)
    return c
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'voip-persist-'))
    dbPath = join(dir, 'test.db')
  })

  afterEach(async () => {
    for (const c of clients) {
      try { c.ws.terminate() } catch { /* ignore */ }
    }
    clients.length = 0
    if (server) await server.close()
    removeDir(dir)
  })

  it('restaura salas temporárias e mensagens após reiniciar o servidor', async () => {
    const store1 = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store1)

    const a = await freshClient('Reporter')
    a.send(WsMessageType.CreateRoom, 'Sala Permanente')
    await a.waitFor(WsMessageType.RoomCreated)
    a.send(WsMessageType.JoinRoom, 'Sala Permanente')
    await a.waitFor(WsMessageType.RoomJoined)
    a.send(WsMessageType.ChatMessage, { text: 'mensagem persistida' })
    await a.waitFor(WsMessageType.ChatMessage)

    const b = await freshClient('Colega')
    b.send(WsMessageType.JoinRoom, 'Sala Permanente')
    const joined = await b.waitFor(WsMessageType.RoomJoined)
    const msgs = (joined.payload as { messages: ChatMessage[] }).messages
    expect(msgs.some((m) => m.text === 'mensagem persistida')).toBe(true)

    for (const c of clients) { try { c.ws.terminate() } catch { /* ignore */ } }
    clients.length = 0
    await server.close()
    store1.close()

    const store2 = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store2)

    const c = await freshClient('Novo')
    c.send(WsMessageType.ListRooms)
    const list = await c.waitFor(WsMessageType.RoomList)
    const rooms = list.payload as Array<{ id: string; name: string; fixed: boolean }>
    const sala = rooms.find((r) => r.name === 'Sala Permanente')
    expect(sala).toBeDefined()
    expect(sala!.fixed).toBe(false)

    c.send(WsMessageType.JoinRoom, 'Sala Permanente')
    const joined2 = await c.waitFor(WsMessageType.RoomJoined)
    const restored = (joined2.payload as { messages: ChatMessage[] }).messages
    expect(restored.some((m) => m.text === 'mensagem persistida')).toBe(true)

    store2.close()
  })

  it('restaura mensagens das salas fixas após reiniciar', async () => {
    const store1 = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store1)

    const a = await freshClient('Narrador')
    a.send(WsMessageType.JoinRoom, 'Externas')
    await a.waitFor(WsMessageType.RoomJoined)
    a.send(WsMessageType.ChatMessage, { text: 'histórico fixo' })
    await a.waitFor(WsMessageType.ChatMessage)

    for (const c of clients) { try { c.ws.terminate() } catch { /* ignore */ } }
    clients.length = 0
    await server.close()
    store1.close()

    const store2 = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store2)

    const b = await freshClient('Ouvinte')
    b.send(WsMessageType.JoinRoom, 'Externas')
    const joined = await b.waitFor(WsMessageType.RoomJoined)
    const msgs = (joined.payload as { messages: ChatMessage[] }).messages
    expect(msgs.some((m) => m.text === 'histórico fixo')).toBe(true)

    store2.close()
  })

  it('deletar sala temporária remove a persistência', async () => {
    const store1 = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store1)

    const a = await freshClient('Dono')
    a.send(WsMessageType.CreateRoom, 'Sala Descartável')
    const created = await a.waitFor(WsMessageType.RoomCreated)
    const roomId = (created.payload as { roomId: string }).roomId

    const admin = await freshClient('AdminCriaSala')
    admin.send(WsMessageType.JoinRoom, 'Sala Descartável')
    await admin.waitFor(WsMessageType.RoomJoined)
    admin.send(WsMessageType.ChatMessage, { text: 'x' })
    await admin.waitFor(WsMessageType.ChatMessage)

    a.send(WsMessageType.DeleteRoom, roomId)
    await a.waitFor(WsMessageType.RoomDeleted)

    for (const c of clients) { try { c.ws.terminate() } catch { /* ignore */ } }
    clients.length = 0
    await server.close()
    store1.close()

    const store2 = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store2)

    const b = await freshClient('Verificador')
    b.send(WsMessageType.ListRooms)
    const list = await b.waitFor(WsMessageType.RoomList)
    const rooms = list.payload as Array<{ name: string }>
    expect(rooms.some((r) => r.name === 'Sala Descartável')).toBe(false)

    store2.close()
  })

  it('persiste e restaura histórico de mensagens privadas (DM)', async () => {
    const store1 = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store1)

    const a = await freshClient('Ana')
    const b = await freshClient('Bia')
    const bId = b.id!

    a.send(WsMessageType.PrivateMessage, { toUserId: bId, text: 'dm persistida' })
    await a.waitFor(WsMessageType.PrivateMessage)

    for (const c of clients) { try { c.ws.terminate() } catch { /* ignore */ } }
    clients.length = 0
    await server.close()
    store1.close()

    const store2 = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store2)

    const a2 = await freshClient('Ana')
    const b2 = await freshClient('Bia')
    const b2Id = b2.id!
    a2.send(WsMessageType.ListPrivateMessages, { withUserId: b2Id })
    const history = await a2.waitFor(WsMessageType.PrivateHistory)
    const payload = history.payload as { withUserId: string; messages: Array<{ text: string }> }
    expect(payload.withUserId).toBe(b2Id)
    expect(payload.messages.some((m) => m.text === 'dm persistida')).toBe(true)

    store2.close()
  })
})

describe('RoomManager com storage', () => {
  let dir: string
  let store: SqliteStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'voip-rm-'))
    store = new SqliteStore(join(dir, 'test.db'))
  })

  afterEach(() => {
    store.close()
    removeDir(dir)
  })

  it('cria sala e persiste no storage', () => {
    const rooms = new RoomManager(20, store)
    rooms.create('Sala Nova', 'u1', 'Dono')
    const stored = store.loadRooms()
    expect(stored.find((r) => r.name === 'Sala Nova')).toMatchObject({ createdBy: 'u1' })
  })

  it('restaura sala persistida na inicialização', () => {
    const rooms1 = new RoomManager(20, store)
    rooms1.create('Sala Viva', 'u1', 'Dono')
    const rooms2 = new RoomManager(20, store)
    expect(rooms2.findByName('Sala Viva')).not.toBeNull()
  })

  it('adiciona e persiste mensagens via addMessage', () => {
    const rooms = new RoomManager(20, store)
    const room = rooms.create('Sala Chat')!
    rooms.addMessage(room.id, { id: 'm1', userId: 'u1', userName: 'A', text: 'oi', timestamp: 1 })
    const loaded = store.loadMessages(room.id)
    expect(loaded).toHaveLength(1)
    expect(loaded[0].text).toBe('oi')
  })

  it('deleteMessage remove do storage', () => {
    const rooms = new RoomManager(20, store)
    const room = rooms.create('Sala Del')!
    rooms.addMessage(room.id, { id: 'm1', userId: 'u1', userName: 'A', text: 'oi', timestamp: 1 })
    rooms.deleteMessage(room.id, 'm1')
    expect(store.loadMessages(room.id)).toHaveLength(0)
  })

  it('delete de sala remove do storage', () => {
    const rooms = new RoomManager(20, store)
    const room = rooms.create('Sala X')!
    rooms.addMessage(room.id, { id: 'm1', userId: 'u1', userName: 'A', text: 'oi', timestamp: 1 })
    expect(rooms.delete(room.id)).toBe(true)
    expect(store.loadRooms()).toHaveLength(0)
    expect(store.loadMessages(room.id)).toHaveLength(0)
  })

  it('salva e carrega contas (perfil do usuário)', () => {
    store.saveAccount({ name: 'Reporter', password: 'segredo', avatar: 'data:image/png;base64,abc' })
    const account = store.getAccount('Reporter')
    expect(account).toMatchObject({ name: 'Reporter', password: 'segredo', avatar: 'data:image/png;base64,abc' })
    expect(store.getAccount('Inexistente')).toBeUndefined()
  })

  it('atualiza conta no conflito de nome', () => {
    store.saveAccount({ name: 'Reporter', password: 'velha', avatar: 'a' })
    store.saveAccount({ name: 'Reporter', password: 'nova', avatar: 'b' })
    expect(store.getAccount('Reporter')).toMatchObject({ password: 'nova', avatar: 'b' })
  })

  it('renomeia conta preservando senha e avatar', () => {
    store.saveAccount({ name: 'Antigo', password: 'segredo', avatar: 'avatar' })
    store.renameAccount('Antigo', { name: 'Novo', password: 'segredo', avatar: 'avatar' })
    expect(store.getAccount('Antigo')).toBeUndefined()
    expect(store.getAccount('Novo')).toMatchObject({ name: 'Novo', password: 'segredo', avatar: 'avatar' })
  })
})

describe('Perfil de conta (UpdateProfile)', () => {
  let dir: string
  let dbPath: string
  let server: TestServer
  const clients: TestClient[] = []

  async function freshClient(name: string, password = 'pass', avatar?: string): Promise<TestClient> {
    const c = await connectClient(server.port, name, password, avatar)
    clients.push(c)
    return c
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'voip-profile-'))
    dbPath = join(dir, 'test.db')
  })

  afterEach(async () => {
    for (const c of clients) {
      try { c.ws.terminate() } catch { /* ignore */ }
    }
    clients.length = 0
    if (server) await server.close()
    removeDir(dir)
  })

  it('login envia avatar no welcome e na lista de usuários', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store)
    const a = await freshClient('AvatarUser', 'pass', 'data:image/png;base64,abc')

    const b = await freshClient('Spectator')
    b.send(WsMessageType.ListUsers)
    const list = await b.waitFor(WsMessageType.UserList)
    const users = list.payload as Array<{ name: string; avatar?: string }>
    expect(users.find((u) => u.name === 'AvatarUser')?.avatar).toBe('data:image/png;base64,abc')
    store.close()
  })

  it('update_profile altera nome e avisa todos os usuários', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store)
    const a = await freshClient('PerfilA')
    const b = await freshClient('PerfilB')
    // Consome o UserList inicial do login do B para o teste ler o broadcast seguinte.
    await b.waitFor(WsMessageType.UserList)

    a.send(WsMessageType.UpdateProfile, { name: 'PerfilANovo', avatar: 'data:image/png;base64,xyz' })
    const updated = await a.waitFor(WsMessageType.ProfileUpdated)
    expect(updated.payload).toMatchObject({ name: 'PerfilANovo', avatar: 'data:image/png;base64,xyz' })

    const list = await b.waitFor(WsMessageType.UserList)
    const users = list.payload as Array<{ name: string; avatar?: string }>
    expect(users.some((u) => u.name === 'PerfilANovo')).toBe(true)
    expect(users.some((u) => u.name === 'PerfilA')).toBe(false)

    const account = store.getAccount('PerfilANovo')
    expect(account?.password).toBe('pass')
    expect(account?.avatar).toBe('data:image/png;base64,xyz')
    store.close()
  })

  it('persiste o novo perfil e valida a nova senha no próximo login', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store)
    const a = await freshClient('ContaAntiga', 'velha')
    a.send(WsMessageType.UpdateProfile, { name: 'ContaNova', password: 'nova', avatar: 'data:image/png;base64,1' })
    await a.waitFor(WsMessageType.ProfileUpdated)
    store.close()

    const store2 = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store2)
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`)
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve())
      ws.on('error', (err) => reject(err))
    })
    const wrong = new TestClient(ws)
    clients.push(wrong)
    wrong.send(WsMessageType.Login, { name: 'ContaNova', password: 'errada' })
    const err = await wrong.waitFor(WsMessageType.Error)
    expect(err.payload).toBe('Wrong password')
    await wrong.waitForClose()

    const ok = await freshClient('ContaNova', 'nova')
    const account = store2.getAccount('ContaNova')
    expect(account?.password).toBe('nova')
    expect(account?.avatar).toBe('data:image/png;base64,1')
    store2.close()
  })

  it('rejeita nome já em uso por outro usuário online', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store)
    const a = await freshClient('DonoNome')
    await freshClient('OutroUser')
    a.send(WsMessageType.UpdateProfile, { name: 'OutroUser' })
    const err = await a.waitFor(WsMessageType.Error)
    expect(err.payload).toBe('Name in use')
    store.close()
  })

  it('rejeita avatar acima do limite', async () => {
    const store = new SqliteStore(dbPath)
    const LIMITS = {
      maxNameLength: 32,
      maxPasswordLength: 128,
      maxRoomNameLength: 64,
      maxTextLength: 4000,
      maxAudioMessageBytes: 512 * 1024,
      maxVideoMessageBytes: 5 * 1024 * 1024,
      maxImageMessageBytes: 5 * 1024 * 1024,
      maxLiveChunkBytes: 512 * 1024,
      maxVoiceFrameBytes: 64 * 1024,
      maxAvatarBytes: 100,
    }
    server = await startTestServer(100, 20, LIMITS, [], store)
    const a = await freshClient('AvatarGrande')
    a.send(WsMessageType.UpdateProfile, { avatar: 'a'.repeat(500) })
    const err = await a.waitFor(WsMessageType.Error)
    expect(err.payload).toBe('Avatar too large')
    store.close()
  })

  it('mantém o mesmo id da conta entre logins', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store)
    const first = await freshClient('IdFixo')
    const firstId = first.id!
    store.close()

    const store2 = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store2)
    const second = await freshClient('IdFixo')
    expect(second.id).toBe(firstId)
    store2.close()
  })

  it('mantém o mesmo id após renomear a conta', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store)
    const a = await freshClient('IdRenome')
    const beforeId = a.id!
    a.send(WsMessageType.UpdateProfile, { name: 'IdRenomeNovo' })
    await a.waitFor(WsMessageType.ProfileUpdated)
    expect(a.id).toBe(beforeId)
    store.close()

    const store2 = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store2)
    const renamed = await freshClient('IdRenomeNovo')
    expect(renamed.id).toBe(beforeId)
    store2.close()
  })
})

describe('Confirmação de e-mail na criação de conta', () => {
  let dir: string
  let dbPath: string
  let server: TestServer
  const clients: TestClient[] = []

  async function connectRaw(): Promise<TestClient> {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`)
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve())
      ws.on('error', (err) => reject(err))
    })
    const client = new TestClient(ws)
    clients.push(client)
    return client
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'voip-confirm-'))
    dbPath = join(dir, 'test.db')
  })

  afterEach(async () => {
    for (const c of clients) {
      try { c.ws.terminate() } catch { /* ignore */ }
    }
    clients.length = 0
    if (server) await server.close()
    removeDir(dir)
  })

  it('pede o e-mail ao tentar criar conta com nick novo sem e-mail', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store, [], false)
    const c = await connectRaw()
    c.send(WsMessageType.Login, { name: 'NovoUsuario', password: 'segredo' })
    const emailRequired = await c.waitFor(WsMessageType.EmailRequired)
    expect(emailRequired.payload).toMatchObject({ name: 'NovoUsuario' })
    store.close()
  })

  it('cria conta pendente e envia código de confirmação', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store, [], false)
    const c = await connectRaw()
    c.send(WsMessageType.Login, { name: 'NovoComEmail', password: 'segredo', email: 'novo@test.com' })
    const confirm = await c.waitFor(WsMessageType.ConfirmRequired)
    expect((confirm.payload as { email: string }).email).toBe('novo@test.com')

    const account = store.getAccount('NovoComEmail')
    expect(account?.email).toBe('novo@test.com')
    expect(account?.emailConfirmed).toBe(false)
    expect(account?.confirmCode).toMatch(/^\d{6}$/)
    store.close()
  })

  it('confirma a conta com o código e faz login', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store, [], false)
    const c = await connectRaw()
    c.send(WsMessageType.Login, { name: 'ConfirmaAqui', password: 'segredo', email: 'confirma@test.com' })
    await c.waitFor(WsMessageType.ConfirmRequired)

    const code = store.getAccount('ConfirmaAqui')!.confirmCode!
    c.send(WsMessageType.Login, { name: 'ConfirmaAqui', password: 'segredo', email: 'confirma@test.com', confirmCode: code })
    const welcome = await c.waitFor(WsMessageType.Welcome)
    expect(welcome.payload).toMatchObject({ name: 'ConfirmaAqui' })
    expect(store.getAccount('ConfirmaAqui')?.emailConfirmed).toBe(true)
    store.close()
  })

  it('rejeita código inválido', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store, [], false)
    const c = await connectRaw()
    c.send(WsMessageType.Login, { name: 'CodigoErrado', password: 'segredo', email: 'errado@test.com' })
    await c.waitFor(WsMessageType.ConfirmRequired)

    c.send(WsMessageType.Login, { name: 'CodigoErrado', password: 'segredo', email: 'errado@test.com', confirmCode: '000000' })
    const confirm = await c.waitFor(WsMessageType.ConfirmRequired)
    expect(confirm.payload).toMatchObject({ name: 'CodigoErrado' })
    expect(store.getAccount('CodigoErrado')?.emailConfirmed).toBe(false)
    store.close()
  })

  it('rejeita e-mail já em uso por outra conta', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store, [], false)
    const c = await connectRaw()
    c.send(WsMessageType.Login, { name: 'DonoEmail', password: 'segredo', email: 'dono@test.com' })
    await c.waitFor(WsMessageType.ConfirmRequired)

    const d = await connectRaw()
    d.send(WsMessageType.Login, { name: 'Outro', password: 'x', email: 'dono@test.com' })
    const err = await d.waitFor(WsMessageType.Error)
    expect(err.payload).toBe('Email in use')
    store.close()
  })

  it('login com e-mail de conta existente confirma a identidade', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store, [], false)
    // Cria e confirma a conta
    const c = await connectRaw()
    c.send(WsMessageType.Login, { name: 'LoginPorEmail', password: 'segredo', email: 'login@test.com' })
    await c.waitFor(WsMessageType.ConfirmRequired)
    const code = store.getAccount('LoginPorEmail')!.confirmCode!
    c.send(WsMessageType.Login, { name: 'LoginPorEmail', password: 'segredo', email: 'login@test.com', confirmCode: code })
    await c.waitFor(WsMessageType.Welcome)

    // Sessão anterior terminada; nova conexão pelo e-mail + senha
    for (const cl of clients) { try { cl.ws.terminate() } catch { /* ignore */ } }
    clients.length = 0

    const d = await connectRaw()
    d.send(WsMessageType.Login, { name: 'login@test.com', password: 'segredo' })
    const welcome = await d.waitFor(WsMessageType.Welcome)
    expect((welcome.payload as { name: string }).name).toBe('LoginPorEmail')
    store.close()
  })

  it('e-mail inválido é rejeitado', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store, [], false)
    const c = await connectRaw()
    c.send(WsMessageType.Login, { name: 'EmailRuim', password: 'x', email: 'nao-e-email' })
    const err = await c.waitFor(WsMessageType.Error)
    expect(err.payload).toBe('Invalid email')
    store.close()
  })
})

