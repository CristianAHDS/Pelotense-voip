import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useVideoRecorder } from '../hooks/useVideoRecorder.ts'

let fileReaderPayload = ''

class FakeFileReader {
  result: string | null = null
  onloadend: (() => void) | null = null
  readAsDataURL(): void {
    this.result = `data:video/webm;base64,${fileReaderPayload}`
    this.onloadend?.()
  }
}

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = []
  static constructorCalls: Array<{ mimeType: string; options: Record<string, unknown> }> = []
  static isTypeSupported = () => true
  state = 'inactive'
  ondataavailable: ((e: { data: { size: number } }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public stream: unknown, public options: { mimeType: string; videoBitsPerSecond?: number }) {
    FakeMediaRecorder.constructorCalls.push({ mimeType: options.mimeType, options })
    FakeMediaRecorder.instances.push(this)
  }
  start(): void {
    this.state = 'recording'
  }
  stop(): void {
    this.state = 'inactive'
  }
}

let mediaRecorderCtor: typeof FakeMediaRecorder = FakeMediaRecorder

function setupMediaRecorder(Ctor: typeof FakeMediaRecorder): void {
  mediaRecorderCtor = Ctor
  ;(globalThis as any).MediaRecorder = Ctor
}

beforeEach(() => {
  fileReaderPayload = 'cmljYXJkbw=='
  FakeMediaRecorder.instances = []
  FakeMediaRecorder.constructorCalls = []
  mediaRecorderCtor = FakeMediaRecorder
  ;(globalThis as any).MediaRecorder = FakeMediaRecorder
  ;(globalThis as any).FileReader = FakeFileReader
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
      enumerateDevices: vi.fn().mockResolvedValue([]),
    },
  })
})

async function recordOnce(): Promise<unknown> {
  const { result } = renderHook(() => useVideoRecorder())
  await act(async () => {
    await result.current.openCamera()
  })
  let out: unknown
  await act(async () => {
    const p = result.current.beginRecording()
    const rec = mediaRecorderCtor.instances[0]
    rec.ondataavailable?.({ data: { size: 100 } })
    rec.onstop?.()
    out = await p
  })
  await act(async () => {
    result.current.closeCamera()
  })
  return out
}

describe('useVideoRecorder', () => {
  it('usa videoBitsPerSecond reduzido para vídeos menores', async () => {
    await recordOnce()
    expect(FakeMediaRecorder.constructorCalls[0].options.videoBitsPerSecond).toBe(500000)
  })

  it('cai para a construção sem videoBitsPerSecond quando o navegador rejeita a opção', async () => {
    class ThrowingCtor extends FakeMediaRecorder {
      constructor(stream: unknown, options: { mimeType: string; videoBitsPerSecond?: number }) {
        if (options.videoBitsPerSecond) throw new Error('unsupported option')
        super(stream, options)
      }
    }
    setupMediaRecorder(ThrowingCtor as unknown as typeof FakeMediaRecorder)

    await recordOnce()

    const calls = ThrowingCtor.constructorCalls
    expect(calls).toHaveLength(1)
    expect(calls[0].options.videoBitsPerSecond).toBeUndefined()
  })

  it('resolve { data, duration } quando o vídeo cabe no limite', async () => {
    fileReaderPayload = 'aGVsbG8gd29ybGQ='
    const out = await recordOnce()
    expect(out).toEqual({ data: 'aGVsbG8gd29ybGQ=', duration: expect.any(Number) })
  })

  it('resolve { error: "too-large" } quando o vídeo excede o limite do servidor', async () => {
    fileReaderPayload = 'A'.repeat(7_000_000)
    const out = await recordOnce()
    expect(out).toEqual({ error: 'too-large' })
  })
})
