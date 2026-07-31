import { describe, it, expect } from 'vitest'
import { userColor, initials } from '../ui/avatar.ts'

describe('avatar utilities', () => {
  it('gera cor estável e consistente para o mesmo seed', () => {
    const a = userColor('user-123')
    const b = userColor('user-123')
    expect(a).toMatch(/^#[0-9a-f]{6}$/i)
    expect(a).toBe(b)
  })

  it('gera cores diferentes para seeds diferentes na maioria dos casos', () => {
    const colors = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(userColor))
    expect(colors.size).toBeGreaterThan(1)
  })

  it('extrai as iniciais de nomes compostos', () => {
    expect(initials('Maria Silva')).toBe('MS')
    expect(initials('joao')).toBe('JO')
    expect(initials('Ana Clara Souza')).toBe('AC')
  })

  it('trata nomes vazios', () => {
    expect(initials('')).toBe('?')
    expect(initials('   ')).toBe('?')
  })

  it('respeita o limite máximo de letras', () => {
    expect(initials('João Pedro Almeida', 1)).toBe('J')
  })
})
