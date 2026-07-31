import React, { useState, useRef, useEffect } from 'react'
import { useAccountStore } from '../stores/accountStore.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { Avatar } from '../ui/Avatar.tsx'
import { sendUpdateProfile } from '../services/connectionService.ts'
import { useT } from '../i18n/index.ts'

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function AccountPrefsModal() {
  const t = useT()
  const prefsOpen = useAccountStore((s) => s.prefsOpen)
  const savedName = useAccountStore((s) => s.name)
  const savedEmail = useAccountStore((s) => s.email)
  const savedPassword = useAccountStore((s) => s.password)
  const savedAvatar = useAccountStore((s) => s.avatar)
  const savePrefs = useAccountStore((s) => s.savePrefs)
  const closePrefs = useAccountStore((s) => s.closePrefs)
  const connectedName = useConnectionStore((s) => s.name)
  const myId = useConnectionStore((s) => s.id)
  const connected = useConnectionStore((s) => s.connected)

  const [name, setName] = useState(savedName)
  const [email, setEmail] = useState(savedEmail)
  const [password, setPassword] = useState(savedPassword)
  const [avatar, setAvatar] = useState(savedAvatar)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (prefsOpen) {
      setName(savedName || connectedName || '')
      setEmail(savedEmail)
      setPassword(savedPassword)
      setAvatar(savedAvatar)
      setError('')
    }
  }, [prefsOpen, savedName, savedEmail, savedPassword, savedAvatar, connectedName])

  if (!prefsOpen) return null

  async function handleFile(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError(t('avatarInvalid'))
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setError(t('avatarTooLarge'))
      return
    }
    try {
      const dataUrl = await readFileAsDataUrl(file)
      setAvatar(dataUrl)
      setError('')
    } catch {
      setError(t('imageUnreadable'))
    }
  }

  function handleSave() {
    if (!name.trim()) {
      setError(t('avatarNameRequired'))
      return
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(t('invalidEmail'))
      return
    }
    const trimmed = name.trim()
    savePrefs({ name: trimmed, email, password, avatar })
    if (connected) {
      sendUpdateProfile({ name: trimmed, email: email || undefined, password, avatar: avatar || undefined })
    }
    closePrefs()
  }

  return (
    <div className="modal-overlay" onClick={closePrefs}>
      <div
        className="account-prefs-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('accountPrefs')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="account-prefs-header">
          <h3>{t('accountPrefs')}</h3>
          <button className="btn-close-pchat" onClick={closePrefs} title={t('close')}>&times;</button>
        </div>

        <div className="account-prefs-body">
          <div className="account-prefs-avatar-row">
            <Avatar id={myId ?? name} name={name} avatar={avatar} className="user-avatar account-prefs-avatar" />
            <div className="account-prefs-avatar-actions">
              <button
                type="button"
                className="btn"
                onClick={() => fileInputRef.current?.click()}
              >
                {t('avatarUpload')}
              </button>
              {avatar && (
                <button
                  type="button"
                  className="btn btn-avatar-remove"
                  onClick={() => setAvatar('')}
                >
                  {t('avatarRemove')}
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </div>
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="field">
            <label className="field-label" htmlFor="acc-name">{t('avatarName')}</label>
            <input
              id="acc-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="acc-email">{t('email')}</label>
            <input
              id="acc-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('emailPlaceholder')}
              className="input"
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="acc-password">{t('avatarPassword')}</label>
            <input
              id="acc-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
            />
          </div>
        </div>

        <div className="account-prefs-footer">
          <button type="button" className="btn btn-cancel" onClick={closePrefs}>{t('cancel')}</button>
          <button type="button" className="btn btn-primary" onClick={handleSave}>{t('save')}</button>
        </div>
      </div>
    </div>
  )
}
