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

const { notifyMock } = vi.hoisted(() => ({ notifyMock: vi.fn() }))
vi.mock('../services/notifications.ts', () => ({
  notifyNewMessage: notifyMock,
  requestNotificationPermission: vi.fn(),
  playMessageSound: vi.fn(),
}))

const { connectToServer, disconnectFromServer, getWsClient } = await import('../services/connectionService.ts')
const { sendLiveChunk, sendLiveRequestCancel, sendLiveRequestResponse, sendLiveStart, sendChatMessage, joinRoom, leaveRoom, sendChatAudioMessage, sendChatVideoMessage, sendPrivateAudioMessage, sendPrivateVideoMessage, generateClientMessageId, sendChatImageMessage, sendMessageReaction, sendForwardMessage, requestPrivateHistory, requestAccounts, sendTyping } = await import('../services/connectionService.ts')
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
  notifyMock.mockClear()
  useConnectionStore.setState({ connected: false, reconnecting: false, id: null, name: null })
  useRoomStore.setState({ rooms: [], users: [], currentRoom: null, currentRoomName: null, messages: [], unread: {}, typing: {}, loadingRooms: false, loadingMessages: false })
  useLiveStore.setState({ broadcasters: [], chunks: [], pendingRequest: null, takeoverRequestSent: false, requestDenied: 0 })
  usePrivateChatStore.setState({ activeUserId: null, activeUserName: null, messages: {}, unread: {} })
})

afterEach(() => {
  disconnectFromServer()
})

describe('connectionService', () => {
  it('conecta ao servidor e envia login (com deviceId)', () => {
    connectToServer('ws://192.168.8.94:3001', 'Reporter', 'segredo')
    expect(connectedUrl).toBe('ws://192.168.8.94:3001')
    ;(getWsClient() as any).emit('connected', { type: 'connected' })
    const login = sent.find((m) => m.type === WsMessageType.Login)
    expect(login?.payload).toMatchObject({ name: 'Reporter', password: 'segredo' })
    expect(typeof (login?.payload as any)?.deviceId).toBe('string')
  })

  it('envia intent register com e-mail no login', () => {
    connectToServer('ws://192.168.8.94:3001', 'Novato', 'segredo', 'novo@test.com', 'register')
    ;(getWsClient() as any).emit('connected', { type: 'connected' })
    const login = sent.find((m) => m.type === WsMessageType.Login)
    expect(login?.payload).toMatchObject({ name: 'Novato', password: 'segredo', email: 'novo@test.com', intent: 'register' })
    expect(typeof (login?.payload as any)?.deviceId).toBe('string')
  })

  it('envia intent login no login', () => {
    connectToServer('ws://192.168.8.94:3001', 'Existente', 'segredo', undefined, 'login')
    ;(getWsClient() as any).emit('connected', { type: 'connected' })
    const login = sent.find((m) => m.type === WsMessageType.Login)
    expect(login?.payload).toMatchObject({ name: 'Existente', password: 'segredo', intent: 'login' })
    expect(typeof (login?.payload as any)?.deviceId).toBe('string')
  })

  it('processa Welcome e marca conexão estabelecida', () => {
    connectToServer('ws://x', 'A', 'p')
    emit('connected')
    emit(WsMessageType.Welcome, { id: 'id1', name: 'A' })
    expect(useConnectionStore.getState().connected).toBe(true)
    expect(useConnectionStore.getState().id).toBe('id1')
    expect(useConnectionStore.getState().name).toBe('A')
  })

  it('no primeiro login não re-entra em sala (currentRoomName é nulo)', () => {
    connectToServer('ws://x', 'A', 'p')
    emit('connected')
    emit(WsMessageType.Welcome, { id: 'id1', name: 'A' })
    expect(sent.filter((m) => m.type === WsMessageType.JoinRoom)).toHaveLength(0)
  })

  it('após reconectar (novo Welcome) re-entra na sala atual para restaurar o client.room no servidor', () => {
    connectToServer('ws://x', 'A', 'p')
    emit('connected')
    emit(WsMessageType.Welcome, { id: 'id1', name: 'A' })
    emit(WsMessageType.RoomJoined, { roomId: 'r1', roomName: 'Ao vivo', messages: [] })
    sent.length = 0

    emit(WsMessageType.Welcome, { id: 'id1', name: 'A' })

    expect(sent).toContainEqual({ type: WsMessageType.JoinRoom, payload: 'Ao vivo' })
  })

  it('processa RoomList e UserList', () => {
    connectToServer('ws://x', 'A', 'p')
    emit('connected')
    emit(WsMessageType.RoomList, [{ id: 'r1', name: 'Ao vivo', users: 1 }])
    emit(WsMessageType.UserList, [{ id: 'u1', name: 'A', room: 'r1' }])
    expect(useRoomStore.getState().rooms).toHaveLength(1)
    expect(useRoomStore.getState().users).toHaveLength(1)
  })

  it('processa AccountsList e requestAccounts envia ListAccounts', () => {
    connectToServer('ws://x', 'A', 'p')
    emit(WsMessageType.AccountsList, [{ id: 'u1', name: 'Bruno', online: false }])
    expect(useRoomStore.getState().accounts).toHaveLength(1)
    expect(useRoomStore.getState().accounts[0].online).toBe(false)
    sent.length = 0
    requestAccounts()
    expect(sent).toContainEqual({ type: WsMessageType.ListAccounts })
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
    expect(useLiveStore.getState().broadcasters).toEqual([{ userId: 'u1', userName: 'Narrador' }])
    emit(WsMessageType.LiveStopped, { userId: 'u1' })
    expect(useLiveStore.getState().broadcasters).toEqual([])
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
    const chatMsg = sent.find((m) => m.type === WsMessageType.ChatMessage)
    expect(chatMsg).toBeTruthy()
    expect(chatMsg?.payload).toMatchObject({ text: 'ola' })
    expect(typeof (chatMsg?.payload as any)?.id).toBe('string')
    expect(sent).toContainEqual({ type: WsMessageType.LiveChunk, payload: { chunk: 'Y2h1bms=', duration: 1 } })
    expect(sent).toContainEqual({ type: WsMessageType.LiveStart })
    expect(sent).toContainEqual({ type: WsMessageType.LiveRequestCancel })
    expect(sent).toContainEqual({ type: WsMessageType.LiveRequestResponse, payload: { allow: true, requesterId: 'u1' } })
    expect(sent).toContainEqual({ type: WsMessageType.JoinRoom, payload: 'Ao vivo' })
    expect(sent).toContainEqual({ type: WsMessageType.LeaveRoom })
  })

  it('envia áudio/vídeo (sala e privado) carregando o id do cliente para correlacionar o eco', () => {
    connectToServer('ws://x', 'A', 'p')
    const id1 = generateClientMessageId()
    sendChatAudioMessage(id1, 'YXVkaW8=', 3)
    sendChatVideoMessage(id1, 'dmlkZW8=', 4)
    sendPrivateAudioMessage('other', id1, 'YXVkaW8=', 3)
    sendPrivateVideoMessage('other', id1, 'dmlkZW8=', 4)
    expect(sent).toContainEqual({ type: WsMessageType.ChatAudioMessage, payload: { id: id1, audioData: 'YXVkaW8=', duration: 3 } })
    expect(sent).toContainEqual({ type: WsMessageType.ChatVideoMessage, payload: { id: id1, videoData: 'dmlkZW8=', duration: 4 } })
    expect(sent).toContainEqual({ type: WsMessageType.PrivateAudioMessage, payload: { toUserId: 'other', id: id1, audioData: 'YXVkaW8=', duration: 3 } })
    expect(sent).toContainEqual({ type: WsMessageType.PrivateVideoMessage, payload: { toUserId: 'other', id: id1, videoData: 'dmlkZW8=', duration: 4 } })
  })

  it('generateClientMessageId gera ids únicos', () => {
    const a = generateClientMessageId()
    const b = generateClientMessageId()
    expect(a).toBeTruthy()
    expect(b).toBeTruthy()
    expect(a).not.toBe(b)
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
    expect(useLiveStore.getState().broadcasters).toEqual([])
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

  it('marca mensagem como não-lida por sala quando a aba está oculta', () => {
    connectToServer('ws://x', 'A', 'p')
    emit(WsMessageType.RoomJoined, { roomId: 'r1', roomName: 'Sala 1', messages: [] })
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    try {
      emit(WsMessageType.ChatMessage, { id: 'm1', userId: 'u1', userName: 'X', text: 'oi', timestamp: 1 })
      emit(WsMessageType.ChatMessage, { id: 'm2', userId: 'u1', userName: 'X', text: 'oi2', timestamp: 2 })
    } finally {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    }
    expect(useRoomStore.getState().unread.r1).toBe(2)
  })

  it('não marca não-lida quando a aba está visível', () => {
    connectToServer('ws://x', 'A', 'p')
    emit(WsMessageType.RoomJoined, { roomId: 'r1', roomName: 'Sala 1', messages: [] })
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    emit(WsMessageType.ChatMessage, { id: 'm1', userId: 'u1', userName: 'X', text: 'oi', timestamp: 1 })
    expect(useRoomStore.getState().unread.r1).toBeUndefined()
  })

  it('RoomJoined limpa o não-lido da sala que está sendo vista', () => {
    connectToServer('ws://x', 'A', 'p')
    emit(WsMessageType.RoomJoined, { roomId: 'r1', roomName: 'Sala 1', messages: [] })
    useRoomStore.getState().incrementUnread('r1')
    useRoomStore.getState().incrementUnread('r1')
    expect(useRoomStore.getState().unread.r1).toBe(2)
    emit(WsMessageType.RoomJoined, { roomId: 'r1', roomName: 'Sala 1', messages: [] })
    expect(useRoomStore.getState().unread.r1).toBeUndefined()
  })

  it('disconnectFromServer limpa o não-lido por sala', () => {
    connectToServer('ws://x', 'A', 'p')
    useRoomStore.getState().incrementUnread('r1')
    disconnectFromServer()
    expect(useRoomStore.getState().unread).toEqual({})
  })

  it('envia imagem, reação e encaminhamento com o payload correto', () => {
    connectToServer('ws://x', 'A', 'p')
    const id1 = generateClientMessageId()
    sendChatImageMessage(id1, 'aW1n')
    sendMessageReaction('m1', '👍')
    sendForwardMessage('m1', 'Ao vivo')
    expect(sent).toContainEqual({ type: WsMessageType.ChatImageMessage, payload: { id: id1, imageData: 'aW1n' } })
    expect(sent).toContainEqual({ type: WsMessageType.MessageReaction, payload: { messageId: 'm1', emoji: '👍' } })
    expect(sent).toContainEqual({ type: WsMessageType.ForwardMessage, payload: { messageId: 'm1', roomName: 'Ao vivo' } })
  })

  it('processa ChatImageMessage adicionando a mensagem', () => {
    connectToServer('ws://x', 'A', 'p')
    emit(WsMessageType.ChatImageMessage, { id: 'm9', userId: 'u1', userName: 'X', imageData: 'aW1n', timestamp: 1 })
    expect(useRoomStore.getState().messages).toHaveLength(1)
    expect(useRoomStore.getState().messages[0].imageData).toBe('aW1n')
  })

  it('processa MessageReaction promovendo a mensagem atualizada (mesmo id)', () => {
    connectToServer('ws://x', 'A', 'p')
    emit(WsMessageType.ChatMessage, { id: 'm1', userId: 'u1', userName: 'X', text: 'oi', timestamp: 1 })
    emit(WsMessageType.MessageReaction, { id: 'm1', userId: 'u1', userName: 'X', text: 'oi', timestamp: 1, reactions: [{ emoji: '👍', userIds: ['u1'] }] })
    const msgs = useRoomStore.getState().messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].reactions).toEqual([{ emoji: '👍', userIds: ['u1'] }])
  })

  it('notifica em mensagem privada de outro usuário quando o chat não está ativo', () => {
    connectToServer('ws://x', 'A', 'p')
    useConnectionStore.getState().setConnected('me', 'A')
    emit(WsMessageType.PrivateMessage, { fromUserId: 'other', fromUserName: 'Outro', toUserId: 'me', text: 'privado', timestamp: 1 })
    expect(notifyMock).toHaveBeenCalledWith('Outro', 'privado')
  })

  it('não notifica quando o chat privado está ativo e a aba focada', () => {
    connectToServer('ws://x', 'A', 'p')
    useConnectionStore.getState().setConnected('me', 'A')
    usePrivateChatStore.getState().openChat('other', 'Outro')
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    emit(WsMessageType.PrivateMessage, { fromUserId: 'other', fromUserName: 'Outro', toUserId: 'me', text: 'privado', timestamp: 1 })
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('não notifica eco da própria mensagem privada', () => {
    connectToServer('ws://x', 'A', 'p')
    useConnectionStore.getState().setConnected('me', 'A')
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    try {
      emit(WsMessageType.PrivateMessage, { fromUserId: 'me', fromUserName: 'A', toUserId: 'other', text: 'eu disse', timestamp: 1 })
    } finally {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    }
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('armazena o histórico privado recebido do servidor', () => {
    connectToServer('ws://x', 'A', 'p')
    useConnectionStore.getState().setConnected('me', 'A')
    emit(WsMessageType.PrivateHistory, {
      withUserId: 'other',
      messages: [
        { id: 'p1', fromUserId: 'other', fromUserName: 'Outro', toUserId: 'me', text: 'oi', timestamp: 1 },
        { id: 'p2', fromUserId: 'me', fromUserName: 'A', toUserId: 'other', text: 'olá', timestamp: 2 },
      ],
    })
    const msgs = usePrivateChatStore.getState().messages['other'] ?? []
    expect(msgs).toHaveLength(2)
    expect(msgs[0].text).toBe('oi')
    expect(msgs[1].text).toBe('olá')
  })

  it('requestPrivateHistory envia ListPrivateMessages com o par', () => {
    connectToServer('ws://x', 'A', 'p')
    sent.length = 0
    requestPrivateHistory('other')
    expect(sent).toContainEqual({ type: WsMessageType.ListPrivateMessages, payload: { withUserId: 'other' } })
  })

  it('sendTyping envia o sinal de digitação', () => {
    connectToServer('ws://x', 'A', 'p')
    sent.length = 0
    sendTyping(true)
    expect(sent).toContainEqual({ type: WsMessageType.Typing, payload: { isTyping: true } })
    sendTyping(false)
    expect(sent).toContainEqual({ type: WsMessageType.Typing, payload: { isTyping: false } })
  })

  it('mostra quem está digitando ao receber typing do servidor', () => {
    connectToServer('ws://x', 'A', 'p')
    useConnectionStore.getState().setConnected('me', 'A')
    emit(WsMessageType.Typing, { userId: 'outro', userName: 'Outro', isTyping: true })
    expect(useRoomStore.getState().typing['outro']).toBe('Outro')
  })

  it('remove o indicador quando o usuário para de digitar', () => {
    connectToServer('ws://x', 'A', 'p')
    useConnectionStore.getState().setConnected('me', 'A')
    emit(WsMessageType.Typing, { userId: 'outro', userName: 'Outro', isTyping: true })
    emit(WsMessageType.Typing, { userId: 'outro', userName: 'Outro', isTyping: false })
    expect(useRoomStore.getState().typing['outro']).toBeUndefined()
  })

  it('ignora o próprio sinal de digitação', () => {
    connectToServer('ws://x', 'A', 'p')
    useConnectionStore.getState().setConnected('me', 'A')
    emit(WsMessageType.Typing, { userId: 'me', userName: 'A', isTyping: true })
    expect(useRoomStore.getState().typing['me']).toBeUndefined()
  })
})
