import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Toasts } from '../components/Toasts.tsx'
import { useToastStore } from '../stores/toastStore.ts'

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
})

afterEach(() => {
  cleanup()
})

describe('Toasts', () => {
  it('renderiza toasts ativos', () => {
    useToastStore.getState().show('success', 'Sala criada')
    render(<Toasts />)
    expect(screen.getByText('Sala criada')).toBeInTheDocument()
  })

  it('não renderiza nada quando não há toasts', () => {
    const { container } = render(<Toasts />)
    expect(container.querySelector('.toasts')).toBeNull()
  })

  it('descarta o toast ao clicar no fechar', () => {
    useToastStore.getState().show('error', 'Erro de conexão')
    render(<Toasts />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('Erro de conexão')).not.toBeInTheDocument()
  })
})
