import Fastify from 'fastify'
import { WebSocketServer } from 'ws'
import { config } from './config/index.js'
import { logger } from './utils/logger.js'
import { ClientManager } from './clients/index.js'
import { RoomManager } from './rooms/index.js'
import { WsHandler } from './network/wsHandler.js'
import { UdpServer } from './network/udpServer.js'
import { VoiceRouter } from './voice/router.js'

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

  const wss = new WebSocketServer({ port: config.wsPort })
  logger.info('Server', `WebSocket server on port ${config.wsPort}`)

  new WsHandler(wss, clientManager, roomManager, config.udpPort)

  new UdpServer(voiceRouter, config.udpPort)

  try {
    await httpServer.listen({ port: config.serverPort, host: config.serverHost })
    logger.info('Server', `HTTP server on port ${config.serverPort}`)
  } catch (err) {
    logger.error('Server', 'Failed to start HTTP server', err)
    process.exit(1)
  }

  process.on('SIGTERM', () => shutdown())
  process.on('SIGINT', () => shutdown())

  function shutdown(): void {
    logger.info('Server', 'Shutting down...')
    wss.close()
    httpServer.close()
    process.exit(0)
  }
}

main().catch((err) => {
  logger.error('Server', 'Fatal error', err)
  process.exit(1)
})
