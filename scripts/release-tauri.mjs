#!/usr/bin/env node
// Gera o exe + artefatos do updater e publica uma release no GitHub.
// Uso:
//   node scripts/release-tauri.mjs            (bump patch + build + release)
//   node scripts/release-tauri.mjs --minor    (bump minor + build + release)
//   node scripts/release-tauri.mjs 1.2.3      (versão fixa + build + release)
//   node scripts/release-tauri.mjs --build-only (só gera o exe, sem release)
//
// Requer:
//   - Chaves de assinatura em client/src-tauri/.tauri/ (geradas uma vez com
//     `npm run tauri signer generate`). O arquivo `.tauri/password.txt` guarda
//     a senha usada no momento da geração.
//   - GitHub CLI (`gh`) instalado e autenticado (`gh auth login`) para publicar.
import { execSync } from 'child_process'
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const CLIENT = resolve(ROOT, 'client')
const TAURI_DIR = resolve(CLIENT, 'src-tauri', '.tauri')
const KEY_FILE = resolve(TAURI_DIR, 'radio-pelotense.key')
const PASSWORD_FILE = resolve(TAURI_DIR, 'password.txt')
const REPO = 'CristianAHDS/Pelotense-voip'

const args = process.argv.slice(2)
const buildOnly = args.includes('--build-only')
const versionFlag = args.find((a) => /^\d+\.\d+\.\d+$/.test(a))
const kind = args.includes('--major') ? '--major' : args.includes('--minor') ? '--minor' : '--patch'

function run(cmd, env = {}) {
  return execSync(cmd, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, ...env },
  })
}

function runCapture(cmd, env = {}) {
  try {
    return execSync(cmd, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    }).trim()
  } catch {
    return ''
  }
}

function loadVersion() {
  const raw = JSON.parse(readFileSync(resolve(ROOT, 'version.json'), 'utf8'))
  return `${raw.version ?? '1.0.0'}`
}

function main() {
  // 1) Bump de versão (se não passou versão fixa), para o Cargo.toml e
  //    tauri.conf.json ficarem em sincronia com o version.json.
  const bumpCmd = versionFlag ? `node scripts/bump-version.mjs ${versionFlag}` : `node scripts/bump-version.mjs ${kind}`
  run(bumpCmd)
  const version = loadVersion()
  console.log(`\nVersão para release: ${version}\n`)

  // 2) Chaves de assinatura para gerar os artefatos do updater.
  if (!existsSync(KEY_FILE)) {
    console.error('ERRO: chave privada não encontrada em client/src-tauri/.tauri/radio-pelotense.key')
    console.error('Gere uma vez com: npm run tauri signer generate')
    process.exit(1)
  }
  let password = ''
  if (existsSync(PASSWORD_FILE)) password = readFileSync(PASSWORD_FILE, 'utf8').trim()

  // 3) Build do exe com assinatura (gerar updater artifacts).
  console.log('Buildando o app (tsc + vite + cargo + bundle)... isso leva um tempo.')
  run(`cd client && npm run tauri build`, {
    TAURI_SIGNING_PRIVATE_KEY: KEY_FILE,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password,
    TAURI_PRIVATE_KEY: KEY_FILE,
    TAURI_KEY_PASSWORD: password,
  })

  // 4) Localiza o instalador, a assinatura e o manifest gerado.
  const nsisDir = resolve(CLIENT, 'src-tauri', 'target', 'release', 'bundle', 'nsis')
  if (!existsSync(nsisDir)) {
    console.error('ERRO: bundle NSIS não gerado em', nsisDir)
    process.exit(1)
  }
  const files = readdirSync(nsisDir)
  const installer = files.find((f) => /_x64-setup\.exe$/.test(f) && !/\.sig$/.test(f))
  const sigFile = files.find((f) => /_x64-setup\.exe\.sig$/.test(f))
  if (!installer || !sigFile) {
    console.error('ERRO: instalador/assinatura não encontrados no bundle NSIS.', files)
    process.exit(1)
  }
  const signature = readFileSync(resolve(nsisDir, sigFile), 'utf8').trim()

  // 5) Manifest do updater (latest.json) com a URL apontando para a release.
  const downloadUrl = `https://github.com/${REPO}/releases/download/v${version}/${encodeURIComponent(installer)}`
  const manifest = {
    version,
    notes: args.find((a) => !a.startsWith('-') && !/^\d+\.\d+\.\d+$/.test(a)) ?? '',
    pub_date: new Date().toISOString(),
    platforms: {
      'windows-x86_64': {
        signature,
        url: downloadUrl,
      },
    },
  }
  const manifestPath = resolve(CLIENT, 'src-tauri', 'target', 'release', 'latest.json')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log('Manifest do updater:', manifestPath)

  if (buildOnly) {
    console.log('\nBuild concluído sem publicar release.')
    console.log('Instalador:', resolve(nsisDir, installer))
    console.log('Manifest:  ', manifestPath)
    return
  }

  // 6) Publica a release no GitHub e anexa instalador + assinatura + manifest.
  const tag = `v${version}`
  const existing = runCapture(`gh release view ${tag} --json tagName --jq .tagName`)
  if (existing) {
    console.log(`Release ${tag} já existe. Removendo para recriar...`)
    run(`gh release delete ${tag} --yes --cleanup-tag`)
  }
  run(`gh release create ${tag} "${resolve(nsisDir, installer)}" "${resolve(nsisDir, sigFile)}" "${manifestPath}" --repo ${REPO} --title "${tag}" --notes "Rádio Pelotense ${version}"`)
  console.log(`\nRelease publicada: https://github.com/${REPO}/releases/tag/${tag}`)
  console.log(`Endpoint do updater: https://github.com/${REPO}/releases/latest/download/latest.json`)
}

main()
