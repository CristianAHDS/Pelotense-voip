// Bump automático de versão. Roda no hook pre-push: incrementa o número de
// build a cada push (e aceita --major/--minor/--patch para a versão semântica).
// Mantém version.json na raiz, que o cliente (build) e o servidor (runtime)
// leem para exibir "qual versão está rodando".
import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const VERSION_FILE = resolve(ROOT, 'version.json')

const args = process.argv.slice(2)

function load() {
  try {
    const raw = JSON.parse(readFileSync(VERSION_FILE, 'utf8'))
    return {
      version: typeof raw.version === 'string' ? raw.version : '1.0.0',
      build: Number.isFinite(raw.build) ? raw.build : 0,
    }
  } catch {
    return { version: '1.0.0', build: 0 }
  }
}

function bumpVersion(v, kind) {
  const parts = v.split('.').map((n) => parseInt(n, 10) || 0)
  while (parts.length < 3) parts.push(0)
  if (kind === 'major') {
    parts[0] += 1
    parts[1] = 0
    parts[2] = 0
  } else if (kind === 'minor') {
    parts[1] += 1
    parts[2] = 0
  } else {
    parts[2] += 1
  }
  return parts.join('.')
}

const kind = args.includes('--major') ? 'major' : args.includes('--minor') ? 'minor' : 'patch'
const forceVersion = args.find((a) => /^\d+\.\d+\.\d+$/.test(a))

const cur = load()
const version = forceVersion ?? bumpVersion(cur.version, kind)
const build = cur.build + 1
const next = { version, build }

writeFileSync(VERSION_FILE, JSON.stringify(next, null, 2) + '\n')

// Também copia para client/public/version.json para o PWA/site estático poder
// exibir a versão mesmo sem o servidor (e para debug do build do front).
const publicVersion = resolve(ROOT, 'client', 'public', 'version.json')
writeFileSync(publicVersion, JSON.stringify(next, null, 2) + '\n')

console.log(`version → ${next.version} (build ${next.build})`)
