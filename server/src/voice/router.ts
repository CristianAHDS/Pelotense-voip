import dgram from 'dgram'
import { VoicePacket } from '../types/index.js'
import { ClientManager } from '../clients/index.js'
import { RoomManager } from '../rooms/index.js'
import { buildVoicePacket } from '../packets/index.js'
import { logger } from '../utils/logger.js'
import { eventBus } from '../utils/events.js'
import { EventType } from '../types/index.js'

export class VoiceRouter {
  private clients: ClientManager
  private rooms: RoomManager
  private socket: dgram.Socket | null = null

  constructor(clients: ClientManager, rooms: RoomManager) {
    this.clients = clients
    this.rooms = rooms
  }

  setSocket(socket: dgram.Socket): void {
    this.socket = socket
  }

  route(packet: VoicePacket, rinfo: dgram.RemoteInfo): void {
    if (!this.socket) return

    const room = this.rooms.get(packet.roomId)
    if (!room) {
      logger.debug('VoiceRouter', `Room ${packet.roomId} not found`)
      return
    }

    const sender = this.clients.get(packet.userId)
    if (!sender) {
      logger.debug('VoiceRouter', `Sender ${packet.userId} not found`)
      return
    }

    const roomClients = this.rooms.getClients(packet.roomId)
    let targetCount = 0

    sender.udpPort = rinfo.port

    roomClients.forEach((target) => {
      if (target.id === packet.userId) return

      const data = buildVoicePacket(
        packet.userId,
        packet.roomId,
        packet.sequence,
        packet.timestamp,
        packet.payload,
      )

      this.socket!.send(data, target.udpPort, target.ip, (err) => {
        if (err) {
          logger.error('VoiceRouter', `Failed to send to ${target.id}`, err.message)
        }
      })
      targetCount++
    })

    if (targetCount > 0) {
      eventBus.emit(EventType.VoicePacketSent, {
        userId: packet.userId,
        roomId: packet.roomId,
        targets: targetCount,
      })
    }
  }
}
