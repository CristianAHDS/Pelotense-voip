import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'
import { RadioBot } from '../components/RadioBot.tsx'

const { mockPlayer, stateCbs } = vi.hoisted(() => {
  const stateCbs: Array<(s: string) => void> = []
  const mockPlayer = {
    usingFallback: false,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    stop: vi.fn(),
    onStateChange: vi.fn((cb: (s: string) => void) => {
      stateCbs.push(cb)
      return () => {
        const i = stateCbs.indexOf(cb)
        if (i >= 0) stateCbs.splice(i, 1)
      }
    }),
  }
  return { mockPlayer, stateCbs }
})

vi.mock('../services/radioStream.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/radioStream.ts')>()
  return {
    ...actual,
    radioPlayer: mockPlayer,
  }
})

function emitState(s: string): void {
  stateCbs.forEach((cb) => cb(s))
}

beforeEach(() => {
  stateCbs.length = 0
  mockPlayer.play.mockClear()
  mockPlayer.pause.mockClear()
  mockPlayer.stop.mockClear()
  mockPlayer.onStateChange.mockClear()
  mockPlayer.play.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('RadioBot', () => {
  it('renderiza o bot sem iniciar ao montar', () => {
    const { container } = render(<RadioBot />)
    expect(container.querySelector('.radio-bot')).not.toBeNull()
    expect(container.querySelector('.radio-bot-name')?.textContent).toBe('Bot')
    expect(container.querySelector('.radio-bot-status')?.textContent).toBe('Pausado')
    expect(mockPlayer.play).not.toHaveBeenCalled()
    expect(mockPlayer.stop).not.toHaveBeenCalled()
  })

  it('inicia ao clicar no play', () => {
    const { container } = render(<RadioBot />)
    fireEvent.click(container.querySelector('.radio-bot-btn')!)
    expect(mockPlayer.play).toHaveBeenCalledTimes(1)
  })

  it('para o player ao desmontar', () => {
    const { unmount } = render(<RadioBot />)
    unmount()
    expect(mockPlayer.stop).toHaveBeenCalled()
  })

  it('não para o player ao desmontar uma instância enquanto outra segue montada (tela cheia)', () => {
    const first = render(<RadioBot />)
    const second = render(<RadioBot />)
    second.unmount()
    expect(mockPlayer.stop).not.toHaveBeenCalled()
    first.unmount()
    expect(mockPlayer.stop).toHaveBeenCalled()
  })

  it('reflete o estado "playing" vindo do player', async () => {
    const { container } = render(<RadioBot />)
    await act(async () => { emitState('playing') })
    expect(container.querySelector('.radio-bot-status')?.textContent).toBe('Tocando rádio ao vivo')
    expect(container.querySelector('.radio-bot-btn')?.className).toContain('playing')
  })

  it('pausa ao clicar no botão quando está tocando', async () => {
    const { container } = render(<RadioBot />)
    await act(async () => { emitState('playing') })
    fireEvent.click(container.querySelector('.radio-bot-btn')!)
    expect(mockPlayer.pause).toHaveBeenCalled()
  })

  it('retoma ao clicar no botão quando está pausado', async () => {
    const { container } = render(<RadioBot />)
    await act(async () => { emitState('paused') })
    expect(container.querySelector('.radio-bot-status')?.textContent).toBe('Pausado')

    fireEvent.click(container.querySelector('.radio-bot-btn')!)
    expect(mockPlayer.play).toHaveBeenCalledTimes(1)
  })

  it('se o autoplay é bloqueado, tenta de novo na primeira interação', async () => {
    mockPlayer.play.mockRejectedValueOnce(new Error('autoplay bloqueado')).mockResolvedValueOnce(undefined)
    const { container } = render(<RadioBot />)
    fireEvent.click(container.querySelector('.radio-bot-btn')!)
    await act(async () => {})
    await act(async () => { emitState('paused') })
    expect(container.querySelector('.radio-bot-status')?.textContent).toBe('Pausado')

    act(() => { fireEvent.pointerDown(window) })
    await act(async () => {})
    expect(mockPlayer.play).toHaveBeenCalledTimes(2)
  })

  it('mostra erro e permite tentar novamente', async () => {
    const { container } = render(<RadioBot />)
    fireEvent.click(container.querySelector('.radio-bot-btn')!)
    await act(async () => { emitState('error') })
    expect(container.querySelector('.radio-bot-status')?.textContent).toBe('Erro ao carregar o stream')
    const retry = container.querySelector('.radio-bot-retry')!
    expect(retry).not.toBeNull()
    fireEvent.click(retry)
    expect(mockPlayer.play).toHaveBeenCalledTimes(2)
  })

  it('variante compacta não para o player ao desmontar', () => {
    const { unmount } = render(<RadioBot compact />)
    unmount()
    expect(mockPlayer.stop).not.toHaveBeenCalled()
    expect(stateCbs.length).toBe(0)
  })
})
