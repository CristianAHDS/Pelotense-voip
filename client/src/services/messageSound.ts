let audioCtx: AudioContext | null = null
let currentSound: string = 'beep'
let currentVolume: number = 0.7
let soundMuted: boolean = false

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!audioCtx) audioCtx = new Ctor()
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {})
  return audioCtx
}

export function setSoundMuted(muted: boolean): void {
  soundMuted = muted
}

export function isSoundMuted(): boolean {
  return soundMuted
}

export function setNotificationSound(sound: string): void {
  currentSound = sound
}

export function getNotificationSound(): string {
  return currentSound
}

export function setNotificationVolume(volume: number): void {
  currentVolume = Math.max(0, Math.min(1, volume))
}

export function getNotificationVolume(): number {
  return currentVolume
}

function play(ctx: AudioContext, freqStart: number, freqEnd: number, dur: number, waveType: OscillatorType = 'sine'): void {
  const now = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = waveType
  osc.frequency.setValueAtTime(freqStart, now)
  osc.frequency.exponentialRampToValueAtTime(freqEnd, now + dur * 0.4)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(currentVolume * 0.3, now + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(now)
  osc.stop(now + dur)
}

export function playMessageSound(): void {
  if (soundMuted) return
  const ctx = getAudioContext()
  if (!ctx) return

  switch (currentSound) {
    case 'beep':
      play(ctx, 880, 1320, 0.3, 'sine')
      break
    case 'chime':
      play(ctx, 1047, 1568, 0.25, 'sine')
      setTimeout(() => play(ctx, 1319, 1760, 0.25, 'sine'), 120)
      break
    case 'bell':
      play(ctx, 660, 880, 0.4, 'triangle')
      break
    case 'pop':
      play(ctx, 600, 400, 0.15, 'square')
      break
    case 'click':
      play(ctx, 1200, 800, 0.08, 'sine')
      break
    case 'glass':
      play(ctx, 1760, 2200, 0.35, 'sine')
      setTimeout(() => play(ctx, 1400, 2000, 0.35, 'sine'), 150)
      break
    default:
      play(ctx, 880, 1320, 0.3, 'sine')
  }
}
