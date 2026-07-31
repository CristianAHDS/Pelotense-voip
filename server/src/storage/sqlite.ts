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
  imageData?: string
  duration?: number
  timestamp: number
}

export interface Account {
  name: string
  id?: string
  email?: string
  password: string
  avatar?: string
  emailConfirmed?: boolean
  confirmCode?: string
  isAdmin?: boolean
  tags?: string[]
  createdAt?: number
}

interface AccountRow {
  name: string
  id: string | null
  email: string | null
  password: string
  avatar: string | null
  emailConfirmed: number | null
  confirmCode: string | null
  isAdmin: number | null
  tags: string | null
  createdAt: number | null
}

function mapAccount(row: AccountRow): Account {
  let tags: string[] | undefined
  if (row.tags) {
    try {
      const parsed = JSON.parse(row.tags)
      if (Array.isArray(parsed)) tags = parsed.filter((t) => typeof t === 'string')
    } catch { /* ignore */ }
  }
  return {
    name: row.name,
    id: row.id ?? undefined,
    email: row.email ?? undefined,
    password: row.password,
    avatar: row.avatar ?? undefined,
    emailConfirmed: row.emailConfirmed === 1,
    confirmCode: row.confirmCode ?? undefined,
    isAdmin: row.isAdmin === 1,
    tags,
    createdAt: row.createdAt ?? undefined,
  }
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
        imageData TEXT,
        duration INTEGER,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_private_pair ON private_messages(fromUserName, toUserName);
      CREATE TABLE IF NOT EXISTS accounts (
        name TEXT PRIMARY KEY,
        id TEXT,
        email TEXT,
        password TEXT NOT NULL,
        avatar TEXT,
        emailConfirmed INTEGER NOT NULL DEFAULT 0,
        confirmCode TEXT,
        isAdmin INTEGER NOT NULL DEFAULT 0,
        tags TEXT,
        createdAt INTEGER
      );
    `)
    // Migração: versões anteriores não tinham as colunas id/email/confirmação.
    const cols = this.db.prepare("PRAGMA table_info(accounts)").all() as Array<{ name: string }>
    if (!cols.some((c) => c.name === 'id')) {
      this.db.exec('ALTER TABLE accounts ADD COLUMN id TEXT')
    }
    if (!cols.some((c) => c.name === 'email')) {
      this.db.exec('ALTER TABLE accounts ADD COLUMN email TEXT')
    }
    if (!cols.some((c) => c.name === 'emailConfirmed')) {
      this.db.exec('ALTER TABLE accounts ADD COLUMN emailConfirmed INTEGER NOT NULL DEFAULT 0')
    }
    if (!cols.some((c) => c.name === 'confirmCode')) {
      this.db.exec('ALTER TABLE accounts ADD COLUMN confirmCode TEXT')
    }
    if (!cols.some((c) => c.name === 'isAdmin')) {
      this.db.exec('ALTER TABLE accounts ADD COLUMN isAdmin INTEGER NOT NULL DEFAULT 0')
    }
    if (!cols.some((c) => c.name === 'tags')) {
      this.db.exec('ALTER TABLE accounts ADD COLUMN tags TEXT')
    }
    if (!cols.some((c) => c.name === 'createdAt')) {
      this.db.exec('ALTER TABLE accounts ADD COLUMN createdAt INTEGER')
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email)')

    const pmCols = this.db.prepare('PRAGMA table_info(private_messages)').all() as Array<{ name: string }>
    if (!pmCols.some((c) => c.name === 'imageData')) {
      this.db.exec('ALTER TABLE private_messages ADD COLUMN imageData TEXT')
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
      INSERT INTO private_messages (id, fromUserId, fromUserName, toUserId, toUserName, text, audioData, videoData, imageData, duration, timestamp)
      VALUES (@id, @fromUserId, @fromUserName, @toUserId, @toUserName, @text, @audioData, @videoData, @imageData, @duration, @timestamp)
      ON CONFLICT(id) DO UPDATE SET
        text = @text,
        audioData = @audioData,
        videoData = @videoData,
        imageData = @imageData,
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
      imageData: msg.imageData ?? null,
      duration: msg.duration ?? null,
      timestamp: msg.timestamp,
    })
  }

  getPrivateMessage(id: string): StoredPrivateMessage | undefined {
    const row = this.db.prepare('SELECT * FROM private_messages WHERE id = ?').get(id) as {
      id: string
      fromUserId: string
      fromUserName: string
      toUserId: string
      toUserName: string
      text: string | null
      audioData: string | null
      videoData: string | null
      imageData: string | null
      duration: number | null
      timestamp: number
    } | undefined
    if (!row) return undefined
    return {
      id: row.id,
      fromUserId: row.fromUserId,
      fromUserName: row.fromUserName,
      toUserId: row.toUserId,
      toUserName: row.toUserName,
      text: row.text ?? undefined,
      audioData: row.audioData ?? undefined,
      videoData: row.videoData ?? undefined,
      imageData: row.imageData ?? undefined,
      duration: row.duration ?? undefined,
      timestamp: row.timestamp,
    }
  }

  deletePrivateMessage(id: string): void {
    this.db.prepare('DELETE FROM private_messages WHERE id = ?').run(id)
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
      imageData: string | null
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
      imageData: r.imageData ?? undefined,
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

  getAccount(name: string): Account | undefined {
    const row = this.db.prepare('SELECT * FROM accounts WHERE name = ?').get(name) as AccountRow | undefined
    if (!row) return undefined
    return mapAccount(row)
  }

  getAccountById(id: string): Account | undefined {
    const row = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined
    if (!row) return undefined
    return mapAccount(row)
  }

  getAllAccounts(): Array<{ id?: string; name: string; email?: string; avatar?: string; emailConfirmed?: boolean; isAdmin?: boolean; tags?: string[] }> {
    const rows = this.db.prepare('SELECT name, id, email, avatar, emailConfirmed, isAdmin, tags FROM accounts ORDER BY name COLLATE NOCASE').all() as Array<{
      name: string
      id: string | null
      email: string | null
      avatar: string | null
      emailConfirmed: number | null
      isAdmin: number | null
      tags: string | null
    }>
    return rows.map((r) => ({
      id: r.id ?? undefined,
      name: r.name,
      email: r.email ?? undefined,
      avatar: r.avatar ?? undefined,
      emailConfirmed: r.emailConfirmed === 1,
      isAdmin: r.isAdmin === 1,
      tags: r.tags ? JSON.parse(r.tags) : undefined,
    }))
  }

  // Busca conta por nome OU e-mail (login aceita ambos).
  getAccountByIdentifier(identifier: string): Account | undefined {
    const row = this.db.prepare('SELECT * FROM accounts WHERE name = ? OR email = ? COLLATE NOCASE LIMIT 1').get(identifier, identifier) as AccountRow | undefined
    if (!row) return undefined
    return mapAccount(row)
  }

  // Busca conta por e-mail (para checar unicidade ao criar/atualizar).
  getAccountByEmail(email: string): Account | undefined {
    const row = this.db.prepare('SELECT * FROM accounts WHERE email = ? COLLATE NOCASE LIMIT 1').get(email) as AccountRow | undefined
    if (!row) return undefined
    return mapAccount(row)
  }

  saveAccount(account: Account): void {
    this.db.prepare(`
      INSERT INTO accounts (name, id, email, password, avatar, emailConfirmed, confirmCode, isAdmin, tags, createdAt)
      VALUES (@name, @id, @email, @password, @avatar, COALESCE(@emailConfirmed, 0), @confirmCode, COALESCE(@isAdmin, 0), @tags, @createdAt)
      ON CONFLICT(name) DO UPDATE SET
        id = COALESCE(@id, id),
        email = COALESCE(@email, email),
        password = @password,
        avatar = COALESCE(@avatar, avatar),
        emailConfirmed = COALESCE(@emailConfirmed, emailConfirmed),
        confirmCode = @confirmCode,
        isAdmin = COALESCE(@isAdmin, isAdmin),
        tags = COALESCE(@tags, tags),
        createdAt = COALESCE(@createdAt, createdAt)
    `).run({
      name: account.name,
      id: account.id ?? null,
      email: account.email ?? null,
      password: account.password,
      avatar: account.avatar ?? null,
      emailConfirmed: account.emailConfirmed === undefined ? null : account.emailConfirmed ? 1 : 0,
      confirmCode: account.confirmCode ?? null,
      isAdmin: account.isAdmin === undefined ? null : account.isAdmin ? 1 : 0,
      tags: account.tags === undefined ? null : JSON.stringify(account.tags),
      createdAt: account.createdAt ?? Date.now(),
    })
  }

  setAccountConfirmation(name: string, confirmed: boolean, confirmCode?: string): void {
    this.db.prepare('UPDATE accounts SET emailConfirmed = ?, confirmCode = ? WHERE name = ?').run(
      confirmed ? 1 : 0,
      confirmCode ?? null,
      name,
    )
  }

  renameAccount(oldName: string, newAccount: Account): void {
    this.db.prepare('DELETE FROM accounts WHERE name = ?').run(oldName)
    this.saveAccount(newAccount)
  }

  deleteAccount(name: string): void {
    this.db.prepare('DELETE FROM accounts WHERE name = ?').run(name)
  }
}
