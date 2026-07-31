import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.hoisted(() => {
  Object.defineProperty(window, 'location', {
    value: { protocol: 'https:', hostname: 'localhost' },
    configurable: true,
  })
})

vi.mock('../services/connectionService.ts', () => ({
  getVoiceManager: () => ({
    startMicrophone: vi.fn().mockResolvedValue(true),
  }),
}))

import { render, cleanup, fireEvent } from '@testing-library/react'
import { PushToTalkButton } from '../components/PushToTalkButton.tsx'
import { useSettingsStore } from '../stores/settingsStore.ts'
import { useVoiceStore } from '../stores/voiceStore.ts'

function resetStores(): void {
  useSettingsStore.setState({ pushToTalk: false, pushToTalkKey: 'Space', serverHost: 'x', serverWsPort: 3001 })
  useVoiceStore.setState({ muted: true, volume: 0.8, level: 0, rxLevel: 0, speaking: {}, transmitting: false })
}

beforeEach(() => {
  resetStores()
})

afterEach(() => {
  cleanup()
})

describe('PushToTalkButton', () => {
  it('não renderiza nada quando o PTT está desativado', () => {
    const { container } = render(<PushToTalkButton />)
    expect(container.querySelector('.ptt-overlay')).toBeNull()
  })

  it('renderiza o botão flutuante quando o PTT está ativado', () => {
    useSettingsStore.getState().setPushToTalk(true)
    const { getByTestId } = render(<PushToTalkButton />)
    expect(getByTestId('ptt-overlay')).not.toBeNull()
  })

  it('pressionar com o ponteiro define transmitting=true e soltar limpa', () => {
    useSettingsStore.getState().setPushToTalk(true)
    const { getByRole } = render(<PushToTalkButton />)
    const btn = getByRole('button', { name: /push-to-talk/i })

    fireEvent.pointerDown(btn)
    expect(useVoiceStore.getState().transmitting).toBe(true)
    expect(btn.getAttribute('aria-pressed')).toBe('true')

    fireEvent.pointerUp(btn)
    expect(useVoiceStore.getState().transmitting).toBe(false)
  })

  it('liberar com pointerLeave também limpa o transmitting', () => {
    useSettingsStore.getState().setPushToTalk(true)
    const { getByRole } = render(<PushToTalkButton />)
    const btn = getByRole('button', { name: /push-to-talk/i })

    fireEvent.pointerDown(btn)
    expect(useVoiceStore.getState().transmitting).toBe(true)
    fireEvent.pointerLeave(btn)
    expect(useVoiceStore.getState().transmitting).toBe(false)
  })

  it('tecla configurada (espaço) ativa/desativa o transmitting', () => {
    useSettingsStore.getState().setPushToTalk(true)
    useSettingsStore.getState().setPushToTalkKey('Space')
    render(<PushToTalkButton />)

    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    expect(useVoiceStore.getState().transmitting).toBe(true)

    fireEvent.keyUp(window, { key: ' ', code: 'Space' })
    expect(useVoiceStore.getState().transmitting).toBe(false)
  })

  it('tecla personalizada (V) ativa/desativa o transmitting', () => {
    useSettingsStore.getState().setPushToTalk(true)
    useSettingsStore.getState().setPushToTalkKey('v')
    render(<PushToTalkButton />)

    fireEvent.keyDown(window, { key: 'v', code: 'KeyV' })
    expect(useVoiceStore.getState().transmitting).toBe(true)

    fireEvent.keyUp(window, { key: 'v', code: 'KeyV' })
    expect(useVoiceStore.getState().transmitting).toBe(false)
  })

  it('não dispara o PTT ao digitar num input', () => {
    useSettingsStore.getState().setPushToTalk(true)
    render(<PushToTalkButton />)

    const input = document.createElement('input')
    fireEvent.keyDown(input, { key: ' ', code: 'Space' })
    expect(useVoiceStore.getState().transmitting).toBe(false)
  })

  it('sair da janela (blur) limpa o transmitting', () => {
    useSettingsStore.getState().setPushToTalk(true)
    render(<PushToTalkButton />)

    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    expect(useVoiceStore.getState().transmitting).toBe(true)

    fireEvent(window, new Event('blur'))
    expect(useVoiceStore.getState().transmitting).toBe(false)
  })
})
