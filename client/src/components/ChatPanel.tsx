import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useRoomStore } from '../stores/roomStore.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useLiveStore } from '../stores/liveStore.ts'
import { useToastStore } from '../stores/toastStore.ts'
import { sendChatMessage, sendChatAudioMessage, sendChatVideoMessage, sendChatImageMessage, sendMessageReaction, sendForwardMessage, deleteMessage, sendLiveStart, sendLiveStop, sendLiveChunk, sendLiveRequestResponse, sendLiveRequestCancel, generateClientMessageId } from '../services/connectionService.ts'
import { useAudioRecorder } from '../hooks/useAudioRecorder.ts'
import { useVideoRecorder } from '../hooks/useVideoRecorder.ts'
import { LiveViewer } from './LiveViewer.tsx'
import { RadioBot } from './RadioBot.tsx'
import { RADIO_ROOM_NAME } from '../ui/radioBot.ts'
import type { ChatMsg, RoomInfo } from '../types/index.ts'
import { userColor, initials } from '../ui/avatar.ts'
import { fileToResizedBase64, imageBase64ExceedsLimit } from '../utils/image.ts'
import { useT, tStatic } from '../i18n/index.ts'

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏']

function formatTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return tStatic('now')
  if (mins < 60) return tStatic('minAgo', { n: mins })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return tStatic('hourAgo', { n: hrs })
  return tStatic('dayAgo', { n: Math.floor(hrs / 24) })
}

function exactTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function sameDay(a: number, b: number): boolean {
  const da = new Date(a)
  const db = new Date(b)
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  )
}

function dateLabel(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(ts, now.getTime())) return tStatic('today')
  if (sameDay(ts, yesterday.getTime())) return tStatic('yesterday')
  return d.toLocaleDateString()
}

function DateSeparator({ ts }: { ts: number }) {
  return (
    <div className="chat-date-separator">
      <span>{dateLabel(ts)}</span>
    </div>
  )
}

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose} aria-label={tStatic('close')}>
        ✕
      </button>
      <img
        src={src}
        className="lightbox-media"
        alt=""
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}

function ForwardPicker({ rooms, onForward, onClose }: {
  rooms: RoomInfo[]
  onForward: (roomName: string) => void
  onClose: () => void
}) {
  return (
    <div className="forward-overlay" onClick={onClose}>
      <div
        className="forward-picker"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="forward-picker-header">
          <span>{tStatic('forwardTo')}</span>
          <button className="lightbox-close" onClick={onClose} aria-label={tStatic('close')}>✕</button>
        </div>
        <div className="forward-picker-list">
          {rooms.map((r) => (
            <button
              key={r.id}
              className="forward-picker-item"
              onClick={() => onForward(r.name)}
            >
              <span className="forward-picker-room">#{r.name}</span>
              <span className="forward-picker-users">{tStatic('usersOnline', { n: r.users })}</span>
            </button>
          ))}
          {rooms.length === 0 && (
            <p className="empty-state-hint">{tStatic('roomsEmpty')}</p>
          )}
        </div>
      </div>
    </div>
  )
}

export function ChatPanel() {
  const messages = useRoomStore((s) => s.messages)
  const currentRoomName = useRoomStore((s) => s.currentRoomName)
  const loadingMessages = useRoomStore((s) => s.loadingMessages)
  const myId = useConnectionStore((s) => s.id)
  const myName = useConnectionStore((s) => s.name)
  const myAdmin = useConnectionStore((s) => s.admin)
  const connected = useConnectionStore((s) => s.connected)
  const broadcaster = useLiveStore((s) => s.broadcaster)
  const pendingRequest = useLiveStore((s) => s.pendingRequest)
  const setPendingRequest = useLiveStore((s) => s.setPendingRequest)
  const takeoverRequested = useLiveStore((s) => s.takeoverRequestSent)
  const setTakeoverRequestSent = useLiveStore((s) => s.setTakeoverRequestSent)
  const requestDenied = useLiveStore((s) => s.requestDenied)
  const [text, setText] = useState('')
  const [cameraPickerOpen, setCameraPickerOpen] = useState(false)
  const [isLiveBroadcasting, setIsLiveBroadcasting] = useState(false)
  const liveMediaRecorderRef = useRef<MediaRecorder | null>(null)
  const liveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const audioRec = useAudioRecorder()
  const videoRec = useVideoRecorder()
  const isRecording = audioRec.recording || videoRec.recording
  const isAoVivo = currentRoomName === 'Ao vivo'
  const isRadioRoom = currentRoomName === RADIO_ROOM_NAME
  const rooms = useRoomStore((s) => s.rooms)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [forwardMsg, setForwardMsg] = useState<ChatMsg | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const t = useT()

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (requestDenied === 0) return
    videoRec.cancelRecording()
    setCameraPickerOpen(false)
  }, [requestDenied])

  const setVideoPreview = useCallback((el: HTMLVideoElement | null) => {
    if (el && videoRec.streamRef.current) {
      el.srcObject = videoRec.streamRef.current
      el.play().catch(() => {})
    }
  }, [videoRec.streamVersion])

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
      // Feedback imediato: bolha local "enviando…", confirmada pelo eco do servidor.
      const id = generateClientMessageId()
      useRoomStore.getState().addMessage({
        id,
        userId: myId ?? '',
        userName: myName ?? '',
        audioData: result.data,
        duration: result.duration,
        timestamp: Date.now(),
        sending: true,
      })
      sendChatAudioMessage(id, result.data, result.duration)
    }
  }

  async function handleOpenCamera() {
    if (videoRec.devices.length === 0) {
      await videoRec.enumerateDevices()
    }
    const ok = await videoRec.openCamera()
    if (!ok) {
      // camera access denied or failed
    }
  }

  async function handleImageSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const base64 = await fileToResizedBase64(file)
    if (!base64) {
      useToastStore.getState().show('error', t('imageUnreadable'))
      return
    }
    if (imageBase64ExceedsLimit(base64)) {
      useToastStore.getState().show('error', t('imageTooLarge'))
      return
    }
    const id = generateClientMessageId()
    useRoomStore.getState().addMessage({
      id,
      userId: myId ?? '',
      userName: myName ?? '',
      imageData: base64,
      timestamp: Date.now(),
      sending: true,
    })
    sendChatImageMessage(id, base64)
  }

  async function handleBeginRecording() {
    const result = await videoRec.beginRecording()
    if (result && 'error' in result) {
      useToastStore.getState().show('error', t('videoTooLarge'))
      return
    }
    if (result) {
      const id = generateClientMessageId()
      useRoomStore.getState().addMessage({
        id,
        userId: myId ?? '',
        userName: myName ?? '',
        videoData: result.data,
        duration: result.duration,
        timestamp: Date.now(),
        sending: true,
      })
      sendChatVideoMessage(id, result.data, result.duration)
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
    if (takeoverRequested) {
      sendLiveRequestCancel()
      setTakeoverRequestSent(false)
    }
    videoRec.cancelRecording()
    setCameraPickerOpen(false)
  }

  async function handleStartLiveBroadcast() {
    if (!videoRec.hasStream) {
      if (videoRec.devices.length === 0) {
        await videoRec.enumerateDevices()
      }
      const ok = await videoRec.openCamera()
      if (!ok) return
    }
    if (broadcaster && broadcaster.userId !== myId) {
      setTakeoverRequestSent(true)
      sendLiveStart()
      return
    }
    sendLiveStart()
  }

  function handleStopLiveBroadcast() {
    if (liveMediaRecorderRef.current && liveMediaRecorderRef.current.state !== 'inactive') {
      liveMediaRecorderRef.current.stop()
    }
    if (liveTimerRef.current) {
      clearInterval(liveTimerRef.current)
      liveTimerRef.current = null
    }
    setIsLiveBroadcasting(false)
    setCameraPickerOpen(false)
    sendLiveStop()
    videoRec.cancelRecording()
  }

  function handleAcceptTakeover() {
    if (!pendingRequest) return
    sendLiveRequestResponse(true, pendingRequest.fromUserId)
    setPendingRequest(null)
  }

  function handleDenyTakeover() {
    if (!pendingRequest) return
    sendLiveRequestResponse(false, pendingRequest.fromUserId)
    setPendingRequest(null)
  }

  // React to LiveStarted for Ao vivo
  useEffect(() => {
    if (!isAoVivo || !broadcaster) return
    if (broadcaster.userId === myId && !isLiveBroadcasting) {
      setIsLiveBroadcasting(true)
      setTakeoverRequestSent(false)
      const stream = videoRec.streamRef.current
      if (!stream) return

      function onChunk(e: BlobEvent) {
        if (e.data.size === 0) return
        const reader = new FileReader()
        reader.onloadend = () => {
          const result = reader.result as string
          if (!result) return
          const parts = result.split(',')
          if (parts.length < 2) return
          sendLiveChunk(parts[1], 0)
        }
        reader.readAsDataURL(e.data)
      }

      const mimeTypes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      let mr: MediaRecorder | null = null
      for (const mime of mimeTypes) {
        try {
          mr = new MediaRecorder(stream, { mimeType: mime })
          break
        } catch { /* try next */ }
      }
      if (!mr) mr = new MediaRecorder(stream)
      liveMediaRecorderRef.current = mr
      mr.ondataavailable = onChunk
      mr.start(1000)
    }
  }, [broadcaster?.userId])

  // React to LiveStopped for Ao vivo
  useEffect(() => {
    if (!isAoVivo) return
    if (!broadcaster) {
      if (isLiveBroadcasting) {
        if (liveMediaRecorderRef.current && liveMediaRecorderRef.current.state !== 'inactive') {
          liveMediaRecorderRef.current.stop()
        }
        if (liveTimerRef.current) {
          clearInterval(liveTimerRef.current)
          liveTimerRef.current = null
        }
        setIsLiveBroadcasting(false)
        videoRec.cancelRecording()
        setCameraPickerOpen(false)
      }
    }
  }, [broadcaster])

  if (!connected || !currentRoomName) return null

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span className="chat-header-name">#{currentRoomName}</span>
        <span className="chat-header-count">{t('messagesCount', { count: messages.length })}</span>
      </div>

      {isAoVivo && broadcaster && broadcaster.userId !== myId && (
        <LiveViewer />
      )}

      {isRadioRoom && (
        <RadioBot />
      )}

      <div className="chat-messages">
        {loadingMessages ? (
          <div aria-busy="true" aria-label={t('loadingMessages')}>
            <div className="skeleton skeleton-line" style={{ width: '55%' }} />
            <div className="skeleton skeleton-line" style={{ width: '70%' }} />
            <div className="skeleton skeleton-line" style={{ width: '40%' }} />
          </div>
        ) : messages.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-icon">💬</span>
            <span className="empty-state-title">{t('noMessages')}</span>
            <span className="empty-state-hint">{t('noMessagesHint')}</span>
          </div>
        ) : (
          messages.map((msg, i) => {
            const isSelf = msg.userId === myId
            const color = userColor(msg.userId)
            const prev = messages[i - 1]
            const showDate = !prev || !sameDay(prev.timestamp, msg.timestamp)
            return (
              <React.Fragment key={i}>
                {showDate && <DateSeparator ts={msg.timestamp} />}
                <ChatBubble
                  msg={msg}
                  isSelf={isSelf}
                  canDelete={isSelf || myAdmin}
                  avatarColor={color}
                  showAvatar={!prev || prev.userId !== msg.userId}
                  myId={myId}
                  onForward={setForwardMsg}
                  onLightbox={setLightboxSrc}
                />
              </React.Fragment>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>

      {videoRec.hasStream && !isLiveBroadcasting ? (
        <div className="chat-video-preview-overlay">
          <div className="chat-video-preview-box">
            <video
              ref={setVideoPreview}
              autoPlay
              muted
              playsInline
              className="chat-video-preview"
            />
            {isAoVivo && takeoverRequested ? (
              <div className="chat-video-preview-toolbar">
                <div className="chat-video-preview-left">
                  <span className="chat-recording-indicator">
                    <span className="chat-recording-dot" />
                    <span>Requesting takeover...</span>
                  </span>
                </div>
                <div className="chat-video-preview-center">
                  {cameraPickerOpen && (
                    <div className="chat-camera-picker">
                      {videoRec.devices.map((d) => (
                        <button
                          key={d.deviceId}
                          className={`chat-camera-picker-item${videoRec.cameraId === d.deviceId ? ' active' : ''}`}
                          onClick={() => {
                            videoRec.switchCamera(d.deviceId)
                            setCameraPickerOpen(false)
                          }}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="chat-video-preview-actions">
                  <button
                    onClick={() => videoRec.enumerateDevices().then(() => setCameraPickerOpen(!cameraPickerOpen))}
                    className="chat-cam-settings-btn"
                    title="Choose camera"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                  </button>
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
                </div>
              </div>
            ) : (
              <div className="chat-video-preview-toolbar">
                <div className="chat-video-preview-left">
                  <span className="chat-recording-indicator">
                    <span className="chat-recording-dot" />
                    <span className="chat-recording-time">{videoRec.duration}s</span>
                  </span>
                </div>
                <div className="chat-video-preview-center">
                  {cameraPickerOpen && (
                    <div className="chat-camera-picker">
                      {videoRec.devices.map((d) => (
                        <button
                          key={d.deviceId}
                          className={`chat-camera-picker-item${videoRec.cameraId === d.deviceId ? ' active' : ''}`}
                          onClick={() => {
                            videoRec.switchCamera(d.deviceId)
                            setCameraPickerOpen(false)
                          }}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="chat-video-preview-actions">
                  <button
                    onClick={() => videoRec.enumerateDevices().then(() => setCameraPickerOpen(!cameraPickerOpen))}
                    className="chat-cam-settings-btn"
                    title="Choose camera"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                  </button>
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
                  {videoRec.recording ? (
                    <button
                      onClick={handleStopVideoRecording}
                      className="chat-recording-stop-btn"
                      title="Stop and send"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="6" width="12" height="12" rx="2" />
                      </svg>
                    </button>
                  ) : (
                    <button
                      onClick={handleBeginRecording}
                      className="chat-recording-start-btn"
                      title="Start recording"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="12" cy="12" r="6" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {isAoVivo && isLiveBroadcasting && videoRec.hasStream ? (
        <div className="chat-video-preview-overlay live-broadcast-overlay">
          <div className="chat-video-preview-box">
            <video
              ref={setVideoPreview}
              autoPlay
              muted
              playsInline
              className="chat-video-preview"
            />
            <div className="chat-video-preview-toolbar">
              <div className="chat-video-preview-left">
                <span className="live-indicator">
                  <span className="live-indicator-dot" />
                  <span className="live-indicator-label">LIVE</span>
                </span>
              </div>
              <div className="chat-video-preview-center">
                {cameraPickerOpen && (
                  <div className="chat-camera-picker">
                    {videoRec.devices.map((d) => (
                      <button
                        key={d.deviceId}
                        className={`chat-camera-picker-item${videoRec.cameraId === d.deviceId ? ' active' : ''}`}
                        onClick={() => {
                          videoRec.switchCamera(d.deviceId)
                          setCameraPickerOpen(false)
                        }}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="chat-video-preview-actions">
                <button
                  onClick={() => videoRec.enumerateDevices().then(() => setCameraPickerOpen(!cameraPickerOpen))}
                  className="chat-cam-settings-btn"
                  title="Choose camera"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </button>
                <button
                  onClick={handleStopLiveBroadcast}
                  className="chat-live-stop-btn"
                  title="Stop broadcast"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {pendingRequest && (
        <div className="chat-takeover-dialog">
          <div className="chat-takeover-dialog-box">
            <p className="chat-takeover-dialog-text">
              <strong>{pendingRequest.fromUserName}</strong> {tStatic('liveTakeover')}
            </p>
            <div className="chat-takeover-dialog-actions">
              <button
                onClick={handleDenyTakeover}
                className="chat-takeover-deny-btn"
              >
                {tStatic('liveDeny')}
              </button>
              <button
                onClick={handleAcceptTakeover}
                className="chat-takeover-accept-btn"
              >
                {tStatic('liveAllow')}
              </button>
            </div>
          </div>
        </div>
      )}

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
                placeholder={t('messagePlaceholder', { room: currentRoomName ?? '' })}
                className="chat-input"
              />
              {!isAoVivo && (
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
              )}
              {isAoVivo ? (
                <button
                  onClick={handleStartLiveBroadcast}
                  className={`chat-live-btn ${isLiveBroadcasting ? 'active' : ''} ${takeoverRequested ? 'requesting' : ''}`}
                  title={isLiveBroadcasting ? 'Broadcasting' : takeoverRequested ? 'Request sent...' : 'Start live broadcast'}
                >
                  {takeoverRequested ? (
                    <span className="chat-live-request-text">Requesting...</span>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58 2.78 2.78 0 0 0 1.94 2C5.12 20 12 20 12 20s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z" />
                      <polygon points="9.75 8.75 9.75 15.25 15.5 12 9.75 8.75" fill="currentColor" stroke="none" />
                    </svg>
                  )}
                </button>
              ) : (
                <button
                  onClick={handleOpenCamera}
                  className="chat-cam-btn"
                  title="Record video"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="23 7 16 12 23 17 23 7" />
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                  </svg>
                </button>
              )}
              <button
                onClick={() => imageInputRef.current?.click()}
                className="chat-img-btn"
                title="Enviar imagem"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
              </button>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleImageSelected}
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
            </>
          )}
        </div>
      </div>

      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
      {forwardMsg && (
        <ForwardPicker
          rooms={rooms}
          onForward={(roomName) => {
            if (!forwardMsg.id) return
            sendForwardMessage(forwardMsg.id, roomName)
            useToastStore.getState().show('success', t('forwardSent', { room: roomName }))
            setForwardMsg(null)
          }}
          onClose={() => setForwardMsg(null)}
        />
      )}
    </div>
  )
}

function ChatBubble({ msg, isSelf, canDelete, avatarColor, showAvatar, myId, onForward, onLightbox }: {
  msg: ChatMsg
  isSelf: boolean
  canDelete: boolean
  avatarColor: string
  showAvatar: boolean
  myId: string | null
  onForward: (msg: ChatMsg) => void
  onLightbox: (src: string) => void
}) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(msg.duration ?? 0)
  const [seeking, setSeeking] = useState(false)
  const [rate, setRate] = useState(1)
  const [reactionsOpen, setReactionsOpen] = useState(false)

  const RATES = [0.5, 1, 1.5, 2]

  // Alturas das barras da onda: determinísticas por mensagem, para não
  // "tremeluzir" a cada atualização de currentTime (timeupdate).
  const bars = useMemo(
    () => Array.from({ length: 32 }, (_, i) => 20 + Math.sin(i * 0.8) * 30 + ((i * 37) % 10)),
    []
  )

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

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate
  }, [rate])

  function togglePlay() {
    if (!audioRef.current) return
    if (playing) {
      audioRef.current.pause()
    } else {
      audioRef.current.playbackRate = rate
      audioRef.current.play()
    }
  }

  function cycleRate() {
    setRate((r) => {
      const next = RATES[(RATES.indexOf(r) + 1) % RATES.length]
      if (audioRef.current) audioRef.current.playbackRate = next
      return next
    })
  }

  function toggleReaction(emoji: string) {
    if (!msg.id) return
    sendMessageReaction(msg.id, emoji)
    setReactionsOpen(false)
  }

  const totalDuration =
    audioRef.current?.duration && isFinite(audioRef.current.duration)
      ? audioRef.current.duration
      : duration

  const progress = totalDuration > 0 ? Math.min(1, Math.max(0, currentTime / totalDuration)) : 0

  function seekFromClientX(clientX: number) {
    if (!audioRef.current || !progressRef.current) return
    const rect = progressRef.current.getBoundingClientRect()
    if (rect.width === 0) return
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    const target = ratio * totalDuration
    audioRef.current.currentTime = target
    setCurrentTime(target)
  }

  function seekBy(delta: number) {
    if (!audioRef.current) return
    const next = Math.min(totalDuration, Math.max(0, audioRef.current.currentTime + delta))
    audioRef.current.currentTime = next
    setCurrentTime(next)
  }

  function handleSeekKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      seekBy(5)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      seekBy(-5)
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
        <div className="chat-avatar" style={{ background: avatarColor }} title={msg.userName}>
          {initials(msg.userName)}
        </div>
      )}
      {!showAvatar && !isSelf && <div className="chat-avatar-spacer" />}
      <div className={`chat-bubble ${isSelf ? 'chat-bubble--self' : ''}`}>
        {!isSelf && (
          <div className="chat-bubble-author" style={{ color: avatarColor }}>
            {msg.userName}
          </div>
        )}
        {msg.forwarded && (
          <div className="chat-bubble-forwarded">{tStatic('forwarded')}</div>
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
        ) : msg.imageData ? (
          <div className="chat-bubble-image">
            <img
              src={`data:image/jpeg;base64,${msg.imageData}`}
              className="chat-image"
              alt=""
              onClick={() => onLightbox(`data:image/jpeg;base64,${msg.imageData}`)}
            />
          </div>
        ) : msg.audioData ? (
          <div className="chat-bubble-audio">
            <button
              onClick={togglePlay}
              className="chat-audio-play-btn"
              title={playing ? tStatic('audioPause') : tStatic('audioPlay')}
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
            <button
              onClick={cycleRate}
              className="chat-audio-rate-btn"
              title={tStatic('speed')}
            >
              {rate}x
            </button>
            <div
              ref={progressRef}
              className="chat-audio-progress"
              role="slider"
              aria-label="Linha do tempo do áudio"
              aria-valuemin={0}
              aria-valuemax={Math.round(totalDuration)}
              aria-valuenow={Math.round(currentTime)}
              tabIndex={0}
              onPointerDown={(e) => {
                e.preventDefault()
                ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
                setSeeking(true)
                seekFromClientX(e.clientX)
              }}
              onPointerMove={(e) => {
                if (seeking) seekFromClientX(e.clientX)
              }}
              onPointerUp={() => setSeeking(false)}
              onPointerCancel={() => setSeeking(false)}
              onPointerLeave={() => setSeeking(false)}
              onKeyDown={handleSeekKey}
            >
              <div className="chat-audio-wave">
                {bars.map((h, i) => (
                  <div
                    key={i}
                    className={`chat-audio-bar ${(i + 1) / bars.length <= progress ? 'chat-audio-bar--active' : ''}`}
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>
              <div className="chat-audio-time-row">
                <span className="chat-audio-time">{formatDuration(currentTime)}</span>
                <span className="chat-audio-duration">{formatDuration(duration)}</span>
              </div>
            </div>
            <audio
              ref={audioRef}
              src={audioUrl ?? undefined}
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => {
                if (Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0) {
                  setDuration(e.currentTarget.duration)
                }
              }}
              onEnded={() => {
                setPlaying(false)
                setCurrentTime(0)
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
          </div>
        ) : (
          <div className="chat-bubble-text">{msg.text}</div>
        )}
        <div className="chat-bubble-reactions">
          {msg.reactions?.map((r) => {
            const mine = !!myId && r.userIds.includes(myId)
            return (
              <button
                key={r.emoji}
                className={`chat-reaction-chip${mine ? ' mine' : ''}${isSelf ? ' static' : ''}`}
                onClick={() => { if (!isSelf && msg.id) sendMessageReaction(msg.id, r.emoji) }}
                disabled={isSelf}
              >
                <span>{r.emoji}</span>
                <span className="chat-reaction-count">{r.userIds.length}</span>
              </button>
            )
          })}
          {!isSelf && (
            <span className="chat-reaction-add">
              <button
                className="chat-reaction-add-btn"
                onClick={() => setReactionsOpen((v) => !v)}
                title={tStatic('react')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                  <line x1="9" y1="9" x2="9.01" y2="9" />
                  <line x1="15" y1="9" x2="15.01" y2="9" />
                </svg>
              </button>
              {reactionsOpen && (
                <div className="chat-reaction-picker">
                  {QUICK_REACTIONS.map((e) => (
                    <button key={e} className="chat-reaction-option" onClick={() => toggleReaction(e)}>
                      {e}
                    </button>
                  ))}
                </div>
              )}
            </span>
          )}
        </div>
        <div className="chat-bubble-footer">
          <span className="chat-bubble-time" title={exactTime(msg.timestamp)}>
            {msg.videoData ? formatDuration(msg.duration ?? 0) : formatTime(msg.timestamp)}
          </span>
          {msg.sending && (
            <span className="chat-bubble-sending">{tStatic('sending')}</span>
          )}
          <button
            onClick={() => onForward(msg)}
            className="chat-bubble-forward-btn"
            title={tStatic('forwardTo')}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2 11 13" />
              <path d="M22 2 15 22l-4-9-9-4z" />
            </svg>
          </button>
          {canDelete && (
            <button
              onClick={() => {
                if (!msg.id) return
                deleteMessage(msg.id)
                useToastStore.getState().show('success', tStatic('messageSent'))
              }}
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
