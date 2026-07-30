import { Microphone, Speaker, Encoder, Decoder } from '../audio/index.ts'
import { useVoiceStore } from '../stores/voiceStore.ts'

export class VoiceManager {
  private microphone: Microphone
  private speaker: Speaker
  private encoder: Encoder
  private decoder: Decoder
  private active: boolean = false
  private sequence: number = 0

  constructor() {
    this.microphone = new Microphone()
    this.speaker = new Speaker()
    this.encoder = new Encoder()
    this.decoder = new Decoder()
  }

  async startMicrophone(): Promise<boolean> {
    const ok = await this.microphone.start()
    if (!ok) return false

    this.microphone.setOnData((data: Float32Array) => {
      if (useVoiceStore.getState().muted) return
      useVoiceStore.getState().setTalking(true)
      const encoded = this.encoder.encode(data)
      this.sendAudio(encoded)
      useVoiceStore.getState().setTalking(false)
    })

    this.active = true
    return true
  }

  stopMicrophone(): void {
    this.microphone.stop()
    this.active = false
  }

  playAudio(data: ArrayBuffer): void {
    const decoded = this.decoder.decode(data)
    this.speaker.play(decoded)
  }

  setVolume(volume: number): void {
    this.speaker.setVolume(volume)
  }

  private sendAudio(_data: ArrayBuffer): void {
    this.sequence++
  }

  destroy(): void {
    this.stopMicrophone()
    this.speaker.destroy()
  }
}
