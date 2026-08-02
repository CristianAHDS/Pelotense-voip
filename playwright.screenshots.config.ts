import { defineConfig } from '@playwright/test'

// Config dedicada para capturar screenshots usando o servidor já em execução.
export default defineConfig({
  testDir: './e2e',
  timeout: 120000,
  workers: 1,
  outputDir: 'e2e/artifacts',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
      ],
    },
  },
})
