import dgram from 'dgram'
import { logger } from '../utils/logger.js'
import { eventBus } from '../utils/events.js'
import { EventType, PacketType } from '../types/index.js'
import { parsePacket } from '../packets/index.js'
import { VoiceRouter } from '../voice/router.js'

export class UdpServer {
  private socket: dgram.Socket
  private router: VoiceRouter
  private port: number

  constructor(router: VoiceRouter, port: number) {
    this.router = router
    this.port = port
    this.socket = dgram.createSocket('udp4')
    this.router.setSocket(this.socket)
    this.setup()
  }

  private setup(): void {
    this.socket.on('message', (msg: Buffer, rinfo) => {
      const packet = parsePacket(msg)
      if (!packet) {
        logger.warn('UdpServer', 'Invalid packet received')
        return
      }

      if (packet.packetType === PacketType.Ping) {
        this.sendPong(rinfo)
        return
      }

      if (packet.packetType === PacketType.Pong) {
        return
      }

      if (packet.packetType === PacketType.VoiceData) {
        eventBus.emit(EventType.VoicePacketReceived, {
          userId: packet.userId,
          roomId: packet.roomId,
          size: packet.payload.length,
        })

        this.router.route(packet, rinfo)
      }
    })

    this.socket.on('error', (err) => {
      logger.error('UdpServer', `Socket error: ${err.message}`)
    })

    this.socket.bind(this.port, () => {
      logger.info('UdpServer', `UDP server listening on port ${this.port}`)
    })
  }

  private sendPong(rinfo: dgram.RemoteInfo): void {
    const pong = Buffer.alloc(2)
    pong.writeUInt8(1, 0)
    pong.writeUInt8(PacketType.Pong, 1)
    this.socket.send(pong, rinfo.port, rinfo.address)
  }

  close(): void {
    this.socket.close()
    logger.info('UdpServer', 'UDP server closed')
  }
}
