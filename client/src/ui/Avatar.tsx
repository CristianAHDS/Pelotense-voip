import React from 'react'
import { userColor, initials } from './avatar.ts'

export function Avatar({ id, name, avatar, maxInitials = 2, className }: {
  id: string
  name: string
  avatar?: string
  maxInitials?: number
  className?: string
}) {
  const cls = className ?? 'user-avatar'
  if (avatar) {
    return (
      <span
        className={`${cls} user-avatar--img`}
        style={{ background: 'transparent' }}
        title={name}
      >
        <img src={avatar} alt={name} className="user-avatar-img" />
      </span>
    )
  }
  return (
    <span className={cls} style={{ background: userColor(id) }} title={name}>
      {initials(name, maxInitials)}
    </span>
  )
}
