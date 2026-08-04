import { describe, it, expect, beforeEach } from 'vitest'
import { RoomManager } from '../rooms/manager.js'
import { ClientManager } from '../clients/manager.js'
import { Client } from '../types/index.js'

function fakeWs(): WebSocket {
  return {} as WebSocket
}

function makeClient(id: string, name: string, manager: ClientManager): Client {
  const client: Client = {
    id,
    name,
    password: 'pass',
    room: null,
    ip: '127.0.0.1',
    lastPing: Date.now(),
    admin: false,
    ws: fakeWs(),
  }
  manager.add(client)
  return client
}

let clients: ClientManager
let rooms: RoomManager

beforeEach(() => {
  clients = new ClientManager(100)
  rooms = new RoomManager(20)
})

describe('RoomManager', () => {
  it('cria 7 salas fixas, com a sala "Ao vivo" desativada (fora das listas)', () => {
    const all = rooms.getAll()
    expect(all.length).toBe(6)
    expect(all.every((r) => r.fixed)).toBe(true)
    // Desativada: permanece criada (para reativar depois) mas fora das listas.
    expect(rooms.findByName('Ao vivo')?.disabled).toBe(true)
    expect(rooms.isNameDisabled('Ao vivo')).toBe(true)
    expect(rooms.getAll().some((r) => r.name === 'Ao vivo')).toBe(false)
    expect(rooms.findByName('Live')).toBeDefined()
  })

  it('ordena salas por featured primeiro, depois fixas, depois por criação', () => {
    rooms.create('Criada')
    const all = rooms.getAll()
    const names = all.map((r) => r.name)
    expect(names[0]).toBe('Retorno ao vivo')
    expect(names[1]).toBe('Boletins gravados')
    expect(names[2]).toBe('Live')
    expect(names[names.length - 1]).toBe('Criada')
  })

  it('encontra sala pelo nome', () => {
    const room = rooms.findByName('Externas')
    expect(room?.name).toBe('Externas')
    expect(rooms.findByName('Inexistente')).toBeNull()
  })

  it('cria e deleta salas não-fixas', () => {
    const room = rooms.create('Minha Sala')!
    expect(room).toBeDefined()
    expect(rooms.get(room.id)?.name).toBe('Minha Sala')
    expect(rooms.delete(room.id)).toBe(true)
    expect(rooms.get(room.id)).toBeUndefined()
  })

  it('recusa deletar sala fixa', () => {
    const fixed = rooms.findByName('Trânsito')!
    expect(rooms.delete(fixed.id)).toBe(false)
    expect(rooms.findByName('Trânsito')).toBeDefined()
  })

  it('respeita o limite máximo de salas', () => {
    const limited = new RoomManager(7)
    for (let i = 0; i < 7; i++) {
      limited.create(`Sala ${i}`)
    }
    expect(limited.create('Sala Extra')).toBeNull()
  })

  it('join troca de sala automaticamente', () => {
    const a = makeClient('a1', 'Joiner', clients)
    const r1 = rooms.findByName('Externas')!
    const r2 = rooms.findByName('Trânsito')!
    rooms.join(r1.id, a)
    expect(a.room).toBe(r1.id)
    expect(rooms.getClients(r1.id).some((c) => c.id === 'a1')).toBe(true)
    rooms.join(r2.id, a)
    expect(a.room).toBe(r2.id)
    expect(rooms.getClients(r1.id).some((c) => c.id === 'a1')).toBe(false)
    expect(rooms.getClients(r2.id).some((c) => c.id === 'a1')).toBe(true)
  })

  it('leave remove o cliente da sala e zera a referência', () => {
    const a = makeClient('a2', 'Leaver', clients)
    const r1 = rooms.findByName('Externas')!
    rooms.join(r1.id, a)
    expect(rooms.leave(r1.id, a)).toBe(true)
    expect(a.room).toBeNull()
    expect(rooms.getClients(r1.id)).toHaveLength(0)
  })

  it('gerencia transmissão ao vivo por sala', () => {
    const roomId = rooms.findByName('Ao vivo')!.id
    expect(rooms.getLiveBroadcast(roomId)).toBeUndefined()
    rooms.setLiveBroadcast(roomId, { userId: 'u1', userName: 'Narrador', timestamp: Date.now() })
    expect(rooms.getLiveBroadcast(roomId)?.userId).toBe('u1')
    rooms.clearLiveBroadcast(roomId)
    expect(rooms.getLiveBroadcast(roomId)).toBeUndefined()
  })

  it('toRoomListPayload expõe os dados corretos', () => {
    const r = rooms.findByName('Ao vivo')!
    const payload = rooms.toRoomListPayload(r)
    expect(payload).toMatchObject({ name: 'Ao vivo', fixed: true, featured: 3, users: 0 })
  })

  it('toRoomListPayload inclui o nome do criador', () => {
    rooms.create('Sala do Dono', 'd1', 'Dono da Sala')
    const payload = rooms.toRoomListPayload(rooms.findByName('Sala do Dono')!)
    expect(payload.createdBy).toBe('d1')
    expect(payload.createdByName).toBe('Dono da Sala')
  })

  it('toRoomListPayload inclui transmissão ao vivo quando ativa', () => {
    const room = rooms.findByName('Ao vivo')!
    expect(rooms.toRoomListPayload(room).live).toBeNull()
    rooms.setLiveBroadcast(room.id, { userId: 'u1', userName: 'Narrador', timestamp: Date.now() })
    expect(rooms.toRoomListPayload(room).live).toEqual({ userId: 'u1', userName: 'Narrador' })
  })
})

describe('ClientManager', () => {
  it('adiciona, obtém, remove e lista clientes', () => {
    const c = makeClient('c1', 'Cliente', clients)
    expect(clients.get('c1')).toBe(c)
    expect(clients.size()).toBe(1)
    expect(clients.has('c1')).toBe(true)
    expect(clients.remove('c1')).toBe(true)
    expect(clients.get('c1')).toBeUndefined()
    expect(clients.remove('c1')).toBe(false)
  })

  it('encontra cliente por nome', () => {
    makeClient('c2', 'Reporter', clients)
    expect(clients.findByName('Reporter')?.id).toBe('c2')
    expect(clients.findByName('Ninguem')).toBeUndefined()
  })

  it('respeita o limite máximo de usuários', () => {
    const limited = new ClientManager(2)
    makeClient('x1', 'Um', limited)
    makeClient('x2', 'Dois', limited)
    const extra: Client = {
      id: 'x3',
      name: 'Tres',
      password: 'pass',
      room: null,
      ip: '127.0.0.1',
      lastPing: Date.now(),
      admin: false,
      ws: fakeWs(),
    }
    expect(limited.add(extra)).toBe(false)
    expect(limited.size()).toBe(2)
  })

  it('agrupa clientes por sala', () => {
    const a = makeClient('g1', 'G1', clients)
    const b = makeClient('g2', 'G2', clients)
    const c = makeClient('g3', 'G3', clients)
    const r1 = rooms.findByName('Externas')!
    const r2 = rooms.findByName('Trânsito')!
    rooms.join(r1.id, a)
    rooms.join(r1.id, b)
    rooms.join(r2.id, c)
    expect(clients.getByRoom(r1.id).map((x) => x.id)).toEqual(['g1', 'g2'])
  })

  it('atualiza lastPing', () => {
    const c = makeClient('p1', 'Pinger', clients)
    const old = c.lastPing
    c.lastPing = old - 1000
    clients.updatePing('p1')
    expect(clients.get('p1')!.lastPing).toBeGreaterThan(old - 1000)
  })
})
