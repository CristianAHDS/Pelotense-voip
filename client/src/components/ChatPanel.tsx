import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useRoomStore } from '../stores/roomStore.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useLiveStore } from '../stores/liveStore.ts'
import { useToastStore } from '../stores/toastStore.ts'
import { sendChatMessage, sendChatAudioMessage, sendChatVideoMessage, sendChatImageMessage, sendMessageReaction, sendForwardMessage, deleteMessage, sendLiveStart, sendLiveStop, sendLiveRequestResponse, sendLiveRequestCancel, generateClientMessageId, resendMessage, sendTyping, requestChatHistoryPage } from '../services/connectionService.ts'
import * as liveRtc from '../services/liveRtc.ts'
import { useAudioRecorder } from '../hooks/useAudioRecorder.ts'
import { useVideoRecorder } from '../hooks/useVideoRecorder.ts'
import { useAccountStore } from '../stores/accountStore.ts'
import { LiveViewer } from './LiveViewer.tsx'
import { RadioBot } from './RadioBot.tsx'
import { MultiLiveMosaic } from './MultiLiveMosaic.tsx'
import { ChatMedia } from './ChatMedia.tsx'
import { RADIO_ROOM_NAME, MULTILIVE_ROOM_NAME } from '../ui/radioBot.ts'
import type { ChatMsg, RoomInfo } from '../types/index.ts'
import { userColor, initials } from '../ui/avatar.ts'
import { fileToResizedBase64, imageBase64ExceedsLimit, readFileAsBase64, getMediaDuration } from '../utils/image.ts'
import { isMobileDevice } from '../utils/device.ts'
import { getLiveViewerUrl } from '../utils/appConfig.ts'
import { renderTextWithLinks } from '../utils/links.tsx'
import { useT, tStatic, type TranslateFn } from '../i18n/index.ts'

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏']

function typingNames(typing: Record<string, string>, myId: string | null, t: TranslateFn): string {
  const names = Object.entries(typing)
    .filter(([id]) => id !== myId)
    .map(([, name]) => name)
  if (names.length === 0) return ''
  if (names.length === 1) return t('typingOne', { name: names[0] })
  if (names.length === 2) return t('typingTwo', { names: names.join(t('and')) })
  return t('typingMany', { names: names.slice(0, 2).join(', ') })
}

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
  const currentRoomId = useRoomStore((s) => s.currentRoom)
  const currentRoomName = useRoomStore((s) => s.currentRoomName)
  const loadingMessages = useRoomStore((s) => s.loadingMessages)
  const hasMoreMessages = useRoomStore((s) => s.hasMoreMessages)
  const isLoadingMore = useRoomStore((s) => s.isLoadingMore)
  const myId = useConnectionStore((s) => s.id)
  const myName = useConnectionStore((s) => s.name)
  const myAdmin = useConnectionStore((s) => s.admin)
  const connected = useConnectionStore((s) => s.connected)
  const isGuest = useConnectionStore((s) => s.guest)
  const broadcaster = useLiveStore((s) => s.broadcasters[0])
  const pendingRequest = useLiveStore((s) => s.pendingRequest)
  const setPendingRequest = useLiveStore((s) => s.setPendingRequest)
  const takeoverRequested = useLiveStore((s) => s.takeoverRequestSent)
  const setTakeoverRequestSent = useLiveStore((s) => s.setTakeoverRequestSent)
  const requestDenied = useLiveStore((s) => s.requestDenied)
  const [text, setText] = useState('')
  const [cameraPickerOpen, setCameraPickerOpen] = useState(false)
  const [isLiveBroadcasting, setIsLiveBroadcasting] = useState(false)
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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const toggleFullscreen = useAccountStore((s) => s.toggleFullscreen)
  const t = useT()
  const typingUsers = useRoomStore((s) => s.typing)

  // Indicador de digitação: sinaliza "typing" enquanto há texto (debounce no
  // envio) e envia "parou de digitar" ao limpar o campo ou após pausa.
  const typingActiveRef = useRef(false)
  const typingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stopTypingSignal = useCallback(() => {
    if (typingActiveRef.current) {
      typingActiveRef.current = false
      sendTyping(false)
    }
    if (typingDebounceRef.current) {
      clearTimeout(typingDebounceRef.current)
      typingDebounceRef.current = null
    }
  }, [])

  const signalTyping = useCallback((value: string) => {
    if (!value.trim()) {
      stopTypingSignal()
      return
    }
    if (!typingActiveRef.current) {
      typingActiveRef.current = true
      sendTyping(true)
    }
    if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current)
    typingDebounceRef.current = setTimeout(() => {
      typingDebounceRef.current = null
      stopTypingSignal()
    }, 3000)
  }, [stopTypingSignal])

  useEffect(() => {
    return () => {
      stopTypingSignal()
    }
  }, [stopTypingSignal])

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
    stopTypingSignal()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  async function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const items = e.clipboardData?.items
    if (!items) return

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.kind !== 'file') continue

      const file = item.getAsFile()
      if (!file) continue

      e.preventDefault()

      if (file.type.startsWith('image/')) {
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
        return
      }

      const isAudio = file.type.startsWith('audio')
      const isVideo = file.type.startsWith('video')
      if (isAudio || isVideo) {
        const base64 = await readFileAsBase64(file)
        const maxBytes = isAudio
          ? useConnectionStore.getState().settings.maxAudioBytes
          : useConnectionStore.getState().settings.maxVideoBytes
        if (!base64 || file.size > maxBytes) {
          useToastStore.getState().show('error', t('fileTooLarge'))
          return
        }
        const duration = Math.round(await getMediaDuration(file))
        const id = generateClientMessageId()
        if (isAudio) {
          useRoomStore.getState().addMessage({
            id,
            userId: myId ?? '',
            userName: myName ?? '',
            audioData: base64,
            duration,
            mime: file.type,
            timestamp: Date.now(),
            sending: true,
          })
          sendChatAudioMessage(id, base64, duration, file.type)
        } else {
          useRoomStore.getState().addMessage({
            id,
            userId: myId ?? '',
            userName: myName ?? '',
            videoData: base64,
            duration,
            mime: file.type,
            timestamp: Date.now(),
            sending: true,
          })
          sendChatVideoMessage(id, base64, duration, file.type)
        }
        return
      }
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

  // Envia um arquivo de áudio ou vídeo (upload) para a sala.
  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const isAudio = file.type.startsWith('audio')
    const isVideo = file.type.startsWith('video')
    if (!isAudio && !isVideo) {
      useToastStore.getState().show('error', t('fileInvalid'))
      return
    }
    const base64 = await readFileAsBase64(file)
    const maxBytes = isAudio
      ? useConnectionStore.getState().settings.maxAudioBytes
      : useConnectionStore.getState().settings.maxVideoBytes
    if (!base64 || file.size > maxBytes) {
      useToastStore.getState().show('error', t('fileTooLarge'))
      return
    }
    const duration = Math.round(await getMediaDuration(file))
    const id = generateClientMessageId()
    if (isAudio) {
      useRoomStore.getState().addMessage({
        id,
        userId: myId ?? '',
        userName: myName ?? '',
        audioData: base64,
        duration,
        mime: file.type,
        timestamp: Date.now(),
        sending: true,
      })
      sendChatAudioMessage(id, base64, duration, file.type)
    } else {
      useRoomStore.getState().addMessage({
        id,
        userId: myId ?? '',
        userName: myName ?? '',
        videoData: base64,
        duration,
        mime: file.type,
        timestamp: Date.now(),
        sending: true,
      })
      sendChatVideoMessage(id, base64, duration, file.type)
    }
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
    // Mesmo com hasStream=true, confirma que a stream ainda tem track de vídeo
    // viva e não-muda (no mobile a câmera pode ter sido liberada pelo sistema
    // após uma live longa); se não, reabre antes de iniciar.
    const warm = videoRec.streamRef.current
    const warmVideo = warm?.getVideoTracks()[0]
    const warmUsable = !!warm && warmVideo?.readyState === 'live' && !warmVideo.muted
    if (!videoRec.hasStream || !warmUsable) {
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
    liveRtc.stopBroadcast()
    if (liveTimerRef.current) {
      clearInterval(liveTimerRef.current)
      liveTimerRef.current = null
    }
    setIsLiveBroadcasting(false)
    setCameraPickerOpen(false)
    sendLiveStop()
    // No mobile (iOS), re-adquirir o getUserMedia logo após parar é instável
    // (câmera ainda ocupada), então a stream fica quente para a próxima live e é
    // liberada ao sair da sala "Ao vivo". No desktop o preview de gravação deve
    // fechar normalmente ao encerrar a live.
    if (!isMobileDevice()) {
      videoRec.cancelRecording()
    }
  }

  function copyLiveLinkToClipboard() {
    getLiveViewerUrl().then((url) => {
      navigator.clipboard.writeText(url).then(() => {
        useToastStore.getState().show('success', t('linkCopied'))
      }).catch(() => {
        useToastStore.getState().show('error', t('linkCopyError'))
      })
    })
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

      // WebRTC: cria um RTCPeerConnection para cada espectador atual da sala.
      const users = useRoomStore.getState().users
      const viewerIds = users
        .filter((u) => u.id !== myId && u.room === currentRoomId)
        .map((u) => u.id)
      liveRtc.startBroadcast(stream, viewerIds)
    }
  }, [broadcaster?.userId])

  // React to LiveStopped for Ao vivo
  useEffect(() => {
    if (!isAoVivo) return
    if (!broadcaster) {
      if (isLiveBroadcasting) {
        liveRtc.stopBroadcast()
        if (liveTimerRef.current) {
          clearInterval(liveTimerRef.current)
          liveTimerRef.current = null
        }
        setIsLiveBroadcasting(false)
        setCameraPickerOpen(false)
        // No mobile mantém a câmera quente (ver handleStopLiveBroadcast); no
        // desktop encerra o preview de gravação junto com a live.
        if (!isMobileDevice()) {
          videoRec.cancelRecording()
        }
      }
    }
  }, [broadcaster])

  // Ao sair da sala "Ao vivo", libera a câmera (a stream fica quente entre
  // lives dentro da sala, mas não pode ficar ligada depois de sair).
  useEffect(() => {
    if (!isAoVivo) {
      if (videoRec.hasStream) videoRec.closeCamera()
      setCameraPickerOpen(false)
    }
  }, [isAoVivo])

  if (!connected || !currentRoomName) return null

  // Sala de multilives: sem chat, apenas o mosaico de câmeras ao vivo.
  if (currentRoomName === MULTILIVE_ROOM_NAME) {
    return (
      <div className="chat-panel chat-panel--multilive">
        <MultiLiveMosaic />
      </div>
    )
  }

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span className="chat-header-name">#{currentRoomName}</span>
        <span className="chat-header-count">{t('messagesCount', { count: messages.length })}</span>
        <button
          className="chat-fullscreen-btn"
          onClick={toggleFullscreen}
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
      </div>

      {isAoVivo && broadcaster && broadcaster.userId !== myId && (
        <LiveViewer />
      )}

      {isRadioRoom && (
        <RadioBot />
      )}

      <div className="chat-messages">
        {!loadingMessages && hasMoreMessages && (
          <div className="chat-load-older">
            <button
              className="btn btn-load-older"
              disabled={isLoadingMore}
              onClick={() => currentRoomId && requestChatHistoryPage(currentRoomId)}
            >
              {isLoadingMore ? t('loading') + '...' : t('loadOlderMessages')}
            </button>
          </div>
        )}
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

      {Object.keys(typingUsers).length > 0 && (
        <div className="chat-typing" aria-live="polite">
          <span className="chat-typing-dots" aria-hidden="true"><i /><i /><i /></span>
          <span>{typingNames(typingUsers, myId, t)}</span>
        </div>
      )}

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
                    <span>{t('requestingTakeover')}</span>
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
                    title={t('chooseCamera')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                  </button>
                  <button
                    onClick={handleCancelVideoRecording}
                    className="chat-cancel-btn"
                    title={t('cancel')}
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
                    title={t('chooseCamera')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                  </button>
                  <button
                    onClick={handleCancelVideoRecording}
                    className="chat-cancel-btn"
                    title={t('cancel')}
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
                      title={t('stopAndSend')}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="6" width="12" height="12" rx="2" />
                      </svg>
                    </button>
                  ) : (
                    <button
                      onClick={handleBeginRecording}
                      className="chat-recording-start-btn"
                      title={t('startRecording')}
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
                  <span className="live-indicator-label">{t('liveBadge')}</span>
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
                  onClick={copyLiveLinkToClipboard}
                  className="chat-cam-settings-btn"
                  title={t('copyLiveLink')}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                </button>
                <button
                  onClick={() => videoRec.enumerateDevices().then(() => setCameraPickerOpen(!cameraPickerOpen))}
                  className="chat-cam-settings-btn"
                  title={t('chooseCamera')}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </button>
                <button
                  onClick={handleStopLiveBroadcast}
                  className="chat-live-stop-btn"
                  title={t('liveStop')}
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
                title={t('cancel')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
              <button
                onClick={handleStopAudioRecording}
                className="chat-recording-stop-btn"
                title={t('send')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
            </>
          ) : (
            <>
              {isGuest ? (
                <span className="chat-guest-hint">{t('guestChatHint')}</span>
              ) : (
                <input
                  type="text"
                  value={text}
                  onChange={(e) => { setText(e.target.value); signalTyping(e.target.value) }}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder={t('messagePlaceholder', { room: currentRoomName ?? '' })}
                  className="chat-input"
                />
              )}
              {!isAoVivo && (
                <button
                  onClick={handleStartAudioRecording}
                  className="chat-mic-btn"
                  title={t('recordAudio')}
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
                  title={isLiveBroadcasting ? t('liveBroadcasting') : takeoverRequested ? t('liveRequestSent') : t('liveStart')}
                >
                  {takeoverRequested ? (
                    <span className="chat-live-request-text">{t('liveRequesting')}</span>
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
                  title={t('recordVideo')}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="23 7 16 12 23 17 23 7" />
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                  </svg>
                </button>
              )}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="chat-file-btn"
                title={t('sendFile')}
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
              {!isGuest && (
                <button
                  onClick={() => imageInputRef.current?.click()}
                  className="chat-img-btn"
                  title={t('sendImage')}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                </button>
              )}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleImageSelected}
              />
              {!isGuest && (
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
              )}
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
  const [reactionsOpen, setReactionsOpen] = useState(false)

  function toggleReaction(emoji: string) {
    if (!msg.id) return
    sendMessageReaction(msg.id, emoji)
    setReactionsOpen(false)
  }

  function formatDuration(seconds: number): string {
    const total = Math.max(0, Math.round(seconds))
    const m = Math.floor(total / 60)
    const s = total % 60
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
      <div className={`chat-bubble ${isSelf ? 'chat-bubble--self' : ''} ${msg.audioData ? 'chat-bubble--audio' : ''}`}>
        {!isSelf && (
          <div className="chat-bubble-author" style={{ color: avatarColor }}>
            {msg.userName}
          </div>
        )}
        {msg.forwarded && (
          <div className="chat-bubble-forwarded">{tStatic('forwarded')}</div>
        )}
        {msg.audioData || msg.videoData || msg.imageData ? (
          <ChatMedia
            audioData={msg.audioData}
            videoData={msg.videoData}
            imageData={msg.imageData}
            duration={msg.duration}
            userName={msg.userName}
            timestamp={msg.timestamp}
            mime={msg.mime}
            onLightbox={onLightbox}
          />
        ) : (
          <div className="chat-bubble-text">{renderTextWithLinks(msg.text ?? '')}</div>
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
                onClick={() => { if (msg.id) resendMessage(msg.id) }}
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
              title={tStatic('delete')}
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
