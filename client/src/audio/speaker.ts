export class Speaker {
  private context: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private pendingVolume = 0.8;

  // Relógio de reprodução por falante: cada usuário tem a própria fila
  // contínua. Quando dois falantes reproduzem ao mesmo tempo, o Web Audio
  // SOMA os sinais no nó de ganho (mix real). Antes, todos compartilhavam um
  // único relógio e os quadros intercalados se revezavam em fatias de ~3ms,
  // gerando o chiado com mais de um falante na sala.
  private nextPlayTimeByUser = new Map<string, number>();

  // Fontes agendadas, para poder pará-las num flush
  private activeSources = new Set<AudioBufferSourceNode>();

  // Teto de quanto áudio pode ficar agendado à frente por falante; acima disso
  // o excesso é descartado para manter a reprodução quase em tempo real
  // (jitter buffer). O corte afeta apenas o falante atrasado, não os demais.
  private static readonly MAX_LOOKAHEAD_SECONDS = 0.15;

  private ensureContext(): AudioContext | null {
    if (!this.context) {
      try {
        this.context = new AudioContext({ sampleRate: 48000 });
        this.nextPlayTimeByUser.clear();

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

        // Compressor no caminho master: quando vários falantes são somados no
        // mesmo instante, evita que o pico estoure (clipping/distorção).
        this.compressor = this.context.createDynamicsCompressor();
        this.compressor.connect(this.context.destination);
        this.gainNode.connect(this.compressor);
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

  play(userId: string, audioData: Float32Array): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.gainNode) return;

    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    if (audioData.length === 0) return;

    const now = ctx.currentTime;
    const duration = audioData.length / 48000;

    // Cada falante tem o próprio relógio: o próximo quadro de um usuário toca
    // logo após o anterior dele (fluxo contínuo), independente dos demais.
    let nextPlayTime = this.nextPlayTimeByUser.get(userId) ?? now;

    // Se o áudio desse usuário atrasou (perda de pacotes/jitter), reinicia a
    // fila dele para não acumular latência.
    if (nextPlayTime < now) {
      nextPlayTime = now;
    }

    // Excesso de áudio agendado à frente: descarta e ressincroniza (mantém no
    // máximo ~150ms de buffer), mas apenas para este falante.
    if (nextPlayTime - now > Speaker.MAX_LOOKAHEAD_SECONDS) {
      nextPlayTime = now;
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

    // Agenda a reprodução exatamente após o buffer anterior deste usuário.
    // Fontes de usuários diferentes tocam sobrepostas e são somadas pelo
    // nó de ganho (mix) em vez de se revezarem.
    source.start(nextPlayTime);

    // Atualiza o próximo horário deste usuário
    this.nextPlayTimeByUser.set(userId, nextPlayTime + duration);
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
    this.nextPlayTimeByUser.clear();

    if (this.gainNode) {
      try {
        this.gainNode.disconnect();
      } catch {
        /* ignore */
      }
      this.gainNode = null;
    }
    if (this.compressor) {
      try {
        this.compressor.disconnect();
      } catch {
        /* ignore */
      }
      this.compressor = null;
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
    }
  }
}
