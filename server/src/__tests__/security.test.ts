import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WebSocket } from 'ws'
import { TestClient, TestServer, startTestServer, connectClient } from './helpers.js'
import { WsMessageType, SecurityLimits } from '../types/index.js'

const LIMITS: SecurityLimits = {
  maxNameLength: 8,
  maxPasswordLength: 12,
  maxRoomNameLength: 10,
  maxTextLength: 50,
  maxAudioMessageBytes: 100,
  maxVideoMessageBytes: 100,
  maxImageMessageBytes: 100,
  maxLiveChunkBytes: 100,
  maxVoiceFrameBytes: 100,
}

let server: TestServer
const clients: TestClient[] = []

async function freshClient(name: string, password = 'pass'): Promise<TestClient> {
  const c = await connectClient(server.port, name, password)
  clients.push(c)
  return c
}

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

async function joinBoth(): Promise<{ a: TestClient; b: TestClient }> {
  const a = await freshClient('ChatA')
  const b = await freshClient('ChatB')
  a.send(WsMessageType.JoinRoom, 'Externas')
  await a.waitFor(WsMessageType.RoomJoined)
  b.send(WsMessageType.JoinRoom, 'Externas')
  await b.waitFor(WsMessageType.RoomJoined)
  return { a, b }
}

beforeEach(async () => {
  server = await startTestServer(100, 20, LIMITS)
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

describe('Limites de login', () => {
  it('rejeita login com nome acima do limite', async () => {
    const c = await connectRaw()
    c.send(WsMessageType.Login, { name: 'nome-muito-longoooo', password: 'x' })
    const err = await c.waitFor(WsMessageType.Error)
    expect(err.payload).toBe('Name too long')
    await c.waitForClose()
  })

  it('rejeita login com senha acima do limite', async () => {
    const c = await connectRaw()
    c.send(WsMessageType.Login, { name: 'user', password: 'senha-bem-longa-123' })
    const err = await c.waitFor(WsMessageType.Error)
    expect(err.payload).toBe('Password too long')
    await c.waitForClose()
  })

  it('aceita login dentro dos limites', async () => {
    const c = await freshClient('Radyo', 'segredo')
    expect(c.id).toBeTruthy()
  })
})

describe('Limites de mensagens', () => {
  it('descarta mensagem de texto acima do limite', async () => {
    const { a, b } = await joinBoth()
    a.send(WsMessageType.ChatMessage, { text: 'x'.repeat(51) })
    await expect(b.waitFor(WsMessageType.ChatMessage, 700)).rejects.toThrow()
    const room = server.rooms.findByName('Externas')!
    expect(room.messages).toHaveLength(0)
  })

  it('relata mensagem de texto dentro do limite', async () => {
    const { a, b } = await joinBoth()
    a.send(WsMessageType.ChatMessage, { text: 'mensagem curta' })
    const received = await b.waitFor(WsMessageType.ChatMessage)
    expect((received.payload as { text: string }).text).toBe('mensagem curta')
  })

  it('descarta mensagem de áudio acima do limite', async () => {
    const { a, b } = await joinBoth()
    a.send(WsMessageType.ChatAudioMessage, { audioData: 'a'.repeat(200), duration: 3 })
    await expect(b.waitFor(WsMessageType.ChatAudioMessage, 700)).rejects.toThrow()
    const room = server.rooms.findByName('Externas')!
    expect(room.messages).toHaveLength(0)
  })

  it('descarta mensagem de vídeo acima do limite', async () => {
    const { a, b } = await joinBoth()
    a.send(WsMessageType.ChatVideoMessage, { videoData: 'b'.repeat(200), duration: 5 })
    await expect(b.waitFor(WsMessageType.ChatVideoMessage, 700)).rejects.toThrow()
    const room = server.rooms.findByName('Externas')!
    expect(room.messages).toHaveLength(0)
  })

  it('descarta mensagem privada acima do limite', async () => {
    const a = await freshClient('PvtA')
    const b = await freshClient('PvtB')
    a.send(WsMessageType.PrivateMessage, { toUserId: b.id, text: 'y'.repeat(51) })
    await expect(b.waitFor(WsMessageType.PrivateMessage, 700)).rejects.toThrow()
  })
})

describe('Limites de live e voz', () => {
  it('descarta chunk ao vivo acima do limite', async () => {
    const broadcaster = await freshClient('LiveBc')
    broadcaster.send(WsMessageType.JoinRoom, 'Ao vivo')
    await broadcaster.waitFor(WsMessageType.RoomJoined)
    broadcaster.send(WsMessageType.LiveStart)
    await broadcaster.waitFor(WsMessageType.LiveStarted)

    const viewer = await freshClient('Viewer')
    viewer.send(WsMessageType.JoinRoom, 'Ao vivo')
    await viewer.waitFor(WsMessageType.RoomJoined)

    broadcaster.send(WsMessageType.LiveChunk, { chunk: 'c'.repeat(200), duration: 1 })
    await expect(viewer.waitFor(WsMessageType.LiveChunkReceived, 700)).rejects.toThrow()
  })

  it('descarta frame de voz binário acima do limite', async () => {
    const a = await freshClient('VozA')
    const b = await freshClient('VozB')
    a.send(WsMessageType.JoinRoom, 'Externas')
    await a.waitFor(WsMessageType.RoomJoined)
    b.send(WsMessageType.JoinRoom, 'Externas')
    await b.waitFor(WsMessageType.RoomJoined)

    a.ws.send(Buffer.alloc(101))
    await expect(b.waitForBinary(700)).rejects.toThrow()
  })

  it('retransmite frame de voz binário dentro do limite', async () => {
    const a = await freshClient('VozC')
    const b = await freshClient('VozD')
    a.send(WsMessageType.JoinRoom, 'Externas')
    await a.waitFor(WsMessageType.RoomJoined)
    b.send(WsMessageType.JoinRoom, 'Externas')
    await b.waitFor(WsMessageType.RoomJoined)

    a.ws.send(Buffer.alloc(10))
    const received = await b.waitForBinary()
    expect(received.length).toBe(8 + 10)
  })
})

describe('Limites de nome de sala', () => {
  it('descarta criação de sala com nome acima do limite', async () => {
    const c = await freshClient('Criador')
    c.send(WsMessageType.CreateRoom, 'nome-de-sala-muito-grande')
    await expect(c.waitFor(WsMessageType.RoomCreated, 700)).rejects.toThrow()
    expect(server.rooms.findByName('nome-de-sala-muito-grande')).toBeNull()
  })

  it('descarta join em sala com nome acima do limite', async () => {
    const c = await freshClient('Joiner')
    c.send(WsMessageType.JoinRoom, 'nome-de-sala-muito-grande')
    await expect(c.waitFor(WsMessageType.RoomJoined, 700)).rejects.toThrow()
    expect(server.clients.get(c.id!)?.room).toBeNull()
  })

  it('cria sala com nome dentro do limite', async () => {
    const c = await freshClient('Criador2')
    c.send(WsMessageType.CreateRoom, 'Curta')
    const created = await c.waitFor(WsMessageType.RoomCreated)
    expect((created.payload as { roomName: string }).roomName).toBe('Curta')
  })
})
