import { test, expect, type Page, type Browser } from '@playwright/test'

const BASE = 'http://127.0.0.1:3000'

async function registerAndJoin(page: Page, name: string, email: string): Promise<void> {
  await page.goto(BASE)

  // Aponta o cliente para o servidor local do e2e.
  await page.click('.server-config summary')
  await page.fill('#cp-host', '127.0.0.1')
  await page.fill('#cp-port', '3001')

  // Cria a conta (aba "Criar conta" + botão de submit `.btn-connect`).
  await page.click('role=tab[name="Criar conta"]')
  await page.fill('#cp-reg-name', name)
  await page.fill('#cp-reg-email', email)
  await page.fill('#cp-reg-password', 'pass123')
  await page.fill('#cp-reg-confirm', 'pass123')
  await page.click('.btn-connect')

  // Aguarda conectar.
  await page.waitForSelector('.status-pill--connected', { timeout: 25000 })

  // Entra na sala "Ao vivo" (nome começa com "Ao vivo"; exclui "Retorno ao vivo").
  const liveRoom = page.locator('.main-content .room-item').filter({ hasText: /^Ao vivo/ }).first()
  await liveRoom.dblclick()
  await page.waitForSelector('.chat-header-name:has-text("#Ao vivo")', { timeout: 25000 })
}

test('live WebRTC: espectador enxerga vídeo (não preto)', async ({ browser }) => {
  const ts = Date.now()
  const bcName = `Bc${ts}`
  const vwName = `Vw${ts}`

  // ---------- Transmissor ----------
  const bcCtx = await browser.newContext({ permissions: ['camera', 'microphone'] })
  const bc = await bcCtx.newPage()
  const bcLogs: string[] = []
  bc.on('console', (m) => bcLogs.push(`[${m.type()}] ${m.text()}`))
  await registerAndJoin(bc, bcName, `${bcName}@test.com`)

  await bc.click('.chat-live-btn')
  await bc.waitForSelector('.chat-live-btn.active', { timeout: 25000 })
  await bc.waitForTimeout(4000)

  // ---------- Espectador (entra DEPOIS que a live começou) ----------
  const vwCtx = await browser.newContext({ permissions: ['camera', 'microphone'] })
  const vw = await vwCtx.newPage()
  const vwLogs: string[] = []
  vw.on('console', (m) => vwLogs.push(`[${m.type()}] ${m.text()}`))
  await registerAndJoin(vw, vwName, `${vwName}@test.com`)

  await vw.waitForSelector('.live-viewer-video', { timeout: 25000 })
  await vw.waitForTimeout(8000) // tempo para o WebRTC conectar e decodificar

  // Artefatos visuais para inspeção.
  await bc.screenshot({ path: 'e2e/artifacts/broadcaster.png' })
  await vw.screenshot({ path: 'e2e/artifacts/viewer.png' })
  await vw.locator('.live-viewer-video').screenshot({ path: 'e2e/artifacts/viewer-video.png' })

  // Amostra os pixels do <video> para detectar se está preto.
  const state = await vw.evaluate(() => {
    const v = document.querySelector('.live-viewer-video') as HTMLVideoElement
    if (!v) return { found: false }
    let black = true
    if (v.videoWidth > 0) {
      const c = document.createElement('canvas')
      c.width = v.videoWidth
      c.height = v.videoHeight
      const ctx = c.getContext('2d')
      if (ctx) {
        ctx.drawImage(v, 0, 0)
        const data = ctx.getImageData(0, 0, c.width, c.height).data
        let sum = 0
        let n = 0
        for (let i = 0; i < data.length; i += 100) {
          sum += (data[i] + data[i + 1] + data[i + 2]) / 3
          n++
        }
        black = sum / n < 8
      }
    }
    return {
      found: true,
      videoWidth: v.videoWidth,
      videoHeight: v.videoHeight,
      currentTime: v.currentTime,
      readyState: v.readyState,
      paused: v.paused,
      hasSrcObject: !!v.srcObject,
      black,
    }
  })

  // Log para inspeção manual (e visualização dos screenshots).
  console.log('\n[LIVE E2E] estado do vídeo no espectador:', JSON.stringify(state, null, 2))
  console.log('\n[BROADCASTER LOGS]\n' + bcLogs.filter((l) => l.includes('LIVE-RTC')).join('\n'))
  console.log('\n[VIEWER LOGS]\n' + vwLogs.filter((l) => l.includes('LIVE-RTC')).join('\n'))

  expect(state.found).toBe(true)
  expect(state.videoWidth).toBeGreaterThan(0)
  expect(state.paused).toBe(false)
  expect(state.black).toBe(false)

  await bcCtx.close()
  await vwCtx.close()
})
