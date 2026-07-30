export type AudioDataCallback = (data: Float32Array) => void

export class Microphone {
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private node: AudioWorkletNode | null = null
  private context: AudioContext | null = null
  private onData: AudioDataCallback | null = null

  setOnData(callback: AudioDataCallback): void {
    this.onData = callback
  }

  async start(): Promise<boolean> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 48000,
          channelCount: 1,
        },
      })

      this.context = new AudioContext({ sampleRate: 48000 })
      await this.context.audioWorklet.addModule('/audio-processor.js')

      this.source = this.context.createMediaStreamSource(this.stream)
      this.node = new AudioWorkletNode(this.context, 'audio-processor')

      this.node.port.onmessage = (event) => {
        if (!this.onData) return
        this.onData(event.data)
      }

      this.source.connect(this.node)
      return true
    } catch (e) {
      console.error('Microphone start failed:', (e as Error)?.message ?? e)
      return false
    }
  }

  stop(): void {
    if (this.node) {
      this.node.disconnect()
      this.node = null
    }
    if (this.source) {
      this.source.disconnect()
      this.source = null
    }
    if (this.context) {
      this.context.close()
      this.context = null
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop())
      this.stream = null
    }
  }
}
