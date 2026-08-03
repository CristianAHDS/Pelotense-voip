#!/usr/bin/env node
// Commit + push automático com bump de versão.
// Uso:
//   node scripts/commit-push.mjs "mensagem do commit"
//   npm run release -- "mensagem do commit"
//
// O que faz:
//   1. Adiciona todas as mudanças (exceto config.json, que o servidor/túnel
//      regrava sozinho com o host atual).
//   2. Faz o commit — o hook pre-commit (.githooks/pre-commit) roda o bump de
//      versão automaticamente (version.json + client/public/version.json).
//   3. Faz o push para origin/main.
//   4. Mostra a nova versão.
import { execSync } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

function run(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function hasChanges() {
  try {
    const out = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf8' })
    return out.trim().length > 0
  } catch {
    return false
  }
}

function currentVersion() {
  try {
    const raw = JSON.parse(readFileSync(resolve(ROOT, 'version.json'), 'utf8'))
    return `${raw.version ?? '1.0.0'} (build ${Number.isFinite(raw.build) ? raw.build : 0})`
  } catch {
    return 'desconhecida'
  }
}

function main() {
  const args = process.argv.slice(2)
  const message = args.join(' ').trim() || 'chore: atualização automática'

  // 1) Garante que o hook esteja ativo.
  const hooksPath = execSync('git config core.hooksPath', { cwd: ROOT, encoding: 'utf8' }).trim()
  if (hooksPath !== '.githooks') {
    run('git config core.hooksPath .githooks')
  }

  // 2) Verifica se há algo para commitar.
  if (!hasChanges()) {
    console.log('Nada para commitar.')
    return
  }

  // 3) Adiciona tudo, exceto config.json (gerado pelo túnel).
  const files = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .map((l) => l.slice(3).trim())
    .filter(Boolean)
    .filter((f) => f !== 'config.json')
  if (files.length > 0) {
    run(`git add ${files.map((f) => `"${f}"`).join(' ')}`)
  }

  // 4) Commit — o pre-commit bumpa a versão e inclui o version.json.
  run(`git commit -m "${message.replace(/"/g, '\\"')}"`)

  // 5) Push.
  run('git push origin main')

  console.log(`Commit + push concluídos. Versão atual: ${currentVersion()}`)
}

main()
