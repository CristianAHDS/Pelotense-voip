import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, fireEvent, cleanup, act } from '@testing-library/react'
import { MainPage } from '../pages/MainPage.tsx'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useRoomStore } from '../stores/roomStore.ts'
import { usePrivateChatStore } from '../stores/privateChatStore.ts'
import { useVoiceStore } from '../stores/voiceStore.ts'
import { useLiveStore } from '../stores/liveStore.ts'
import { useSettingsStore } from '../stores/settingsStore.ts'

vi.mock('../services/connectionService.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../services/connectionService.ts')>()
  return {
    ...mod,
    getVoiceManager: () => ({
      listMicrophones: vi.fn().mockResolvedValue([]),
      startMicrophone: vi.fn().mockResolvedValue(true),
      stopMicrophone: vi.fn(),
    }),
  }
})

function resetStores(): void {
  useConnectionStore.setState({ connected: true, id: 'me', name: 'Eu', admin: false, reconnecting: false })
  useRoomStore.setState({ rooms: [], users: [], currentRoom: null, currentRoomName: null, messages: [] })
  usePrivateChatStore.setState({ activeUserId: null, activeUserName: null, messages: {}, unread: {} })
  useVoiceStore.setState({ muted: true, volume: 0.8, level: 0, rxLevel: 0, speaking: {} })
  useLiveStore.setState({ broadcaster: null, chunks: [], pendingRequest: null, takeoverRequestSent: false, requestDenied: 0 })
  useSettingsStore.setState({ theme: 'dark' })
}

beforeEach(() => {
  resetStores()
  Element.prototype.scrollIntoView = () => {}
})

afterEach(() => {
  cleanup()
})

describe('MainPage (sheet mobile com 3 abas)', () => {
  it('abre o sheet ao tocar no menu', () => {
    const { container } = render(<MainPage />)
    expect(container.querySelector('.mobile-sheet--open')).toBeNull()

    fireEvent.click(container.querySelector('.menu-toggle')!)
    expect(container.querySelector('.mobile-sheet--open')).not.toBeNull()
  })

  it('fecha o sheet automaticamente ao entrar numa sala', () => {
    const { container } = render(<MainPage />)
    fireEvent.click(container.querySelector('.menu-toggle')!)
    expect(container.querySelector('.mobile-sheet--open')).not.toBeNull()

    act(() => {
      useRoomStore.getState().setCurrentRoom('r1', 'Sala X')
    })

    expect(container.querySelector('.mobile-sheet--open')).toBeNull()
  })

  it('não fecha o sheet quando não entra em nenhuma sala', () => {
    const { container } = render(<MainPage />)
    fireEvent.click(container.querySelector('.menu-toggle')!)
    expect(container.querySelector('.mobile-sheet--open')).not.toBeNull()

    act(() => {
      useRoomStore.getState().setRooms([{ id: 'r1', name: 'Sala X', users: 0 }])
    })

    expect(container.querySelector('.mobile-sheet--open')).not.toBeNull()
  })

  it('mostra a versão da UI discretamente na sidebar esquerda', () => {
    const { container } = render(<MainPage />)
    const badge = container.querySelector('.sidebar-version')
    expect(badge).not.toBeNull()
    expect(badge!.textContent).toContain(__APP_VERSION__)
  })

  it('mostra a versão do servidor no rodapé da sidebar quando conectado', () => {
    act(() => {
      useConnectionStore.getState().setServerVersion('1.0.0', 7)
    })
    const { container } = render(<MainPage />)
    const badge = container.querySelector('.sidebar-version')
    expect(badge!.textContent).toContain('1.0.0')
    expect(badge!.textContent).toContain('7')
    expect(badge!.getAttribute('title')).toContain('Servidor: v1.0.0 (build 7)')
  })
})
