export type AudioDataCallback = (data: Float32Array) => void

export interface MicrophoneInfo {
  deviceId: string
  label: string
}

export class Microphone {
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private node: AudioWorkletNode | null = null
  private context: AudioContext | null = null
  private onData: AudioDataCallback | null = null
  private deviceId: string | null = null

  setOnData(callback: AudioDataCallback): void {
    this.onData = callback
  }

  setDeviceId(deviceId: string | null): void {
    this.deviceId = deviceId
  }

  async listDevices(): Promise<MicrophoneInfo[]> {
    try {
      const md = navigator.mediaDevices
      if (!md?.enumerateDevices) return []
      const devices = await md.enumerateDevices()
      return devices
        .filter((d) => d.kind === 'audioinput')
        .map((d) => ({ deviceId: d.deviceId, label: d.label }))
    } catch {
      return []
    }
  }

  async start(): Promise<boolean> {
    try {
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 48000,
        channelCount: 1,
      }
      if (this.deviceId) {
        audioConstraints.deviceId = { exact: this.deviceId }
      }
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
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
