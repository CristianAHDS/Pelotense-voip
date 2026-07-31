import React, { useState, useRef, useEffect } from 'react'
import { PrivateChatMsg } from '../types/index.ts'
import { usePrivateChatStore } from '../stores/privateChatStore.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { sendPrivateMessage, sendPrivateAudioMessage, sendPrivateVideoMessage } from '../services/connectionService.ts'
import { useMediaRecorder } from '../hooks/useMediaRecorder.ts'
import { userColor, initials } from '../ui/avatar.ts'

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function DmMediaBubble({ msg }: { msg: PrivateChatMsg }) {
  if (msg.audioData) {
    const src = `data:audio/webm;base64,${msg.audioData}`
    return (
      <div className="chat-bubble-text">
        <audio controls src={src} className="dm-audio" />
        {msg.duration ? <div className="dm-media-duration">{msg.duration}s</div> : null}
      </div>
    )
  }
  if (msg.videoData) {
    const src = `data:video/webm;base64,${msg.videoData}`
    return (
      <div className="chat-bubble-text">
        <video controls src={src} className="dm-video" />
        {msg.duration ? <div className="dm-media-duration">{msg.duration}s</div> : null}
      </div>
    )
  }
  return <div className="chat-bubble-text">{msg.text}</div>
}

export function PrivateChatPanel() {
  const connected = useConnectionStore((s) => s.connected)
  const activeUserId = usePrivateChatStore((s) => s.activeUserId)
  const activeUserName = usePrivateChatStore((s) => s.activeUserName)
  const messages = usePrivateChatStore((s) => activeUserId ? (s.messages[activeUserId] ?? []) : [])
  const closeChat = usePrivateChatStore((s) => s.closeChat)
  const myId = useConnectionStore((s) => s.id)
  const [text, setText] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const audioRecorder = useMediaRecorder('audio')
  const videoRecorder = useMediaRecorder('video')

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    setText('')
    audioRecorder.cancel()
    videoRecorder.cancel()
  }, [activeUserId])

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

  async function handleSendAudio() {
    if (!activeUserId) return
    if (audioRecorder.recording) {
      const blob = await audioRecorder.stop()
      if (blob) {
        const data = await blobToBase64(blob)
        const duration = Math.max(1, Math.round(blob.size / 16000))
        sendPrivateAudioMessage(activeUserId, data, duration)
      }
    } else {
      audioRecorder.start()
    }
  }

  async function handleSendVideo() {
    if (!activeUserId) return
    if (videoRecorder.recording) {
      const blob = await videoRecorder.stop()
      if (blob) {
        const data = await blobToBase64(blob)
        const duration = Math.max(1, Math.round(blob.size / 64000))
        sendPrivateVideoMessage(activeUserId, data, duration)
      }
    } else {
      videoRecorder.start()
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
              {!isSelf && (
                <div className="chat-avatar" style={{ background: userColor(msg.fromUserId) }} title={msg.fromUserName}>
                  {initials(msg.fromUserName)}
                </div>
              )}
              <div className={`chat-bubble chat-bubble--dm ${isSelf ? 'chat-bubble--self' : ''}`}>
                <DmMediaBubble msg={msg} />
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <div className="chat-footer chat-footer--dm">
        <div className="dm-recorder-btns">
          <button
            onClick={() => handleSendAudio()}
            className={`dm-rec-btn dm-rec-btn--audio ${audioRecorder.recording ? 'dm-rec-btn--recording' : ''}`}
            disabled={!audioRecorder.supported || videoRecorder.recording}
            title="Record audio message"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" />
            </svg>
            {audioRecorder.recording ? 'Stop' : 'Audio'}
          </button>
          <button
            onClick={() => handleSendVideo()}
            className={`dm-rec-btn dm-rec-btn--video ${videoRecorder.recording ? 'dm-rec-btn--recording' : ''}`}
            disabled={!videoRecorder.supported || audioRecorder.recording}
            title="Record video message"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z" />
            </svg>
            {videoRecorder.recording ? 'Stop' : 'Video'}
          </button>
        </div>
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
