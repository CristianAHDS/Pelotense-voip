// Atualização automática do app desktop (Tauri). Em navegador não faz nada:
// só o exe tem o plugin de updater ativo.
import { checkUpdate, installUpdate } from '@tauri-apps/api/updater'
import { isTauri } from '../utils/isTauri.ts'
import { useUpdaterStore } from '../stores/updaterStore.ts'

export async function checkForUpdates(): Promise<void> {
  if (!isTauri()) return
  const s = useUpdaterStore.getState()
  if (s.status !== 'idle' && s.status !== 'error' && s.status !== 'done') return
  s.setChecking()
  try {
    const res = await checkUpdate()
    if (res?.shouldUpdate && res.manifest) {
      s.setAvailable(res.manifest.version)
    } else {
      s.setDone()
    }
  } catch (err) {
    console.error('[updater] check failed', err)
    s.setError(err instanceof Error ? err.message : String(err))
  }
}

export async function installAppUpdate(): Promise<void> {
  const s = useUpdaterStore.getState()
  s.setDownloading()
  try {
    await installUpdate()
    // Se voltou aqui, a instalação foi concluída (ou cancelada pelo usuário
    // na janela nativa). Não há mais nada a mostrar.
    s.setDone()
  } catch (err) {
    console.error('[updater] install failed', err)
    s.setError(err instanceof Error ? err.message : String(err))
  }
}
