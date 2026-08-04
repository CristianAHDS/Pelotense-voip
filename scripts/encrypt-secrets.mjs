#!/usr/bin/env node
// Criptografa a chave privada do updater + senha num único arquivo .enc
// (AES-256-GCM, senha derivada com scrypt). Só o .enc vai pro GitHub — a senha
// fica com você (nunca commitar).
// Uso:
//   node scripts/encrypt-secrets.mjs --pass "senha-muito-forte"
//   node scripts/decrypt-secrets.mjs --pass "senha-muito-forte" [--out pasta]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const TAURI_DIR = resolve(ROOT, 'client', 'src-tauri', '.tauri')
const BACKUP_FILE = resolve(TAURI_DIR, 'backup', 'radio-pelotense-updater-backup.enc')
const MAGIC = 'RPUPD'
const KEY_FILE = resolve(TAURI_DIR, 'radio-pelotense.key')
const PUB_FILE = resolve(TAURI_DIR, 'radio-pelotense.key.pub')
const PASS_FILE = resolve(TAURI_DIR, 'password.txt')

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : ''
}

function deriveKey(pass, salt) {
  return crypto.scryptSync(pass, salt, 32)
}

function encrypt(pass) {
  const payload = JSON.stringify({
    createdAt: new Date().toISOString(),
    key: readFileSync(KEY_FILE, 'utf8'),
    pub: readFileSync(PUB_FILE, 'utf8'),
    password: readFileSync(PASS_FILE, 'utf8').trim(),
  })
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(pass, salt), iv)
  const ciphertext = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  mkdirSync(dirname(BACKUP_FILE), { recursive: true })
  writeFileSync(BACKUP_FILE, Buffer.concat([Buffer.from(MAGIC), salt, iv, tag, ciphertext]))
  console.log(`Backup criptografado criado: ${BACKUP_FILE}`)
}

function decrypt(pass, outDir) {
  if (!existsSync(BACKUP_FILE)) {
    console.error('Backup não encontrado:', BACKUP_FILE)
    process.exit(1)
  }
  const buf = readFileSync(BACKUP_FILE)
  const magic = buf.subarray(0, 5).toString()
  if (magic !== MAGIC) {
    console.error('Arquivo inválido (magic errado).')
    process.exit(1)
  }
  const salt = buf.subarray(5, 21)
  const iv = buf.subarray(21, 33)
  const tag = buf.subarray(33, 49)
  const ciphertext = buf.subarray(49)
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(pass, salt), iv)
  decipher.setAuthTag(tag)
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  const data = JSON.parse(plain.toString('utf8'))
  mkdirSync(outDir, { recursive: true })
  writeFileSync(resolve(outDir, 'radio-pelotense.key'), data.key)
  writeFileSync(resolve(outDir, 'radio-pelotense.key.pub'), data.pub)
  writeFileSync(resolve(outDir, 'password.txt'), data.password + '\n')
  console.log('Restaurado em:', outDir)
  console.log('Conteúdo: radio-pelotense.key, radio-pelotense.key.pub, password.txt')
}

const pass = arg('--pass') || process.env.SECRETS_PASS
if (!pass) {
  console.error('Informe a senha: --pass "sua-senha-forte"')
  process.exit(1)
}

if (process.argv.includes('decrypt') || process.argv.includes('--decrypt')) {
  const out = arg('--out') || resolve(TAURI_DIR, 'restored')
  decrypt(pass, out)
} else {
  encrypt(pass)
}
