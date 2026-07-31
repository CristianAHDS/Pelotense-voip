import { describe, it, expect } from 'vitest'
import { chunkToBuffer, isMseSupported, MAX_CHUNKS, MSE_MIMES } from '../utils/livePlayer.ts'

describe('chunkToBuffer', () => {
  it('converte base64 válido em bytes corretos', () => {
    const buf = chunkToBuffer('AQIDBA==')
    expect(Array.from(buf)).toEqual([1, 2, 3, 4])
  })

  it('converte string vazia em array vazio', () => {
    expect(chunkToBuffer('').length).toBe(0)
  })

  it('retorna array vazio para base64 inválido', () => {
    expect(chunkToBuffer('!!!não-base64!!!').length).toBe(0)
  })
})

describe('isMseSupported', () => {
  it('retorna o primeiro MIME suportado', () => {
    const ctor = { isTypeSupported: (mime: string) => mime === 'video/webm;codecs=vp8,opus' }
    expect(isMseSupported(ctor)).toBe('video/webm;codecs=vp8,opus')
  })

  it('retorna null quando nenhum MIME é suportado', () => {
    const ctor = { isTypeSupported: () => false }
    expect(isMseSupported(ctor)).toBeNull()
  })

  it('retorna null quando não há construtor', () => {
    expect(isMseSupported(undefined)).toBeNull()
    expect(isMseSupported(null)).toBeNull()
  })

  it('retorna null quando o construtor não tem isTypeSupported', () => {
    expect(isMseSupported({})).toBeNull()
  })

  it('ignora MIMEs que lançam exceção', () => {
    const ctor = {
      isTypeSupported: (mime: string) => {
        if (mime.includes('vp9')) throw new Error('boom')
        return true
      },
    }
    const supported = isMseSupported(ctor)
    expect(supported).toBeTruthy()
    expect(MSE_MIMES).toContain(supported)
  })

  it('usa os MIMEs padrão quando não especificados', () => {
    expect(MSE_MIMES.length).toBeGreaterThan(0)
    expect(MAX_CHUNKS).toBe(200)
  })
})
