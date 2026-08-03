import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Versão do front embutida no bundle. Lê primeiro do version.json da raiz do
// projeto e, se não houver, usa o que o script de bump copia para
// client/public/version.json (funciona tanto no repo quanto em builds copiados).
function readAppVersion(): string {
  const candidates = [
    resolve(__dirname, '..', 'version.json'),
    resolve(__dirname, 'public', 'version.json'),
  ]
  for (const file of candidates) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8'))
      return `${raw.version ?? '1.0.0'} (build ${Number.isFinite(raw.build) ? raw.build : 0})`
    } catch { /* tenta o próximo */ }
  }
  return '1.0.0 (build 0)'
}

export default defineConfig({
  plugins: [basicSsl(), react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    https: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  define: {
    __APP_VERSION__: JSON.stringify(readAppVersion()),
  },
  build: {
    target: ['es2021', 'chrome100', 'safari13'],
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
})
