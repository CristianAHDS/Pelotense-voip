import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { useAccountStore } from '../stores/accountStore.ts'
import { Avatar } from '../ui/Avatar.tsx'

const CREDENTIALS_KEY = 'voip_credentials'
const AVATAR_KEY = 'voip_avatar'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('accountStore', () => {
  it('persiste avatar no localStorage', () => {
    useAccountStore.getState().savePrefs({ name: 'Ana', password: 'seg', avatar: 'data:image/png;base64,abc' })
    expect(localStorage.getItem(AVATAR_KEY)).toBe('data:image/png;base64,abc')
  })

  it('persiste credenciais no localStorage', () => {
    useAccountStore.getState().savePrefs({ name: 'Ana', password: 'seg', avatar: '' })
    const parsed = JSON.parse(localStorage.getItem(CREDENTIALS_KEY) ?? '{}')
    expect(parsed.name).toBe('Ana')
    expect(parsed.password).toBe('seg')
  })

  it('remove avatar do localStorage quando limpo', () => {
    useAccountStore.getState().savePrefs({ name: 'Ana', password: 'seg', avatar: 'data:image/png;base64,abc' })
    useAccountStore.getState().savePrefs({ name: 'Ana', password: 'seg', avatar: '' })
    expect(localStorage.getItem(AVATAR_KEY)).toBeNull()
  })

  it('recarrega nome/senha/avatar persistidos no armazenamento', () => {
    useAccountStore.getState().savePrefs({ name: 'Persistida', password: '123', avatar: 'data:image/png;base64,p' })
    expect(useAccountStore.getState().name).toBe('Persistida')
    expect(useAccountStore.getState().password).toBe('123')
    expect(useAccountStore.getState().avatar).toBe('data:image/png;base64,p')
    expect(localStorage.getItem(AVATAR_KEY)).toBe('data:image/png;base64,p')
    const creds = JSON.parse(localStorage.getItem(CREDENTIALS_KEY) ?? '{}')
    expect(creds.name).toBe('Persistida')
    expect(creds.password).toBe('123')
  })

  it('alterna o estado de tela cheia', () => {
    expect(useAccountStore.getState().chatFullscreen).toBe(false)
    useAccountStore.getState().toggleFullscreen()
    expect(useAccountStore.getState().chatFullscreen).toBe(true)
    useAccountStore.getState().toggleFullscreen()
    expect(useAccountStore.getState().chatFullscreen).toBe(false)
  })

  it('abre e fecha as preferências', () => {
    expect(useAccountStore.getState().prefsOpen).toBe(false)
    useAccountStore.getState().openPrefs()
    expect(useAccountStore.getState().prefsOpen).toBe(true)
    useAccountStore.getState().closePrefs()
    expect(useAccountStore.getState().prefsOpen).toBe(false)
  })
})

describe('Avatar', () => {
  it('renderiza as iniciais quando não há avatar', () => {
    const { container } = render(<Avatar id="u1" name="Maria Silva" />)
    const span = container.querySelector('.user-avatar')!
    expect(span.textContent).toBe('MS')
    expect(span.querySelector('img')).toBeNull()
  })

  it('renderiza a imagem quando há avatar', () => {
    const { container } = render(<Avatar id="u1" name="Maria Silva" avatar="data:image/png;base64,abc" />)
    const img = container.querySelector('.user-avatar-img') as HTMLImageElement
    expect(img).not.toBeNull()
    expect(img.src).toBe('data:image/png;base64,abc')
    expect(img.alt).toBe('Maria Silva')
  })
})
