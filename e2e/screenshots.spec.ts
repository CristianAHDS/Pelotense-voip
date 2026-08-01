import { test, type Page } from '@playwright/test'

const BASE = 'http://127.0.0.1:3000'

async function gotoAndConfigure(page: Page): Promise<void> {
  await page.goto(BASE)
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

test('captura screenshots das telas principais', async ({ browser }) => {
  // ---------- Tela de login / registro ----------
  const loginCtx = await browser.newContext()
  const login = await loginCtx.newPage()
  await gotoAndConfigure(login)
  await login.waitForTimeout(1500)
  await login.screenshot({ path: 'docs/screenshots/login.png' })
  await loginCtx.close()

  // ---------- Aplicação principal (salas + chat) ----------
  const appCtx = await browser.newContext()
  const app = await appCtx.newPage()
  const ts = Date.now()
  await gotoAndConfigure(app)
  await register(app, `Usu${ts}`, `user${ts}@test.com`)
  const room = app.locator('.main-content .room-item').filter({ hasText: /^Externas/ }).first()
  await room.dblclick()
  await app.waitForSelector('.chat-header-name', { timeout: 25000 })
  await app.waitForTimeout(1000)
  await app.screenshot({ path: 'docs/screenshots/app.png' })
  await appCtx.close()

  // ---------- Painel do admin ----------
  const adminCtx = await browser.newContext()
  const admin = await adminCtx.newPage()
  await gotoAndConfigure(admin)
  await register(admin, 'AdminPrint', 'adminprint@test.com')
  await admin.click('.btn-admin')
  await admin.waitForSelector('.admin-modal', { timeout: 15000 })
  await admin.waitForTimeout(800)
  await admin.screenshot({ path: 'docs/screenshots/admin.png' })
  await adminCtx.close()
})
