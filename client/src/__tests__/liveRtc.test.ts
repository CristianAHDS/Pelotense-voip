import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as liveRtc from '../services/liveRtc.ts'

// Mock do RTCPeerConnection para registrar addIceCandidate/setRemoteDescription.
class FakePC {
  static instances: FakePC[] = []
  connectionState = 'new'
  remoteDescription: { type: string } | null = null
  addedCandidates: unknown[] = []
  setRemoteCalls: unknown[] = []
  setLocalDescription = vi.fn()
  createAnswer = vi.fn()
  onicecandidate: ((e: { candidate: unknown }) => void) | null = null
  ontrack: ((e: unknown) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  addTrack = vi.fn()
  getSenders = () => []
  close = vi.fn()

  constructor() {
    FakePC.instances.push(this)
  }

  createOffer(): Promise<{ type: string; sdp: string }> {
    return Promise.resolve({ type: 'offer', sdp: 'SDP' })
  }

  setRemoteDescription(sdp: { type: string }): Promise<void> {
    this.setRemoteCalls.push(sdp)
    return new Promise((resolve) => {
      // Diferido para simular o comportamento assíncrono real do navegador.
      setTimeout(() => {
        this.remoteDescription = sdp
        resolve()
      }, 5)
    })
  }

  addIceCandidate(candidate: unknown): Promise<void> {
    if (this.remoteDescription) {
      this.addedCandidates.push(candidate)
      return Promise.resolve()
    }
    return Promise.reject(new Error('no remote description'))
  }
}

function sentSignals(): Array<{ sdp?: unknown; candidate?: unknown }> {
  return (liveRtc as unknown as { __signals: unknown[] }).__signals as unknown as Array<{ sdp?: unknown; candidate?: unknown }>
}

beforeEach(() => {
  FakePC.instances = []
  ;(globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = FakePC
  ;(globalThis as unknown as { MediaStream: unknown }).MediaStream = class {
    getTracks() { return [] }
  }
})

describe('liveRtc', () => {
  it('reconcileViewers adiciona espectadores que já estão na sala (sem conexão ainda)', () => {
    const stream = { getTracks: () => [] } as unknown as MediaStream
    liveRtc.startBroadcast(stream, ['v1'])

    // Chega uma UserList mais completa depois do início da live (comum no mobile).
    liveRtc.reconcileViewers(['v1', 'v2'])

    // Deve ter criado conexão para v1 e v2.
    const pcs = FakePC.instances
    expect(pcs.length).toBe(2)

    // Remove quem saiu da sala.
    liveRtc.reconcileViewers(['v2'])
    liveRtc.stopBroadcast()
  })

  it('removeViewer fecha a conexão de quem saiu da sala', () => {
    const stream = { getTracks: () => [] } as unknown as MediaStream
    liveRtc.startBroadcast(stream, ['v1', 'v2'])
    expect(FakePC.instances.length).toBe(2)

    liveRtc.reconcileViewers(['v1'])
    expect(FakePC.instances.length).toBe(2)
    liveRtc.stopBroadcast()
  })

  it('stopBroadcast limpa o modo transmissor', () => {
    const stream = { getTracks: () => [] } as unknown as MediaStream
    liveRtc.startBroadcast(stream, ['v1'])
    expect(liveRtc.isBroadcasting()).toBe(true)
    liveRtc.stopBroadcast()
    expect(liveRtc.isBroadcasting()).toBe(false)
  })
})
