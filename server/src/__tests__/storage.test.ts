import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { WebSocket } from 'ws'
import Database from 'better-sqlite3'
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

  it('migra banco antigo: adiciona colunas que faltam em private_messages (ex: toUserName)', () => {
    store.close()
    removeDir(dir)
    dir = mkdtempSync(join(tmpdir(), 'voip-sqlite-mig-'))
    const dbPath = join(dir, 'test.db')

    // Simula um banco com schema antigo da tabela de DMs (sem toUserName).
    const raw = new Database(dbPath)
    raw.exec(`
      CREATE TABLE private_messages (
        id TEXT PRIMARY KEY,
        fromUserId TEXT NOT NULL,
        fromUserName TEXT NOT NULL,
        toUserId TEXT NOT NULL,
        text TEXT,
        timestamp INTEGER NOT NULL
      );
    `)
    raw.close()

    store = new SqliteStore(dbPath)
    store.savePrivateMessage({
      id: 'pm1',
      fromUserId: 'a',
      fromUserName: 'Ana',
      toUserId: 'b',
      toUserName: 'Bia',
      text: 'oi',
      timestamp: 1,
    })
    const msgs = store.loadPrivateMessages('Ana', 'Bia')
    expect(msgs.length).toBe(1)
    expect(msgs[0].text).toBe('oi')
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

describe('Criação e login de conta', () => {
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
    dir = mkdtempSync(join(tmpdir(), 'voip-account-'))
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

  it('cria a conta se o nick não existe', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store)
    const c = await connectRaw()
    c.send(WsMessageType.Login, { name: 'NovoNick', password: 'segredo', email: 'novo@test.com' })
    const welcome = await c.waitFor(WsMessageType.Welcome)
    expect(welcome.payload).toMatchObject({ name: 'NovoNick' })
    expect(store.getAccount('NovoNick')).toMatchObject({ email: 'novo@test.com' })
    store.close()
  })

  it('cria a conta sem e-mail quando o nick não existe', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store)
    const c = await connectRaw()
    c.send(WsMessageType.Login, { name: 'SemEmail', password: 'segredo' })
    const welcome = await c.waitFor(WsMessageType.Welcome)
    expect(welcome.payload).toMatchObject({ name: 'SemEmail' })
    store.close()
  })

  it('registro tradicional exige e-mail', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store)
    const c = await connectRaw()
    c.send(WsMessageType.Login, { name: 'SemEmailReg', password: 'segredo', intent: 'register' })
    const err = await c.waitFor(WsMessageType.Error)
    expect(err.payload).toBe('Email required')
    store.close()
  })

  it('registro tradicional cria a conta com e-mail e nome livre', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store)
    const c = await connectRaw()
    c.send(WsMessageType.Login, { name: 'RegistroNovo', password: 'segredo', email: 'reg@test.com', intent: 'register' })
    const welcome = await c.waitFor(WsMessageType.Welcome)
    expect(welcome.payload).toMatchObject({ name: 'RegistroNovo' })
    expect(store.getAccount('RegistroNovo')).toMatchObject({ email: 'reg@test.com', password: 'segredo' })
    store.close()
  })

  it('registro tradicional rejeita nome já em uso', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store)
    const c = await connectRaw()
    c.send(WsMessageType.Login, { name: 'Duplicado', password: 'segredo', email: 'dup@test.com', intent: 'register' })
    await c.waitFor(WsMessageType.Welcome)
    for (const cl of clients) { try { cl.ws.terminate() } catch { /* ignore */ } }
    clients.length = 0

    const d = await connectRaw()
    d.send(WsMessageType.Login, { name: 'Duplicado', password: 'outra', email: 'dup2@test.com', intent: 'register' })
    const err = await d.waitFor(WsMessageType.Error)
    expect(err.payload).toBe('Name in use')
    store.close()
  })

  it('login tradicional rejeita conta inexistente em vez de criá-la', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store)
    const c = await connectRaw()
    c.send(WsMessageType.Login, { name: 'NaoExiste', password: 'segredo', intent: 'login' })
    const err = await c.waitFor(WsMessageType.Error)
    expect(err.payload).toBe('Account not found')
    expect(store.getAccount('NaoExiste')).toBeUndefined()
    store.close()
  })

  it('login tradicional aceita conta existente criada no registro', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store)
    const c = await connectRaw()
    c.send(WsMessageType.Login, { name: 'DepoisLogin', password: 'segredo', email: 'dl@test.com', intent: 'register' })
    await c.waitFor(WsMessageType.Welcome)
    for (const cl of clients) { try { cl.ws.terminate() } catch { /* ignore */ } }
    clients.length = 0

    const d = await connectRaw()
    d.send(WsMessageType.Login, { name: 'DepoisLogin', password: 'segredo', intent: 'login' })
    const welcome = await d.waitFor(WsMessageType.Welcome)
    expect(welcome.payload).toMatchObject({ name: 'DepoisLogin' })
    store.close()
  })

  it('login por nick + senha quando a conta existe', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store)
    const c = await connectRaw()
    c.send(WsMessageType.Login, { name: 'Existente', password: 'segredo', email: 'exist@test.com' })
    await c.waitFor(WsMessageType.Welcome)
    for (const cl of clients) { try { cl.ws.terminate() } catch { /* ignore */ } }
    clients.length = 0

    const d = await connectRaw()
    d.send(WsMessageType.Login, { name: 'Existente', password: 'segredo' })
    const welcome = await d.waitFor(WsMessageType.Welcome)
    expect(welcome.payload).toMatchObject({ name: 'Existente' })
    store.close()
  })

  it('login por e-mail + senha quando a conta existe', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store)
    const c = await connectRaw()
    c.send(WsMessageType.Login, { name: 'PorEmail', password: 'segredo', email: 'mail@test.com' })
    await c.waitFor(WsMessageType.Welcome)
    for (const cl of clients) { try { cl.ws.terminate() } catch { /* ignore */ } }
    clients.length = 0

    const d = await connectRaw()
    d.send(WsMessageType.Login, { name: 'mail@test.com', password: 'segredo' })
    const welcome = await d.waitFor(WsMessageType.Welcome)
    expect((welcome.payload as { name: string }).name).toBe('PorEmail')
    store.close()
  })

  it('rejeita senha errada para conta existente', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store)
    const c = await connectRaw()
    c.send(WsMessageType.Login, { name: 'ComSenha', password: 'correta', email: 'senha@test.com' })
    await c.waitFor(WsMessageType.Welcome)
    for (const cl of clients) { try { cl.ws.terminate() } catch { /* ignore */ } }
    clients.length = 0

    const d = await connectRaw()
    d.send(WsMessageType.Login, { name: 'ComSenha', password: 'errada' })
    const err = await d.waitFor(WsMessageType.Error)
    expect(err.payload).toBe('Wrong password')
    store.close()
  })

  it('rejeita e-mail já em uso por outra conta', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store)
    const c = await connectRaw()
    c.send(WsMessageType.Login, { name: 'DonoEmail', password: 'segredo', email: 'dono@test.com' })
    await c.waitFor(WsMessageType.Welcome)

    const d = await connectRaw()
    d.send(WsMessageType.Login, { name: 'Outro', password: 'x', email: 'dono@test.com' })
    const err = await d.waitFor(WsMessageType.Error)
    expect(err.payload).toBe('Email in use')
    store.close()
  })

  it('rejeita e-mail inválido', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store)
    const c = await connectRaw()
    c.send(WsMessageType.Login, { name: 'EmailRuim', password: 'x', email: 'nao-e-email' })
    const err = await c.waitFor(WsMessageType.Error)
    expect(err.payload).toBe('Invalid email')
    store.close()
  })

  it('list_accounts retorna contas cadastradas com status online/offline', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store)
    const a = await connectRaw()
    a.send(WsMessageType.Login, { name: 'ContaOffline', password: 'segredo', email: 'off@test.com' })
    await a.waitFor(WsMessageType.Welcome)

    a.ws.terminate()

    const b = await connectRaw()
    b.send(WsMessageType.Login, { name: 'ContaOnline', password: 'segredo', email: 'on@test.com' })
    await b.waitFor(WsMessageType.Welcome)

    b.send(WsMessageType.ListAccounts)
    const msg = await b.waitFor(WsMessageType.AccountsList)
    const accounts = msg.payload as Array<{ name: string; online: boolean; admin: boolean }>
    const offline = accounts.find((x) => x.name === 'ContaOffline')
    const online = accounts.find((x) => x.name === 'ContaOnline')
    expect(offline).toBeDefined()
    expect(offline!.online).toBe(false)
    expect(online).toBeDefined()
    expect(online!.online).toBe(true)
    store.close()
  })

  it('admin_update_account altera nick/e-mail/senha e flag de admin do alvo', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, ['ChefeAdmin'], store)
    const admin = await connectRaw()
    admin.send(WsMessageType.Login, { name: 'ChefeAdmin', password: 'pass' })
    await admin.waitFor(WsMessageType.Welcome)

    const target = await connectRaw()
    target.send(WsMessageType.Login, { name: 'Alvo', password: 'segredo', email: 'alvo@test.com' })
    await target.waitFor(WsMessageType.Welcome)

    admin.send(WsMessageType.AdminUpdateAccount, {
      userName: 'Alvo',
      name: 'AlvoEditado',
      email: 'editado@test.com',
      password: 'nova',
      isAdmin: true,
    })
    const list = await admin.waitFor(WsMessageType.AccountsList)
    const accounts = list.payload as Array<{ name: string; admin: boolean }>
    const edited = accounts.find((x) => x.name === 'AlvoEditado')
    expect(edited).toBeDefined()
    expect(edited!.admin).toBe(true)

    const saved = store.getAccount('AlvoEditado')
    expect(saved).toMatchObject({ email: 'editado@test.com', password: 'nova', isAdmin: true })
    expect(store.getAccount('Alvo')).toBeUndefined()
    store.close()
  })

  it('admin_update_account é ignorado para quem não é admin', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store)
    const comum = await connectRaw()
    comum.send(WsMessageType.Login, { name: 'Comum', password: 'pass' })
    await comum.waitFor(WsMessageType.Welcome)

    comum.send(WsMessageType.AdminUpdateAccount, { userName: 'Comum', name: 'Hacker', isAdmin: true })
    await expect(comum.waitFor(WsMessageType.AccountsList, 700)).rejects.toThrow()
    expect(store.getAccount('Comum')?.name).toBe('Comum')
    store.close()
  })

  it('admin_update_account persiste tags e aparece na lista de contas', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, ['ChefeAdmin'], store)
    const admin = await connectRaw()
    admin.send(WsMessageType.Login, { name: 'ChefeAdmin', password: 'pass' })
    await admin.waitFor(WsMessageType.Welcome)

    const target = await connectRaw()
    target.send(WsMessageType.Login, { name: 'AlvoTags', password: 'segredo' })
    await target.waitFor(WsMessageType.Welcome)

    admin.send(WsMessageType.AdminUpdateAccount, {
      userName: 'AlvoTags',
      tags: ['Repórter', 'Vídeo'],
    })
    const list = await admin.waitFor(WsMessageType.AccountsList)
    const accounts = list.payload as Array<{ name: string; tags?: string[] }>
    const edited = accounts.find((x) => x.name === 'AlvoTags')
    expect(edited?.tags).toEqual(['Repórter', 'Vídeo'])

    const saved = store.getAccount('AlvoTags')
    expect(saved?.tags).toEqual(['Repórter', 'Vídeo'])
    store.close()
  })
})

describe('Deleção de mensagens privadas', () => {
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

  async function loginClient(name: string): Promise<TestClient> {
    const client = await connectRaw()
    client.send(WsMessageType.Login, { name, password: 'pass' })
    const welcome = await client.waitFor(WsMessageType.Welcome)
    ;(client.ws as unknown as { _clientId: string })._clientId = (welcome.payload as { id: string }).id
    return client
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'voip-pvt-del-'))
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

  it('deleta mensagem privada pelo autor e notifica os dois lados', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store)
    const a = await loginClient('PvtDelA')
    const b = await loginClient('PvtDelB')

    a.send(WsMessageType.PrivateMessage, { toUserId: b.id, text: 'apagar isso' })
    const sent = await a.waitFor(WsMessageType.PrivateMessage)
    const msgId = (sent.payload as { id: string }).id
    await b.waitFor(WsMessageType.PrivateMessage)

    a.send(WsMessageType.DeletePrivateMessage, { messageId: msgId })
    const delA = await a.waitFor(WsMessageType.PrivateMessageDeleted)
    const delB = await b.waitFor(WsMessageType.PrivateMessageDeleted)
    expect(delA.payload).toEqual({ messageId: msgId })
    expect(delB.payload).toEqual({ messageId: msgId })
    expect(store.getPrivateMessage(msgId)).toBeUndefined()
    store.close()
  })

  it('não deixa usuário apagar mensagem privada de outro', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store)
    const a = await loginClient('PvtDelC')
    const b = await loginClient('PvtDelD')
    const c = await loginClient('PvtDelE')

    a.send(WsMessageType.PrivateMessage, { toUserId: b.id, text: 'minha msg' })
    const sent = await a.waitFor(WsMessageType.PrivateMessage)
    const msgId = (sent.payload as { id: string }).id

    c.send(WsMessageType.DeletePrivateMessage, { messageId: msgId })
    await expect(c.waitFor(WsMessageType.PrivateMessageDeleted, 700)).rejects.toThrow()
    expect(store.getPrivateMessage(msgId)).toBeDefined()
    store.close()
  })

  it('mensagens privadas persistem após reconexão (refresh) com destinatário offline', async () => {
    const store = new SqliteStore(dbPath)
    server = await startTestServer(100, 20, undefined, [], store)
    const a = await loginClient('PvtPersA')
    const b = await loginClient('PvtPersB')
    const bId = b.id!

    a.send(WsMessageType.PrivateMessage, { toUserId: bId, text: 'persiste isso' })
    const sent = await a.waitFor(WsMessageType.PrivateMessage)
    const msgId = (sent.payload as { id: string }).id

    // "Refresh": desconecta tudo e reconecta só o A (B fica offline).
    for (const cl of clients) {
      try { cl.ws.terminate() } catch { /* ignore */ }
    }
    clients.length = 0

    const a2 = await loginClient('PvtPersA')
    a2.send(WsMessageType.ListPrivateMessages, { withUserId: bId })
    const history = await a2.waitFor(WsMessageType.PrivateHistory)
    const msgs = (history.payload as { messages: Array<{ id: string; text: string }> }).messages
    expect(msgs.some((m) => m.id === msgId && m.text === 'persiste isso')).toBe(true)
    store.close()
  })
})


