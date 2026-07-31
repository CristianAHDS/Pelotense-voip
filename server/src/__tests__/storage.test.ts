import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
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
})

