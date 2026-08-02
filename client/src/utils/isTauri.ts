// Detecção de ambiente Tauri (app desktop). No Tauri a página é servida em
// `http://tauri.localhost`, então forçamos conexão WSS (o servidor remoto usa
// WSS na 443) em vez de WS.
export function isTauri(): boolean {
  return (
    typeof window !== 'undefined'
    && (
      '__TAURI__' in window
      || window.location.hostname === 'tauri.localhost'
      || window.location.protocol === 'tauri:'
    )
  )
}
