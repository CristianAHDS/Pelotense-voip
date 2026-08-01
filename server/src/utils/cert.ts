import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import selfsigned from 'selfsigned'

const __dirname = dirname(fileURLToPath(import.meta.url))
// Permite apontar os certificados para dentro do volume de dados (Fly/Oracle:
// só um volume por máquina no Fly). Padrão: server/certs.
const CERTS_DIR = process.env.CERTS_DIR ?? join(__dirname, '..', '..', 'certs')
const KEY_PATH = join(CERTS_DIR, 'server.key')
const CERT_PATH = join(CERTS_DIR, 'server.crt')

export async function getSSLCredentials(): Promise<{ key: string; cert: string }> {
  if (existsSync(KEY_PATH) && existsSync(CERT_PATH)) {
    return {
      key: readFileSync(KEY_PATH, 'utf8'),
      cert: readFileSync(CERT_PATH, 'utf8'),
    }
  }

  console.log('[Cert] Generating self-signed certificate...')
  mkdirSync(CERTS_DIR, { recursive: true })

  const notAfter = new Date()
  notAfter.setFullYear(notAfter.getFullYear() + 1)
  const result = await selfsigned.generate(
    [{ name: 'commonName', value: 'localhost' }],
    { notAfterDate: notAfter, algorithm: 'sha256' },
  )

  writeFileSync(KEY_PATH, result.private)
  writeFileSync(CERT_PATH, result.cert)
  console.log('[Cert] Certificate saved to', CERTS_DIR)

  return { key: result.private, cert: result.cert }
}
