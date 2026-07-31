import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { WsMessageType } from '../types/index.ts'
import { WsClient } from '../network/wsClient.ts'

let instances: FakeWs[] = []

class FakeWs {
  static OPEN = 1
  readyState = 0
  sent: unknown[] = []
  binaryType = ''
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  constructor(public url: string) {
    instances.push(this)
  }
  send(data: unknown): void {
    this.sent.push(data)
  }
  close(): void {
    this.readyState = 3
  }
}

let client: WsClient | null = null

function open(ws: FakeWs): void {
  ws.readyState = FakeWs.OPEN
  ws.onopen?.()
}

beforeEach(() => {
  instances = []
  ;(globalThis as any).WebSocket = FakeWs
})

afterEach(() => {
  client?.disconnect()
  client = null
  ;(globalThis as any).WebSocket = undefined
})

describe('wsClient', () => {
  it('enfileira mensagens enviadas com o socket fechado e reenvia após reconectar', () => {
    client = new WsClient()
    client.connect('ws://x')
    const ws = instances[0]

    client.send(WsMessageType.ChatMessage, { text: 'oi' })
    expect(ws.sent).toHaveLength(0)

    open(ws)

    expect(ws.sent).toContain(JSON.stringify({ type: WsMessageType.ChatMessage, payload: { text: 'oi' } }))
  })

  it('envia imediatamente quando o socket está aberto (sem fila)', () => {
    client = new WsClient()
    client.connect('ws://x')
    const ws = instances[0]
    open(ws)

    client.send(WsMessageType.ChatMessage, { text: 'já conectado' })

    expect(ws.sent).toContain(JSON.stringify({ type: WsMessageType.ChatMessage, payload: { text: 'já conectado' } }))
  })

  it('não enfileira dados binários (voz em tempo real)', () => {
    client = new WsClient()
    client.connect('ws://x')
    const ws = instances[0]

    client.sendBinary(new ArrayBuffer(8))
    open(ws)

    expect(ws.sent).toHaveLength(0)
  })

  it('descarta a fila em desconexão intencional', () => {
    client = new WsClient()
    client.connect('ws://x')
    client.send(WsMessageType.ChatMessage, { text: 'oi' })
    client.disconnect()

    client.connect('ws://y')
    const ws2 = instances[1]
    open(ws2)

    expect(ws2.sent).not.toContain(JSON.stringify({ type: WsMessageType.ChatMessage, payload: { text: 'oi' } }))
  })

  it('mantém a fila através da reconexão automática', () => {
    vi.useFakeTimers()
    client = new WsClient()
    client.connect('ws://x')
    const ws = instances[0]

    client.send(WsMessageType.ChatMessage, { text: 'oi' })
    ws.readyState = 3
    ws.onclose?.()
    vi.advanceTimersByTime(3000)

    expect(instances).toHaveLength(2)
    open(instances[1])
    expect(instances[1].sent).toContain(JSON.stringify({ type: WsMessageType.ChatMessage, payload: { text: 'oi' } }))
    vi.useRealTimers()
  })
})
