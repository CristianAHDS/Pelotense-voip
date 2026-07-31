import { Microphone, Speaker, AudioCodec } from '../audio/index.ts';
import { useVoiceStore } from '../stores/voiceStore.ts';

const LEVEL_SMOOTHING = 0.3;

export class VoiceManager {
  private microphone: Microphone;
  private speaker: Speaker;
  private audioCodec: AudioCodec;
  private active: boolean = false;
  private onSendAudio: ((data: ArrayBuffer) => void) | null = null;
  private smoothLevel: number = 0;
  private smoothRxLevel: number = 0;

  constructor() {
    this.microphone = new Microphone();
    this.speaker = new Speaker();
    this.audioCodec = AudioCodec.create();
  }

  setOnSend(cb: (data: ArrayBuffer) => void): void {
    this.onSendAudio = cb;
  }

  async startMicrophone(): Promise<boolean> {
    if (this.active) {
      return true;
    }
    const ok = await this.microphone.start();
    if (!ok) return false;

    // Gesto de usuário: garante que o contexto de saída (speaker) esteja rodando
    // (política de autoplay do navegador).
    void this.speaker.resume();

    this.microphone.setOnData((data: Float32Array) => {
      if (useVoiceStore.getState().muted) {
        return;
      }

      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        sum += data[i] * data[i];
      }
      const rms = Math.sqrt(sum / data.length);
      const raw = Math.min(1, rms * 3);
      this.smoothLevel =
        this.smoothLevel + (raw - this.smoothLevel) * LEVEL_SMOOTHING;

      const store = useVoiceStore.getState();
      store.setLevel(this.smoothLevel);

      void this.audioCodec.encode(data).then((frame) => {
        this.onSendAudio?.(frame);
      });
    });

    this.active = true;
    return true;
  }

  stopMicrophone(): void {
    if (!this.active) return;
    this.microphone.stop();
    this.active = false;
    useVoiceStore.getState().setLevel(0);
    this.smoothLevel = 0;
  }

  playAudio(data: ArrayBuffer): void {
    void this.audioCodec
      .decode(data)
      .then((pcm) => {
        let sum = 0;
        for (let i = 0; i < pcm.length; i++) {
          const v = pcm[i];
          if (Number.isFinite(v)) sum += v * v;
        }
        const rms = Math.sqrt(sum / Math.max(1, pcm.length));
        const raw = Number.isFinite(rms) ? Math.min(1, rms * 3) : 0;
        this.smoothRxLevel =
          this.smoothRxLevel + (raw - this.smoothRxLevel) * LEVEL_SMOOTHING;
        useVoiceStore.getState().setRxLevel(this.smoothRxLevel);

        void this.speaker.resume();
        this.speaker.play(pcm);
      })
      .catch(() => { /* codec indisponível para este frame; pula */ });
  }

  setVolume(volume: number): void {
    this.speaker.setVolume(volume);
  }

  get activeMic(): boolean {
    return this.active;
  }

  get codecName(): string {
    return this.audioCodec.name;
  }

  destroy(): void {
    this.stopMicrophone();
    this.speaker.destroy();
    this.audioCodec.destroy();
  }
}
