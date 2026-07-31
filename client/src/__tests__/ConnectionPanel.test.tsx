import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ConnectionPanel } from '../components/ConnectionPanel.tsx'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { disconnectFromServer, connectToServer, resendLogin } from '../services/connectionService.ts'

const STORAGE_KEY = 'voip_credentials'

vi.mock('../services/connectionService.ts', () => ({
  connectToServer: vi.fn(),
  disconnectFromServer: vi.fn(),
  resendLogin: vi.fn(),
}))

function renderConnected() {
  useConnectionStore.setState({ connected: true, reconnecting: false, id: 'id1', name: 'Reporter' })
  render(<ConnectionPanel />)
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  useConnectionStore.setState({ connected: false, reconnecting: false, id: null, name: null })
})

afterEach(() => {
  cleanup()
})

describe('ConnectionPanel logout', () => {
  it('mostra botão Logout quando conectado', () => {
    renderConnected()
    expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument()
  })

  it('não mostra botão Logout quando desconectado', () => {
    render(<ConnectionPanel />)
    expect(screen.queryByRole('button', { name: 'Logout' })).not.toBeInTheDocument()
  })

  it('logout desconecta e limpa nome/senha do localStorage', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      host: '10.0.0.1',
      wsPort: '3001',
      wssPort: '3003',
      name: 'Reporter',
      password: 'segredo',
    }))
    renderConnected()
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }))
    expect(disconnectFromServer).toHaveBeenCalled()
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(stored.name).toBe('')
    expect(stored.password).toBe('')
    expect(stored.host).toBe('10.0.0.1')
  })
})

describe('ConnectionPanel login (e-mail/confirmação)', () => {
  beforeEach(() => {
    useConnectionStore.setState({ connected: false, reconnecting: false, id: null, name: null, loginStep: 'none', loginError: '' })
  })

  it('mostra campo de e-mail no formulário de login', () => {
    render(<ConnectionPanel />)
    expect(screen.getByLabelText(/E-mail/)).toBeInTheDocument()
    expect(screen.getByLabelText('Usuário ou e-mail')).toBeInTheDocument()
  })

  it('mostra campo de código quando loginStep é confirm_required', () => {
    useConnectionStore.setState({ loginStep: 'confirm_required' })
    render(<ConnectionPanel />)
    expect(screen.getByLabelText('Código de confirmação')).toBeInTheDocument()
  })

  it('envia e-mail via resendLogin quando loginStep é email_required', () => {
    useConnectionStore.setState({ loginStep: 'email_required' })
    render(<ConnectionPanel />)
    fireEvent.change(screen.getByLabelText(/E-mail/), { target: { value: 'novo@test.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(resendLogin).toHaveBeenCalledWith({ email: 'novo@test.com' })
    expect(connectToServer).not.toHaveBeenCalled()
  })

  it('envia código via resendLogin quando loginStep é confirm_required', () => {
    useConnectionStore.setState({ loginStep: 'confirm_required' })
    render(<ConnectionPanel />)
    fireEvent.change(screen.getByLabelText('Código de confirmação'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(resendLogin).toHaveBeenCalledWith({ confirmCode: '123456' })
    expect(connectToServer).not.toHaveBeenCalled()
  })

  it('chama connectToServer com e-mail no fluxo normal', () => {
    render(<ConnectionPanel />)
    fireEvent.change(screen.getByLabelText('Usuário ou e-mail'), { target: { value: 'Reporter' } })
    fireEvent.change(screen.getByLabelText(/E-mail/), { target: { value: 'r@test.com' } })
    fireEvent.change(screen.getByPlaceholderText('Senha'), { target: { value: 'segredo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(connectToServer).toHaveBeenCalledWith(expect.stringContaining('ws'), 'Reporter', 'segredo', 'r@test.com')
    expect(resendLogin).not.toHaveBeenCalled()
  })
})
