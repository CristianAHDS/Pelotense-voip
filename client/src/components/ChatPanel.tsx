import React, { useState, useRef, useEffect } from 'react'
import { useRoomStore } from '../stores/roomStore.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { sendChatMessage } from '../services/connectionService.ts'
import type { ChatMsg } from '../types/index.ts'

const COLORS = [
  '#0984e3', '#e17055', '#00b894', '#fdcb6e', '#6c5ce7',
  '#e84393', '#55efc4', '#fab1a0', '#74b9ff', '#a29bfe',
]

function userColor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash) + userId.charCodeAt(i)
    hash |= 0
  }
  return COLORS[Math.abs(hash) % COLORS.length]
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function ChatPanel() {
  const messages = useRoomStore((s) => s.messages)
  const currentRoomName = useRoomStore((s) => s.currentRoomName)
  const myId = useConnectionStore((s) => s.id)
  const connected = useConnectionStore((s) => s.connected)
  const [text, setText] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function handleSend() {
    if (!text.trim()) return
    sendChatMessage(text.trim())
    setText('')
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (!connected || !currentRoomName) return null

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span className="chat-header-name">#{currentRoomName}</span>
        <span className="chat-header-count">{messages.length} messages</span>
      </div>

      <div className="chat-messages">
        {messages.map((msg, i) => {
          const isSelf = msg.userId === myId
          const color = userColor(msg.userId)
          return (
            <ChatBubble
              key={i}
              msg={msg}
              isSelf={isSelf}
              avatarColor={color}
              showAvatar={i === 0 || messages[i - 1].userId !== msg.userId}
            />
          )
        })}
        <div ref={bottomRef} />
      </div>

      <div className="chat-footer">
        <div className="chat-input-wrap">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message #general"
            className="chat-input"
          />
          <button
            onClick={handleSend}
            className="chat-send-btn"
            disabled={!text.trim()}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

function ChatBubble({ msg, isSelf, avatarColor, showAvatar }: {
  msg: ChatMsg
  isSelf: boolean
  avatarColor: string
  showAvatar: boolean
}) {
  return (
    <div className={`chat-row ${isSelf ? 'chat-row--self' : ''}`}>
      {showAvatar && !isSelf && (
        <div className="chat-avatar" style={{ background: avatarColor }}>
          {msg.userName.charAt(0).toUpperCase()}
        </div>
      )}
      {!showAvatar && !isSelf && <div className="chat-avatar-spacer" />}
      <div className={`chat-bubble ${isSelf ? 'chat-bubble--self' : ''}`}>
        {!isSelf && (
          <div className="chat-bubble-author" style={{ color: avatarColor }}>
            {msg.userName}
          </div>
        )}
        <div className="chat-bubble-text">{msg.text}</div>
        <div className="chat-bubble-time">{formatTime(msg.timestamp)}</div>
      </div>
    </div>
  )
}
