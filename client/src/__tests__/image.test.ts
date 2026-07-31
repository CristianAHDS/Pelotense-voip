import { describe, it, expect } from 'vitest'
import { imageBase64ExceedsLimit, MAX_IMAGE_BASE64_LENGTH, MAX_IMAGE_BYTES } from '../utils/image.ts'

describe('image.ts (limites de envio)', () => {
  it('limite base64 espelha MAX_IMAGE_BYTES (5MB)', () => {
    expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024)
    expect(MAX_IMAGE_BASE64_LENGTH).toBe(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4)
  })

  it('rejeita base64 acima do limite', () => {
    expect(imageBase64ExceedsLimit('A'.repeat(MAX_IMAGE_BASE64_LENGTH + 1))).toBe(true)
  })

  it('aceita base64 dentro do limite', () => {
    expect(imageBase64ExceedsLimit('A'.repeat(MAX_IMAGE_BASE64_LENGTH))).toBe(false)
    expect(imageBase64ExceedsLimit('')).toBe(false)
  })
})
