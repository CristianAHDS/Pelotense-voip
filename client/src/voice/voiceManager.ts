import { Microphone, Speaker, Encoder, Decoder } from '../audio/index.ts'
import { useVoiceStore } from '../stores/voiceStore.ts'

const LEVEL_SMOOTHING = 0.3

export class VoiceManager {
  private microphone: Microphone
  private speaker: Speaker
  private encoder: Encoder
  private decoder: Decoder
  private active: boolean = false
  private onSendAudio: ((data: ArrayBuffer) => void) | null = null
  private smoothLevel: number = 0

  constructor() {
    this.microphone = new Microphone()
    this.speaker = new Speaker()
    this.encoder = new Encoder()
    this.decoder = new Decoder()
  }

  setOnSend(cb: (data: ArrayBuffer) => void): void {
    this.onSendAudio = cb
  }

  async startMicrophone(): Promise<boolean> {
    if (this.active) { console.log('[VM] already active'); return true }
    console.log('[VM] startMicrophone')
    const ok = await this.microphone.start()
    console.log('[VM] mic.start() returned', ok)
    if (!ok) return false

    this.microphone.setOnData((data: Float32Array) => {
      if (useVoiceStore.getState().muted) { console.log('[VM] muted, skipping'); return }

      let sum = 0
      for (let i = 0; i < data.length; i++) {
        sum += data[i] * data[i]
      }
      const rms = Math.sqrt(sum / data.length)
      const raw = Math.min(1, rms * 3)
      this.smoothLevel = this.smoothLevel + (raw - this.smoothLevel) * LEVEL_SMOOTHING

      const store = useVoiceStore.getState()
      store.setLevel(this.smoothLevel)

      const encoded = this.encoder.encode(data)
      this.onSendAudio?.(encoded)
    })

    this.active = true
    return true
  }

  stopMicrophone(): void {
    if (!this.active) return
    this.microphone.stop()
    this.active = false
    useVoiceStore.getState().setLevel(0)
    this.smoothLevel = 0
  }

  playAudio(data: ArrayBuffer): void {
    const decoded = this.decoder.decode(data)
    this.speaker.play(decoded)
  }

  setVolume(volume: number): void {
    this.speaker.setVolume(volume)
  }

  get activeMic(): boolean { return this.active }

  destroy(): void {
    this.stopMicrophone()
    this.speaker.destroy()
  }
}
