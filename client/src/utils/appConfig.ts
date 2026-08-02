import { isTauri } from './isTauri.ts'

export interface AppConfig {
  host?: string
  wsPort?: string
  wssPort?: string
}

let cache: Promise<AppConfig> | null = null

// Lê um config.json opcional:
// - No desktop (Tauri): arquivo `config.json` ao lado do .exe (mais fácil de editar).
// - No navegador: arquivo `config.json` servido junto do app.
export function loadAppConfig(): Promise<AppConfig> {
  if (!cache) {
    cache = (async () => {
      try {
        if (isTauri()) {
          const [{ readTextFile }, { executableDir, resolve }] = await Promise.all([
            import('@tauri-apps/api/fs'),
            import('@tauri-apps/api/path'),
          ])
          const dir = await executableDir()
          const p = await resolve(dir, 'config.json')
          const text = await readTextFile(p)
          return JSON.parse(text) as AppConfig
        }
        const res = await fetch('config.json', { cache: 'no-store' })
        if (res.ok) return (await res.json()) as AppConfig
      } catch { /* arquivo ausente ou inválido — usa padrões */ }
      return {}
    })()
  }
  return cache
}
