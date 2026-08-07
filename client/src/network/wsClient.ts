import { WsMessage, WsMessageType } from '../types/index.ts'

export type MessageHandler = (msg: WsMessage) => void
export type BinaryHandler = (data: ArrayBuffer) => void

export class WsClient {
  private ws: WebSocket | null = null
  private url: string = ''
  private handlers = new Map<string, Set<MessageHandler>>()
  private binaryHandlers = new Set<BinaryHandler>()
  private lastPingTime: number = 0
  private onLatencyCb: ((ms: number) => void) | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private intentionalDisconnect: boolean = false
  // Mensagens enviadas enquanto o socket estava fechado (reconexão no mobile):
  // são reenviadas após o Login, para o envio não "sumir" silenciosamente.
  private pendingQueue: Array<{ type: string; payload?: unknown }> = []
  private static readonly MAX_PENDING = 100

  connect(url: string): void {
    this.intentionalDisconnect = false
    this.url = url
    this.doConnect()
  }

  private doConnect(): void {
    this.cleanupWs()
    this.createWs()
  }

  private cleanupWs(): void {
    if (!this.ws) return
    this.ws.onopen = null
    this.ws.onclose = null
    this.ws.onmessage = null
    this.ws.onerror = null
    this.ws.close()
    this.ws = null
  }

  private createWs(): void {
    this.ws = new WebSocket(this.url)
    this.ws.binaryType = 'arraybuffer'

    this.ws.onopen = () => {
      this.startHeartbeat()
      this.emit('connected', { type: 'connected' as WsMessageType, payload: undefined })
      this.emit('*', { type: 'connected' as WsMessageType, payload: undefined })
      // Flush após o 'connected': o Login enviado pelo handler já foi mandado,
      // então as mensagens pendentes chegam ao servidor depois da autenticação.
      this.flushQueue()
    }

    this.ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.binaryHandlers.forEach((h) => h(event.data as ArrayBuffer))
        return
      }
      try {
        const msg: WsMessage = JSON.parse(event.data)
        if (msg.type === WsMessageType.Heartbeat && this.lastPingTime) {
          const rtt = Date.now() - this.lastPingTime
          this.onLatencyCb?.(rtt)
        }
        this.emit(msg.type, msg)
        this.emit('*', msg)
      } catch {
        console.error('Invalid WS message')
      }
    }

    this.ws.onclose = () => {
      this.stopHeartbeat()
      this.emit('disconnected', { type: 'disconnected' as WsMessageType, payload: undefined })
      this.emit('*', { type: 'disconnected' as WsMessageType, payload: undefined })
      if (!this.intentionalDisconnect) {
        this.scheduleReconnect()
      }
    }

    this.ws.onerror = (e) => {
      console.error('[WsClient] WebSocket error', e)
      this.ws?.close()
    }
  }

  disconnect(): void {
    this.intentionalDisconnect = true
    this.cancelReconnect()
    this.stopHeartbeat()
    this.pendingQueue.length = 0
    this.cleanupWs()
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  send(type: string, payload?: unknown): void {
    const msg: WsMessage = { type: type as WsMessageType, payload }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    } else if (this.pendingQueue.length < WsClient.MAX_PENDING) {
      // Socket fechado (mobile em reconexão): guarda para reenviar após o Login.
      // Áudio/vídeo em tempo real (sendBinary) não entra na fila — dados velhos
      // são inúteis; já as mensagens de chat/intenções precisam ser preservadas.
      this.pendingQueue.push(msg)
    }
  }

  sendBinary(data: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data)
    }
  }

  private flushQueue(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    while (this.pendingQueue.length > 0) {
      const msg = this.pendingQueue.shift()!
      this.ws.send(JSON.stringify(msg))
    }
  }

  on(type: string, handler: MessageHandler): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set())
    }
    this.handlers.get(type)!.add(handler)
  }

  off(type: string, handler: MessageHandler): void {
    this.handlers.get(type)?.delete(handler)
  }

  onBinary(handler: BinaryHandler): void {
    this.binaryHandlers.add(handler)
  }

  offBinary(handler: BinaryHandler): void {
    this.binaryHandlers.delete(handler)
  }

  setOnLatency(cb: (ms: number) => void): void {
    this.onLatencyCb = cb
  }

  private emit(type: string, msg: WsMessage): void {
    this.handlers.get(type)?.forEach((h) => h(msg))
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      this.lastPingTime = Date.now()
      this.send(WsMessageType.Heartbeat)
    }, 5000)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.intentionalDisconnect) {
        this.doConnect()
      }
    }, 3000)
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}



