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
      // Local (servidor) tem prioridade sobre remoto (GitHub) porque o servidor
      // atualiza config.json com o host do túnel a cada reinício.
      return { ...remote, ...local }
    })()
  }
  return cache
}

// Força recarregar a config (ignora cache). Usado pelo link de live para
// garantir que o host do túnel está atualizado.
async function loadFreshConfig(): Promise<AppConfig> {
  const local = await loadLocalConfig()
  const remote = await fetchRemoteConfig()
  return { ...remote, ...local }
}

function isTunnelHost(host: string): boolean {
  return host.includes('trycloudflare.com')
    || host.includes('ngrok')
    || host.includes('lhr.life')
    || host.includes('fly.dev')
}

// Monta a URL pública do viewer de live.
// Se o app está sendo acessado via túnel, usa o mesmo host (acessível de qualquer lugar).
// Senão, tenta pegar o host do túnel do config.json (atualizado pelo servidor).
// Fallback: host local (acessível apenas na mesma rede).
export async function getLiveViewerUrl(broadcasterId?: string, room?: string): Promise<string> {
  const roomParam = encodeURIComponent(room || 'Ao vivo')
  const broadcasterParam = broadcasterId ? `&broadcaster=${encodeURIComponent(broadcasterId)}` : ''

  // host com porta (ex: 192.168.8.94:3000) — necessário para o viewer carregar a página.
  const pageHost = window.location.host
  const pageProtocol = window.location.protocol
  const hostname = window.location.hostname

  // Se já está acessando via túnel público, usa a mesma URL base.
  if (isTunnelHost(hostname)) {
    return `${pageProtocol}//${pageHost}/viewer?host=${hostname}&port=443&room=${roomParam}${broadcasterParam}`
  }

  // Tenta descobrir o túnel público via config.json (servidor atualiza ao iniciar).
  try {
    const config = await loadFreshConfig()
    if (config.host && isTunnelHost(config.host)) {
      return `https://${config.host}/viewer?host=${config.host}&port=443&room=${roomParam}${broadcasterParam}`
    }
  } catch { /* fallback local */ }

  // Nenhum túnel público disponível — link local (rede local apenas).
  const localPort = window.location.port || (pageProtocol === 'https:' ? '3443' : '3000')
  return `${pageProtocol}//${hostname}:${localPort}/viewer?host=${hostname}&port=3003&room=${roomParam}${broadcasterParam}`
}
