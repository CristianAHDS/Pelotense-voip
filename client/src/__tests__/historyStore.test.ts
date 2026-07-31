import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { chatHistory } from '../services/historyStore.ts'
import type { ChatMsg } from '../types/index.ts'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

describe('chatHistory (fallback localStorage)', () => {
  it('salva e carrega mensagens de sala', async () => {
    const msgs: ChatMsg[] = [{ id: 'm1', userId: 'u1', userName: 'A', text: 'oi', timestamp: 1 }]
    await chatHistory.saveRoomMessages('r1', msgs)
    const loaded = await chatHistory.loadRoomMessages('r1')
    expect(loaded).toEqual(msgs)
  })

  it('limpa mensagens de sala', async () => {
    await chatHistory.saveRoomMessages('r1', [{ id: 'm1', userId: 'u1', userName: 'A', text: 'oi', timestamp: 1 }])
    await chatHistory.clearRoomMessages('r1')
    expect(await chatHistory.loadRoomMessages('r1')).toBeNull()
  })

  it('retorna null quando não há histórico', async () => {
    expect(await chatHistory.loadRoomMessages('inexistente')).toBeNull()
  })

  it('salva e carrega mensagens de DM por conversa', async () => {
    const msgs = [{ id: 'p1', fromUserId: 'a', fromUserName: 'Ana', toUserId: 'b', text: 'oi', timestamp: 1 }]
    await chatHistory.saveDmMessages('b', msgs)
    expect(await chatHistory.loadDmMessages('b')).toEqual(msgs)
    expect(await chatHistory.loadDmMessages('c')).toBeNull()
  })
})
