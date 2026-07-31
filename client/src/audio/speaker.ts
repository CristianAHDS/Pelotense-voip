export class Speaker {
  private context: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private pendingVolume = 0.8;

  // Próximo instante em que um buffer será reproduzido
  private nextPlayTime = 0;

  private ensureContext(): AudioContext | null {
    if (!this.context) {
      try {
        this.context = new AudioContext({ sampleRate: 48000 });

        this.gainNode = this.context.createGain();
        this.gainNode.gain.value = this.pendingVolume;
        this.gainNode.connect(this.context.destination);

        this.nextPlayTime = this.context.currentTime;

        if (this.context.state === 'suspended') {
          void this.context.resume();
        }
      } catch {
        return null;
      }
    }

    return this.context;
  }

  async resume(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx && ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        /* autoplay policy may block; try again on next gesture */
      }
    }
  }

  play(audioData: Float32Array): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.gainNode) return;

    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    if (audioData.length === 0) return;

    const buffer = ctx.createBuffer(1, audioData.length, 48000);
    buffer.getChannelData(0).set(audioData);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gainNode);

    // Duração do buffer em segundos
    const duration = audioData.length / 48000;

    // Se o áudio atrasou, reinicia a fila para evitar acúmulo
    if (this.nextPlayTime < ctx.currentTime) {
      this.nextPlayTime = ctx.currentTime;
    }

    // Agenda a reprodução exatamente após o buffer anterior
    source.start(this.nextPlayTime);

    // Atualiza o próximo horário
    this.nextPlayTime += duration;
  }

  setVolume(value: number): void {
    this.pendingVolume = Math.max(0, Math.min(1, value));
    if (this.gainNode) {
      this.gainNode.gain.value = this.pendingVolume;
    }
  }

  destroy(): void {
    if (this.context) {
      void this.context.close().catch(() => {});
      this.context = null;
      this.gainNode = null;
      this.nextPlayTime = 0;
    }
  }
}
