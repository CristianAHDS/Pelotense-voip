export class Speaker {
  private context: AudioContext | null = null;
  private gainNode: GainNode | null = null;

  // Próximo instante em que um buffer será reproduzido
  private nextPlayTime = 0;

  private ensureContext(): AudioContext | null {
    if (!this.context) {
      try {
        this.context = new AudioContext({ sampleRate: 48000 });

        this.gainNode = this.context.createGain();
        this.gainNode.connect(this.context.destination);

        this.nextPlayTime = this.context.currentTime;
      } catch {
        return null;
      }
    }

    return this.context;
  }

  play(audioData: Float32Array): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.gainNode) return;

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
    if (this.gainNode) {
      this.gainNode.gain.value = Math.max(0, Math.min(1, value));
    }
  }

  destroy(): void {
    if (this.context) {
      this.context.close();
      this.context = null;
      this.gainNode = null;
      this.nextPlayTime = 0;
    }
  }
}
