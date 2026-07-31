import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { WebSocketServer } from 'ws'
import { createServer as createHttpsServer } from 'https'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { config, securityLimits } from './config/index.js'
import { logger } from './utils/logger.js'
import { ClientManager } from './clients/index.js'
import { RoomManager } from './rooms/index.js'
import { WsHandler } from './network/wsHandler.js'
import { UdpServer } from './network/udpServer.js'
import { VoiceRouter } from './voice/router.js'
import { getSSLCredentials } from './utils/cert.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function main(): Promise<void> {
  logger.info('Server', 'Starting VoIP server...')

  const clientManager = new ClientManager(config.maxUsers)
  const roomManager = new RoomManager(config.maxRooms)

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
  new WsHandler(wss, clientManager, roomManager, config.udpPort, securityLimits)

  const httpsServer = createHttpsServer({ key: ssl.key, cert: ssl.cert }, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<!DOCTYPE html><html><body><h1>WSS Server</h1><p>Cert accepted. You can close this tab and connect in the app.</p></body></html>')
  })
  const wssServer = new WebSocketServer({ server: httpsServer, maxPayload: config.maxWsPayload })
  logger.info('Server', `WebSocket server (WSS) on port ${config.wssPort}`)
  new WsHandler(wssServer, clientManager, roomManager, config.udpPort, securityLimits)
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

  process.on('SIGTERM', () => shutdown())
  process.on('SIGINT', () => shutdown())

  function shutdown(): void {
    logger.info('Server', 'Shutting down...')
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
