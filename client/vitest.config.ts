import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function readAppVersion(): string {
  try {
    const raw = JSON.parse(readFileSync(resolve(__dirname, '..', 'version.json'), 'utf8'))
    return `${raw.version ?? '1.0.0'} (build ${Number.isFinite(raw.build) ? raw.build : 0})`
  } catch {
    return '1.0.0 (build 0)'
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(readAppVersion()),
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    css: false,
  },
})
