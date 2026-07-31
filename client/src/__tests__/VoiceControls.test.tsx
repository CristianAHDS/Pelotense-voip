import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.hoisted(() => {
  Object.defineProperty(window, 'location', {
    value: { protocol: 'https:', hostname: 'localhost' },
    configurable: true,
  })
})

import { render, cleanup } from '@testing-library/react'
import { VoiceControls } from '../components/VoiceControls.tsx'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useRoomStore } from '../stores/roomStore.ts'
import { useVoiceStore } from '../stores/voiceStore.ts'

function resetStores(): void {
  useConnectionStore.setState({ connected: true, id: 'me', name: 'Eu', admin: false, reconnecting: false })
  useRoomStore.setState({ rooms: [], users: [], currentRoom: 'r1', currentRoomName: 'Sala', messages: [] })
  useVoiceStore.setState({ muted: true, volume: 0.8, level: 0, rxLevel: 0, speaking: {} })
}

beforeEach(() => {
  resetStores()
})

afterEach(() => {
  cleanup()
})

describe('VoiceControls (medidor RX)', () => {
  it('mostra RX 0% e nenhuma barra ativa quando rxLevel é NaN', () => {
    useVoiceStore.getState().setRxLevel(NaN)
    const { container } = render(<VoiceControls />)
    const value = container.querySelector('.vu-meter--rx .vu-meter-value')
    expect(value?.textContent).toBe('0%')
    expect(container.querySelectorAll('.vu-meter--rx .vu-bar--active').length).toBe(0)
  })

  it('mostra RX com percentual e barras proporcionais', () => {
    useVoiceStore.getState().setRxLevel(0.5)
    const { container } = render(<VoiceControls />)
    const value = container.querySelector('.vu-meter--rx .vu-meter-value')
    expect(value?.textContent).toBe('50%')
    expect(container.querySelectorAll('.vu-meter--rx .vu-bar--active').length).toBe(5)
  })

  it('mantém o medidor de mic em 0% quando o nível é NaN', () => {
    useVoiceStore.getState().setLevel(NaN)
    const { container } = render(<VoiceControls />)
    const value = container.querySelector('.vu-meter-value')
    expect(value?.textContent).toBe('0%')
    expect(container.querySelectorAll('.vu-meter .vu-bar--active').length).toBe(0)
  })
})
