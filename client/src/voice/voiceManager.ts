import { Microphone, Speaker, AudioCodec } from '../audio/index.ts';
import type { MicrophoneInfo } from '../audio/index.ts';
import { useVoiceStore } from '../stores/voiceStore.ts';

const LEVEL_SMOOTHING = 0.3;

export class VoiceManager {
  private microphone: Microphone;
  private speaker: Speaker;
  private audioCodec: AudioCodec;
  private active: boolean = false;
  private destroyed: boolean = false;
  private onSendAudio: ((data: ArrayBuffer) => void) | null = null;
  private smoothLevel: number = 0;
  private smoothRxLevel: number = 0;
  private micDeviceId: string | null = null;
  private startPromise: Promise<boolean> | null = null;
  // Flag de backpressure do encode (evita rajadas de frames).
  private encoding = false;

  constructor() {
    this.microphone = new Microphone();
    this.speaker = new Speaker();
    this.audioCodec = AudioCodec.create();
  }

  setOnSend(cb: (data: ArrayBuffer) => void): void {
    this.onSendAudio = cb;
  }

  async listMicrophones(): Promise<MicrophoneInfo[]> {
    return this.microphone.listDevices();
  }

  async setMicrophone(deviceId: string | null): Promise<boolean> {
    if (this.micDeviceId === deviceId) return true;
    this.micDeviceId = deviceId;
    this.microphone.setDeviceId(deviceId);
    if (this.active) {
      this.stopMicrophone();
      return this.startMicrophone();
    }
    return true;
  }

  async setNoiseSuppression(enabled: boolean): Promise<void> {
    const changed = await this.microphone.setNoiseSuppression(enabled);
    if (!changed && this.active) {
      this.stopMicrophone();
      await this.startMicrophone();
    }
  }

  async startMicrophone(): Promise<boolean> {
    if (this.active) {
      return true;
    }
    // Serializa chamadas concorrentes: se já há um start em andamento (ex:
    // login + entrar na sala na sequência), reutiliza a mesma promise em vez de
    // abrir uma segunda stream de áudio. Duas streams simultâneas causam áudio
    // duplicado/faseado (chiado) — problema comum com interfaces de áudio.
    if (this.startPromise) {
      return this.startPromise;
    }
    this.startPromise = this.doStartMicrophone().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async doStartMicrophone(): Promise<boolean> {
    const ok = await this.microphone.start();
    if (!ok) return false;

    // Gesto de usuário: garante que o contexto de saída (speaker) esteja rodando
    // (política de autoplay do navegador).
    void this.speaker.resume();

    this.microphone.setOnData((data: Float32Array) => {
      if (this.destroyed) return;
      const { muted } = useVoiceStore.getState()

      if (muted) {
        return;
      }

      // Backpressure: se o encode anterior ainda não terminou, descarta este
      // chunk em vez de empilhar frames que sairiam em rajada (causa de áudio
      // "rasgado/embolado" no receptor).
      if (this.encoding) {
        return;
      }
      this.encoding = true;

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
        this.encoding = false;
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

  // Deve ser chamado dentro de um gesto de usuário (ex: clique em Join/Unmute):
  // cria/retoma o AudioContext de saída mesmo com o microfone mutado, senão o
  // navegador (especialmente mobile) mantém o contexto suspenso e não há som.
  resumeOutput(): void {
    void this.speaker.resume();
  }

  // Para imediatamente todo o áudio de saída pendente (ao sair da sala ou
  // desconectar), evitando que o buffer agendado continue tocando.
  flushAudio(): void {
    this.speaker.flush();
    this.smoothRxLevel = 0;
    useVoiceStore.getState().setRxLevel(0);
  }

  playAudio(data: ArrayBuffer, userId: string = ''): void {
    void this.audioCodec
      .decode(data)
      .then((pcm) => {
        if (this.destroyed) return;
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
        this.speaker.play(userId, pcm);
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
    this.destroyed = true;
    this.stopMicrophone();
    this.speaker.destroy();
    this.audioCodec.destroy();
  }
}
