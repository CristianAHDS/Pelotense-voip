import React from 'react'
import { Avatar } from '../ui/Avatar.tsx'
import { MASTER_USER_ID, tagColor } from '../ui/admin.ts'
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
  const isMaster = user.id === MASTER_USER_ID
  const isAdmin = !!user.admin || isMaster

  return (
    <div
      className="user-info-popup"
      style={{ left, top }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
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
            {t('adminRole')}
            {isMaster && <span className="user-admin-badge user-admin-badge--master">Master</span>}
            {!isMaster && isAdmin && <span className="user-admin-badge">Admin</span>}
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
              <span key={tag} className="user-tag" style={{ background: tagColor(tag), borderColor: tagColor(tag) }}>{tag}</span>
            ))}
          </div>
        ) : (
          <span className="admin-user-edit-admin-hint">{t('noTags')}</span>
        )}
      </div>
    </div>
  )
}
