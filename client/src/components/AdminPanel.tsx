import React, { useState, useEffect, useRef } from 'react'
import { useAccountStore } from '../stores/accountStore.ts'
import { useRoomStore } from '../stores/roomStore.ts'
import { useAdminStore } from '../stores/adminStore.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { requestAccounts, sendAdminUpdateAccount } from '../services/connectionService.ts'
import { Avatar } from '../ui/Avatar.tsx'
import { isMasterUser, USER_TAGS, tagColor, tagLabel } from '../ui/admin.ts'
import { useT, tStatic } from '../i18n/index.ts'

type AdminTab = 'dashboard' | 'users' | 'rooms' | 'system'

interface EditState {
  account: { id?: string; name: string; email?: string; avatar?: string; admin?: boolean; tags?: string[] }
  name: string
  email: string
  password: string
  error: string
}

const LIMIT_LABELS: Record<string, string> = {
  maxUsers: 'adminMaxUsers',
  maxRooms: 'adminMaxRooms',
  maxNameLength: 'adminNameChars',
  maxPasswordLength: 'adminPasswordChars',
  maxRoomNameLength: 'adminRoomNameChars',
  maxTextLength: 'adminTextChars',
  maxAudioMessageBytes: 'adminAudioBytes',
  maxVideoMessageBytes: 'adminVideoBytes',
  maxImageMessageBytes: 'adminImageBytes',
  maxLiveChunkBytes: 'adminLiveChunkBytes',
  maxVoiceFrameBytes: 'adminVoiceFrameBytes',
  maxAvatarBytes: 'adminAvatarBytes',
}

function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${s % 60}s`
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString()
}

function ConfirmDialog({ title, text, onConfirm, onClose }: { title: string; text: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <div className="admin-confirm-overlay" onClick={onClose}>
      <div className="admin-confirm" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h4 className="admin-confirm-title">{title}</h4>
        <p className="admin-confirm-text">{text}</p>
        <div className="admin-confirm-actions">
          <button type="button" className="btn btn-cancel" onClick={onClose}>{tStatic('cancel')}</button>
          <button type="button" className="btn btn-danger" onClick={() => { onConfirm(); onClose() }}>{tStatic('confirm')}</button>
        </div>
      </div>
    </div>
  )
}

// ---------- Dashboard (A1/A19/A14/A15/A16) ----------
function AdminDashboard() {
  const t = useT()
  const store = useAdminStore()
  const m = store.metrics
  const d = store.diagnostics
  const [announce, setAnnounce] = useState('')
  const [maintenanceMsg, setMaintenanceMsg] = useState('')

  const metric = (label: string, value: string | number, sub?: string) => (
    <div className="admin-metric">
      <span className="admin-metric-value">{value}</span>
      <span className="admin-metric-label">{label}</span>
      {sub && <span className="admin-metric-sub">{sub}</span>}
    </div>
  )

  return (
    <div className="admin-dashboard">
      <div className="admin-metrics-grid">
        {metric(t('onlineUsers').replace(' ({n})', ''), m ? `${m.usersOnline}/${m.maxUsers}` : '—')}
        {metric(t('roomsLabel'), m ? `${m.rooms}/${m.maxRooms}` : '—')}
        {metric(t('live'), m ? m.liveCount : '—')}
        {metric(t('adminMessagesToday'), m ? m.messagesToday : '—')}
        {metric(t('adminAccounts'), m ? m.accounts : '—')}
        {metric(t('adminUptime'), m ? fmtDuration(m.uptimeSeconds) : '—')}
        {metric(t('adminMemory'), m ? `${m.memoryMB} MB` : '—')}
        {metric(t('adminMessages'), m ? m.messages : '—')}
      </div>

      <div className="admin-section">
        <div className="admin-section-head">
          <h4 className="admin-section-title">{t('adminMaintenance')}</h4>
          <span className={`admin-badge ${m?.maintenance ? 'admin-badge--warn' : ''}`}>
            {m?.maintenance ? t('adminMaintenanceOn') : t('adminMaintenanceOff')}
          </span>
        </div>
        <div className="admin-row">
          <input
            type="text"
            className="input"
            value={maintenanceMsg}
            placeholder={t('adminMaintenanceMsg')}
            onChange={(e) => setMaintenanceMsg(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => store.run('maintenance', { enabled: !m?.maintenance, message: maintenanceMsg })}
          >
            {m?.maintenance ? t('adminDisable') : t('adminEnable')}
          </button>
        </div>
      </div>

      <div className="admin-section">
        <h4 className="admin-section-title">{t('adminAnnounce')}</h4>
        <div className="admin-row">
          <input
            type="text"
            className="input"
            value={announce}
            placeholder={t('adminAnnouncePlaceholder')}
            onChange={(e) => setAnnounce(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && announce.trim()) {
                store.run('announce', { text: announce.trim() })
                setAnnounce('')
              }
            }}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={!announce.trim()}
            onClick={() => { store.run('announce', { text: announce.trim() }); setAnnounce('') }}
          >
            {t('adminSend')}
          </button>
        </div>
      </div>

      <div className="admin-section">
        <h4 className="admin-section-title">{t('adminRadio')}</h4>
        <div className="admin-row">
          <button type="button" className="btn" onClick={() => store.run('radio', { action: 'pause' })}>{t('audioPause')}</button>
          <button type="button" className="btn btn-primary" onClick={() => store.run('radio', { action: 'play' })}>{t('audioPlay')}</button>
        </div>
      </div>

      {d && (
        <div className="admin-section">
          <h4 className="admin-section-title">{t('adminDiagnostics')}</h4>
          <div className="admin-diagnostics-grid">
            <span>{t('adminUptime')}: <strong>{fmtDuration(d.uptimeSeconds)}</strong></span>
            <span>{t('diagRss')}: <strong>{d.memoryMB} MB</strong></span>
            <span>{t('diagHeap')}: <strong>{d.heapMB} MB</strong></span>
            <span>{t('diagClients')}: <strong>{d.clients}</strong></span>
            <span>{t('diagRooms')}: <strong>{d.rooms}</strong></span>
            <span>{t('live')}: <strong>{d.liveCount}</strong></span>
            <span>{t('diagPending')}: <strong>{d.pendingConnections}</strong></span>
          </div>
        </div>
      )}

      <button type="button" className="btn" onClick={() => store.run('diagnostics')}>{t('refresh')}</button>
    </div>
  )
}

// ---------- Usuários (A2/A3/A4/A6/A10/A11/A12) ----------
function AdminUsers({ onEdit }: { onEdit: (a: EditState['account']) => void }) {
  const t = useT()
  const accounts = useRoomStore((s) => s.accounts)
  const store = useAdminStore()
  const bans = store.bans
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'online' | 'offline' | 'admin'>('all')
  const [confirmBan, setConfirmBan] = useState<{ name: string; email?: string } | null>(null)
  const [banReason, setBanReason] = useState('')

  const q = query.trim().toLowerCase()
  const isGuest = (name: string) => name.toLowerCase().startsWith('guest')
  const filtered = accounts.filter((a) => {
    if (isGuest(a.name)) return false
    if (filter === 'online' && !a.online) return false
    if (filter === 'offline' && a.online) return false
    if (filter === 'admin' && !a.admin) return false
    if (q && !a.name.toLowerCase().includes(q) && !(a.email ?? '').toLowerCase().includes(q) && !(a.tags ?? []).some((tag) => tag.toLowerCase().includes(q))) return false
    return true
  })

  const online = filtered.filter((a) => a.online)
  const offline = filtered.filter((a) => !a.online)

  function exportCsv() {
    const rows = [
      [t('csvName'), t('csvEmail'), t('csvTags'), t('csvAdmin'), t('csvOnline')].join(','),
      ...filtered.map((a) => [a.name, a.email ?? '', (a.tags ?? []).join('|'), a.admin ? t('csvYes') : t('csvNo'), a.online ? t('csvYes') : t('csvNo')].join(',')),
    ]
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'usuarios.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function renderUser(a: { id?: string; name: string; email?: string; avatar?: string; admin?: boolean; tags?: string[]; online?: boolean }, withActions: boolean) {
    const isOnline = a.online === true
    return (
      <div key={a.id ?? a.name} className="admin-user-row">
        <div className="admin-user-main" role="button" tabIndex={0} onClick={() => onEdit(a)} onKeyDown={(e) => e.key === 'Enter' && onEdit(a)}>
          <span className={`admin-user-avatar-wrap${isOnline ? ' admin-user-avatar-wrap--online' : ''}`}>
            <Avatar id={a.id ?? a.name} name={a.name} avatar={a.avatar} />
          </span>
          <span className="user-name">
            {a.name}
            {a.admin && (
              <span className={`user-admin-badge ${isMasterUser(a) ? 'user-admin-badge--master' : ''}`}>
                {isMasterUser(a) ? t('adminMaster') : t('adminBadge')}
              </span>
            )}
            {a.tags?.map((tag) => (
              <span key={tag} className="user-tag" style={{ background: tagColor(tag), borderColor: tagColor(tag) }}>{tagLabel(tag, t)}</span>
            ))}
          </span>
          <span
            className={`admin-user-status-dot ${isOnline ? 'admin-user-status-dot--online' : 'admin-user-status-dot--offline'}`}
            title={isOnline ? t('online') : t('offline')}
          />
        </div>
        {withActions && (
          <div className="admin-user-actions">
            <button type="button" className="admin-icon-btn" title={t('adminRestrictions')} onClick={() => onEdit(a)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            <button type="button" className="admin-icon-btn" title={t('adminKick')} onClick={() => store.run('kick', { name: a.name })}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
            <button type="button" className="admin-icon-btn admin-icon-btn--danger" title={t('adminBan')} onClick={() => setConfirmBan({ name: a.name, email: a.email })}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
              </svg>
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="admin-users">
      <div className="admin-panel-actions">
        <input
          type="text"
          className="input"
          value={query}
          placeholder={t('adminSearch')}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="input admin-filter-select" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="all">{t('adminAll')}</option>
          <option value="online">{t('online')}</option>
          <option value="offline">{t('offline')}</option>
          <option value="admin">{t('adminRole')}</option>
        </select>
        <button type="button" className="btn" onClick={requestAccounts}>{t('refresh')}</button>
        <button type="button" className="btn" onClick={exportCsv}>CSV</button>
      </div>

      {bans && bans.length > 0 && (
        <div className="admin-section">
          <h4 className="admin-section-title">{t('adminBanned')} ({bans.length})</h4>
          <div className="admin-bans-list">
            {bans.map((b, i) => (
              <div key={i} className="admin-ban-row">
                <span className="admin-ban-name">{b.name || b.email}</span>
                {b.reason && <span className="admin-ban-reason">{b.reason}</span>}
                <button type="button" className="btn btn-sm" onClick={() => store.run('unban', { value: b.name || b.email })}>{t('adminUnban')}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="user-list-section">
        <h4 className="user-list-section-title">
          <span className="section-status-dot section-status-dot--online" aria-hidden="true" />
          <span>{t('onlineUsers', { n: online.length })}</span>
        </h4>
        {online.length > 0 ? <div className="user-list-items">{online.map((a) => renderUser(a, true))}</div> : <div className="empty-state empty-state--compact"><span className="empty-state-title">{t('noUsers')}</span></div>}
      </div>

      <div className="user-list-section">
        <h4 className="user-list-section-title">
          <span className="section-status-dot section-status-dot--offline" aria-hidden="true" />
          <span>{t('offlineUsers', { n: offline.length })}</span>
        </h4>
        {offline.length > 0 ? <div className="user-list-items">{offline.map((a) => renderUser(a, false))}</div> : <div className="empty-state empty-state--compact"><span className="empty-state-title">{t('noUsers')}</span></div>}
      </div>

      {confirmBan && (
        <ConfirmDialog
          title={t('adminBan')}
          text={t('adminBanConfirm', { name: confirmBan.name })}
          onClose={() => setConfirmBan(null)}
          onConfirm={() => {
            store.run('ban', { name: confirmBan.name, email: confirmBan.email, reason: banReason })
            setBanReason('')
          }}
        />
      )}
    </div>
  )
}

// ---------- Salas (A9) ----------
function AdminRooms() {
  const t = useT()
  const store = useAdminStore()
  const rooms = store.rooms
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)

  if (!rooms) {
    return <div className="empty-state"><span className="empty-state-title">{t('loadingRooms')}</span></div>
  }

  return (
    <div className="admin-rooms">
      <div className="admin-panel-actions">
        <button type="button" className="btn" onClick={() => store.run('rooms')}>{t('refresh')}</button>
      </div>
      <div className="admin-rooms-list">
        {rooms.map((r) => (
          <div key={r.id} className={`admin-room-row${r.fixed ? ' admin-room-row--fixed' : ''}${r.live ? ' admin-room-row--live' : ''}`}>
            <span className={`admin-room-avatar ${r.featured !== undefined ? `admin-room-avatar--f${r.featured}` : ''}`} aria-hidden="true">
              {r.live ? '📡' : r.fixed ? '📻' : '#'}
            </span>
            <div className="admin-room-info">
              <span className="admin-room-name">
                {r.name}
                {r.fixed && <span className="admin-room-fixed">{t('adminFixed')}</span>}
                {r.featured !== undefined && <span className="admin-room-featured">★{r.featured}</span>}
                {r.live && <span className="admin-room-live">{t('liveBadge')}</span>}
              </span>
              <span className="admin-room-meta">
                <span className="admin-room-stat">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                  {r.users}
                </span>
                <span className="admin-room-stat">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  {r.messages}
                </span>
                {r.occupants.length > 0 && (
                  <span className="admin-room-occupants" title={r.occupants.join(', ')}>
                    {r.occupants.slice(0, 4).map((occ) => (
                      <Avatar key={occ} id={occ} name={occ} maxInitials={1} className="admin-room-occupant-avatar" />
                    ))}
                    {r.occupants.length > 4 && <span className="admin-room-occupants-more">+{r.occupants.length - 4}</span>}
                  </span>
                )}
              </span>
            </div>
            <div className="admin-room-actions">
              <button type="button" className="btn btn-sm" onClick={() => setRenaming({ id: r.id, name: r.name })}>{t('adminRename')}</button>
              <button type="button" className="btn btn-sm" onClick={() => store.run('room_action', { roomId: r.id, action: 'fixed', value: !r.fixed })}>
                {t(r.fixed ? 'adminUnfix' : 'adminFix')}
              </button>
              <label className="admin-room-featured-field">
                <span className="admin-room-featured-label">{t('adminFeatured')}</span>
                <select
                  className="input admin-room-featured-select"
                  value={r.featured ?? 0}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    store.run('room_action', { roomId: r.id, action: 'featured', value: v === 0 ? null : v })
                  }}
                  aria-label={t('adminFeaturedOf', { name: r.name })}
                >
                  <option value={0}>{t('adminFeatureNone')}</option>
                  <option value={1}>{t('adminFeatureGold')}</option>
                  <option value={2}>{t('adminFeatureBlue')}</option>
                  <option value={3}>{t('adminFeatureRed')}</option>
                </select>
              </label>
              <button type="button" className="btn btn-sm" onClick={() => store.run('room_action', { roomId: r.id, action: 'clear' })}>{t('adminCleanNow')}</button>
              {!r.fixed && (
                <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirmDel(r.id)}>{t('delete')}</button>
              )}
            </div>
            {renaming?.id === r.id && (
              <div className="admin-row">
                <input
                  type="text"
                  className="input"
                  value={renaming.name}
                  autoFocus
                  onChange={(e) => setRenaming({ id: r.id, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      store.run('room_action', { roomId: r.id, action: 'rename', value: renaming.name })
                      setRenaming(null)
                    }
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                />
                <button type="button" className="btn btn-sm btn-primary" onClick={() => { store.run('room_action', { roomId: r.id, action: 'rename', value: renaming.name }); setRenaming(null) }}>OK</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {confirmDel && (
        <ConfirmDialog
          title={t('deleteRoom')}
          text={t('adminDeleteRoomConfirm')}
          onClose={() => setConfirmDel(null)}
          onConfirm={() => store.run('room_action', { roomId: confirmDel, action: 'delete' })}
        />
      )}
    </div>
  )
}

// ---------- Sistema (A13/A17/A18/A5 + modo convidado) ----------
function AdminSystem() {
  const t = useT()
  const store = useAdminStore()
  const metrics = store.metrics
  const limits = store.limits
  const backup = store.backup
  const cleanup = store.cleanup
  const log = store.log
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [cleanupDays, setCleanupDays] = useState('30')
  const [confirmCleanup, setConfirmCleanup] = useState(false)

  // Qualidade de vídeo (sincroniza quando o servidor envia SettingsState).
  const connSettings = useConnectionStore((s) => s.settings)
  const [vq, setVq] = useState(() => ({
    width: connSettings.video.width,
    height: connSettings.video.height,
    fps: connSettings.video.fps,
    bitrateKbps: Math.round(connSettings.video.bitrate / 1000),
  }))
  useEffect(() => {
    setVq({
      width: connSettings.video.width,
      height: connSettings.video.height,
      fps: connSettings.video.fps,
      bitrateKbps: Math.round(connSettings.video.bitrate / 1000),
    })
  }, [connSettings.video.width, connSettings.video.height, connSettings.video.fps, connSettings.video.bitrate])
  const [removeEmpty, setRemoveEmpty] = useState(true)
  const restoreRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (limits) {
      const d: Record<string, string> = {}
      for (const k of Object.keys(limits)) d[k] = String(limits[k])
      setDraft(d)
    }
  }, [limits])

  function saveLimits() {
    for (const [k, v] of Object.entries(draft)) {
      const n = Number(v)
      if (Number.isFinite(n) && n >= 1 && limits && limits[k] !== n) {
        store.run('limit', { key: k, value: n })
      }
    }
  }

  function downloadBackup() {
    if (!backup?.base64) return
    const buf = atob(backup.base64)
    const bytes = new Uint8Array(buf.length)
    for (let i = 0; i < buf.length; i++) bytes[i] = buf.charCodeAt(i)
    const blob = new Blob([bytes], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `voip-backup-${new Date().toISOString().slice(0, 10)}.db`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleRestoreFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1] ?? ''
      if (base64) store.run('restore', { base64 })
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="admin-system">
      <div className="admin-section">
        <div className="admin-section-head">
          <h4 className="admin-section-title">{t('adminGuestMode')}</h4>
          <span className={`admin-badge ${metrics?.guestMode ? 'admin-badge--warn' : ''}`}>
            {metrics?.guestMode ? t('adminGuestOn') : t('adminGuestOff')}
          </span>
        </div>
        <div className="admin-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => store.run('guest', { enabled: !metrics?.guestMode })}
          >
            {metrics?.guestMode ? t('adminDisable') : t('adminEnable')}
          </button>
        </div>
      </div>

      <div className="admin-section">
        <h4 className="admin-section-title">{t('adminVideoQuality')}</h4>
        <span className="admin-guest-hint">{t('adminVideoQualityHint')}</span>
        <div className="admin-limits-grid">
          <label className="admin-limit-field">
            <span className="admin-limit-label">{t('adminVideoWidth')}</span>
            <input type="number" min="320" max="3840" className="input" value={vq.width} onChange={(e) => setVq({ ...vq, width: Number(e.target.value) || 0 })} />
          </label>
          <label className="admin-limit-field">
            <span className="admin-limit-label">{t('adminVideoHeight')}</span>
            <input type="number" min="240" max="2160" className="input" value={vq.height} onChange={(e) => setVq({ ...vq, height: Number(e.target.value) || 0 })} />
          </label>
          <label className="admin-limit-field">
            <span className="admin-limit-label">{t('adminVideoFps')}</span>
            <input type="number" min="15" max="60" className="input" value={vq.fps} onChange={(e) => setVq({ ...vq, fps: Number(e.target.value) || 0 })} />
          </label>
          <label className="admin-limit-field">
            <span className="admin-limit-label">{t('adminVideoBitrate')} (kbps)</span>
            <input type="number" min="200" max="20000" className="input" value={vq.bitrateKbps} onChange={(e) => setVq({ ...vq, bitrateKbps: Number(e.target.value) || 0 })} />
          </label>
        </div>
        <div className="admin-row">
          <button type="button" className="btn btn-primary" onClick={() => store.run('video_settings', { width: vq.width, height: vq.height, fps: vq.fps, bitrate: vq.bitrateKbps * 1000 })}>
            {t('save')}
          </button>
        </div>
      </div>

      <div className="admin-section">
        <h4 className="admin-section-title">{t('adminLimits')}</h4>
        <div className="admin-limits-grid">
          {limits && Object.keys(limits).map((k) => (
            <label key={k} className="admin-limit-field">
              <span className="admin-limit-label">{t(LIMIT_LABELS[k] ?? k)}</span>
              <input
                type="number"
                min="1"
                className="input"
                value={draft[k] ?? ''}
                onChange={(e) => setDraft((prev) => ({ ...prev, [k]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        <button type="button" className="btn btn-primary" onClick={saveLimits}>{t('save')}</button>
      </div>

      <div className="admin-section">
        <h4 className="admin-section-title">{t('adminBackup')}</h4>
        <div className="admin-row">
          <button type="button" className="btn btn-primary" disabled={store.pending.backup} onClick={() => store.run('backup')}>
            {store.pending.backup ? '…' : t('adminBackupCreate')}
          </button>
          {backup && (
            <button type="button" className="btn" onClick={downloadBackup}>
              {t('download')} ({Math.round(backup.size / 1024)} KB)
            </button>
          )}
          <button type="button" className="btn" onClick={() => restoreRef.current?.click()}>{t('adminRestore')}</button>
          <input ref={restoreRef} type="file" accept=".db,.sqlite" style={{ display: 'none' }} onChange={handleRestoreFile} />
        </div>
      </div>

      <div className="admin-section">
        <h4 className="admin-section-title">{t('adminCleanup')}</h4>
        <div className="admin-row">
          <label className="admin-limit-field">
            <span className="admin-limit-label">{t('adminCleanupDays')}</span>
            <input type="number" min="1" max="365" className="input" value={cleanupDays} onChange={(e) => setCleanupDays(e.target.value)} />
          </label>
          <label className="admin-check">
            <input type="checkbox" checked={removeEmpty} onChange={(e) => setRemoveEmpty(e.target.checked)} />
            <span>{t('adminCleanupEmptyRooms')}</span>
          </label>
          <button type="button" className="btn" onClick={() => store.run('cleanup')}>{t('adminEstimate')}</button>
          <button
            type="button"
            className="btn btn-danger"
            title={t('adminCleanNowHint')}
            onClick={() => setConfirmCleanup(true)}
          >
            {t('adminCleanNow')}
          </button>
        </div>
        {cleanup && (
          <div className="admin-cleanup-result">
            <p>
              {cleanup.messages} {t('adminMessages')} · {cleanup.privateMessages} {t('adminPrivateMessages')} ·{' '}
              {cleanup.emptyRooms.length} {t('adminEmptyRooms')}
              {cleanup.emptyRooms.length > 0 ? ` (${cleanup.emptyRooms.join(', ')})` : ''}
            </p>
          </div>
        )}
      </div>

      {confirmCleanup && (
        <ConfirmDialog
          title={t('adminCleanNow')}
          text={t('adminCleanNowConfirm')}
          onClose={() => setConfirmCleanup(false)}
          onConfirm={() => store.run('cleanup_apply', { days: Number(cleanupDays) || 30, emptyRooms: removeEmpty })}
        />
      )}

      <div className="admin-section">
        <h4 className="admin-section-title">{t('adminLog')}</h4>
        {log && log.length > 0 ? (
          <div className="admin-log-list">
            {log.map((entry, i) => (
              <div key={i} className="admin-log-row">
                <span className="admin-log-time">{fmtTime(entry.at)}</span>
                <span className="admin-log-by">{entry.by}</span>
                <span className="admin-log-action">{entry.action}</span>
                {entry.detail && <span className="admin-log-detail">{entry.detail}</span>}
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state empty-state--compact"><span className="empty-state-title">{t('adminNoLog')}</span></div>
        )}
      </div>
    </div>
  )
}

function AdminUserEdit({ account, onBack }: { account: EditState['account']; onBack: () => void }) {
  const t = useT()
  const store = useAdminStore()
  const [name, setName] = useState(account.name)
  const [email, setEmail] = useState(account.email ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isAdmin, setIsAdmin] = useState(!!account.admin)
  const [tags, setTags] = useState<string[]>(account.tags ?? [])
  const [mic, setMic] = useState(false)
  const [chat, setChat] = useState(false)
  const isMaster = isMasterUser(account)

  function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('nameRequired'))
      return
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(t('invalidEmail'))
      return
    }
    setError('')
    sendAdminUpdateAccount({
      userId: account.id,
      userName: account.name,
      name: trimmed,
      email: email || undefined,
      password: password || undefined,
      isAdmin,
      tags,
    })
    requestAccounts()
    onBack()
  }

  return (
    <div className="admin-user-edit">
      <div className="admin-user-edit-header">
        <button type="button" className="btn btn-cancel" onClick={onBack}>← {t('backButton')}</button>
        <h4 className="admin-user-edit-title">{t('editUser')}</h4>
      </div>

      <div className="admin-user-edit-profile">
        <Avatar id={account.id ?? account.name} name={account.name} avatar={account.avatar} className="user-avatar admin-user-edit-avatar" />
        <div className="admin-user-edit-profile-info">
          <span className="admin-user-edit-profile-name">{account.name}</span>
          <span className="admin-user-edit-profile-id">{account.id ? `ID: ${account.id}` : ''}</span>
        </div>
      </div>

      <div className="admin-user-edit-admin">
        <div className="admin-user-edit-admin-text">
          <span className="admin-user-edit-admin-label">
            {t('adminRole')}
            {isMaster && <span className="user-admin-badge user-admin-badge--master">{t('adminMaster')}</span>}
          </span>
          <span className="admin-user-edit-admin-hint">
            {isMaster ? t('masterUserHint') : isAdmin ? t('adminRoleActive') : t('adminRoleInactive')}
          </span>
        </div>
        <button
          type="button"
          className={`btn ${isAdmin ? 'btn-admin-remove' : 'btn-admin-add'}`}
          onClick={() => setIsAdmin((prev) => !prev)}
          disabled={isMaster}
          title={isMaster ? t('masterUserHint') : undefined}
        >
          {isAdmin ? t('removeAdmin') : t('makeAdmin')}
        </button>
      </div>

      <div className="admin-section">
        <h4 className="admin-section-title">{t('adminRestrictions')}</h4>
        <div className="admin-row">
          <label className="admin-check">
            <input type="checkbox" checked={mic} onChange={(e) => setMic(e.target.checked)} />
            <span>{t('adminMuteMic')}</span>
          </label>
          <label className="admin-check">
            <input type="checkbox" checked={chat} onChange={(e) => setChat(e.target.checked)} />
            <span>{t('adminMuteChat')}</span>
          </label>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => store.run('restrictions', { userId: account.id, name: account.name, mic, chat })}
          >
            {t('adminApply')}
          </button>
        </div>
        <div className="admin-row">
          <button type="button" className="btn btn-sm" onClick={() => store.run('onboarding_reset', { name: account.name })}>
            {t('adminResetOnboarding')}
          </button>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="admin-user-edit-tags">
        <span className="admin-user-edit-admin-label">{t('tags')}</span>
        <span className="admin-user-edit-admin-hint">{t('tagsHint')}</span>
        <div className="admin-tag-list">
          {USER_TAGS.map((tag) => {
            const selected = tags.includes(tag)
            return (
              <button
                key={tag}
                type="button"
                className={`admin-tag-chip ${selected ? 'admin-tag-chip--selected' : ''}`}
                onClick={() => setTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]))}
                aria-pressed={selected}
                style={selected ? { borderColor: tagColor(tag), color: tagColor(tag) } : undefined}
              >
                {tagLabel(tag, t)}
              </button>
            )
          })}
        </div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="au-name">{t('registerName')}</label>
        <input id="au-name" type="text" value={name} onChange={(e) => setName(e.target.value)} className="input" />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="au-email">{t('email')}</label>
        <input id="au-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('emailPlaceholder')} className="input" />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="au-password">{t('loginPasswordPlaceholder')}</label>
        <input id="au-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className="input" />
        <div className="form-hint">{t('passwordKeepHint')}</div>
      </div>

      <div className="account-prefs-footer admin-user-edit-footer">
        <button type="button" className="btn btn-cancel" onClick={onBack}>{t('cancel')}</button>
        <button type="button" className="btn btn-primary" onClick={handleSave}>{t('save')}</button>
      </div>
    </div>
  )
}

export function AdminPanel() {
  const t = useT()
  const open = useAccountStore((s) => s.adminOpen)
  const closeAdmin = useAccountStore((s) => s.closeAdmin)
  const store = useAdminStore()

  const [tab, setTab] = useState<AdminTab>('dashboard')
  const [editing, setEditing] = useState<EditState | null>(null)

  useEffect(() => {
    if (open) {
      requestAccounts()
      setEditing(null)
      store.refreshAll()
    }
  }, [open])

  if (!open) return null

  const tabs: Array<{ id: AdminTab; label: string }> = [
    { id: 'dashboard', label: t('adminDashboard') },
    { id: 'users', label: t('adminUsers') },
    { id: 'rooms', label: t('adminRooms') },
    { id: 'system', label: t('adminSystem') },
  ]

  return (
    <div className="modal-overlay" onClick={closeAdmin}>
      <div className="account-prefs-modal admin-modal" role="dialog" aria-modal="true" aria-label={t('adminPanel')} onClick={(e) => e.stopPropagation()}>
        <div className="account-prefs-header">
          <h3>{t('adminPanel')}</h3>
          <button className="btn-close-pchat" onClick={closeAdmin} title={t('close')}>&times;</button>
        </div>

        <div className="admin-tabs" role="tablist" aria-label={t('adminPanel')}>
          {tabs.map((tb) => (
            <button
              key={tb.id}
              role="tab"
              aria-selected={tab === tb.id}
              className={`admin-tab ${tab === tb.id ? 'admin-tab--active' : ''}`}
              onClick={() => { setTab(tb.id); setEditing(null) }}
            >
              {tb.label}
            </button>
          ))}
        </div>

        <div className="account-prefs-body">
          {tab === 'dashboard' && <AdminDashboard />}
          {tab === 'users' && (editing ? <AdminUserEdit account={editing.account} onBack={() => setEditing(null)} /> : <AdminUsers onEdit={(a) => setEditing({ account: a, name: a.name, email: a.email ?? '', password: '', error: '' })} />)}
          {tab === 'rooms' && <AdminRooms />}
          {tab === 'system' && <AdminSystem />}
        </div>
      </div>
    </div>
  )
}
