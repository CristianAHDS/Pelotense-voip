import React, { useState, useRef, useEffect, useMemo } from 'react'
import { useRoomStore } from '../stores/roomStore.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { sendChatMessage } from '../services/connectionService.ts'

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

  if (!connected || !currentRoomName) return null

  return (
    <div className="panel chat-panel">
      <h2>Chat - {currentRoomName}</h2>
      <div className="chat-messages">
        {messages.map((msg, i) => {
          const isSelf = msg.userId === myId
          const color = userColor(msg.userId)
          return (
            <div key={i} className={`chat-message ${isSelf ? 'chat-message--self' : ''}`}>
              <div className="chat-avatar" style={{ background: color }}>
                {msg.userName.charAt(0).toUpperCase()}
              </div>
              <div className="chat-body">
                <span className="chat-username" style={{ color }}>{msg.userName}</span>
                <span className="chat-text">{msg.text}</span>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
      <div className="chat-input-row">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Type a message..."
          className="input"
        />
        <button onClick={handleSend} className="btn btn-send" disabled={!text.trim()}>
          Send
        </button>
      </div>
    </div>
  )
}
