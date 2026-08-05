import { playMessageSound } from './messageSound.ts'

export function requestNotificationPermission(): void {
  if (typeof Notification === 'undefined') return
  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {})
  }
}

export function notifyNewMessage(title: string, body: string, onClick?: () => void): void {
  const isVisible = typeof document !== 'undefined' && !document.hidden
  const hasFocus = typeof document !== 'undefined' && document.hasFocus()
  if (isVisible && hasFocus) return
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      const n = new Notification(title, { body, tag: 'new-message', silent: true })
      n.onclick = () => {
        window.focus()
        n.close()
        onClick?.()
      }
    } catch { /* permissão negada ou indisponível */ }
  }
  if (!isVisible || !hasFocus) {
    playMessageSound()
  }
}

export function notifyMention(userName: string, roomName: string, body: string): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    const n = new Notification(`@${userName} em #${roomName}`, {
      body,
      tag: 'mention',
      silent: true,
    })
    n.onclick = () => { window.focus(); n.close() }
  } catch { /* ignore */ }
}
