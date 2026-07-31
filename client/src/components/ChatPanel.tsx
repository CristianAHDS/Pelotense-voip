import React, { useState, useRef, useEffect } from 'react'
import { useRoomStore } from '../stores/roomStore.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { sendChatMessage, sendChatAudioMessage, sendChatVideoMessage, deleteMessage } from '../services/connectionService.ts'
import { useAudioRecorder } from '../hooks/useAudioRecorder.ts'
import { useVideoRecorder } from '../hooks/useVideoRecorder.ts'
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
  const videoPreviewRef = useRef<HTMLVideoElement>(null)
  const audioRec = useAudioRecorder()
  const videoRec = useVideoRecorder()
  const isRecording = audioRec.recording || videoRec.recording

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const el = videoPreviewRef.current
    if (el) {
      el.srcObject = videoRec.stream
      if (videoRec.stream) {
        el.play().catch(() => {})
      }
    }
  }, [videoRec.stream])

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

  async function handleStartAudioRecording() {
    const result = await audioRec.startRecording()
    if (result) {
      sendChatAudioMessage(result.data, result.duration)
    }
  }

  async function handleStartVideoRecording() {
    const result = await videoRec.startRecording()
    if (result) {
      sendChatVideoMessage(result.data, result.duration)
    }
  }

  function handleStopAudioRecording() {
    audioRec.stopRecording()
  }

  function handleStopVideoRecording() {
    videoRec.stopRecording()
  }

  function handleCancelAudioRecording() {
    audioRec.cancelRecording()
  }

  function handleCancelVideoRecording() {
    videoRec.cancelRecording()
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

      {videoRec.stream ? (
        <div className="chat-video-preview-overlay">
          <div className="chat-video-preview-box">
            <video
              ref={videoPreviewRef}
              autoPlay
              muted
              playsInline
              className="chat-video-preview"
            />
            <div className="chat-video-preview-toolbar">
              <span className="chat-recording-indicator">
                <span className="chat-recording-dot" />
                <span className="chat-recording-time">{videoRec.duration}s</span>
              </span>
              <div className="chat-video-preview-actions">
                <button
                  onClick={handleCancelVideoRecording}
                  className="chat-cancel-btn"
                  title="Cancel"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
                <button
                  onClick={handleStopVideoRecording}
                  className="chat-recording-stop-btn"
                  title="Send"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="chat-footer">
        <div className="chat-input-wrap">
          {isRecording ? (
            <>
              <div className="chat-recording-indicator">
                <span className="chat-recording-dot" />
                <span className="chat-recording-time">{audioRec.duration}s</span>
              </div>
              <button
                onClick={handleCancelAudioRecording}
                className="chat-cancel-btn"
                title="Cancel"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
              <button
                onClick={handleStopAudioRecording}
                className="chat-recording-stop-btn"
                title="Send"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
            </>
          ) : (
            <>
              <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message #general"
                className="chat-input"
              />
              <button
                onClick={handleStartAudioRecording}
                className="chat-mic-btn"
                title="Record audio"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </button>
              <button
                onClick={handleStartVideoRecording}
                className="chat-cam-btn"
                title="Record video"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
              </button>
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
            </>
          )}
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
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    if (msg.audioData && !audioUrl) {
      const url = URL.createObjectURL(
        new Blob(
          [Uint8Array.from(atob(msg.audioData), (c) => c.charCodeAt(0))],
          { type: 'audio/webm' }
        )
      )
      setAudioUrl(url)
    }
    if (msg.videoData && !videoUrl) {
      const url = URL.createObjectURL(
        new Blob(
          [Uint8Array.from(atob(msg.videoData), (c) => c.charCodeAt(0))],
          { type: 'video/webm' }
        )
      )
      setVideoUrl(url)
    }
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl)
      if (videoUrl) URL.revokeObjectURL(videoUrl)
    }
  }, [msg.audioData, msg.videoData])

  function togglePlay() {
    if (!audioRef.current) return
    if (playing) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      setPlaying(false)
    } else {
      audioRef.current.play()
      setPlaying(true)
    }
  }

  function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

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
        {msg.videoData ? (
          <div className="chat-bubble-video">
            {videoUrl && (
              <video
                src={videoUrl}
                controls
                className="chat-video-player"
              />
            )}
            <div className="chat-bubble-time">{formatDuration(msg.duration ?? 0)}</div>
          </div>
        ) : msg.audioData ? (
          <div className="chat-bubble-audio">
            <button
              onClick={togglePlay}
              className="chat-audio-play-btn"
              title={playing ? 'Pause' : 'Play'}
            >
              {playing ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              )}
            </button>
            <div className="chat-audio-progress">
              <div className="chat-audio-wave">
                {Array.from({ length: 32 }, (_, i) => (
                  <div
                    key={i}
                    className="chat-audio-bar"
                    style={{
                      height: `${20 + Math.sin(i * 0.8) * 30 + Math.random() * 10}%`,
                      opacity: playing ? 1 : 0.4,
                    }}
                  />
                ))}
              </div>
              <span className="chat-audio-duration">
                {playing ? '' : formatDuration(msg.duration ?? 0)}
              </span>
            </div>
            <audio
              ref={audioRef}
              src={audioUrl ?? undefined}
              onEnded={() => setPlaying(false)}
            />
          </div>
        ) : (
          <div className="chat-bubble-text">{msg.text}</div>
        )}
        <div className="chat-bubble-footer">
          <span className="chat-bubble-time">
            {msg.videoData ? formatDuration(msg.duration ?? 0) : formatTime(msg.timestamp)}
          </span>
          {isSelf && (
            <button
              onClick={() => msg.id && deleteMessage(msg.id)}
              className="chat-bubble-delete-btn"
              title="Delete"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
