const COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#14b8a6', '#f97316', '#06b6d4', '#ec4899', '#84cc16',
]

export function userColor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i)
    hash |= 0
  }
  return COLORS[Math.abs(hash) % COLORS.length]
}

export function initials(name: string, max = 2): string {
  const clean = name.trim()
  if (!clean) return '?'
  const words = clean.split(/\s+/)
  if (words.length === 1) return words[0].slice(0, max).toUpperCase()
  return words
    .slice(0, max)
    .map((w) => w.charAt(0).toUpperCase())
    .join('')
}
