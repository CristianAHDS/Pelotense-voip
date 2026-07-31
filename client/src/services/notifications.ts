import { playMessageSound } from './messageSound.ts'

export function requestNotificationPermission(): void {
  if (typeof Notification === 'undefined') return
  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {})
  }
}

export function notifyNewMessage(title: string, body: string): void {
  const isVisible = typeof document !== 'undefined' && !document.hidden
  const hasFocus = typeof document !== 'undefined' && document.hasFocus()
  if (isVisible && hasFocus) return
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      const n = new Notification(title, { body, tag: 'new-message', silent: true })
      n.onclick = () => {
        window.focus()
        n.close()
      }
    } catch { /* permissão negada ou indisponível */ }
  }
  playMessageSound()
}
