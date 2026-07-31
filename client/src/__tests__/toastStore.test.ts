import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useToastStore } from '../stores/toastStore.ts'

describe('toastStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useToastStore.setState({ toasts: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('adiciona um toast com o tipo e mensagem informados', () => {
    useToastStore.getState().show('success', 'Sala criada')
    expect(useToastStore.getState().toasts).toHaveLength(1)
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      kind: 'success',
      message: 'Sala criada',
    })
  })

  it('remove o toast automaticamente após o tempo', () => {
    useToastStore.getState().show('info', 'oi')
    expect(useToastStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(3000)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('permite descartar um toast manualmente', () => {
    useToastStore.getState().show('error', 'Erro')
    const id = useToastStore.getState().toasts[0].id
    useToastStore.getState().dismiss(id)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('mantém vários toasts e remove apenas o selecionado', () => {
    useToastStore.getState().show('success', 'um')
    useToastStore.getState().show('success', 'dois')
    const id = useToastStore.getState().toasts[0].id
    useToastStore.getState().dismiss(id)
    const remaining = useToastStore.getState().toasts
    expect(remaining).toHaveLength(1)
    expect(remaining[0].message).toBe('dois')
  })
})
