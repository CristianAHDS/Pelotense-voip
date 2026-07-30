import { Microphone, Speaker, Encoder, Decoder } from '../audio/index.ts'
import { useVoiceStore } from '../stores/voiceStore.ts'

export class VoiceManager {
  private microphone: Microphone
  private speaker: Speaker
  private encoder: Encoder
  private decoder: Decoder
  private active: boolean = false
  private onSendAudio: ((data: ArrayBuffer) => void) | null = null

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
    const ok = await this.microphone.start()
    if (!ok) return false

    this.microphone.setOnData((data: Float32Array) => {
      if (useVoiceStore.getState().muted) return
      useVoiceStore.getState().setTalking(true)
      const encoded = this.encoder.encode(data)
      this.onSendAudio?.(encoded)
      useVoiceStore.getState().setTalking(false)
    })

    this.active = true
    return true
  }

  stopMicrophone(): void {
    this.microphone.stop()
    this.active = false
    useVoiceStore.getState().setTalking(false)
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
