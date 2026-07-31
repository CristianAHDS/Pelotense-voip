export class Speaker {
  private context: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private pendingVolume = 0.8;

  // Próximo instante em que um buffer será reproduzido
  private nextPlayTime = 0;

  // Fontes agendadas, para poder pará-las num flush
  private activeSources = new Set<AudioBufferSourceNode>();

  // Teto de quanto áudio pode ficar agendado à frente; acima disso o buffer
  // é descartado para manter a reprodução quase em tempo real (jitter buffer).
  private static readonly MAX_LOOKAHEAD_SECONDS = 0.15;

  private ensureContext(): AudioContext | null {
    if (!this.context) {
      try {
        this.context = new AudioContext({ sampleRate: 48000 });
        this.nextPlayTime = this.context.currentTime;

        if (this.context.state === 'suspended') {
          void this.context.resume();
        }
      } catch {
        return null;
      }
    }

    // Após um flush o gainNode é descartado; recria-o ao tocar de novo.
    if (!this.gainNode) {
      try {
        this.gainNode = this.context.createGain();
        this.gainNode.gain.value = this.pendingVolume;
        this.gainNode.connect(this.context.destination);
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

    const now = ctx.currentTime;
    const duration = audioData.length / 48000;

    // Se o áudio atrasou (perda de pacotes/jitter), reinicia a fila para
    // não acumular latência.
    if (this.nextPlayTime < now) {
      this.nextPlayTime = now;
    }

    // Se já há muito áudio agendado à frente, descarta o excesso (mantém no
    // máximo ~150ms de buffer) para a reprodução ficar em tempo real.
    if (this.nextPlayTime - now > Speaker.MAX_LOOKAHEAD_SECONDS) {
      this.nextPlayTime = now;
    }

    const buffer = ctx.createBuffer(1, audioData.length, 48000);
    buffer.getChannelData(0).set(audioData);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gainNode);
    this.activeSources.add(source);
    source.onended = () => {
      this.activeSources.delete(source);
    };

    // Agenda a reprodução exatamente após o buffer anterior
    source.start(this.nextPlayTime);

    // Atualiza o próximo horário
    this.nextPlayTime += duration;
  }

  // Para imediatamente todo o áudio agendado/em reprodução (ao sair da sala,
  // desconectar ou trocar de cena). Silencia na hora via desconexão do nó de
  // ganho e para as fontes agendadas.
  flush(): void {
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        /* fonte já finalizada/não iniciada */
      }
    }
    this.activeSources.clear();
    this.nextPlayTime = 0;

    if (this.gainNode) {
      try {
        this.gainNode.disconnect();
      } catch {
        /* ignore */
      }
      this.gainNode = null;
    }
  }

  setVolume(value: number): void {
    this.pendingVolume = Math.max(0, Math.min(1, value));
    if (this.gainNode) {
      this.gainNode.gain.value = this.pendingVolume;
    }
  }

  destroy(): void {
    this.flush();
    if (this.context) {
      void this.context.close().catch(() => {});
      this.context = null;
      this.nextPlayTime = 0;
    }
  }
}
