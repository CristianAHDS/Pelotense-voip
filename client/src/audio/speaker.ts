export class Speaker {
  private context: AudioContext | null = null
  private gainNode: GainNode | null = null

  private ensureContext(): AudioContext | null {
    if (!this.context) {
      try {
        this.context = new AudioContext()
        this.gainNode = this.context.createGain()
        this.gainNode.connect(this.context.destination)
      } catch {
        return null
      }
    }
    return this.context
  }

  play(audioData: Float32Array): void {
    const ctx = this.ensureContext()
    if (!ctx || !this.gainNode) return

    const buffer = ctx.createBuffer(1, audioData.length, 48000)
    buffer.getChannelData(0).set(audioData)

    const source = ctx.createBufferSource()
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
      this.gainNode = null
    }
  }
}
