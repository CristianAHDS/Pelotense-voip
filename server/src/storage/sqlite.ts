import Database from 'better-sqlite3'
import { ChatMessage, PrivateMessage, Room } from '../types/index.js'
import { logger } from '../utils/logger.js'

export interface StoredRoom {
  id: string
  name: string
  createdAt: number
  fixed: boolean
  featured?: number
  createdBy?: string
  createdByName?: string
}

export interface StoredPrivateMessage {
  id?: string
  fromUserId: string
  fromUserName: string
  toUserId: string
  toUserName: string
  text?: string
  audioData?: string
  videoData?: string
  duration?: number
  timestamp: number
}

export class SqliteStore {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.migrate()
    logger.info('SqliteStore', `Opened database at ${dbPath}`)
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        fixed INTEGER NOT NULL DEFAULT 0,
        featured INTEGER,
        createdBy TEXT,
        createdByName TEXT
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        roomId TEXT NOT NULL,
        userId TEXT NOT NULL,
        userName TEXT NOT NULL,
        text TEXT,
        audioData TEXT,
        videoData TEXT,
        imageData TEXT,
        duration INTEGER,
        timestamp INTEGER NOT NULL,
        forwarded INTEGER NOT NULL DEFAULT 0,
        reactions TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(roomId);
      CREATE TABLE IF NOT EXISTS private_messages (
        id TEXT PRIMARY KEY,
        fromUserId TEXT NOT NULL,
        fromUserName TEXT NOT NULL,
        toUserId TEXT NOT NULL,
        toUserName TEXT NOT NULL,
        text TEXT,
        audioData TEXT,
        videoData TEXT,
        duration INTEGER,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_private_pair ON private_messages(fromUserName, toUserName);
      CREATE TABLE IF NOT EXISTS accounts (
        name TEXT PRIMARY KEY,
        id TEXT,
        password TEXT NOT NULL,
        avatar TEXT
      );
    `)
    // Migração: versões anteriores não tinham a coluna id em accounts.
    const cols = this.db.prepare("PRAGMA table_info(accounts)").all() as Array<{ name: string }>
    if (!cols.some((c) => c.name === 'id')) {
      this.db.exec('ALTER TABLE accounts ADD COLUMN id TEXT')
    }
  }

  close(): void {
    try { this.db.close() } catch { /* ignore */ }
  }

  saveRoom(room: Room | StoredRoom): void {
    this.db.prepare(`
      INSERT INTO rooms (id, name, createdAt, fixed, featured, createdBy, createdByName)
      VALUES (@id, @name, @createdAt, @fixed, @featured, @createdBy, @createdByName)
      ON CONFLICT(id) DO UPDATE SET
        name = @name,
        fixed = @fixed,
        featured = @featured,
        createdBy = @createdBy,
        createdByName = @createdByName
    `).run({
      id: room.id,
      name: room.name,
      createdAt: room.createdAt,
      fixed: room.fixed ? 1 : 0,
      featured: room.featured ?? null,
      createdBy: room.createdBy ?? null,
      createdByName: room.createdByName ?? null,
    })
  }

  deleteRoom(roomId: string): void {
    this.db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId)
    this.db.prepare('DELETE FROM messages WHERE roomId = ?').run(roomId)
  }

  loadRooms(): StoredRoom[] {
    const rows = this.db.prepare('SELECT * FROM rooms ORDER BY createdAt ASC').all() as Array<{
      id: string
      name: string
      createdAt: number
      fixed: number
      featured: number | null
      createdBy: string | null
      createdByName: string | null
    }>
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.createdAt,
      fixed: r.fixed === 1,
      featured: r.featured ?? undefined,
      createdBy: r.createdBy ?? undefined,
      createdByName: r.createdByName ?? undefined,
    }))
  }

  saveMessage(roomId: string, msg: ChatMessage): void {
    this.db.prepare(`
      INSERT INTO messages (id, roomId, userId, userName, text, audioData, videoData, imageData, duration, timestamp, forwarded, reactions)
      VALUES (@id, @roomId, @userId, @userName, @text, @audioData, @videoData, @imageData, @duration, @timestamp, @forwarded, @reactions)
      ON CONFLICT(id) DO UPDATE SET
        text = @text,
        audioData = @audioData,
        videoData = @videoData,
        imageData = @imageData,
        duration = @duration,
        reactions = @reactions
    `).run({
      id: msg.id ?? '',
      roomId,
      userId: msg.userId,
      userName: msg.userName,
      text: msg.text ?? null,
      audioData: msg.audioData ?? null,
      videoData: msg.videoData ?? null,
      imageData: msg.imageData ?? null,
      duration: msg.duration ?? null,
      timestamp: msg.timestamp,
      forwarded: msg.forwarded ? 1 : 0,
      reactions: msg.reactions ? JSON.stringify(msg.reactions) : null,
    })
  }

  deleteMessage(roomId: string, messageId: string): void {
    this.db.prepare('DELETE FROM messages WHERE roomId = ? AND id = ?').run(roomId, messageId)
  }

  loadMessages(roomId: string): ChatMessage[] {
    const rows = this.db.prepare('SELECT * FROM messages WHERE roomId = ? ORDER BY timestamp ASC').all(roomId) as Array<{
      id: string
      userId: string
      userName: string
      text: string | null
      audioData: string | null
      videoData: string | null
      imageData: string | null
      duration: number | null
      timestamp: number
      forwarded: number
      reactions: string | null
    }>
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userName: r.userName,
      text: r.text ?? undefined,
      audioData: r.audioData ?? undefined,
      videoData: r.videoData ?? undefined,
      imageData: r.imageData ?? undefined,
      duration: r.duration ?? undefined,
      timestamp: r.timestamp,
      forwarded: r.forwarded === 1,
      reactions: r.reactions ? JSON.parse(r.reactions) : undefined,
    }))
  }

  savePrivateMessage(msg: StoredPrivateMessage): void {
    this.db.prepare(`
      INSERT INTO private_messages (id, fromUserId, fromUserName, toUserId, toUserName, text, audioData, videoData, duration, timestamp)
      VALUES (@id, @fromUserId, @fromUserName, @toUserId, @toUserName, @text, @audioData, @videoData, @duration, @timestamp)
      ON CONFLICT(id) DO UPDATE SET
        text = @text,
        audioData = @audioData,
        videoData = @videoData,
        duration = @duration
    `).run({
      id: msg.id ?? '',
      fromUserId: msg.fromUserId,
      fromUserName: msg.fromUserName,
      toUserId: msg.toUserId,
      toUserName: msg.toUserName,
      text: msg.text ?? null,
      audioData: msg.audioData ?? null,
      videoData: msg.videoData ?? null,
      duration: msg.duration ?? null,
      timestamp: msg.timestamp,
    })
  }

  loadPrivateMessages(nameA: string, nameB: string): StoredPrivateMessage[] {
    const rows = this.db.prepare(`
      SELECT * FROM private_messages
      WHERE (fromUserName = @a AND toUserName = @b) OR (fromUserName = @b AND toUserName = @a)
      ORDER BY timestamp ASC
    `).all({ a: nameA, b: nameB }) as Array<{
      id: string
      fromUserId: string
      fromUserName: string
      toUserId: string
      toUserName: string
      text: string | null
      audioData: string | null
      videoData: string | null
      duration: number | null
      timestamp: number
    }>
    return rows.map((r) => ({
      id: r.id,
      fromUserId: r.fromUserId,
      fromUserName: r.fromUserName,
      toUserId: r.toUserId,
      toUserName: r.toUserName,
      text: r.text ?? undefined,
      audioData: r.audioData ?? undefined,
      videoData: r.videoData ?? undefined,
      duration: r.duration ?? undefined,
      timestamp: r.timestamp,
    }))
  }

  loadPrivateMessagesWith(name: string): string[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT CASE
        WHEN fromUserName = @me THEN toUserName
        ELSE fromUserName
      END AS peer
      FROM private_messages
      WHERE fromUserName = @me OR toUserName = @me
    `).all({ me: name }) as Array<{ peer: string }>
    return rows.map((r) => r.peer)
  }

  getAccount(name: string): { name: string; id?: string; password: string; avatar?: string } | undefined {
    const row = this.db.prepare('SELECT * FROM accounts WHERE name = ?').get(name) as
      | { name: string; id: string | null; password: string; avatar: string | null }
      | undefined
    if (!row) return undefined
    return { name: row.name, id: row.id ?? undefined, password: row.password, avatar: row.avatar ?? undefined }
  }

  saveAccount(account: { name: string; id?: string; password: string; avatar?: string }): void {
    this.db.prepare(`
      INSERT INTO accounts (name, id, password, avatar)
      VALUES (@name, @id, @password, @avatar)
      ON CONFLICT(name) DO UPDATE SET
        id = COALESCE(@id, id),
        password = @password,
        avatar = @avatar
    `).run({
      name: account.name,
      id: account.id ?? null,
      password: account.password,
      avatar: account.avatar ?? null,
    })
  }

  renameAccount(oldName: string, newAccount: { name: string; id?: string; password: string; avatar?: string }): void {
    this.db.prepare('DELETE FROM accounts WHERE name = ?').run(oldName)
    this.saveAccount(newAccount)
  }

  deleteAccount(name: string): void {
    this.db.prepare('DELETE FROM accounts WHERE name = ?').run(name)
  }
}
