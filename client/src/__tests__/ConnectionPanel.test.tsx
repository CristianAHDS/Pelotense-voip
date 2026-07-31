import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ConnectionPanel } from '../components/ConnectionPanel.tsx'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { disconnectFromServer, connectToServer } from '../services/connectionService.ts'

const STORAGE_KEY = 'voip_credentials'

vi.mock('../services/connectionService.ts', () => ({
  connectToServer: vi.fn(),
  disconnectFromServer: vi.fn(),
}))

function renderConnected() {
  useConnectionStore.setState({ connected: true, reconnecting: false, id: 'id1', name: 'Reporter' })
  render(<ConnectionPanel />)
}

function renderLoggedOut() {
  useConnectionStore.setState({ connected: false, reconnecting: false, id: null, name: null, loginStep: 'none', loginError: '' })
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

describe('ConnectionPanel desconexão', () => {
  it('mostra botão Disconnect quando conectado', () => {
    renderConnected()
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument()
  })

  it('não mostra botão Logout quando conectado', () => {
    renderConnected()
    expect(screen.queryByRole('button', { name: 'Logout' })).not.toBeInTheDocument()
  })

  it('não mostra botão Disconnect quando desconectado', () => {
    renderLoggedOut()
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument()
  })

  it('Disconnect desconecta e também faz logout limpando as credenciais', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      host: '10.0.0.1',
      wsPort: '3001',
      wssPort: '3003',
      name: 'Reporter',
      password: 'segredo',
    }))
    renderConnected()
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(disconnectFromServer).toHaveBeenCalled()
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(stored.name).toBe('')
    expect(stored.password).toBe('')
    expect(stored.host).toBe('10.0.0.1')
  })
})

describe('ConnectionPanel login', () => {
  it('mostra abas de Entrar e Criar conta no formulário', () => {
    renderLoggedOut()
    expect(screen.getByRole('tab', { name: 'Entrar' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Criar conta' })).toBeInTheDocument()
  })

  it('aba de login mostra usuário/e-mail e senha', () => {
    renderLoggedOut()
    expect(screen.getByLabelText('Usuário ou e-mail')).toBeInTheDocument()
    expect(screen.getByLabelText('Senha')).toBeInTheDocument()
    expect(screen.queryByLabelText('E-mail')).not.toBeInTheDocument()
  })

  it('não mostra campo de código de confirmação', () => {
    renderLoggedOut()
    expect(screen.queryByLabelText('Código de confirmação')).not.toBeInTheDocument()
  })

  it('chama connectToServer com intent login no fluxo normal', () => {
    renderLoggedOut()
    fireEvent.change(screen.getByLabelText('Usuário ou e-mail'), { target: { value: 'Reporter' } })
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'segredo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(connectToServer).toHaveBeenCalledWith(expect.stringContaining('ws'), 'Reporter', 'segredo', undefined, 'login')
  })

  it('bloqueia login sem nome', () => {
    renderLoggedOut()
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'segredo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Informe seu nome ou e-mail')
    expect(connectToServer).not.toHaveBeenCalled()
  })

  it('bloqueia login sem senha', () => {
    renderLoggedOut()
    fireEvent.change(screen.getByLabelText('Usuário ou e-mail'), { target: { value: 'Reporter' } })
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Informe a senha')
    expect(connectToServer).not.toHaveBeenCalled()
  })
})

describe('ConnectionPanel register', () => {
  function openRegister() {
    renderLoggedOut()
    fireEvent.click(screen.getByRole('tab', { name: 'Criar conta' }))
  }

  it('mostra nome, e-mail, senha e confirmar senha', () => {
    openRegister()
    expect(screen.getByLabelText('Nome')).toBeInTheDocument()
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument()
    expect(screen.getByLabelText('Senha')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirmar senha')).toBeInTheDocument()
  })

  it('chama connectToServer com intent register quando tudo é válido', () => {
    openRegister()
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Novato' } })
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'novo@test.com' } })
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'segredo' } })
    fireEvent.change(screen.getByLabelText('Confirmar senha'), { target: { value: 'segredo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
    expect(connectToServer).toHaveBeenCalledWith(expect.stringContaining('ws'), 'Novato', 'segredo', 'novo@test.com', 'register')
  })

  it('exige e-mail no registro', () => {
    openRegister()
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Novato' } })
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'segredo' } })
    fireEvent.change(screen.getByLabelText('Confirmar senha'), { target: { value: 'segredo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
    expect(screen.getByRole('alert')).toHaveTextContent('E-mail inválido')
    expect(connectToServer).not.toHaveBeenCalled()
  })

  it('bloqueia senhas diferentes', () => {
    openRegister()
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Novato' } })
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'novo@test.com' } })
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'segredo' } })
    fireEvent.change(screen.getByLabelText('Confirmar senha'), { target: { value: 'outra' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
    expect(screen.getByRole('alert')).toHaveTextContent('As senhas não coincidem')
    expect(connectToServer).not.toHaveBeenCalled()
  })
})
