import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { WsMessageType } from '../types/index.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useRoomStore } from '../stores/roomStore.ts'
import { useLiveStore } from '../stores/liveStore.ts'
import { usePrivateChatStore } from '../stores/privateChatStore.ts'

type Handler = (msg: any) => void

const listeners = new Map<string, Set<Handler>>()
const sent: Array<{ type: string; payload?: unknown }> = []
let connectedUrl: string | null = null

class MockWsClient {
  connect(url: string): void {
    connectedUrl = url
  }
  disconnect(): void {}
  on(type: string, handler: Handler): void {
    if (!listeners.has(type)) listeners.set(type, new Set())
    listeners.get(type)!.add(handler)
  }
  off(type: string, handler: Handler): void {
    listeners.get(type)?.delete(handler)
  }
  onBinary(): void {}
  offBinary(): void {}
  send(type: string, payload?: unknown): void {
    sent.push({ type, payload })
  }
  sendBinary(): void {}
  emit(type: string, msg: any): void {
    listeners.get(type)?.forEach((h) => h(msg))
    listeners.get('*')?.forEach((h) => h(msg))
  }
}

vi.mock('../network/wsClient.ts', () => ({ WsClient: MockWsClient }))
vi.mock('../voice/index.ts', () => {
  class MockVoiceManager {
    static resumeCalls = 0
    static startMicCalls = 0
    static flushAudioCalls = 0
    resumeOutput(): void {
      MockVoiceManager.resumeCalls += 1
    }
    flushAudio(): void {
      MockVoiceManager.flushAudioCalls += 1
    }
    setOnSend(): void {}
    async startMicrophone(): Promise<boolean> {
      MockVoiceManager.startMicCalls += 1
      return true
    }
    stopMicrophone(): void {}
    playAudio(): void {}
    setVolume(): void {}
    destroy(): void {}
  }
  return { VoiceManager: MockVoiceManager }
})

const { connectToServer, disconnectFromServer, getWsClient } = await import('../services/connectionService.ts')
const { sendLiveChunk, sendLiveRequestCancel, sendLiveRequestResponse, sendLiveStart, sendChatMessage, joinRoom, leaveRoom } = await import('../services/connectionService.ts')
const voiceMock = await import('../voice/index.ts')
const MockVoiceManager = voiceMock.VoiceManager as unknown as { resumeCalls: number; startMicCalls: number; flushAudioCalls: number }

function emit(type: string, payload?: unknown): void {
  ;(getWsClient() as any).emit(type, { type, payload })
}

beforeEach(() => {
  listeners.clear()
  sent.length = 0
  connectedUrl = null
  MockVoiceManager.resumeCalls = 0
  MockVoiceManager.startMicCalls = 0
  MockVoiceManager.flushAudioCalls = 0
  useConnectionStore.setState({ connected: false, reconnecting: false, id: null, name: null })
  useRoomStore.setState({ rooms: [], users: [], currentRoom: null, currentRoomName: null, messages: [] })
  useLiveStore.setState({ broadcaster: null, chunks: [], pendingRequest: null, takeoverRequestSent: false, requestDenied: 0 })
  usePrivateChatStore.setState({ activeUserId: null, activeUserName: null, messages: {}, unread: {} })
})

afterEach(() => {
  disconnectFromServer()
})

describe('connectionService', () => {
  it('conecta ao servidor e envia login', () => {
    connectToServer('ws://192.168.8.94:3001', 'Reporter', 'segredo')
    expect(connectedUrl).toBe('ws://192.168.8.94:3001')
    ;(getWsClient() as any).emit('connected', { type: 'connected' })
    expect(sent).toContainEqual({ type: WsMessageType.Login, payload: { name: 'Reporter', password: 'segredo' } })
  })

  it('processa Welcome e marca conexão estabelecida', () => {
    connectToServer('ws://x', 'A', 'p')
    emit('connected')
    emit(WsMessageType.Welcome, { id: 'id1', name: 'A' })
    expect(useConnectionStore.getState().connected).toBe(true)
    expect(useConnectionStore.getState().id).toBe('id1')
    expect(useConnectionStore.getState().name).toBe('A')
  })

  it('processa RoomList e UserList', () => {
    connectToServer('ws://x', 'A', 'p')
    emit('connected')
    emit(WsMessageType.RoomList, [{ id: 'r1', name: 'Ao vivo', users: 1 }])
    emit(WsMessageType.UserList, [{ id: 'u1', name: 'A', room: 'r1' }])
    expect(useRoomStore.getState().rooms).toHaveLength(1)
    expect(useRoomStore.getState().users).toHaveLength(1)
  })

  it('processa RoomJoined definindo sala atual e mensagens', () => {
    connectToServer('ws://x', 'A', 'p')
    emit(WsMessageType.RoomJoined, { roomId: 'r1', roomName: 'Ao vivo', messages: [{ id: 'm1', userId: 'u1', userName: 'X', text: 'oi', timestamp: 1 }] })
    expect(useRoomStore.getState().currentRoom).toBe('r1')
    expect(useRoomStore.getState().currentRoomName).toBe('Ao vivo')
    expect(useRoomStore.getState().messages).toHaveLength(1)
  })

  it('processa mensagens de chat de texto, áudio e vídeo', () => {
    connectToServer('ws://x', 'A', 'p')
    emit(WsMessageType.ChatMessage, { id: 'm1', userId: 'u1', userName: 'X', text: 'texto', timestamp: 1 })
    emit(WsMessageType.ChatAudioMessage, { id: 'm2', userId: 'u1', userName: 'X', audioData: 'YXVkaW8=', duration: 2, timestamp: 1 })
    emit(WsMessageType.ChatVideoMessage, { id: 'm3', userId: 'u1', userName: 'X', videoData: 'dmlkZW8=', duration: 3, timestamp: 1 })
    expect(useRoomStore.getState().messages).toHaveLength(3)
  })

  it('processa MessageDeleted removendo a mensagem', () => {
    connectToServer('ws://x', 'A', 'p')
    emit(WsMessageType.ChatMessage, { id: 'm1', userId: 'u1', userName: 'X', text: 't', timestamp: 1 })
    emit(WsMessageType.MessageDeleted, { messageId: 'm1' })
    expect(useRoomStore.getState().messages).toHaveLength(0)
  })

  it('processa mensagem privada adicionando ao chat', () => {
    connectToServer('ws://x', 'A', 'p')
    useConnectionStore.getState().setConnected('me', 'A')
    emit(WsMessageType.PrivateMessage, { fromUserId: 'other', fromUserName: 'Outro', toUserId: 'me', text: 'privado', timestamp: 1 })
    expect(usePrivateChatStore.getState().messages.other).toHaveLength(1)
  })

  it('processa LiveStarted e LiveStopped', () => {
    connectToServer('ws://x', 'A', 'p')
    emit(WsMessageType.LiveStarted, { userId: 'u1', userName: 'Narrador' })
    expect(useLiveStore.getState().broadcaster).toEqual({ userId: 'u1', userName: 'Narrador' })
    emit(WsMessageType.LiveStopped, { userId: 'u1' })
    expect(useLiveStore.getState().broadcaster).toBeNull()
  })

  it('processa LiveChunkReceived adicionando ao store', () => {
    connectToServer('ws://x', 'A', 'p')
    emit(WsMessageType.LiveStarted, { userId: 'u1', userName: 'Narrador' })
    emit(WsMessageType.LiveChunkReceived, { userId: 'u1', chunk: 'Y2h1bms=', duration: 1 })
    expect(useLiveStore.getState().chunks).toHaveLength(1)
    expect(useLiveStore.getState().chunks[0].chunk).toBe('Y2h1bms=')
  })

  it('processa LiveRequest definindo pedido pendente', () => {
    connectToServer('ws://x', 'A', 'p')
    emit(WsMessageType.LiveRequest, { fromUserId: 'u2', fromUserName: 'Intruso' })
    expect(useLiveStore.getState().pendingRequest).toEqual({ fromUserId: 'u2', fromUserName: 'Intruso' })
  })

  it('processa LiveRequestCancelled limpando o pedido pendente', () => {
    connectToServer('ws://x', 'A', 'p')
    emit(WsMessageType.LiveRequest, { fromUserId: 'u2', fromUserName: 'Intruso' })
    emit(WsMessageType.LiveRequestCancelled, { fromUserId: 'u2' })
    expect(useLiveStore.getState().pendingRequest).toBeNull()
  })

  it('em LiveRequestResponse permitido envia LiveStart', () => {
    connectToServer('ws://x', 'A', 'p')
    useLiveStore.getState().setTakeoverRequestSent(true)
    emit(WsMessageType.LiveRequestResponse, { allow: true, fromUserId: 'u1' })
    expect(useLiveStore.getState().takeoverRequestSent).toBe(false)
    expect(sent).toContainEqual({ type: WsMessageType.LiveStart })
  })

  it('em LiveRequestResponse negado incrementa requestDenied e não inicia live', () => {
    connectToServer('ws://x', 'A', 'p')
    useLiveStore.getState().setTakeoverRequestSent(true)
    emit(WsMessageType.LiveRequestResponse, { allow: false, fromUserId: 'u1' })
    expect(useLiveStore.getState().takeoverRequestSent).toBe(false)
    expect(useLiveStore.getState().requestDenied).toBe(1)
    expect(sent.some((m) => m.type === WsMessageType.LiveStart)).toBe(false)
  })

  it('expõe funções de envio corretas', () => {
    connectToServer('ws://x', 'A', 'p')
    sendChatMessage('ola')
    sendLiveChunk('Y2h1bms=', 1)
    sendLiveStart()
    sendLiveRequestCancel()
    sendLiveRequestResponse(true, 'u1')
    joinRoom('Ao vivo')
    leaveRoom()
    expect(sent).toContainEqual({ type: WsMessageType.ChatMessage, payload: { text: 'ola' } })
    expect(sent).toContainEqual({ type: WsMessageType.LiveChunk, payload: { chunk: 'Y2h1bms=', duration: 1 } })
    expect(sent).toContainEqual({ type: WsMessageType.LiveStart })
    expect(sent).toContainEqual({ type: WsMessageType.LiveRequestCancel })
    expect(sent).toContainEqual({ type: WsMessageType.LiveRequestResponse, payload: { allow: true, requesterId: 'u1' } })
    expect(sent).toContainEqual({ type: WsMessageType.JoinRoom, payload: 'Ao vivo' })
    expect(sent).toContainEqual({ type: WsMessageType.LeaveRoom })
  })

  it('disconnectFromServer limpa todo o estado', () => {
    connectToServer('ws://x', 'A', 'p')
    emit('connected')
    emit(WsMessageType.Welcome, { id: 'id1', name: 'A' })
    emit(WsMessageType.RoomJoined, { roomId: 'r1', roomName: 'Ao vivo', messages: [] })
    disconnectFromServer()
    expect(useConnectionStore.getState().connected).toBe(false)
    expect(useRoomStore.getState().currentRoom).toBeNull()
    expect(useRoomStore.getState().messages).toHaveLength(0)
    expect(useLiveStore.getState().broadcaster).toBeNull()
  })

  it('joinRoom retoma a saída de áudio mesmo com o mic mutado', () => {
    connectToServer('ws://x', 'A', 'p')
    const before = MockVoiceManager.resumeCalls
    joinRoom('Ao vivo')
    expect(MockVoiceManager.resumeCalls).toBe(before + 1)
  })

  it('após o Welcome, solicita a permissão do microfone (destrava o áudio de saída no mobile)', () => {
    connectToServer('ws://x', 'A', 'p')
    const before = MockVoiceManager.startMicCalls
    emit(WsMessageType.Welcome, { id: 'id1', name: 'A' })
    expect(MockVoiceManager.startMicCalls).toBe(before + 1)
  })

  it('ao sair da sala, limpa o buffer de áudio de saída imediatamente', () => {
    connectToServer('ws://x', 'A', 'p')
    emit(WsMessageType.RoomJoined, { roomId: 'r1', roomName: 'Ao vivo', messages: [] })
    emit(WsMessageType.RoomLeft, { roomId: 'r1' })
    expect(MockVoiceManager.flushAudioCalls).toBeGreaterThanOrEqual(1)
  })

  it('ao entrar/trocar de sala, limpa o buffer de áudio da sala anterior', () => {
    connectToServer('ws://x', 'A', 'p')
    emit(WsMessageType.RoomJoined, { roomId: 'r1', roomName: 'Sala 1', messages: [] })
    const before = MockVoiceManager.flushAudioCalls
    emit(WsMessageType.RoomJoined, { roomId: 'r2', roomName: 'Sala 2', messages: [] })
    expect(MockVoiceManager.flushAudioCalls).toBe(before + 1)
  })
})
