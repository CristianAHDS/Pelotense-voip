import { VoicePacket, PacketType } from '../types/index.js'

const MIN_HEADER_SIZE = 2

export function parsePacket(buf: Buffer): VoicePacket | null {
  if (buf.length < MIN_HEADER_SIZE) return null

  const version = buf.readUInt8(0)
  const packetType = buf.readUInt8(1) as PacketType

  if (packetType === PacketType.Ping || packetType === PacketType.Pong) {
    return {
      version,
      packetType,
      userId: '',
      roomId: '',
      sequence: 0,
      timestamp: 0,
      payload: Buffer.alloc(0),
    }
  }

  if (buf.length < 17) return null

  const userId = buf.toString('utf8', 2, 10).replace(/\0+$/, '')
  const roomId = buf.toString('utf8', 10, 14).replace(/\0+$/, '')
  const sequence = buf.readUInt32BE(14)
  const timestamp = buf.readDoubleBE(18)
  const payload = buf.subarray(26)

  return {
    version,
    packetType,
    userId,
    roomId,
    sequence,
    timestamp,
    payload,
  }
}
