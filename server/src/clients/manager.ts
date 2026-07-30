import { Client } from '../types/index.js'
import { logger } from '../utils/logger.js'

export class ClientManager {
  private clients = new Map<string, Client>()
  private maxUsers: number

  constructor(maxUsers: number) {
    this.maxUsers = maxUsers
  }

  add(client: Client): boolean {
    if (this.clients.size >= this.maxUsers) {
      logger.warn('ClientManager', 'Max users reached, rejecting connection')
      return false
    }
    this.clients.set(client.id, client)
    logger.info('ClientManager', `Client connected: ${client.id}`, { name: client.name })
    return true
  }

  remove(id: string): boolean {
    const client = this.clients.get(id)
    if (!client) return false
    this.clients.delete(id)
    logger.info('ClientManager', `Client disconnected: ${id}`)
    return true
  }

  get(id: string): Client | undefined {
    return this.clients.get(id)
  }

  getAll(): Client[] {
    return Array.from(this.clients.values())
  }

  getByRoom(roomId: string): Client[] {
    return this.getAll().filter((c) => c.room === roomId)
  }

  size(): number {
    return this.clients.size
  }

  updatePing(id: string): void {
    const client = this.clients.get(id)
    if (client) {
      client.lastPing = Date.now()
    }
  }

  has(id: string): boolean {
    return this.clients.has(id)
  }

  findByName(name: string): Client | undefined {
    for (const client of this.clients.values()) {
      if (client.name === name) return client
    }
    return undefined
  }
}
