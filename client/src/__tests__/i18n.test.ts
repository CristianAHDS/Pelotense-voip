import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useT, tStatic } from '../i18n/index.ts'
import { useSettingsStore } from '../stores/settingsStore.ts'

describe('i18n', () => {
  beforeEach(() => {
    useSettingsStore.getState().setLanguage('pt')
  })

  it('usa português por padrão', () => {
    const { result } = renderHook(() => useT())
    expect(result.current('roomsTab')).toBe('Salas')
    expect(result.current('noMessages')).toBe('Nenhuma mensagem ainda')
  })

  it('troca para inglês e reflete nas traduções', () => {
    act(() => useSettingsStore.getState().setLanguage('en'))
    const { result } = renderHook(() => useT())
    expect(result.current('roomsTab')).toBe('Rooms')
    expect(result.current('noMessages')).toBe('No messages yet')
  })

  it('interpola parâmetros', () => {
    const { result } = renderHook(() => useT())
    expect(result.current('usersCount', { n: 3 })).toBe('3 usuários')
    expect(result.current('messagesCount', { count: 7 })).toBe('7 mensagens')
  })

  it('tStatic reflete o idioma atual sem hook', () => {
    expect(tStatic('forwardTo')).toBe('Encaminhar para')
    act(() => useSettingsStore.getState().setLanguage('en'))
    expect(tStatic('forwardTo')).toBe('Forward to')
  })
})
