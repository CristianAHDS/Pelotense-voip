import React, { useState, useRef, useEffect } from 'react'
import { usePrivateChatStore } from '../stores/privateChatStore.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { sendPrivateMessage } from '../services/connectionService.ts'

export function PrivateChatPanel() {
  const connected = useConnectionStore((s) => s.connected)
  const activeUserId = usePrivateChatStore((s) => s.activeUserId)
  const activeUserName = usePrivateChatStore((s) => s.activeUserName)
  const messages = usePrivateChatStore((s) => activeUserId ? (s.messages[activeUserId] ?? []) : [])
  const closeChat = usePrivateChatStore((s) => s.closeChat)
  const myId = useConnectionStore((s) => s.id)
  const [text, setText] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (!connected) return null

  function handleSend() {
    if (!text.trim() || !activeUserId) return
    sendPrivateMessage(activeUserId, text.trim())
    setText('')
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (!activeUserId || !activeUserName) return null

  return (
    <div className="chat-panel chat-panel--dm">
      <div className="chat-header chat-header--dm">
        <span className="chat-header-name">@{activeUserName}</span>
        <span className="chat-header-count">{messages.length} messages</span>
        <button onClick={closeChat} className="btn-close-pchat" title="Close">&times;</button>
      </div>

      <div className="chat-messages">
        {messages.map((msg, i) => {
          const isSelf = msg.fromUserId === myId
          return (
            <div key={i} className={`chat-row ${isSelf ? 'chat-row--self' : ''}`}>
              <div className={`chat-bubble chat-bubble--dm ${isSelf ? 'chat-bubble--self' : ''}`}>
                <div className="chat-bubble-text">{msg.text}</div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <div className="chat-footer chat-footer--dm">
        <div className="chat-input-wrap">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message @${activeUserName}`}
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
