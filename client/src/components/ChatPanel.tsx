import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useRoomStore } from '../stores/roomStore.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useLiveStore } from '../stores/liveStore.ts'
import { sendChatMessage, sendChatAudioMessage, sendChatVideoMessage, deleteMessage, sendLiveStart, sendLiveStop, sendLiveChunk, sendLiveRequestResponse, sendLiveRequestCancel } from '../services/connectionService.ts'
import { useAudioRecorder } from '../hooks/useAudioRecorder.ts'
import { useVideoRecorder } from '../hooks/useVideoRecorder.ts'
import { LiveViewer } from './LiveViewer.tsx'
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
      sendChatAudioMessage(result.data, result.duration)
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

  async function handleBeginRecording() {
    const result = await videoRec.beginRecording()
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
        <span className="chat-header-count">{messages.length} messages</span>
      </div>

      {isAoVivo && broadcaster && broadcaster.userId !== myId && (
        <LiveViewer />
      )}

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
              <strong>{pendingRequest.fromUserName}</strong> wants to take over the live broadcast. Allow?
            </p>
            <div className="chat-takeover-dialog-actions">
              <button
                onClick={handleDenyTakeover}
                className="chat-takeover-deny-btn"
              >
                Deny
              </button>
              <button
                onClick={handleAcceptTakeover}
                className="chat-takeover-accept-btn"
              >
                Allow
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
                placeholder="Message #general"
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
