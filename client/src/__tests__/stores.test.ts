import { describe, it, expect, beforeEach } from 'vitest'
import { useLiveStore } from '../stores/liveStore.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useRoomStore } from '../stores/roomStore.ts'
import { usePrivateChatStore } from '../stores/privateChatStore.ts'
import { useVoiceStore } from '../stores/voiceStore.ts'
import { useSettingsStore } from '../stores/settingsStore.ts'
import { WsMessageType } from '../types/index.ts'

describe('liveStore', () => {
  beforeEach(() => {
    useLiveStore.setState({
      broadcaster: null,
      chunks: [],
      pendingRequest: null,
      takeoverRequestSent: false,
      requestDenied: 0,
    })
  })

  it('define o broadcaster e limpa chunks ao trocar de transmissão', () => {
    useLiveStore.getState().addChunk({ userId: 'u1', chunk: 'aGk=', duration: 1 })
    expect(useLiveStore.getState().chunks).toHaveLength(1)
    useLiveStore.getState().setBroadcaster({ userId: 'u2', userName: 'Narrador' })
    expect(useLiveStore.getState().broadcaster).toEqual({ userId: 'u2', userName: 'Narrador' })
    expect(useLiveStore.getState().chunks).toHaveLength(0)
  })

  it('limita os chunks a 200 (descarta os mais antigos)', () => {
    for (let i = 0; i < 250; i++) {
      useLiveStore.getState().addChunk({ userId: 'u1', chunk: `chunk-${i}`, duration: 1 })
    }
    const chunks = useLiveStore.getState().chunks
    expect(chunks).toHaveLength(200)
    expect(chunks[0].chunk).toBe('chunk-50')
    expect(chunks[chunks.length - 1].chunk).toBe('chunk-249')
  })

  it('gerencia pedido de takeover pendente', () => {
    const req = { fromUserId: 'u2', fromUserName: 'Intruso' }
    useLiveStore.getState().setPendingRequest(req)
    expect(useLiveStore.getState().pendingRequest).toEqual(req)
    useLiveStore.getState().setPendingRequest(null)
    expect(useLiveStore.getState().pendingRequest).toBeNull()
  })

  it('marca pedido de takeover enviado e incrementa negações', () => {
    expect(useLiveStore.getState().takeoverRequestSent).toBe(false)
    useLiveStore.getState().setTakeoverRequestSent(true)
    expect(useLiveStore.getState().takeoverRequestSent).toBe(true)

    expect(useLiveStore.getState().requestDenied).toBe(0)
    useLiveStore.getState().setRequestDenied()
    useLiveStore.getState().setRequestDenied()
    expect(useLiveStore.getState().requestDenied).toBe(2)
  })

  it('clearChunks esvazia a lista', () => {
    useLiveStore.getState().addChunk({ userId: 'u1', chunk: 'aGk=', duration: 1 })
    useLiveStore.getState().clearChunks()
    expect(useLiveStore.getState().chunks).toHaveLength(0)
  })
})

describe('connectionStore', () => {
  beforeEach(() => {
    useConnectionStore.setState({
      connected: false,
      reconnecting: false,
      id: null,
      name: null,
    })
  })

  it('setConnected marca conectado e zera reconnecting', () => {
    useConnectionStore.getState().setReconnecting(true)
    useConnectionStore.getState().setConnected('abc123', 'Reporter')
    expect(useConnectionStore.getState().connected).toBe(true)
    expect(useConnectionStore.getState().id).toBe('abc123')
    expect(useConnectionStore.getState().name).toBe('Reporter')
    expect(useConnectionStore.getState().reconnecting).toBe(false)
    expect(useConnectionStore.getState().admin).toBe(false)
  })

  it('setConnected registra admin quando informado', () => {
    useConnectionStore.getState().setConnected('abc', 'Chefe', true)
    expect(useConnectionStore.getState().admin).toBe(true)
  })

  it('setDisconnected limpa id, nome e admin', () => {
    useConnectionStore.getState().setConnected('abc', 'Nome', true)
    useConnectionStore.getState().setDisconnected()
    expect(useConnectionStore.getState().connected).toBe(false)
    expect(useConnectionStore.getState().id).toBeNull()
    expect(useConnectionStore.getState().name).toBeNull()
    expect(useConnectionStore.getState().admin).toBe(false)
  })
})

describe('roomStore', () => {
  beforeEach(() => {
    useRoomStore.setState({
      rooms: [],
      users: [],
      currentRoom: null,
      currentRoomName: null,
      messages: [],
    })
  })

  it('define salas e usuários', () => {
    useRoomStore.getState().setRooms([{ id: 'r1', name: 'Externas', users: 2 }])
    useRoomStore.getState().setUsers([{ id: 'u1', name: 'A', room: 'r1' }])
    expect(useRoomStore.getState().rooms[0].name).toBe('Externas')
    expect(useRoomStore.getState().users).toHaveLength(1)
  })

  it('adiciona/remove usuário sem duplicar', () => {
    useRoomStore.getState().addUser({ id: 'u1', name: 'A', room: null })
    useRoomStore.getState().addUser({ id: 'u1', name: 'A atualizado', room: 'r1' })
    expect(useRoomStore.getState().users).toHaveLength(1)
    expect(useRoomStore.getState().users[0].room).toBe('r1')
    useRoomStore.getState().removeUser('u1')
    expect(useRoomStore.getState().users).toHaveLength(0)
  })

  it('adiciona/remove mensagens', () => {
    const msg = { id: 'm1', userId: 'u1', userName: 'A', text: 'oi', timestamp: Date.now() }
    useRoomStore.getState().addMessage(msg)
    expect(useRoomStore.getState().messages).toHaveLength(1)
    useRoomStore.getState().removeMessage('m1')
    expect(useRoomStore.getState().messages).toHaveLength(0)
  })

  it('define sala atual e limpa mensagens', () => {
    useRoomStore.getState().setCurrentRoom('r1', 'Ao vivo')
    expect(useRoomStore.getState().currentRoom).toBe('r1')
    expect(useRoomStore.getState().currentRoomName).toBe('Ao vivo')
    useRoomStore.getState().setMessages([{ id: 'm1', userId: 'u1', userName: 'A', text: 'x', timestamp: 0 }])
    useRoomStore.getState().clearMessages()
    expect(useRoomStore.getState().messages).toHaveLength(0)
  })
})

describe('privateChatStore', () => {
  beforeEach(() => {
    usePrivateChatStore.setState({
      activeUserId: null,
      activeUserName: null,
      messages: {},
      unread: {},
    })
    useConnectionStore.setState({ connected: true, id: 'me', name: 'Eu' })
  })

  function dm(fromUserId: string, toUserId: string, text: string) {
    return { fromUserId, fromUserName: fromUserId, toUserId, text, timestamp: Date.now() }
  }

  it('abre chat e limpa o não-lido do usuário', () => {
    usePrivateChatStore.getState().addMessage(dm('other', 'me', 'oi'))
    expect(usePrivateChatStore.getState().unread.other).toBe(true)
    usePrivateChatStore.getState().openChat('other', 'Outro')
    expect(usePrivateChatStore.getState().activeUserId).toBe('other')
    expect(usePrivateChatStore.getState().unread.other).toBeUndefined()
  })

  it('marca como não-lida mensagem recebida com chat fechado', () => {
    usePrivateChatStore.getState().addMessage(dm('other', 'me', 'oi'))
    expect(usePrivateChatStore.getState().messages.other).toHaveLength(1)
    expect(usePrivateChatStore.getState().unread.other).toBe(true)
  })

  it('não marca não-lida quando o chat está ativo', () => {
    usePrivateChatStore.getState().openChat('other', 'Outro')
    usePrivateChatStore.getState().addMessage(dm('other', 'me', 'oi'))
    expect(usePrivateChatStore.getState().unread.other).toBeUndefined()
  })

  it('agrupa mensagens enviadas por mim sob o destinatário', () => {
    usePrivateChatStore.getState().addMessage(dm('me', 'other', 'resposta'))
    expect(usePrivateChatStore.getState().messages.other).toHaveLength(1)
  })

  it('fecha o chat', () => {
    usePrivateChatStore.getState().openChat('other', 'Outro')
    usePrivateChatStore.getState().closeChat()
    expect(usePrivateChatStore.getState().activeUserId).toBeNull()
  })
})

describe('voiceStore', () => {
  beforeEach(() => {
    useVoiceStore.setState({ muted: true, volume: 0.8, level: 0, speaking: {} })
  })

  it('alterna mute, ajusta volume e nível', () => {
    expect(useVoiceStore.getState().muted).toBe(true)
    useVoiceStore.getState().toggleMute()
    expect(useVoiceStore.getState().muted).toBe(false)
    useVoiceStore.getState().setMuted(true)
    useVoiceStore.getState().setVolume(0.5)
    useVoiceStore.getState().setLevel(0.9)
    expect(useVoiceStore.getState().muted).toBe(true)
    expect(useVoiceStore.getState().volume).toBe(0.5)
    expect(useVoiceStore.getState().level).toBe(0.9)
  })

  it('controla o nível de recepção (rxLevel)', () => {
    expect(useVoiceStore.getState().rxLevel).toBe(0)
    useVoiceStore.getState().setRxLevel(0.7)
    expect(useVoiceStore.getState().rxLevel).toBe(0.7)
    useVoiceStore.getState().setRxLevel(0)
    expect(useVoiceStore.getState().rxLevel).toBe(0)
  })

  it('marca quem está falando e remove após expirar', async () => {
    expect(useVoiceStore.getState().speaking).toEqual({})
    useVoiceStore.getState().markSpeaking('u1')
    useVoiceStore.getState().markSpeaking('u2')
    expect(Object.keys(useVoiceStore.getState().speaking).sort()).toEqual(['u1', 'u2'])

    const expired = { u1: Date.now() - 10000, u2: Date.now() }
    useVoiceStore.setState({ speaking: expired })
    useVoiceStore.getState().pruneSpeaking()
    expect(useVoiceStore.getState().speaking).toEqual({ u2: expired.u2 })
  })

  it('clearSpeaking esvazia o indicador de fala', () => {
    useVoiceStore.getState().markSpeaking('u1')
    useVoiceStore.getState().clearSpeaking()
    expect(useVoiceStore.getState().speaking).toEqual({})
  })
})

describe('settingsStore', () => {
  it('mantém valores padrão', () => {
    const s = useSettingsStore.getState()
    expect(s.pushToTalk).toBe(false)
    expect(s.pushToTalkKey).toBe('Space')
    expect(s.serverWsPort).toBe(3001)
  })

  it('permite ajustar configurações', () => {
    useSettingsStore.getState().setPushToTalk(true)
    useSettingsStore.getState().setPushToTalkKey('V')
    useSettingsStore.getState().setServerHost('10.0.0.1')
    useSettingsStore.getState().setServerWsPort(3002)
    const s = useSettingsStore.getState()
    expect(s.pushToTalk).toBe(true)
    expect(s.pushToTalkKey).toBe('V')
    expect(s.serverHost).toBe('10.0.0.1')
    expect(s.serverWsPort).toBe(3002)
  })
})
