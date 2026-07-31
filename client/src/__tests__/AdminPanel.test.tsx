import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { AdminPanel } from '../components/AdminPanel.tsx'
import { useAccountStore } from '../stores/accountStore.ts'
import { useRoomStore } from '../stores/roomStore.ts'
import { sendAdminUpdateAccount, requestAccounts } from '../services/connectionService.ts'

vi.mock('../services/connectionService.ts', () => ({
  requestAccounts: vi.fn(),
  sendAdminUpdateAccount: vi.fn(),
}))

function reset(): void {
  useAccountStore.setState({ adminOpen: false, prefsOpen: false, chatFullscreen: false })
  useRoomStore.setState({ rooms: [], users: [], accounts: [], currentRoom: null, currentRoomName: null, messages: [] })
}

beforeEach(() => {
  reset()
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('AdminPanel', () => {
  it('não renderiza quando fechado', () => {
    const { container } = render(<AdminPanel />)
    expect(container.querySelector('.admin-modal')).toBeNull()
  })

  it('abre com a aba Usuários e caixas online/offline', () => {
    useAccountStore.setState({ adminOpen: true })
    useRoomStore.getState().setAccounts([
      { id: 'u1', name: 'Ana', online: true },
      { id: 'u2', name: 'Bruno', online: false },
    ])
    render(<AdminPanel />)
    expect(screen.getByRole('tab', { name: 'Usuários' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Sistema' })).toBeInTheDocument()
    expect(screen.getByText('Online (1)')).toBeInTheDocument()
    expect(screen.getByText('Offline (1)')).toBeInTheDocument()
  })

  it('mostra placeholder na aba Sistema', () => {
    useAccountStore.setState({ adminOpen: true })
    useRoomStore.getState().setAccounts([{ id: 'u1', name: 'Ana', online: true }])
    render(<AdminPanel />)
    fireEvent.click(screen.getByRole('tab', { name: 'Sistema' }))
    expect(screen.getByText('Configurações do sistema')).toBeInTheDocument()
    expect(screen.queryByText('Online (1)')).not.toBeInTheDocument()
  })

  it('solicita a lista de contas ao abrir', () => {
    useAccountStore.setState({ adminOpen: true })
    render(<AdminPanel />)
    expect(requestAccounts).toHaveBeenCalled()
  })

  it('ao clicar num usuário abre a edição com opção de tornar admin', () => {
    useAccountStore.setState({ adminOpen: true })
    useRoomStore.getState().setAccounts([{ id: 'u1', name: 'Ana', online: false, admin: false }])
    const { container } = render(<AdminPanel />)
    fireEvent.click(container.querySelector('.user-item--offline')!)
    expect(screen.getByText('Editar usuário')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tornar admin' })).toBeInTheDocument()
  })

  it('salva alterações de nome, e-mail e senha', () => {
    useAccountStore.setState({ adminOpen: true })
    useRoomStore.getState().setAccounts([{ id: 'u1', name: 'Ana', online: false }])
    const { container } = render(<AdminPanel />)
    fireEvent.click(container.querySelector('.user-item--offline')!)
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'AnaEditada' } })
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'ana@test.com' } })
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'nova123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(sendAdminUpdateAccount).toHaveBeenCalledWith({
      userId: 'u1',
      userName: 'Ana',
      name: 'AnaEditada',
      email: 'ana@test.com',
      password: 'nova123',
      isAdmin: false,
      tags: [],
    })
  })

  it('só efetiva a mudança de admin após salvar', () => {
    useAccountStore.setState({ adminOpen: true })
    useRoomStore.getState().setAccounts([{ id: 'u1', name: 'Ana', online: false, admin: false }])
    const { container } = render(<AdminPanel />)
    fireEvent.click(container.querySelector('.user-item--offline')!)
    fireEvent.click(screen.getByRole('button', { name: 'Tornar admin' }))
    expect(sendAdminUpdateAccount).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(sendAdminUpdateAccount).toHaveBeenCalledWith({
      userId: 'u1',
      userName: 'Ana',
      name: 'Ana',
      isAdmin: true,
      tags: [],
    })
  })

  it('permite adicionar tags clicando nelas e salva junto', () => {
    useAccountStore.setState({ adminOpen: true })
    useRoomStore.getState().setAccounts([{ id: 'u1', name: 'Ana', online: false }])
    const { container } = render(<AdminPanel />)
    fireEvent.click(container.querySelector('.user-item--offline')!)
    fireEvent.click(screen.getByRole('button', { name: 'Repórter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Vídeo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(sendAdminUpdateAccount).toHaveBeenCalledWith({
      userId: 'u1',
      userName: 'Ana',
      name: 'Ana',
      isAdmin: false,
      tags: ['Repórter', 'Vídeo'],
    })
  })
})
