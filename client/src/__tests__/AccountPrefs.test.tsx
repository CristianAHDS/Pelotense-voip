import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, fireEvent, cleanup, act } from '@testing-library/react'
import { MainPage } from '../pages/MainPage.tsx'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useRoomStore } from '../stores/roomStore.ts'
import { usePrivateChatStore } from '../stores/privateChatStore.ts'
import { useVoiceStore } from '../stores/voiceStore.ts'
import { useLiveStore } from '../stores/liveStore.ts'
import { useSettingsStore } from '../stores/settingsStore.ts'
import { useAccountStore } from '../stores/accountStore.ts'
import { sendUpdateProfile } from '../services/connectionService.ts'

vi.mock('../services/connectionService.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../services/connectionService.ts')>()
  return {
    ...mod,
    getVoiceManager: () => ({
      listMicrophones: vi.fn().mockResolvedValue([]),
      startMicrophone: vi.fn().mockResolvedValue(true),
      stopMicrophone: vi.fn(),
    }),
    sendUpdateProfile: vi.fn(),
  }
})

function resetStores(): void {
  useConnectionStore.setState({ connected: true, id: 'me', name: 'Eu', admin: false, reconnecting: false })
  useRoomStore.setState({ rooms: [], users: [], currentRoom: null, currentRoomName: null, messages: [] })
  usePrivateChatStore.setState({ activeUserId: null, activeUserName: null, messages: {}, unread: {} })
  useVoiceStore.setState({ muted: true, volume: 0.8, level: 0, rxLevel: 0, speaking: {} })
  useLiveStore.setState({ broadcasters: [], chunks: [], pendingRequest: null, takeoverRequestSent: false, requestDenied: 0 })
  useSettingsStore.setState({ theme: 'dark' })
  useAccountStore.setState({ name: 'Eu', password: 'senha', avatar: '', prefsOpen: false, chatFullscreen: false })
}

beforeEach(() => {
  resetStores()
  Element.prototype.scrollIntoView = () => {}
})

afterEach(() => {
  cleanup()
  vi.mocked(sendUpdateProfile).mockClear()
})

describe('Preferências de conta', () => {
  it('abre o modal pelo botão da sidebar esquerda', () => {
    const { container } = render(<MainPage />)
    expect(container.querySelector('.account-prefs-modal')).toBeNull()

    fireEvent.click(container.querySelector('.btn-account-prefs')!)
    expect(container.querySelector('.account-prefs-modal')).not.toBeNull()
  })

  it('salva as preferências e chama update_profile', () => {
    const { container } = render(<MainPage />)
    fireEvent.click(container.querySelector('.btn-account-prefs')!)
    const modal = container.querySelector('.account-prefs-modal')!

    const nameInput = modal.querySelector('#acc-name') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'NovoNome' } })

    fireEvent.click(modal.querySelector('.btn-primary')!)

    expect(useAccountStore.getState().name).toBe('NovoNome')
    expect(sendUpdateProfile).toHaveBeenCalledWith({ name: 'NovoNome', password: 'senha', avatar: undefined })
    expect(useAccountStore.getState().prefsOpen).toBe(false)
  })

  it('fecha o modal pelo botão de fechar', () => {
    const { container } = render(<MainPage />)
    fireEvent.click(container.querySelector('.btn-account-prefs')!)
    expect(container.querySelector('.account-prefs-modal')).not.toBeNull()

    fireEvent.click(container.querySelector('.account-prefs-modal .btn-close-pchat')!)
    expect(container.querySelector('.account-prefs-modal')).toBeNull()
  })
})

describe('Chat em tela cheia', () => {
  it('abre o chat em tela cheia pelo botão no header', () => {
    useRoomStore.setState({ rooms: [], users: [], currentRoom: 'r1', currentRoomName: 'Ao vivo', messages: [] })
    const { container } = render(<MainPage />)
    expect(container.querySelector('.fullscreen-chat')).toBeNull()

    fireEvent.click(container.querySelector('.chat-fullscreen-btn')!)
    expect(container.querySelector('.fullscreen-chat')).not.toBeNull()
  })

  it('fecha o chat em tela cheia pelo botão de fechar', () => {
    useRoomStore.setState({ rooms: [], users: [], currentRoom: 'r1', currentRoomName: 'Ao vivo', messages: [] })
    const { container } = render(<MainPage />)
    fireEvent.click(container.querySelector('.chat-fullscreen-btn')!)
    expect(container.querySelector('.fullscreen-chat')).not.toBeNull()

    fireEvent.click(container.querySelector('.fullscreen-chat-toolbar .btn-close-pchat')!)
    expect(container.querySelector('.fullscreen-chat')).toBeNull()
  })
})
