import React, { useState, useEffect } from 'react'
import { useAccountStore } from '../stores/accountStore.ts'
import { useRoomStore } from '../stores/roomStore.ts'
import { requestAccounts, sendAdminUpdateAccount } from '../services/connectionService.ts'
import { Avatar } from '../ui/Avatar.tsx'
import { MASTER_USER_ID, USER_TAGS, tagColor } from '../ui/admin.ts'
import { useT } from '../i18n/index.ts'

type AdminTab = 'users' | 'system'

interface EditState {
  account: { id?: string; name: string; email?: string; avatar?: string; admin?: boolean; tags?: string[] }
  name: string
  email: string
  password: string
  error: string
}

function AdminUserEdit({ account, onBack }: { account: { id?: string; name: string; email?: string; avatar?: string; admin?: boolean; tags?: string[] }; onBack: () => void }) {
  const t = useT()
  const [name, setName] = useState(account.name)
  const [email, setEmail] = useState(account.email ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isAdmin, setIsAdmin] = useState(!!account.admin)
  const [tags, setTags] = useState<string[]>(account.tags ?? [])
  const isMaster = account.id === MASTER_USER_ID

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

  function handleToggleAdmin() {
    setIsAdmin((prev) => !prev)
  }

  function toggleTag(tag: string) {
    setTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }

  return (
    <div className="admin-user-edit">
      <div className="admin-user-edit-header">
        <button type="button" className="btn btn-cancel" onClick={onBack}>
          ← {t('backButton')}
        </button>
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
            {isMaster && <span className="user-admin-badge user-admin-badge--master">Master</span>}
          </span>
          <span className="admin-user-edit-admin-hint">
            {isMaster ? t('masterUserHint') : isAdmin ? t('adminRoleActive') : t('adminRoleInactive')}
          </span>
        </div>
        <button
          type="button"
          className={`btn ${isAdmin ? 'btn-admin-remove' : 'btn-admin-add'}`}
          onClick={handleToggleAdmin}
          disabled={isMaster}
          title={isMaster ? t('masterUserHint') : undefined}
        >
          {isAdmin ? t('removeAdmin') : t('makeAdmin')}
        </button>
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
                onClick={() => toggleTag(tag)}
                aria-pressed={selected}
                style={selected ? { borderColor: tagColor(tag), color: tagColor(tag) } : undefined}
              >
                {tag}
              </button>
            )
          })}
        </div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="au-name">{t('registerName')}</label>
        <input
          id="au-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input"
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="au-email">{t('email')}</label>
        <input
          id="au-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('emailPlaceholder')}
          className="input"
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="au-password">{t('loginPasswordPlaceholder')}</label>
        <input
          id="au-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          className="input"
        />
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
  const accounts = useRoomStore((s) => s.accounts)

  const [tab, setTab] = useState<AdminTab>('users')
  const [editing, setEditing] = useState<EditState | null>(null)

  useEffect(() => {
    if (open) {
      requestAccounts()
      setEditing(null)
    }
  }, [open])

  if (!open) return null

  const tabs: Array<{ id: AdminTab; label: string }> = [
    { id: 'users', label: t('adminUsers') },
    { id: 'system', label: t('adminSystem') },
  ]

  const online = accounts.filter((a) => a.online)
  const offline = accounts.filter((a) => !a.online)

  function openEdit(account: { id?: string; name: string; email?: string; avatar?: string; admin?: boolean; tags?: string[] }) {
    setEditing({ account, name: account.name, email: account.email ?? '', password: '', error: '' })
  }

  return (
    <div className="modal-overlay" onClick={closeAdmin}>
      <div
        className="account-prefs-modal admin-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('adminPanel')}
        onClick={(e) => e.stopPropagation()}
      >
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
          {tab === 'users' && (
            editing ? (
              <AdminUserEdit account={editing.account} onBack={() => setEditing(null)} />
            ) : (
              <>
                <div className="admin-panel-actions">
                  <button type="button" className="btn" onClick={requestAccounts}>
                    {t('refresh')}
                  </button>
                </div>

                <div className="user-list-section">
                  <h4 className="user-list-section-title">
                    <span className="section-status-dot section-status-dot--online" aria-hidden="true" />
                    <span>{t('onlineUsers', { n: online.length })}</span>
                  </h4>
                  {online.length > 0 ? (
                    <div className="user-list-items">
                      {online.map((a) => (
                        <div key={a.id ?? a.name} className="user-item user-item--clickable" role="button" tabIndex={0} onClick={() => openEdit(a)} onKeyDown={(e) => e.key === 'Enter' && openEdit(a)}>
                          <Avatar id={a.id ?? a.name} name={a.name} avatar={a.avatar} />
                          <span className="user-name">
                            {a.name}
                            {a.admin && (
                              <span className={`user-admin-badge ${a.id === MASTER_USER_ID ? 'user-admin-badge--master' : ''}`} title={a.id === MASTER_USER_ID ? 'Master Admin' : 'Admin'}>
                                {a.id === MASTER_USER_ID ? 'Master' : 'Admin'}
                              </span>
                            )}
                            {a.tags?.map((tag) => (
                              <span key={tag} className="user-tag" style={{ background: tagColor(tag), borderColor: tagColor(tag) }}>{tag}</span>
                            ))}
                          </span>
                          <span className="admin-user-online-dot" title={t('online')} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state empty-state--compact">
                      <span className="empty-state-title">{t('noUsers')}</span>
                    </div>
                  )}
                </div>

                <div className="user-list-section">
                  <h4 className="user-list-section-title">
                    <span className="section-status-dot section-status-dot--offline" aria-hidden="true" />
                    <span>{t('offlineUsers', { n: offline.length })}</span>
                  </h4>
                  {offline.length > 0 ? (
                    <div className="user-list-items">
                      {offline.map((a) => (
                        <div key={a.id ?? a.name} className="user-item user-item--offline user-item--clickable" role="button" tabIndex={0} onClick={() => openEdit(a)} onKeyDown={(e) => e.key === 'Enter' && openEdit(a)}>
                          <Avatar id={a.id ?? a.name} name={a.name} avatar={a.avatar} />
                          <span className="user-name">
                            {a.name}
                            {a.admin && (
                              <span className={`user-admin-badge ${a.id === MASTER_USER_ID ? 'user-admin-badge--master' : ''}`} title={a.id === MASTER_USER_ID ? 'Master Admin' : 'Admin'}>
                                {a.id === MASTER_USER_ID ? 'Master' : 'Admin'}
                              </span>
                            )}
                            {a.tags?.map((tag) => (
                              <span key={tag} className="user-tag" style={{ background: tagColor(tag), borderColor: tagColor(tag) }}>{tag}</span>
                            ))}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state empty-state--compact">
                      <span className="empty-state-title">{t('noUsers')}</span>
                    </div>
                  )}
                </div>
              </>
            )
          )}
          {tab === 'system' && (
            <div className="empty-state">
              <span className="empty-state-icon">⚙️</span>
              <span className="empty-state-title">{t('systemConfigSoon')}</span>
              <span className="empty-state-hint">{t('systemConfigHint')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
