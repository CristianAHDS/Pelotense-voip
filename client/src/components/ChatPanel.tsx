import React, { useState, useRef, useEffect } from 'react'
import { useRoomStore } from '../stores/roomStore.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { sendChatMessage } from '../services/connectionService.ts'

export function ChatPanel() {
  const messages = useRoomStore((s) => s.messages)
  const currentRoomName = useRoomStore((s) => s.currentRoomName)
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
        {messages.map((msg, i) => (
          <div key={i} className="chat-message">
            <div className="chat-avatar" />
            <div className="chat-body">
              <span className="chat-username">{msg.userName}</span>
              <span className="chat-text">{msg.text}</span>
            </div>
          </div>
        ))}
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
