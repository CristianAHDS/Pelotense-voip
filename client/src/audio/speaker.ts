export class Speaker {
  private context: AudioContext | null = null
  private gainNode: GainNode | null = null

  constructor() {
    this.context = new AudioContext()
    this.gainNode = this.context.createGain()
    this.gainNode.connect(this.context.destination)
  }

  play(audioData: Float32Array): void {
    if (!this.context || !this.gainNode) return

    const buffer = this.context.createBuffer(1, audioData.length, 48000)
    buffer.getChannelData(0).set(audioData)

    const source = this.context.createBufferSource()
    source.buffer = buffer
    source.connect(this.gainNode)
    source.start()
  }

  setVolume(value: number): void {
    if (this.gainNode) {
      this.gainNode.gain.value = Math.max(0, Math.min(1, value))
    }
  }

  destroy(): void {
    if (this.context) {
      this.context.close()
      this.context = null
    }
  }
}
