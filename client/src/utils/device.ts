// Identificador único do aparelho (persistido no navegador). É enviado no
// login e salvo no servidor para controlar o onboarding por dispositivo.
const DEVICE_KEY = 'voip_device_id'

// Detecção de mobile para comportamentos específicos (ex: manter a câmera
// quente entre lives apenas no iOS, onde re-adquirir o getUserMedia logo após
// parar é instável; no desktop o preview deve fechar normalmente).
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(navigator.userAgent || '')
}

export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY)
    if (existing) return existing
  } catch { /* ignore */ }
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 10)
  try {
    localStorage.setItem(DEVICE_KEY, id)
  } catch { /* ignore */ }
  return id
}
