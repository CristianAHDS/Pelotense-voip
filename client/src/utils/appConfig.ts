import { isTauri } from './isTauri.ts'

export interface AppConfig {
  host?: string
  wsPort?: string
  wssPort?: string
}

// URL remota (com CORS habilitado) de onde o app busca o host atual. Edite o
// arquivo no site (ex: GitHub Gist raw ou um arquivo do repositório) e o app
// sempre pega o IP de lá. Pode ser sobrescrita via VITE_REMOTE_CONFIG_URL.
const REMOTE_CONFIG_URL = (import.meta.env.VITE_REMOTE_CONFIG_URL as string | undefined)
  || 'https://raw.githubusercontent.com/CristianAHDS/Pelotense-voip/main/config.json'

let cache: Promise<AppConfig> | null = null

// Lê um config.json opcional:
// - No desktop (Tauri): arquivo `config.json` ao lado do .exe (mais fácil de editar).
// - No navegador: arquivo `config.json` servido junto do app.
async function loadLocalConfig(): Promise<AppConfig> {
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
}

// Busca o host remoto (site) — ex.: GitHub Gist raw com {"host":"..."}.
async function fetchRemoteConfig(): Promise<AppConfig> {
  try {
    const res = await fetch(REMOTE_CONFIG_URL, { cache: 'no-store' })
    if (!res.ok) return {}
    const text = await res.text()
    const parsed = JSON.parse(text) as AppConfig
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch { /* offline ou site inacessível */ }
  return {}
}

export function loadAppConfig(): Promise<AppConfig> {
  if (!cache) {
    cache = (async () => {
      const local = await loadLocalConfig()
      const remote = await fetchRemoteConfig()
      // O remoto (site) tem prioridade: é a forma de apontar o IP sem editar localmente.
      return { ...local, ...remote }
    })()
  }
  return cache
}

// Monta a URL pública do viewer de live com base no config.json.
// Para túneis (Cloudflare/ngrok), o wssPort é 443 e o host é o domínio do
// túnel. Para acesso local direto, usa o hostname atual e porta 3003.
export async function getLiveViewerUrl(): Promise<string> {
  try {
    const config = await loadAppConfig()
    const wssPort = config.wssPort || '3003'
    const isTunnel = !!(config.host && (wssPort === '443' || wssPort === '80'))
    if (isTunnel) {
      const host = config.host!
      return `https://${host}/viewer?host=${host}&port=${wssPort}&room=Ao%20vivo`
    }
  } catch { /* fallback local */ }
  const host = window.location.hostname
  return `${window.location.protocol}//${host}/viewer?host=${host}&port=3003&room=Ao%20vivo`
}
