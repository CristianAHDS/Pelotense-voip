export const MAX_CHUNKS = 200
export const REVOKE_DELAY = 3000

export const MSE_MIMES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
]

export function chunkToBuffer(chunk: string): Uint8Array {
  try {
    const binary = atob(chunk)
    return Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
  } catch {
    return new Uint8Array()
  }
}

export function isMseSupported(
  mediaSourceCtor: unknown = typeof MediaSource !== 'undefined' ? MediaSource : undefined,
  mimes: string[] = MSE_MIMES,
): string | null {
  if (typeof mediaSourceCtor === 'undefined' || mediaSourceCtor === null) return null
  const ctor = mediaSourceCtor as {
    isTypeSupported?: (mime: string) => boolean
  }
  if (typeof ctor.isTypeSupported !== 'function') return null
  for (const mime of mimes) {
    try {
      if (ctor.isTypeSupported(mime)) return mime
    } catch { /* next */ }
  }
  return null
}
