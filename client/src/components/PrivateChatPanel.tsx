import React, { useState, useRef, useEffect, useCallback } from 'react'
import { PrivateChatMsg } from '../types/index.ts'
import { usePrivateChatStore } from '../stores/privateChatStore.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useAccountStore } from '../stores/accountStore.ts'
import { useToastStore } from '../stores/toastStore.ts'
import { sendPrivateMessage, sendPrivateAudioMessage, sendPrivateVideoMessage, sendPrivateImageMessage, deletePrivateMessage, generateClientMessageId, resendPrivateMessage } from '../services/connectionService.ts'
import { useAudioRecorder } from '../hooks/useAudioRecorder.ts'
import { useVideoRecorder } from '../hooks/useVideoRecorder.ts'
import { userColor, initials } from '../ui/avatar.ts'
import { fileToResizedBase64, imageBase64ExceedsLimit, readFileAsBase64, getMediaDuration, fileBase64ExceedsLimit } from '../utils/image.ts'
import { ChatMedia } from './ChatMedia.tsx'
import { useT, tStatic } from '../i18n/index.ts'

function DmMediaBubble({ msg }: { msg: PrivateChatMsg }) {
  if (msg.audioData || msg.videoData || msg.imageData) {
    return (
      <ChatMedia
        audioData={msg.audioData}
        videoData={msg.videoData}
        imageData={msg.imageData}
        duration={msg.duration}
        userName={msg.fromUserName}
        timestamp={msg.timestamp}
        mime={msg.mime}
      />
    )
  }
  return <div className="chat-bubble-text">{msg.text}</div>
}

export function PrivateChatPanel() {
  const t = useT()
  const connected = useConnectionStore((s) => s.connected)
  const isGuest = useConnectionStore((s) => s.guest)
  const activeUserId = usePrivateChatStore((s) => s.activeUserId)
  const activeUserName = usePrivateChatStore((s) => s.activeUserName)
  const messages = usePrivateChatStore((s) => activeUserId ? (s.messages[activeUserId] ?? []) : [])
  const closeChat = usePrivateChatStore((s) => s.closeChat)
  const myId = useConnectionStore((s) => s.id)
  const myName = useConnectionStore((s) => s.name)
  const myAdmin = useConnectionStore((s) => s.admin)
  const toggleDmFullscreen = useAccountStore((s) => s.toggleDmFullscreen)
  const [text, setText] = useState('')
  const [cameraPickerOpen, setCameraPickerOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const audioRec = useAudioRecorder()
  const videoRec = useVideoRecorder()

  const setVideoPreview = useCallback((el: HTMLVideoElement | null) => {
    if (el && videoRec.streamRef.current) {
      el.srcObject = videoRec.streamRef.current
      el.play().catch(() => {})
    }
  }, [videoRec.streamVersion])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    setText('')
    audioRec.cancelRecording()
    videoRec.closeCamera()
    setCameraPickerOpen(false)
  }, [activeUserId])

  if (!connected) return null
  // Convidados não têm chat privado.
  if (isGuest) return null

  function handleSend() {
    if (!text.trim() || !activeUserId) return
    const value = text.trim()
    const id = generateClientMessageId()
    usePrivateChatStore.getState().addMessage({
      id,
      fromUserId: myId ?? '',
      fromUserName: myName ?? '',
      toUserId: activeUserId,
      text: value,
      timestamp: Date.now(),
      sending: true,
    })
    sendPrivateMessage(activeUserId, value, id)
    setText('')
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  async function handleStartAudioRecording() {
    if (!activeUserId) return
    const result = await audioRec.startRecording()
    if (result) {
      const id = generateClientMessageId()
      usePrivateChatStore.getState().addMessage({
        id,
        fromUserId: myId ?? '',
        fromUserName: myName ?? '',
        toUserId: activeUserId,
        audioData: result.data,
        duration: result.duration,
        timestamp: Date.now(),
        sending: true,
      })
      sendPrivateAudioMessage(activeUserId, id, result.data, result.duration)
    }
  }

  function handleStopAudioRecording() {
    audioRec.stopRecording()
  }

  function handleCancelAudioRecording() {
    audioRec.cancelRecording()
  }

  async function handleOpenCamera() {
    if (videoRec.devices.length === 0) {
      await videoRec.enumerateDevices()
    }
    await videoRec.openCamera()
  }

  async function handleBeginRecording() {
    if (!activeUserId) return
    const result = await videoRec.beginRecording()
    if (result && 'error' in result) {
      useToastStore.getState().show('error', tStatic('videoTooLarge'))
      return
    }
    if (result) {
      const id = generateClientMessageId()
      usePrivateChatStore.getState().addMessage({
        id,
        fromUserId: myId ?? '',
        fromUserName: myName ?? '',
        toUserId: activeUserId,
        videoData: result.data,
        duration: result.duration,
        timestamp: Date.now(),
        sending: true,
      })
      sendPrivateVideoMessage(activeUserId, id, result.data, result.duration)
    }
  }

  function handleStopVideoRecording() {
    videoRec.stopRecording()
  }

  function handleCancelVideoRecording() {
    videoRec.closeCamera()
    setCameraPickerOpen(false)
  }

  async function handleImageSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !activeUserId) return
    const base64 = await fileToResizedBase64(file)
    if (!base64) {
      useToastStore.getState().show('error', tStatic('imageUnreadable'))
      return
    }
    if (imageBase64ExceedsLimit(base64)) {
      useToastStore.getState().show('error', tStatic('imageTooLarge'))
      return
    }
    const id = generateClientMessageId()
    usePrivateChatStore.getState().addMessage({
      id,
      fromUserId: myId ?? '',
      fromUserName: myName ?? '',
      toUserId: activeUserId,
      imageData: base64,
      timestamp: Date.now(),
      sending: true,
    })
    sendPrivateImageMessage(activeUserId, id, base64)
  }

  // Envia um arquivo de áudio ou vídeo (upload) no chat privado.
  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !activeUserId) return
    const isAudio = file.type.startsWith('audio')
    const isVideo = file.type.startsWith('video')
    if (!isAudio && !isVideo) {
      useToastStore.getState().show('error', tStatic('fileInvalid'))
      return
    }
    const base64 = await readFileAsBase64(file)
    if (!base64 || fileBase64ExceedsLimit(file, base64)) {
      useToastStore.getState().show('error', tStatic('fileTooLarge'))
      return
    }
    const duration = Math.round(await getMediaDuration(file))
    const id = generateClientMessageId()
    if (isAudio) {
      usePrivateChatStore.getState().addMessage({
        id,
        fromUserId: myId ?? '',
        fromUserName: myName ?? '',
        toUserId: activeUserId,
        audioData: base64,
        duration,
        mime: file.type,
        timestamp: Date.now(),
        sending: true,
      })
      sendPrivateAudioMessage(activeUserId, id, base64, duration, file.type)
    } else {
      usePrivateChatStore.getState().addMessage({
        id,
        fromUserId: myId ?? '',
        fromUserName: myName ?? '',
        toUserId: activeUserId,
        videoData: base64,
        duration,
        mime: file.type,
        timestamp: Date.now(),
        sending: true,
      })
      sendPrivateVideoMessage(activeUserId, id, base64, duration, file.type)
    }
  }

  function handleDelete(messageId: string | undefined) {
    if (!messageId) return
    deletePrivateMessage(messageId)
  }

  if (!activeUserId || !activeUserName) return null

  return (
    <div className="chat-panel chat-panel--dm">
      <div className="chat-header chat-header--dm">
        <span className="chat-header-name">@{activeUserName}</span>
        <span className="chat-header-count">{messages.length} messages</span>
        <div className="chat-header-actions">
          <button
            className="chat-fullscreen-btn"
            onClick={toggleDmFullscreen}
            title={t('chatFullscreen')}
            aria-label={t('chatFullscreen')}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3" />
              <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
              <path d="M3 16v3a2 2 0 0 0 2 2h3" />
              <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
            </svg>
          </button>
          <button onClick={closeChat} className="btn-close-pchat" title="Close">&times;</button>
        </div>
      </div>

      <div className="chat-messages">
        {messages.map((msg, i) => {
          const isSelf = msg.fromUserId === myId
          const canDelete = isSelf || myAdmin
          return (
            <div key={msg.id ?? i} className={`chat-row ${isSelf ? 'chat-row--self' : ''}`}>
              {!isSelf && (
                <div className="chat-avatar" style={{ background: userColor(msg.fromUserId) }} title={msg.fromUserName}>
                  {initials(msg.fromUserName)}
                </div>
              )}
              <div className={`chat-bubble chat-bubble--dm ${isSelf ? 'chat-bubble--self' : ''} ${msg.audioData ? 'chat-bubble--audio' : ''}`}>
                <DmMediaBubble msg={msg} />
                <div className="chat-bubble-footer">
                  {isSelf && msg.sending && (
                    <span className="chat-bubble-status chat-bubble-status--sending" title={tStatic('sending')}>
                      <span className="chat-status-dots" aria-hidden="true"><i /><i /><i /></span>
                      {tStatic('sending')}
                    </span>
                  )}
                  {isSelf && msg.failed && (
                    <span className="chat-bubble-status chat-bubble-status--failed" title={tStatic('sendFailed')}>
                      <button
                        className="chat-bubble-retry"
                        onClick={() => { if (msg.id) resendPrivateMessage(msg.id) }}
                        title={tStatic('retry')}
                        aria-label={tStatic('retry')}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="23 4 23 10 17 10" />
                          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                        </svg>
                      </button>
                    </span>
                  )}
                  {isSelf && !msg.sending && !msg.failed && (
                    <span className="chat-bubble-status chat-bubble-status--sent" title={tStatic('sent')}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </span>
                  )}
                  {canDelete && msg.id && (
                    <button
                      onClick={() => handleDelete(msg.id)}
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
        })}
        <div ref={bottomRef} />
      </div>

      {videoRec.hasStream && (
        <div className="chat-video-preview-overlay">
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
                <span className="chat-recording-indicator">
                  <span className="chat-recording-dot" />
                  {videoRec.recording && <span className="chat-recording-time">{videoRec.duration}s</span>}
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
          </div>
        </div>
      )}

      <div className="chat-footer chat-footer--dm">
        <div className="chat-input-wrap">
          {audioRec.recording ? (
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
                placeholder={`Message @${activeUserName}`}
                className="chat-input"
              />
              <button
                onClick={handleStartAudioRecording}
                className="chat-mic-btn"
                disabled={videoRec.recording}
                title={tStatic('recordAudio')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </button>
              <button
                onClick={handleOpenCamera}
                className={`chat-cam-btn ${videoRec.recording ? 'recording' : ''}`}
                disabled={audioRec.recording}
                title={tStatic('recordVideo')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="chat-file-btn"
                title={tStatic('sendFile')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,video/*"
                style={{ display: 'none' }}
                onChange={handleFileSelected}
              />
              <button
                onClick={() => imageInputRef.current?.click()}
                className="chat-img-btn"
                title={tStatic('sendImage')}
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
    </div>
  )
}
