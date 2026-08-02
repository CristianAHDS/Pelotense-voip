import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { WebSocketServer } from 'ws'
import { createServer as createHttpsServer } from 'https'
import { join, dirname, extname } from 'path'
import { fileURLToPath } from 'url'
import { createReadStream, existsSync, statSync } from 'fs'
import { networkInterfaces } from 'os'
import { spawn } from 'child_process'
import { config, securityLimits } from './config/index.js'
import { logger } from './utils/logger.js'
import { ClientManager } from './clients/index.js'
import { RoomManager } from './rooms/index.js'
import { WsHandler } from './network/wsHandler.js'
import { UdpServer } from './network/udpServer.js'
import { VoiceRouter } from './voice/router.js'
import { getSSLCredentials } from './utils/cert.js'
import { SqliteStore } from './storage/index.js'
import { mkdirSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

const STATIC_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
}

function serveClientDist(req: import('http').IncomingMessage, res: import('http').ServerResponse): void {
  const clientDist = join(__dirname, '..', '..', 'client', 'dist')
  let pathname = decodeURIComponent((req.url ?? '/').split('?')[0])
  if (pathname === '/') pathname = '/index.html'
  const filePath = join(clientDist, pathname)
  if (!filePath.startsWith(clientDist)) {
    res.writeHead(403); res.end('Forbidden'); return
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    // SPA: fallback para o index.html
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    createReadStream(join(clientDist, 'index.html')).pipe(res)
    return
  }
  res.writeHead(200, { 'Content-Type': STATIC_MIME[extname(filePath)] ?? 'application/octet-stream' })
  createReadStream(filePath).pipe(res)
}

function getLocalIPs(): string[] {
  const nets = networkInterfaces()
  const ips: string[] = []
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address)
    }
  }
  return ips
}

function logAccessUrls(): void {
  const ips = getLocalIPs()
  if (ips.length > 0) logger.info('Network', `IPs locais desta máquina: ${ips.join(', ')}`)
  logger.info('Network', `App (HTTP):  http://localhost:${config.serverPort}  |  App (HTTPS): https://localhost:${config.httpsClientPort}`)
  if (ips.length > 0) {
    logger.info('Network', `WSS para outros na rede: ${ips.map((ip) => `wss://${ip}:${config.wssPort}`).join('  |  ')}`)
  }
}

// Expõe o servidor via ngrok (URL pública muda a cada execução). Para ativar,
// defina NGROK_AUTHTOKEN no .env (e opcionalmente NGROK_DOMAIN p/ endereço fixo).
function startNgrokTunnel(): void {
  const authtoken = process.env.NGROK_AUTHTOKEN
  if (!authtoken) {
    logger.info('Ngrok', 'Para expor via ngrok, configure NGROK_AUTHTOKEN no server/.env')
    return
  }
  try {
    const args = ['http', String(config.wssPort)]
    if (process.env.NGROK_DOMAIN) args.push('--domain', process.env.NGROK_DOMAIN)
    logger.info('Ngrok', `Iniciando ngrok → porta ${config.wssPort}...`)
    let tries = 0
    let timer: ReturnType<typeof setInterval> | undefined
    const child = spawn('ngrok', args, { stdio: 'ignore', detached: true, windowsHide: true })
    child.on('error', (err) => {
      if (timer) clearInterval(timer)
      logger.warn('Ngrok', `ngrok não pôde ser iniciado (${(err as Error).message}). Instale com: winget install ngrok.ngrok (ou baixe em https://ngrok.com/download)`)
    })
    child.unref()
    timer = setInterval(async () => {
      tries++
      try {
        const res = await fetch('http://127.0.0.1:4040/api/tunnels')
        const data = await res.json() as { tunnels?: Array<{ public_url?: string }> }
        const url = data.tunnels?.find((t) => t.public_url)?.public_url
        if (url) {
          clearInterval(timer!)
          logger.info('Ngrok', `PÚBLICO (envie este link): ${url}`)
        } else if (tries > 15) {
          clearInterval(timer!)
        }
      } catch {
        if (tries > 15) clearInterval(timer!)
      }
    }, 2000)
  } catch (e) {
    logger.warn('Ngrok', 'Não foi possível iniciar o ngrok. Instale com: winget install ngrok.ngrok')
  }
}

// Expõe o servidor via Cloudflare Tunnel (cloudflared) — URL pública sem aviso
// de navegador (diferente do ngrok-free). Ative com CLOUDFLARED=true no .env.
function startCloudflareTunnel(): void {
  if (process.env.CLOUDFLARED !== 'true') {
    logger.info('Cloudflare', 'Para expor via cloudflared, defina CLOUDFLARED=true no server/.env')
    return
  }
  try {
    logger.info('Cloudflare', `Iniciando cloudflared → porta ${config.wssPort}...`)
    const child = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${config.wssPort}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    child.on('error', (err) => {
      logger.warn('Cloudflare', `cloudflared não pôde ser iniciado (${(err as Error).message}). Instale com: winget install cloudflare.cloudflared`)
    })
    let found = false
    const onData = (buf: Buffer) => {
      const text = buf.toString()
      const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
      if (m && !found) {
        found = true
        logger.info('Cloudflare', `PÚBLICO (envie este link): ${m[0]}`)
      }
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('exit', () => logger.info('Cloudflare', 'Túnel cloudflared encerrado'))
  } catch (e) {
    logger.warn('Cloudflare', 'Não foi possível iniciar o cloudflared. Instale com: winget install cloudflare.cloudflared')
  }
}

async function main(): Promise<void> {
  logger.info('Server', 'Starting VoIP server...')

  try {
    mkdirSync(dirname(config.dbPath), { recursive: true })
  } catch { /* diretório já existe */ }

  const storage = new SqliteStore(config.dbPath)

  const clientManager = new ClientManager(config.maxUsers)
  const roomManager = new RoomManager(config.maxRooms, storage)

  const voiceRouter = new VoiceRouter(clientManager, roomManager)

  const httpServer = Fastify({
    logger: false,
  })

  httpServer.get('/health', async () => {
    return {
      status: 'ok',
      clients: clientManager.size(),
      rooms: roomManager.getAll().length,
    }
  })

  const clientDist = join(__dirname, '..', '..', 'client', 'dist')

  httpServer.register(fastifyStatic, {
    root: clientDist,
    prefix: '/',
    wildcard: false,
  })

  httpServer.setNotFoundHandler((_req, reply) => {
    reply.sendFile('index.html')
  })

  const ssl = await getSSLCredentials()

  const httpsClient = Fastify({
    logger: false,
    https: { key: ssl.key, cert: ssl.cert },
  })

  httpsClient.register(fastifyStatic, {
    root: clientDist,
    prefix: '/',
    wildcard: false,
  })

  httpsClient.setNotFoundHandler((_req, reply) => {
    reply.sendFile('index.html')
  })

  const wss = new WebSocketServer({ port: config.wsPort, maxPayload: config.maxWsPayload })
  logger.info('Server', `WebSocket server (WS) on port ${config.wsPort}`)
  new WsHandler(wss, clientManager, roomManager, config.udpPort, securityLimits, config.adminNames, storage, config.adminIds)

  const httpsServer = createHttpsServer({ key: ssl.key, cert: ssl.cert }, serveClientDist)
  const wssServer = new WebSocketServer({ server: httpsServer, maxPayload: config.maxWsPayload })
  logger.info('Server', `WebSocket server (WSS) on port ${config.wssPort}`)
  new WsHandler(wssServer, clientManager, roomManager, config.udpPort, securityLimits, config.adminNames, storage, config.adminIds)
  httpsServer.listen(config.wssPort)

  try {
    await httpServer.listen({ port: config.serverPort, host: config.serverHost })
    logger.info('Server', `HTTP client server on port ${config.serverPort}`)
  } catch (err) {
    logger.error('Server', 'Failed to start HTTP server', err)
    process.exit(1)
  }

  try {
    await httpsClient.listen({ port: config.httpsClientPort, host: config.serverHost })
    logger.info('Server', `HTTPS client server on port ${config.httpsClientPort}`)
  } catch (err) {
    logger.error('Server', 'Failed to start HTTPS client server', err)
    process.exit(1)
  }

  logAccessUrls()
  startNgrokTunnel()
  startCloudflareTunnel()

  process.on('SIGTERM', () => shutdown())
  process.on('SIGINT', () => shutdown())

  function shutdown(): void {
    logger.info('Server', 'Shutting down...')
    storage.close()
    wss.close()
    httpsServer.close()
    httpServer.close()
    httpsClient.close()
    process.exit(0)
  }
}

main().catch((err) => {
  logger.error('Server', 'Fatal error', err)
  process.exit(1)
})
