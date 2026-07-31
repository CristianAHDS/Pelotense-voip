export const MASTER_USER_ID = 'fc2su3qi'

export const USER_TAGS = ['Repórter', 'TI', 'Vídeo', 'Áudio', 'Produção', 'Locução']

const TAG_COLORS = ['#3b82f6', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0d9488', '#ea580c', '#db2777', '#0891b2', '#65a30d']

export function tagColor(tag: string): string {
  let hash = 0
  for (let i = 0; i < tag.length; i++) {
    hash = ((hash << 5) - hash) + tag.charCodeAt(i)
    hash |= 0
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length]
}

