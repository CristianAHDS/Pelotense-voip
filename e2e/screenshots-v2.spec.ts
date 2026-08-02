import { test, type Browser, type Page } from '@playwright/test'

// Screenshots do NOVO layout (Fase 2): gravados em docs/screenshots/*-v2.png
// para comparar com as versões antigas (login.png, app.png, admin.png...).
const BASE = 'http://127.0.0.1:3000'
const ADMIN = { name: 'AdminV2Print', email: 'adminv2print@test.com', password: 'pass123' }

async function gotoAndConfigure(page: Page): Promise<void> {
  await page.goto(BASE)
  // Espera o splash (que cobre a tela) sumir antes de interagir.
  await page.waitForSelector('.splash-screen', { state: 'detached', timeout: 15000 })
  await page.click('.server-config summary')
  await page.fill('#cp-host', '127.0.0.1')
  await page.fill('#cp-port', '3001')
}

async function register(page: Page, name: string, email: string): Promise<void> {
  await page.click('role=tab[name="Criar conta"]')
  await page.fill('#cp-reg-name', name)
  await page.fill('#cp-reg-email', email)
  await page.fill('#cp-reg-password', 'pass123')
  await page.fill('#cp-reg-confirm', 'pass123')
  await page.click('.btn-connect')
  await page.waitForSelector('.status-pill--connected', { timeout: 25000 })
}

interface CtxOpts {
  dark: boolean
  creds?: { name: string; email: string; password: string }
}

async function newContext(browser: Browser, opts: CtxOpts) {
  const ctx = await browser.newContext()
  await ctx.addInitScript((o) => {
    if (o.creds) {
      localStorage.setItem('voip_credentials', JSON.stringify({
        host: '127.0.0.1',
        wsPort: '3001',
        wssPort: '3003',
        name: o.creds.name,
        email: o.creds.email,
        password: o.creds.password,
      }))
    }
    if (o.dark) localStorage.setItem('voip_theme', 'dark')
  }, opts)
  return ctx
}

test('captura screenshots v2 (novo layout) — claro e escuro', async ({ browser }) => {
  const ts = Date.now()

  for (const dark of [false, true]) {
    const suffix = dark ? '-dark' : ''

    // ---------- Tela de login / registro (espera o splash sumir) ----------
    const loginCtx = await newContext(browser, { dark })
    const login = await loginCtx.newPage()
    await gotoAndConfigure(login)
    await login.waitForTimeout(2400)
    await login.screenshot({ path: `docs/screenshots/login-v2${suffix}.png` })
    await loginCtx.close()

    // ---------- Aplicação principal (salas + chat) ----------
    const appCtx = await newContext(browser, { dark })
    const app = await appCtx.newPage()
    const appName = `V2${ts}${dark ? 'D' : 'L'}`
    await gotoAndConfigure(app)
    await register(app, appName, `${appName.toLowerCase()}@test.com`)
    const room = app.locator('.main-content .room-item').filter({ hasText: /^Externas/ }).first()
    await room.dblclick()
    await app.waitForSelector('.chat-header-name', { timeout: 25000 })
    await app.waitForTimeout(1000)
    await app.screenshot({ path: `docs/screenshots/app-v2${suffix}.png` })
    await appCtx.close()

    // ---------- Painel do admin (conta AdminV2Print criada no banco) ----------
    const adminCtx = await newContext(browser, { dark, creds: ADMIN })
    const admin = await adminCtx.newPage()
    await admin.goto(BASE)
    await admin.waitForSelector('.status-pill--connected', { timeout: 25000 })
    await admin.click('.btn-admin')
    await admin.waitForSelector('.admin-modal', { timeout: 15000 })
    await admin.waitForTimeout(800)
    await admin.screenshot({ path: `docs/screenshots/admin-v2${suffix}.png` })
    await adminCtx.close()
  }
})
