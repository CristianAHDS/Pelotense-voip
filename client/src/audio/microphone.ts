export type AudioDataCallback = (data: Float32Array) => void

export class Microphone {
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null
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
      this.source = this.context.createMediaStreamSource(this.stream)
      this.processor = this.context.createScriptProcessor(960, 1, 1)

      this.processor.onaudioprocess = (event) => {
        if (!this.onData) return
        const input = event.inputBuffer.getChannelData(0)
        this.onData(input)
      }

      this.source.connect(this.processor)
      return true
    } catch (e) {
      console.error('Microphone start failed:', (e as Error)?.message ?? e)
      return false
    }
  }

  stop(): void {
    if (this.processor) {
      this.processor.disconnect()
      this.processor = null
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
