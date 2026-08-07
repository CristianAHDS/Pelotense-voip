import React, { useState, useRef, useEffect, useCallback } from 'react'
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

const EDITOR_SIZE = 220
const AVATAR_SIZE = 200

export function AccountPrefsModal() {
  const t = useT()
  const prefsOpen = useAccountStore((s) => s.prefsOpen)
  const savedName = useAccountStore((s) => s.name)
  const savedEmail = useAccountStore((s) => s.email)
  const savedPassword = useAccountStore((s) => s.password)
  const savedAvatar = useAccountStore((s) => s.avatar)
  const savedStatus = useAccountStore((s) => s.status)
  const savedBio = useAccountStore((s) => s.bio)
  const savePrefs = useAccountStore((s) => s.savePrefs)
  const closePrefs = useAccountStore((s) => s.closePrefs)
  const connectedName = useConnectionStore((s) => s.name)
  const myId = useConnectionStore((s) => s.id)
  const connected = useConnectionStore((s) => s.connected)

  const [name, setName] = useState(savedName)
  const [email, setEmail] = useState(savedEmail)
  const [password, setPassword] = useState(savedPassword)
  const [avatar, setAvatar] = useState(savedAvatar)
  const [status, setStatus] = useState(savedStatus)
  const [bio, setBio] = useState(savedBio)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [editSrc, setEditSrc] = useState<string | null>(null)
  const [editImage, setEditImage] = useState<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (prefsOpen) {
      setName(savedName || connectedName || '')
      setEmail(savedEmail)
      setPassword(savedPassword)
      setAvatar(savedAvatar)
      setStatus(savedStatus)
      setBio(savedBio)
      setError('')
      setEditSrc(null)
      setEditImage(null)
    }
  }, [prefsOpen, savedName, savedEmail, savedPassword, savedAvatar, savedStatus, savedBio, connectedName])

  useEffect(() => {
    if (!editImage || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = EDITOR_SIZE
    canvas.height = EDITOR_SIZE

    const iw = editImage.naturalWidth
    const ih = editImage.naturalHeight
    const scale = Math.max(AVATAR_SIZE / iw, AVATAR_SIZE / ih) * zoom
    const sw = iw * scale
    const sh = ih * scale
    const sx = (EDITOR_SIZE - AVATAR_SIZE) / 2 + pos.x
    const sy = (EDITOR_SIZE - AVATAR_SIZE) / 2 + pos.y
    const dx = (EDITOR_SIZE - sw) / 2 + pos.x
    const dy = (EDITOR_SIZE - sh) / 2 + pos.y

    ctx.clearRect(0, 0, EDITOR_SIZE, EDITOR_SIZE)

    ctx.save()
    ctx.beginPath()
    ctx.arc(EDITOR_SIZE / 2, EDITOR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(editImage, dx, dy, sw, sh)
    ctx.restore()

    ctx.beginPath()
    ctx.arc(EDITOR_SIZE / 2, EDITOR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    ctx.lineWidth = 2
    ctx.stroke()

    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.beginPath()
    ctx.rect(0, 0, EDITOR_SIZE, EDITOR_SIZE)
    ctx.arc(EDITOR_SIZE / 2, EDITOR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2, true)
    ctx.fill()
  }, [editImage, zoom, pos])

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    setDragging(true)
    setDragStart({ x: e.clientX - pos.x, y: e.clientY - pos.y })
  }, [pos])

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return
    setPos({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y })
  }, [dragging, dragStart])

  const handleCanvasMouseUp = useCallback(() => {
    setDragging(false)
  }, [])

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
      const img = new Image()
      img.onload = () => {
        setEditSrc(dataUrl)
        setEditImage(img)
        setZoom(1)
        setPos({ x: 0, y: 0 })
        setError('')
      }
      img.src = dataUrl
    } catch {
      setError(t('imageUnreadable'))
    }
  }

  function handleCropConfirm() {
    if (!canvasRef.current) return
    const canvas = document.createElement('canvas')
    canvas.width = AVATAR_SIZE
    canvas.height = AVATAR_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.beginPath()
    ctx.arc(AVATAR_SIZE / 2, AVATAR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2)
    ctx.clip()

    const srcX = (EDITOR_SIZE - AVATAR_SIZE) / 2 - pos.x
    const srcY = (EDITOR_SIZE - AVATAR_SIZE) / 2 - pos.y
    ctx.drawImage(
      canvasRef.current,
      srcX, srcY, AVATAR_SIZE, AVATAR_SIZE,
      0, 0, AVATAR_SIZE, AVATAR_SIZE
    )

    setAvatar(canvas.toDataURL('image/jpeg', 0.85))
    setEditSrc(null)
    setEditImage(null)
  }

  function handleCropCancel() {
    setEditSrc(null)
    setEditImage(null)
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
    savePrefs({ name: trimmed, email, password, avatar, status, bio })
    if (connected) {
      sendUpdateProfile({ name: trimmed, email: email || undefined, password, avatar: avatar || undefined, status: status || undefined, bio: bio || undefined })
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

        {editSrc ? (
          <div className="avatar-editor">
            <canvas
              ref={canvasRef}
              className="avatar-editor-canvas"
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={handleCanvasMouseUp}
              style={{ cursor: dragging ? 'grabbing' : 'grab' }}
            />
            <div className="avatar-editor-controls">
              <label className="avatar-editor-label">{t('avatarZoom')}</label>
              <input
                type="range"
                min="1"
                max="3"
                step="0.05"
                value={zoom}
                onChange={(e) => setZoom(parseFloat(e.target.value))}
                className="avatar-editor-slider"
              />
            </div>
            <div className="avatar-editor-actions">
              <button className="btn btn-cancel" onClick={handleCropCancel}>{t('cancel')}</button>
              <button className="btn btn-primary" onClick={handleCropConfirm}>{t('avatarConfirm')}</button>
            </div>
          </div>
        ) : (
          <>
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

              <div className="field">
                <label className="field-label" htmlFor="acc-status">{t('profileStatus')}</label>
                <select
                  id="acc-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="input"
                >
                  <option value="">{t('statusNone')}</option>
                  <option value={t('statusAvailable')}>🟢 {t('statusAvailable')}</option>
                  <option value={t('statusBusy')}>🟡 {t('statusBusy')}</option>
                  <option value={t('statusAway')}>🔴 {t('statusAway')}</option>
                </select>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="acc-bio">{t('profileBio')}</label>
                <textarea
                  id="acc-bio"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder={t('profileBioPlaceholder')}
                  maxLength={200}
                  className="input account-prefs-bio"
                  rows={3}
                />
              </div>
            </div>

            <div className="account-prefs-footer">
              <button type="button" className="btn btn-cancel" onClick={closePrefs}>{t('cancel')}</button>
              <button type="button" className="btn btn-primary" onClick={handleSave}>{t('save')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
