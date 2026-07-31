import React, { useState, useRef, useEffect } from 'react'
import { PrivateChatMsg } from '../types/index.ts'
import { usePrivateChatStore } from '../stores/privateChatStore.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useAccountStore } from '../stores/accountStore.ts'
import { useToastStore } from '../stores/toastStore.ts'
import { sendPrivateMessage, sendPrivateAudioMessage, sendPrivateVideoMessage, sendPrivateImageMessage, deletePrivateMessage, generateClientMessageId } from '../services/connectionService.ts'
import { useMediaRecorder } from '../hooks/useMediaRecorder.ts'
import { userColor, initials } from '../ui/avatar.ts'
import { fileToResizedBase64, imageBase64ExceedsLimit } from '../utils/image.ts'
import { ChatMedia } from './ChatMedia.tsx'
import { useT, tStatic } from '../i18n/index.ts'

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

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
      />
    )
  }
  return <div className="chat-bubble-text">{msg.text}</div>
}

export function PrivateChatPanel() {
  const t = useT()
  const connected = useConnectionStore((s) => s.connected)
  const activeUserId = usePrivateChatStore((s) => s.activeUserId)
  const activeUserName = usePrivateChatStore((s) => s.activeUserName)
  const messages = usePrivateChatStore((s) => activeUserId ? (s.messages[activeUserId] ?? []) : [])
  const closeChat = usePrivateChatStore((s) => s.closeChat)
  const myId = useConnectionStore((s) => s.id)
  const myName = useConnectionStore((s) => s.name)
  const myAdmin = useConnectionStore((s) => s.admin)
  const toggleDmFullscreen = useAccountStore((s) => s.toggleDmFullscreen)
  const [text, setText] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

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

  async function handleSendAudio() {
    if (!activeUserId) return
    if (audioRecorder.recording) {
      const blob = await audioRecorder.stop()
      if (blob) {
        const data = await blobToBase64(blob)
        const duration = Math.max(1, Math.round(blob.size / 16000))
        const id = generateClientMessageId()
        usePrivateChatStore.getState().addMessage({
          id,
          fromUserId: myId ?? '',
          fromUserName: myName ?? '',
          toUserId: activeUserId,
          audioData: data,
          duration,
          timestamp: Date.now(),
          sending: true,
        })
        sendPrivateAudioMessage(activeUserId, id, data, duration)
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
        const id = generateClientMessageId()
        usePrivateChatStore.getState().addMessage({
          id,
          fromUserId: myId ?? '',
          fromUserName: myName ?? '',
          toUserId: activeUserId,
          videoData: data,
          duration,
          timestamp: Date.now(),
          sending: true,
        })
        sendPrivateVideoMessage(activeUserId, id, data, duration)
      }
    } else {
      videoRecorder.start()
    }
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
                  {msg.sending && (
                    <span className="chat-bubble-sending">enviando…</span>
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
            onClick={() => handleSendAudio()}
            className={`chat-mic-btn ${audioRecorder.recording ? 'recording' : ''}`}
            disabled={!audioRecorder.supported || videoRecorder.recording}
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
            onClick={() => handleSendVideo()}
            className={`chat-cam-btn ${videoRecorder.recording ? 'recording' : ''}`}
            disabled={!videoRecorder.supported || audioRecorder.recording}
            title={tStatic('recordVideo')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
          </button>
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
        </div>
      </div>
    </div>
  )
}
