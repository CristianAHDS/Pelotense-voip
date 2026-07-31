import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WebSocket } from 'ws'
import { TestClient, TestServer, startTestServer, connectClient } from './helpers.js'
import { WsMessageType, ChatMessage, LiveState } from '../types/index.js'

let server: TestServer
const clients: TestClient[] = []

async function freshClient(name: string, password = 'pass'): Promise<TestClient> {
  const c = await connectClient(server.port, name, password)
  clients.push(c)
  return c
}

beforeEach(async () => {
  server = await startTestServer()
})

afterEach(async () => {
  for (const c of clients) {
    try {
      c.ws.terminate()
    } catch { /* ignore */ }
  }
  clients.length = 0
  await server.close()
})

describe('Login', () => {
  it('aceita login válido e envia welcome com id e nome', async () => {
    const c = await freshClient('Reporter')
    expect(c.id).toBeTruthy()
  })

  it('rejeita login sem nome', async () => {
    const ws = await connectRaw(server.port)
    const client = new TestClient(ws)
    clients.push(client)
    client.send(WsMessageType.Login, { password: 'x' })
    const err = await client.waitFor(WsMessageType.Error)
    expect(err.payload).toBe('Name and password required')
    await client.waitForClose()
  })

  it('rejeita login sem senha', async () => {
    const ws = await connectRaw(server.port)
    const client = new TestClient(ws)
    clients.push(client)
    client.send(WsMessageType.Login, { name: 'x' })
    const err = await client.waitFor(WsMessageType.Error)
    expect(err.payload).toBe('Name and password required')
    await client.waitForClose()
  })

  it('rejeita senha errada para nome existente', async () => {
    await freshClient('Jornalista', 'correta')
    const ws = await connectRaw(server.port)
    const client = new TestClient(ws)
    clients.push(client)
    client.send(WsMessageType.Login, { name: 'Jornalista', password: 'errada' })
    const err = await client.waitFor(WsMessageType.Error)
    expect(err.payload).toBe('Wrong password')
    await client.waitForClose()
  })

  it('substitui sessão anterior quando o mesmo nome loga de novo', async () => {
    const first = await freshClient('Narrador', 'segredo')
    const ws = await connectRaw(server.port)
    const second = new TestClient(ws)
    clients.push(second)
    second.send(WsMessageType.Login, { name: 'Narrador', password: 'segredo' })
    const welcome = await second.waitFor(WsMessageType.Welcome)
    expect(welcome.payload).toMatchObject({ name: 'Narrador' })
    await first.waitForClose()
  })

  it('fecha conexão que envia mensagem antes do login', async () => {
    const ws = await connectRaw(server.port)
    const client = new TestClient(ws)
    clients.push(client)
    client.send(WsMessageType.ChatMessage, { text: 'oi' })
    const err = await client.waitFor(WsMessageType.Error)
    expect(err.payload).toBe('Login first')
    await client.waitForClose()
  })
})

describe('Salas', () => {
  it('lista as 6 salas fixas no room_list', async () => {
    const c = await freshClient('Operador')
    c.send(WsMessageType.ListRooms)
    const msg = await c.waitFor(WsMessageType.RoomList)
    const rooms = msg.payload as Array<{ name: string; fixed: boolean }>
    expect(rooms.length).toBe(6)
    expect(rooms.filter((r) => r.fixed).length).toBe(6)
    expect(rooms.map((r) => r.name)).toEqual(
      expect.arrayContaining(['Externas', 'Trânsito', 'Ao vivo', 'Jornada Esportiva', 'Retorno ao vivo', 'Boletins gravados']),
    )
  })

  it('entra em sala existente e recebe room_joined com histórico', async () => {
    const a = await freshClient('A')
    a.send(WsMessageType.JoinRoom, 'Externas')
    await a.waitFor(WsMessageType.RoomJoined)

    a.send(WsMessageType.ChatMessage, { text: 'ola pessoal' })
    await a.waitFor(WsMessageType.ChatMessage)

    const b = await freshClient('B')
    b.send(WsMessageType.JoinRoom, 'Externas')
    const joined = await b.waitFor(WsMessageType.RoomJoined)
    const msgs = (joined.payload as { messages: ChatMessage[] }).messages
    expect(msgs.some((m) => m.text === 'ola pessoal')).toBe(true)
  })

  it('entrar em sala desconhecida cria a sala automaticamente', async () => {
    const c = await freshClient('Explorador')
    c.send(WsMessageType.JoinRoom, 'Sala Nova')
    const joined = await c.waitFor(WsMessageType.RoomJoined)
    expect((joined.payload as { roomName: string }).roomName).toBe('Sala Nova')
  })

  it('sai da sala e recebe room_left', async () => {
    const c = await freshClient('Volante')
    c.send(WsMessageType.JoinRoom, 'Externas')
    await c.waitFor(WsMessageType.RoomJoined)
    c.send(WsMessageType.LeaveRoom)
    const left = await c.waitFor(WsMessageType.RoomLeft)
    expect(left.payload).toBeDefined()
  })

  it('cria sala e recebe room_created', async () => {
    const c = await freshClient('Criador')
    c.send(WsMessageType.CreateRoom, 'Especiais')
    const created = await c.waitFor(WsMessageType.RoomCreated)
    expect((created.payload as { roomName: string }).roomName).toBe('Especiais')
  })

  it('deleta sala não-fixa e notifica ocupantes', async () => {
    const a = await freshClient('Ocupante1')
    const b = await freshClient('Ocupante2')
    a.send(WsMessageType.CreateRoom, 'Temporaria')
    const created = await a.waitFor(WsMessageType.RoomCreated)
    const roomId = (created.payload as { roomId: string }).roomId

    a.send(WsMessageType.JoinRoom, 'Temporaria')
    await a.waitFor(WsMessageType.RoomJoined)
    b.send(WsMessageType.JoinRoom, 'Temporaria')
    await b.waitFor(WsMessageType.RoomJoined)

    a.send(WsMessageType.DeleteRoom, roomId)
    const leftA = await a.waitFor(WsMessageType.RoomLeft)
    const leftB = await b.waitFor(WsMessageType.RoomLeft)
    expect(leftA.payload).toMatchObject({ roomId })
    expect(leftB.payload).toMatchObject({ roomId })

    const delA = await a.waitFor(WsMessageType.RoomDeleted)
    const delB = await b.waitFor(WsMessageType.RoomDeleted)
    expect(delA.payload).toMatchObject({ roomId })
    expect(delB.payload).toMatchObject({ roomId })
  })

  it('não deleta sala fixa', async () => {
    const c = await freshClient('X')
    c.send(WsMessageType.ListRooms)
    const list = await c.waitFor(WsMessageType.RoomList)
    const rooms = list.payload as Array<{ id: string; name: string; fixed: boolean }>
    const fixed = rooms.find((r) => r.name === 'Externas')!

    c.send(WsMessageType.DeleteRoom, fixed.id)
    c.send(WsMessageType.ListRooms)
    const list2 = await c.waitFor(WsMessageType.RoomList)
    const rooms2 = list2.payload as Array<{ id: string; name: string }>
    expect(rooms2.some((r) => r.id === fixed.id)).toBe(true)
  })

  it('inclui o nome do criador no room_list', async () => {
    const a = await freshClient('DonoSalaNome')
    a.send(WsMessageType.CreateRoom, 'SalaNome')
    await a.waitFor(WsMessageType.RoomCreated)

    const b = await freshClient('OutroSalaNome')
    b.send(WsMessageType.ListRooms)
    const msg = await b.waitFor(WsMessageType.RoomList)
    const rooms = msg.payload as Array<{ name: string; createdBy?: string; createdByName?: string }>
    const sala = rooms.find((r) => r.name === 'SalaNome')!
    expect(sala.createdBy).toBe(a.id)
    expect(sala.createdByName).toBe('DonoSalaNome')
  })

  it('registra o criador em sala criada automaticamente via join', async () => {
    const a = await freshClient('AutoCriador')
    a.send(WsMessageType.JoinRoom, 'SalaAutoCriada')
    await a.waitFor(WsMessageType.RoomJoined)

    const b = await freshClient('AutoOutro')
    b.send(WsMessageType.ListRooms)
    const msg = await b.waitFor(WsMessageType.RoomList)
    const rooms = msg.payload as Array<{ name: string; createdByName?: string }>
    expect(rooms.find((r) => r.name === 'SalaAutoCriada')?.createdByName).toBe('AutoCriador')
  })

  it('inclui transmissão ao vivo no room_list', async () => {
    const b = await freshClient('ReporterList')
    b.send(WsMessageType.JoinRoom, 'Ao vivo')
    await b.waitFor(WsMessageType.RoomJoined)
    b.send(WsMessageType.LiveStart)
    await b.waitFor(WsMessageType.LiveStarted)

    const c = await freshClient('ViewerList')
    c.send(WsMessageType.ListRooms)
    const msg = await c.waitFor(WsMessageType.RoomList)
    const rooms = msg.payload as Array<{ name: string; live?: { userId: string; userName: string } | null }>
    const aoVivo = rooms.find((r) => r.name === 'Ao vivo')!
    expect(aoVivo.live?.userId).toBe(b.id)
    expect(aoVivo.live?.userName).toBe('ReporterList')

    b.send(WsMessageType.LiveStop)
    await b.waitFor(WsMessageType.LiveStopped)

    let liveAfter: { userId: string; userName: string } | null | undefined
    for (let i = 0; i < 3; i++) {
      c.send(WsMessageType.ListRooms)
      const msgN = await c.waitFor(WsMessageType.RoomList)
      const roomsN = msgN.payload as Array<{ name: string; live?: { userId: string; userName: string } | null }>
      liveAfter = roomsN.find((r) => r.name === 'Ao vivo')?.live
      if (!liveAfter) break
    }
    expect(liveAfter).toBeNull()
  })
})

describe('Admin', () => {
  let adminServer: TestServer
  const adminClients: TestClient[] = []

  async function adminClient(name: string, password = 'pass'): Promise<TestClient> {
    const ws = await connectRaw(adminServer.port)
    const client = new TestClient(ws)
    adminClients.push(client)
    client.send(WsMessageType.Login, { name, password })
    const welcome = await client.waitFor(WsMessageType.Welcome)
    const payload = welcome.payload as { id: string }
    ;(ws as unknown as { _clientId: string })._clientId = payload.id
    return client
  }

  beforeEach(async () => {
    adminServer = await startTestServer(100, 20, undefined, ['ChefeAdmin'])
  })

  afterEach(async () => {
    for (const c of adminClients) {
      try {
        c.ws.terminate()
      } catch { /* ignore */ }
    }
    adminClients.length = 0
    await adminServer.close()
  })

  it('marca admin=true no welcome do admin e false para usuário comum', async () => {
    const ws1 = await connectRaw(adminServer.port)
    const c1 = new TestClient(ws1)
    adminClients.push(c1)
    c1.send(WsMessageType.Login, { name: 'ChefeAdmin', password: 'pass' })
    const w1 = await c1.waitFor(WsMessageType.Welcome)
    expect((w1.payload as { admin?: boolean }).admin).toBe(true)

    const ws2 = await connectRaw(adminServer.port)
    const c2 = new TestClient(ws2)
    adminClients.push(c2)
    c2.send(WsMessageType.Login, { name: 'Comum', password: 'pass' })
    const w2 = await c2.waitFor(WsMessageType.Welcome)
    expect((w2.payload as { admin?: boolean }).admin).toBe(false)
  })

  it('inclui o flag admin na lista de usuários', async () => {
    const admin = await adminClient('ChefeAdmin')
    admin.send(WsMessageType.JoinRoom, 'Externas')
    await admin.waitFor(WsMessageType.RoomJoined)

    const comum = await adminClient('Comum')
    comum.send(WsMessageType.JoinRoom, 'Externas')
    await comum.waitFor(WsMessageType.RoomJoined)

    let users: Array<{ name: string; admin?: boolean }> = []
    for (let i = 0; i < 3; i++) {
      const list = await admin.waitFor(WsMessageType.UserList)
      users = list.payload as Array<{ name: string; admin?: boolean }>
      if (users.some((u) => u.name === 'Comum')) break
    }
    expect(users.find((u) => u.name === 'ChefeAdmin')?.admin).toBe(true)
    expect(users.find((u) => u.name === 'Comum')?.admin).toBe(false)
  })

  it('admin pode deletar sala criada por outro usuário', async () => {
    const admin = await adminClient('ChefeAdmin')
    const owner = await adminClient('DonoAdmin')
    owner.send(WsMessageType.CreateRoom, 'SalaDoDono')
    const created = await owner.waitFor(WsMessageType.RoomCreated)
    const roomId = (created.payload as { roomId: string }).roomId

    admin.send(WsMessageType.DeleteRoom, roomId)
    const deleted = await admin.waitFor(WsMessageType.RoomDeleted)
    expect(deleted.payload).toMatchObject({ roomId })
    expect(adminServer.rooms.get(roomId)).toBeUndefined()
  })

  it('não-admin não pode deletar sala criada por outro usuário', async () => {
    const owner = await adminClient('Dono3')
    owner.send(WsMessageType.CreateRoom, 'SalaProtegida')
    const created = await owner.waitFor(WsMessageType.RoomCreated)
    const roomId = (created.payload as { roomId: string }).roomId

    const intruder = await adminClient('Intruso')
    intruder.send(WsMessageType.DeleteRoom, roomId)
    await expect(intruder.waitFor(WsMessageType.RoomDeleted, 300)).rejects.toThrow()
    expect(adminServer.rooms.get(roomId)).toBeDefined()
  })

  it('admin pode encerrar a live de outro usuário', async () => {
    const admin = await adminClient('ChefeAdmin')
    const b = await adminClient('ReporterAdmin')
    b.send(WsMessageType.JoinRoom, 'Ao vivo')
    await b.waitFor(WsMessageType.RoomJoined)
    b.send(WsMessageType.LiveStart)
    await b.waitFor(WsMessageType.LiveStarted)

    admin.send(WsMessageType.JoinRoom, 'Ao vivo')
    await admin.waitFor(WsMessageType.RoomJoined)

    admin.send(WsMessageType.LiveForceStop, { targetUserId: b.id })
    const stopped = await b.waitFor(WsMessageType.LiveStopped)
    expect((stopped.payload as { userId: string }).userId).toBe(b.id)
    expect(adminServer.rooms.getLiveBroadcast(adminServer.rooms.findByName('Ao vivo')!.id)).toBeUndefined()
  })

  it('não-admin não consegue encerrar a live alheia', async () => {
    const a = await adminClient('Comum1')
    const b = await adminClient('Comum2')
    b.send(WsMessageType.JoinRoom, 'Ao vivo')
    await b.waitFor(WsMessageType.RoomJoined)
    b.send(WsMessageType.LiveStart)
    await b.waitFor(WsMessageType.LiveStarted)

    a.send(WsMessageType.JoinRoom, 'Ao vivo')
    await a.waitFor(WsMessageType.RoomJoined)

    a.send(WsMessageType.LiveForceStop, { targetUserId: b.id })
    await expect(a.waitFor(WsMessageType.LiveStopped, 300)).rejects.toThrow()
    const live = adminServer.rooms.getLiveBroadcast(adminServer.rooms.findByName('Ao vivo')!.id)
    expect(live?.userId).toBe(b.id)
  })

  it('admin pode apagar mensagem de outro usuário', async () => {
    const admin = await adminClient('ChefeAdmin')
    const comum = await adminClient('ComumMsg')
    comum.send(WsMessageType.JoinRoom, 'Chats')
    await comum.waitFor(WsMessageType.RoomJoined)
    admin.send(WsMessageType.JoinRoom, 'Chats')
    await admin.waitFor(WsMessageType.RoomJoined)

    comum.send(WsMessageType.ChatMessage, { text: 'mensagem do comum' })
    const received = await admin.waitFor(WsMessageType.ChatMessage)
    const msg = received.payload as ChatMessage

    admin.send(WsMessageType.DeleteMessage, { messageId: msg.id })
    const deleted = await comum.waitFor(WsMessageType.MessageDeleted)
    expect(deleted.payload).toMatchObject({ messageId: msg.id })
    const room = adminServer.rooms.findByName('Chats')
    expect(room!.messages.find((m) => m.id === msg.id)).toBeUndefined()
  })

  it('não-admin não pode apagar mensagem de outro usuário', async () => {
    const a = await adminClient('MsgAutor')
    const b = await adminClient('MsgIntruso')
    a.send(WsMessageType.JoinRoom, 'Chats')
    await a.waitFor(WsMessageType.RoomJoined)
    b.send(WsMessageType.JoinRoom, 'Chats')
    await b.waitFor(WsMessageType.RoomJoined)

    a.send(WsMessageType.ChatMessage, { text: 'mensagem protegida' })
    const received = await b.waitFor(WsMessageType.ChatMessage)
    const msg = received.payload as ChatMessage

    b.send(WsMessageType.DeleteMessage, { messageId: msg.id })
    await expect(b.waitFor(WsMessageType.MessageDeleted, 300)).rejects.toThrow()
    const room = adminServer.rooms.findByName('Chats')
    expect(room!.messages.find((m) => m.id === msg.id)).toBeDefined()
  })
})

describe('Chat', () => {
  async function joinBoth(): Promise<{ a: TestClient; b: TestClient }> {
    const a = await freshClient('ChatA')
    const b = await freshClient('ChatB')
    a.send(WsMessageType.JoinRoom, 'Externas')
    await a.waitFor(WsMessageType.RoomJoined)
    b.send(WsMessageType.JoinRoom, 'Externas')
    await b.waitFor(WsMessageType.RoomJoined)
    return { a, b }
  }

  it('relata mensagem de texto para todos da sala', async () => {
    const { a, b } = await joinBoth()
    a.send(WsMessageType.ChatMessage, { text: 'boa noite' })
    const received = await b.waitFor(WsMessageType.ChatMessage)
    expect((received.payload as ChatMessage).text).toBe('boa noite')
    expect((received.payload as ChatMessage).userId).toBe(a.id)
  })

  it('relata mensagem de áudio para todos da sala', async () => {
    const { a, b } = await joinBoth()
    a.send(WsMessageType.ChatAudioMessage, { audioData: 'aGVsbG8=', duration: 3 })
    const received = await b.waitFor(WsMessageType.ChatAudioMessage)
    expect((received.payload as ChatMessage).audioData).toBe('aGVsbG8=')
    expect((received.payload as ChatMessage).duration).toBe(3)
  })

  it('relata mensagem de vídeo para todos da sala', async () => {
    const { a, b } = await joinBoth()
    a.send(WsMessageType.ChatVideoMessage, { videoData: 'dmlkZW8=', duration: 5 })
    const received = await b.waitFor(WsMessageType.ChatVideoMessage)
    expect((received.payload as ChatMessage).videoData).toBe('dmlkZW8=')
    expect((received.payload as ChatMessage).duration).toBe(5)
  })

  it('apaga apenas a própria mensagem', async () => {
    const { a, b } = await joinBoth()
    a.send(WsMessageType.ChatMessage, { text: 'apagar-me' })
    const received = await b.waitFor(WsMessageType.ChatMessage)
    const msg = received.payload as ChatMessage

    b.send(WsMessageType.DeleteMessage, { messageId: msg.id })
    await expect(b.waitFor(WsMessageType.MessageDeleted, 700)).rejects.toThrow()

    a.send(WsMessageType.DeleteMessage, { messageId: msg.id })
    const deleted = await b.waitFor(WsMessageType.MessageDeleted)
    expect(deleted.payload).toMatchObject({ messageId: msg.id })
  })
})

describe('Mensagens privadas', () => {
  it('envia para o remetente e o destinatário', async () => {
    const a = await freshClient('PvtA')
    const b = await freshClient('PvtB')
    a.send(WsMessageType.PrivateMessage, { toUserId: b.id, text: 'mensagem secreta' })

    const sent = await a.waitFor(WsMessageType.PrivateMessage)
    const received = await b.waitFor(WsMessageType.PrivateMessage)
    expect((sent.payload as { text: string }).text).toBe('mensagem secreta')
    expect((sent.payload as { fromUserId: string }).fromUserId).toBe(a.id)
    expect(received.payload).toEqual(sent.payload)
  })

  it('envia mensagem de áudio para o remetente e o destinatário', async () => {
    const a = await freshClient('PvtAudA')
    const b = await freshClient('PvtAudB')
    a.send(WsMessageType.PrivateAudioMessage, { toUserId: b.id, audioData: 'b3B1cw==', duration: 2 })

    const sent = await a.waitFor(WsMessageType.PrivateAudioMessage)
    const received = await b.waitFor(WsMessageType.PrivateAudioMessage)
    expect((sent.payload as { audioData: string }).audioData).toBe('b3B1cw==')
    expect((sent.payload as { fromUserId: string }).fromUserId).toBe(a.id)
    expect(received.payload).toEqual(sent.payload)
  })

  it('envia mensagem de vídeo para o remetente e o destinatário', async () => {
    const a = await freshClient('PvtVidA')
    const b = await freshClient('PvtVidB')
    a.send(WsMessageType.PrivateVideoMessage, { toUserId: b.id, videoData: 'dmlkZW8=', duration: 4 })

    const sent = await a.waitFor(WsMessageType.PrivateVideoMessage)
    const received = await b.waitFor(WsMessageType.PrivateVideoMessage)
    expect((sent.payload as { videoData: string }).videoData).toBe('dmlkZW8=')
    expect(received.payload).toEqual(sent.payload)
  })
})

describe('Transmissão ao vivo', () => {
  async function startLive(room = 'Ao vivo'): Promise<TestClient> {
    const c = await freshClient('ReporterLive')
    c.send(WsMessageType.JoinRoom, room)
    await c.waitFor(WsMessageType.RoomJoined)
    c.send(WsMessageType.LiveStart)
    await c.waitFor(WsMessageType.LiveStarted)
    return c
  }

  it('inicia transmissão e notifica os demais da sala', async () => {
    const broadcaster = await startLive()
    const viewer = await freshClient('Espectador')
    viewer.send(WsMessageType.JoinRoom, 'Ao vivo')
    await viewer.waitFor(WsMessageType.RoomJoined)

    const started = await viewer.waitFor(WsMessageType.LiveStarted)
    expect((started.payload as { userId: string }).userId).toBe(broadcaster.id)
  })

  it('não repassa live_chunk de volta para o broadcaster', async () => {
    const broadcaster = await startLive()
    const viewer = await freshClient('ViewerChunk')
    viewer.send(WsMessageType.JoinRoom, 'Ao vivo')
    await viewer.waitFor(WsMessageType.RoomJoined)

    broadcaster.send(WsMessageType.LiveChunk, { chunk: 'Y2h1bmsx', duration: 1 })
    const received = await viewer.waitFor(WsMessageType.LiveChunkReceived)
    expect((received.payload as { chunk: string }).chunk).toBe('Y2h1bmsx')

    await expect(broadcaster.waitFor(WsMessageType.LiveChunkReceived, 700)).rejects.toThrow()
  })

  it('novato que entra no meio recebe o initChunk', async () => {
    const broadcaster = await startLive()
    broadcaster.send(WsMessageType.LiveChunk, { chunk: 'aW5pdA==', duration: 0 })

    const late = await freshClient('ChegandoAgora')
    late.send(WsMessageType.JoinRoom, 'Ao vivo')
    await late.waitFor(WsMessageType.RoomJoined)

    const started = await late.waitFor(WsMessageType.LiveStarted)
    expect((started.payload as { userId: string }).userId).toBe(broadcaster.id)

    const init = await late.waitFor(WsMessageType.LiveChunkReceived)
    expect((init.payload as { chunk: string }).chunk).toBe('aW5pdA==')
  })

  it('primeiro chunk enviado é cacheado como initChunk (persistência no servidor)', async () => {
    const broadcaster = await startLive()
    const viewer = await freshClient('ViewerInit')
    viewer.send(WsMessageType.JoinRoom, 'Ao vivo')
    await viewer.waitFor(WsMessageType.RoomJoined)

    broadcaster.send(WsMessageType.LiveChunk, { chunk: 'cHJpbWVpcm8=', duration: 1 })
    await viewer.waitFor(WsMessageType.LiveChunkReceived)
    broadcaster.send(WsMessageType.LiveChunk, { chunk: 'c2VndW5kbw==', duration: 1 })
    await viewer.waitFor(WsMessageType.LiveChunkReceived)

    const state = server.rooms.getLiveBroadcast(
      server.rooms.findByName('Ao vivo')!.id,
    ) as LiveState
    expect(state.initChunk).toBe('cHJpbWVpcm8=')
  })

  it('para a transmissão e notifica os espectadores', async () => {
    const broadcaster = await startLive()
    const viewer = await freshClient('ViewerStop')
    viewer.send(WsMessageType.JoinRoom, 'Ao vivo')
    await viewer.waitFor(WsMessageType.RoomJoined)

    broadcaster.send(WsMessageType.LiveStop)
    const stopped = await viewer.waitFor(WsMessageType.LiveStopped)
    expect((stopped.payload as { userId: string }).userId).toBe(broadcaster.id)
    expect(server.rooms.getLiveBroadcast(server.rooms.findByName('Ao vivo')!.id)).toBeUndefined()
  })

  it('trocar de sala encerra a transmissão e avisa quem ficou na sala antiga', async () => {
    const broadcaster = await startLive()
    const viewer = await freshClient('ViewerSwap')
    viewer.send(WsMessageType.JoinRoom, 'Ao vivo')
    await viewer.waitFor(WsMessageType.RoomJoined)

    broadcaster.send(WsMessageType.JoinRoom, 'Externas')
    await broadcaster.waitFor(WsMessageType.RoomJoined)

    const stopped = await viewer.waitFor(WsMessageType.LiveStopped)
    expect((stopped.payload as { userId: string }).userId).toBe(broadcaster.id)
    expect(server.rooms.getLiveBroadcast(server.rooms.findByName('Ao vivo')!.id)).toBeUndefined()
  })

  it('deletar a sala da transmissão encerra a live do broadcaster', async () => {
    const broadcaster = await freshClient('DonoTemp')
    broadcaster.send(WsMessageType.CreateRoom, 'TransmissaoTemp')
    const created = await broadcaster.waitFor(WsMessageType.RoomCreated)
    const roomId = (created.payload as { roomId: string }).roomId

    broadcaster.send(WsMessageType.JoinRoom, 'TransmissaoTemp')
    await broadcaster.waitFor(WsMessageType.RoomJoined)
    broadcaster.send(WsMessageType.LiveStart)
    await broadcaster.waitFor(WsMessageType.LiveStarted)

    broadcaster.send(WsMessageType.DeleteRoom, roomId)

    const stopped = await broadcaster.waitFor(WsMessageType.LiveStopped)
    expect((stopped.payload as { userId: string }).userId).toBe(broadcaster.id)
    expect(server.rooms.getLiveBroadcast(roomId)).toBeUndefined()
    expect(server.rooms.get(roomId)).toBeUndefined()
  })
})

describe('Takeover', () => {
  async function broadcasterAndRequester(): Promise<{ broadcaster: TestClient; requester: TestClient }> {
    const broadcaster = await freshClient('DonoLive')
    broadcaster.send(WsMessageType.JoinRoom, 'Ao vivo')
    await broadcaster.waitFor(WsMessageType.RoomJoined)
    broadcaster.send(WsMessageType.LiveStart)
    await broadcaster.waitFor(WsMessageType.LiveStarted)

    const requester = await freshClient('QueroLive')
    requester.send(WsMessageType.JoinRoom, 'Ao vivo')
    await requester.waitFor(WsMessageType.RoomJoined)
    requester.send(WsMessageType.LiveStart)
    return { broadcaster, requester }
  }

  it('solicita takeover e o broadcaster recebe live_request', async () => {
    const { broadcaster, requester } = await broadcasterAndRequester()
    const req = await broadcaster.waitFor(WsMessageType.LiveRequest)
    expect((req.payload as { fromUserId: string }).fromUserId).toBe(requester.id)
    expect((req.payload as { fromUserName: string }).fromUserName).toBe('QueroLive')
  })

  it('permite takeover: encerra live e avisa o requerente', async () => {
    const { broadcaster, requester } = await broadcasterAndRequester()
    await broadcaster.waitFor(WsMessageType.LiveRequest)

    broadcaster.send(WsMessageType.LiveRequestResponse, { allow: true, requesterId: requester.id })

    const resp = await requester.waitFor(WsMessageType.LiveRequestResponse)
    expect((resp.payload as { allow: boolean }).allow).toBe(true)

    const stopped = await broadcaster.waitFor(WsMessageType.LiveStopped)
    expect((stopped.payload as { userId: string }).userId).toBe(broadcaster.id)

    expect(server.rooms.getLiveBroadcast(server.rooms.findByName('Ao vivo')!.id)).toBeUndefined()
  })

  it('nega takeover: requerente é avisado e broadcaster segue transmitindo', async () => {
    const { broadcaster, requester } = await broadcasterAndRequester()
    await broadcaster.waitFor(WsMessageType.LiveRequest)

    broadcaster.send(WsMessageType.LiveRequestResponse, { allow: false, requesterId: requester.id })

    const resp = await requester.waitFor(WsMessageType.LiveRequestResponse)
    expect((resp.payload as { allow: boolean }).allow).toBe(false)

    const live = server.rooms.getLiveBroadcast(server.rooms.findByName('Ao vivo')!.id)
    expect(live?.userId).toBe(broadcaster.id)
    expect(live?.takeoverRequesterId).toBeUndefined()
  })

  it('cancela pedido de takeover e o broadcaster é notificado', async () => {
    const { broadcaster, requester } = await broadcasterAndRequester()
    await broadcaster.waitFor(WsMessageType.LiveRequest)

    requester.send(WsMessageType.LiveRequestCancel)
    const cancelled = await broadcaster.waitFor(WsMessageType.LiveRequestCancelled)
    expect((cancelled.payload as { fromUserId: string }).fromUserId).toBe(requester.id)

    const live = server.rooms.getLiveBroadcast(server.rooms.findByName('Ao vivo')!.id)
    expect(live?.takeoverRequesterId).toBeUndefined()
  })

  it('após cancelar, um novo pedido do mesmo usuário volta a funcionar', async () => {
    const { broadcaster, requester } = await broadcasterAndRequester()
    await broadcaster.waitFor(WsMessageType.LiveRequest)
    requester.send(WsMessageType.LiveRequestCancel)
    await broadcaster.waitFor(WsMessageType.LiveRequestCancelled)

    requester.send(WsMessageType.LiveStart)
    const req2 = await broadcaster.waitFor(WsMessageType.LiveRequest)
    expect((req2.payload as { fromUserId: string }).fromUserId).toBe(requester.id)
  })

  it('auto-concede takeover quando o broadcaster para a live', async () => {
    const { broadcaster, requester } = await broadcasterAndRequester()
    await broadcaster.waitFor(WsMessageType.LiveRequest)

    broadcaster.send(WsMessageType.LiveStop)
    const resp = await requester.waitFor(WsMessageType.LiveRequestResponse)
    expect((resp.payload as { allow: boolean }).allow).toBe(true)
  })

  it('auto-concede takeover quando o broadcaster desconecta', async () => {
    const { broadcaster, requester } = await broadcasterAndRequester()
    await broadcaster.waitFor(WsMessageType.LiveRequest)

    broadcaster.ws.terminate()
    const resp = await requester.waitFor(WsMessageType.LiveRequestResponse)
    expect((resp.payload as { allow: boolean }).allow).toBe(true)
  })

  it('auto-concede takeover quando o broadcaster sai da sala', async () => {
    const { broadcaster, requester } = await broadcasterAndRequester()
    await broadcaster.waitFor(WsMessageType.LiveRequest)

    broadcaster.send(WsMessageType.LeaveRoom)
    const resp = await requester.waitFor(WsMessageType.LiveRequestResponse)
    expect((resp.payload as { allow: boolean }).allow).toBe(true)
  })
})

describe('Conexões mortas', () => {
  it('expira clientes sem heartbeat dentro do timeout', async () => {
    const c = await freshClient('Adormecido')
    const stored = server.clients.get(c.id)!
    stored.lastPing = Date.now() - 60000

    server.handler.checkDeadConnections(30000)
    await c.waitForClose()

    expect(server.clients.get(c.id)).toBeUndefined()
  })

  it('mantém clientes com heartbeat recente', async () => {
    const c = await freshClient('Ativo')
    server.handler.checkDeadConnections(30000)
    expect(server.clients.get(c.id)).toBeDefined()
    await expect(c.waitForClose(700)).rejects.toThrow()
  })
})

describe('Voz (binário)', () => {
  it('retransmite frames binários com prefixo de 8 bytes do remetente', async () => {
    const a = await freshClient('VozA')
    const b = await freshClient('VozB')
    a.send(WsMessageType.JoinRoom, 'Externas')
    await a.waitFor(WsMessageType.RoomJoined)
    b.send(WsMessageType.JoinRoom, 'Externas')
    await b.waitFor(WsMessageType.RoomJoined)

    const payload = Buffer.from([1, 2, 3, 4])
    a.ws.send(payload)

    const received = await b.waitForBinary()
    expect(received.length).toBe(8 + payload.length)
    const prefix = received.subarray(0, 8).toString('utf8').replace(/\0+$/, '')
    expect(prefix).toBe(a.id)
    expect(received.subarray(8)).toEqual(payload)
  })

  it('não reenvia o frame binário para o próprio remetente', async () => {
    const a = await freshClient('VozSolo')
    a.send(WsMessageType.JoinRoom, 'Externas')
    await a.waitFor(WsMessageType.RoomJoined)
    a.ws.send(Buffer.from([9]))
    await expect(a.waitForBinary(700)).rejects.toThrow()
  })
})

async function connectRaw(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve())
    ws.on('error', (err) => reject(err))
  })
  return ws
}
