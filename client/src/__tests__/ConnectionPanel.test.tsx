import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ConnectionPanel } from '../components/ConnectionPanel.tsx'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { disconnectFromServer } from '../services/connectionService.ts'

const STORAGE_KEY = 'voip_credentials'

vi.mock('../services/connectionService.ts', () => ({
  connectToServer: vi.fn(),
  disconnectFromServer: vi.fn(),
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
