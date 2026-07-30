import { VoicePacket, PacketType } from '../types/index.js'

const HEADER_SIZE = 17
const VERSION = 1

export function buildVoicePacket(
  userId: string,
  roomId: string,
  sequence: number,
  timestamp: number,
  payload: Buffer,
): Buffer {
  const userIdBuf = Buffer.from(userId.padEnd(8, '\0').slice(0, 8), 'utf8')
  const roomIdBuf = Buffer.from(roomId.padEnd(4, '\0').slice(0, 4), 'utf8')
  const buf = Buffer.alloc(HEADER_SIZE + payload.length)

  let offset = 0
  buf.writeUInt8(VERSION, offset); offset += 1
  buf.writeUInt8(PacketType.VoiceData, offset); offset += 1
  userIdBuf.copy(buf, offset); offset += 8
  roomIdBuf.copy(buf, offset); offset += 4
  buf.writeUInt32BE(sequence, offset); offset += 4
  buf.writeDoubleBE(timestamp, offset); offset += 8
  payload.copy(buf, offset)

  return buf
}

export function buildPingPacket(): Buffer {
  const buf = Buffer.alloc(2)
  buf.writeUInt8(VERSION, 0)
  buf.writeUInt8(PacketType.Ping, 1)
  return buf
}

export function buildPongPacket(): Buffer {
  const buf = Buffer.alloc(2)
  buf.writeUInt8(VERSION, 0)
  buf.writeUInt8(PacketType.Pong, 1)
  return buf
}
