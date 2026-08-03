import React, { useEffect, useRef } from 'react'
import { Avatar } from '../ui/Avatar.tsx'
import { useRoomStore } from '../stores/roomStore.ts'
import { useLiveStore } from '../stores/liveStore.ts'
import { sendRequestLivePreview } from '../services/connectionService.ts'
import * as liveRtc from '../services/liveRtc.ts'
import { isMasterUser, tagColor, tagLabel } from '../ui/admin.ts'
import { useT } from '../i18n/index.ts'

export interface TooltipUser {
  id?: string
  name: string
  avatar?: string
  admin?: boolean
  tags?: string[]
}

export function UserInfoPopup({ user, left, top, onMouseEnter, onMouseLeave }: {
  user: TooltipUser
  left: number
  top: number
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}) {
  const t = useT()
  const isMaster = isMasterUser(user)
  const isAdmin = !!user.admin || isMaster
  const rooms = useRoomStore((s) => s.rooms)
  const currentBroadcaster = useLiveStore((s) => s.broadcasters[0])
  const isLive = !!user.id && rooms.some((r) => r.live?.userId === user.id)
  // Se o usuário já está assistindo a live desta pessoa (mesma sala), não abre
  // uma segunda conexão WebRTC — isso faria o transmissor codificar 2x e travar.
  const alreadyWatching = isLive && !!currentBroadcaster && currentBroadcaster.userId === user.id
  const videoRef = useRef<HTMLVideoElement>(null)

  // Preview da live: conecta via WebRTC ao transmissor, mesmo fora da sala.
  useEffect(() => {
    if (!isLive || !user.id) return
    const attach = (stream: MediaStream | null) => {
      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      if (stream) video.play().catch(() => {})
    }
    if (alreadyWatching) {
      // Já estamos recebendo esta live: reusa a conexão existente (sem segunda
      // codificação/stream no transmissor, que travava a live).
      const unsubscribe = liveRtc.startViewing(user.id, attach)
      return () => {
        unsubscribe()
        if (videoRef.current) videoRef.current.srcObject = null
      }
    }
    liveRtc.startPreviewViewing(user.id, attach)
    sendRequestLivePreview(user.id)
    return () => {
      liveRtc.stopPreviewViewing(user.id)
      if (videoRef.current) videoRef.current.srcObject = null
    }
  }, [isLive, user.id, alreadyWatching])

  return (
    <div
      className="user-info-popup"
      style={{ left, top }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {isLive && (
        <div className="live-preview">
          <span className="live-preview-label">🔴 {t('liveBadge')}</span>
          <video ref={videoRef} autoPlay playsInline muted className="live-preview-video" />
        </div>
      )}

      <div className="admin-user-edit-profile">
        <Avatar id={user.id ?? user.name} name={user.name} avatar={user.avatar} className="user-avatar admin-user-edit-avatar" />
        <div className="admin-user-edit-profile-info">
          <span className="admin-user-edit-profile-name">{user.name}</span>
          {user.id && <span className="admin-user-edit-profile-id">ID: {user.id}</span>}
        </div>
      </div>

      <div className="admin-user-edit-admin">
        <div className="admin-user-edit-admin-text">
          <span className="admin-user-edit-admin-label">
            {t('userType')}
            {isMaster && <span className="user-admin-badge user-admin-badge--master">{t('adminMaster')}</span>}
            {!isMaster && isAdmin && <span className="user-admin-badge">{t('adminBadge')}</span>}
          </span>
          <span className="admin-user-edit-admin-hint">
            {isMaster ? t('masterUserHint') : isAdmin ? t('adminRoleActive') : t('adminRoleInactive')}
          </span>
        </div>
      </div>

      <div className="admin-user-edit-tags admin-user-edit-tags--inline">
        <span className="admin-user-edit-admin-label admin-user-edit-tags-label">{t('tags')}</span>
        {user.tags && user.tags.length > 0 ? (
          <div className="admin-tag-list">
            {user.tags.map((tag) => (
              <span key={tag} className="user-tag" style={{ background: tagColor(tag), borderColor: tagColor(tag) }}>{tagLabel(tag, t)}</span>
            ))}
          </div>
        ) : (
          <span className="admin-user-edit-admin-hint">{t('noTags')}</span>
        )}
      </div>
    </div>
  )
}
