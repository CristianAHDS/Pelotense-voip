import type { TranslateFn } from '../i18n/index.ts'

export const MASTER_USER_ID = (import.meta.env.VITE_MASTER_USER_ID as string | undefined) || 'fc2su3qi'
export const MASTER_NAME = (import.meta.env.VITE_MASTER_NAME as string | undefined) || 'Cris'
export const MASTER_EMAIL = (import.meta.env.VITE_MASTER_EMAIL as string | undefined) || 'admin@ahoradosul.com.br'

// Sempre master: pelo id configurado OU pelo nome OU pelo e-mail.
export function isMasterUser(u: { id?: string; name?: string; email?: string }): boolean {
  return u.id === MASTER_USER_ID
    || u.name === MASTER_NAME
    || (!!u.email && u.email.toLowerCase() === MASTER_EMAIL.toLowerCase())
}

export const USER_TAGS = ['Repórter', 'TI', 'Vídeo', 'Áudio', 'Produção', 'Locução']

const TAG_KEYS: Record<string, string> = {
  'Repórter': 'tagReporter',
  'TI': 'tagTI',
  'Vídeo': 'tagVideo',
  'Áudio': 'tagAudio',
  'Produção': 'tagProduction',
  'Locução': 'tagLocution',
}

export function tagLabel(tag: string, t: TranslateFn): string {
  const key = TAG_KEYS[tag]
  return key ? t(key) : tag
}

const TAG_COLORS = ['#3b82f6', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0d9488', '#ea580c', '#db2777', '#0891b2', '#65a30d']

export function tagColor(tag: string): string {
  let hash = 0
  for (let i = 0; i < tag.length; i++) {
    hash = ((hash << 5) - hash) + tag.charCodeAt(i)
    hash |= 0
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length]
}

