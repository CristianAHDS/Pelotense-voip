import React, { useEffect } from 'react'
import { useVoice } from '../hooks/useVoice.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useRoomStore } from '../stores/roomStore.ts'
import { useVoiceStore } from '../stores/voiceStore.ts'

interface Props {
  compact?: boolean
}

const IS_HTTPS = window.location.protocol === 'https:'
const HTTPS_CLIENT_PORT = 3443
const HTTPS_HOST = `${window.location.hostname}:${HTTPS_CLIENT_PORT}`

export function VoiceControls({ compact }: Props) {
  const { muted, volume, level, rxLevel, toggleMute, setVolume } = useVoice()
  const connected = useConnectionStore((s) => s.connected)
  const currentRoomName = useRoomStore((s) => s.currentRoomName)
  const micDisabled = currentRoomName === 'Boletins gravados'

  useEffect(() => {
    if (currentRoomName === 'Boletins gravados') {
      const state = useVoiceStore.getState()
      if (!state.muted) {
        state.setMuted(true)
      }
    }
  }, [currentRoomName])

  const pct = Math.round((Number.isFinite(level) ? level : 0) * 100)
  const bars = compact ? 8 : 10
  const filled = Math.round((Number.isFinite(level) ? level : 0) * bars)
  const rxPct = Math.round((Number.isFinite(rxLevel) ? rxLevel : 0) * 100)
  const rxFilled = Math.round((Number.isFinite(rxLevel) ? rxLevel : 0) * bars)

  if (!IS_HTTPS) {
    if (compact) {
      return (
        <div className="voice-bar">
          <button disabled className="voice-bar-mic muted">
            HTTPS
          </button>
          <div className="voice-bar-vu">
            <div className="voice-bar-vu-track">
              {Array.from({ length: bars }, (_, i) => (
                <div key={i} className="vu-bar" />
              ))}
            </div>
            <span className="voice-bar-vu-label">--%</span>
          </div>
          <div className="voice-bar-volume">
            <label>Vol</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
            />
          </div>
          <a
            href={`https://${HTTPS_HOST}/`}
            target="_blank"
            rel="noopener noreferrer"
            className="voice-bar-https-link"
          >
            HTTPS
          </a>
        </div>
      )
    }

    return (
      <div className="panel voice-controls">
        <h2>Voice</h2>
        <div className="voice-controls-row">
          <button disabled className="btn btn-mic muted">
            Mic indisponível
          </button>
        </div>
        <div className="wss-hint" style={{ marginTop: 8 }}>
          Para ativar o microfone, acesse{' '}
          <a href={`https://${HTTPS_HOST}/`} target="_blank" rel="noopener noreferrer">
            https://{HTTPS_HOST}/
          </a>
          {' '}e aceite o certificado SSL.
        </div>
        <div className="vu-meter">
          <div className="vu-meter-label">Mic</div>
          <div className="vu-meter-track">
            {Array.from({ length: bars }, (_, i) => (
              <div key={i} className="vu-bar" />
            ))}
          </div>
          <div className="vu-meter-value">--%</div>
        </div>
      </div>
    )
  }

  if (compact) {
    return (
      <div className="voice-bar">
        <button
          onClick={toggleMute}
          disabled={!connected || micDisabled}
          className={`voice-bar-mic ${(muted || micDisabled) ? 'muted' : 'unmuted'}`}
        >
          {micDisabled ? 'Muted' : muted ? 'Unmute' : 'Mute'}
        </button>
        <div className="voice-bar-vu">
          <div className="voice-bar-vu-track">
            {Array.from({ length: bars }, (_, i) => (
              <div
                key={i}
                className={`vu-bar ${i < filled ? 'vu-bar--active' : ''} ${
                  i >= bars * 0.7 ? 'vu-bar--high' : i >= bars * 0.4 ? 'vu-bar--mid' : 'vu-bar--low'
                }`}
              />
            ))}
          </div>
          <span className="voice-bar-vu-label">{pct}%</span>
        </div>
        <div className="voice-bar-vu voice-bar-vu--rx">
          <div className="voice-bar-vu-track">
            {Array.from({ length: bars }, (_, i) => (
              <div
                key={i}
                className={`vu-bar ${i < rxFilled ? 'vu-bar--active' : ''} ${
                  i >= bars * 0.7 ? 'vu-bar--high' : i >= bars * 0.4 ? 'vu-bar--mid' : 'vu-bar--low'
                }`}
              />
            ))}
          </div>
          <span className="voice-bar-vu-label voice-bar-vu-label--rx">RX {rxPct}%</span>
        </div>
        <div className="voice-bar-volume">
          <label>Vol</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="panel voice-controls">
      <h2>Voice</h2>
      <div className="voice-controls-row">
        <button
          onClick={toggleMute}
          disabled={!connected || micDisabled}
          className={`btn btn-mic ${(muted || micDisabled) ? 'muted' : 'unmuted'}`}
        >
          {micDisabled ? 'Muted' : muted ? 'Unmute' : 'Mute'}
        </button>
      </div>
      <div className="volume-control">
        <label>Volume: {Math.round(volume * 100)}%</label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
        />
      </div>
      <div className="vu-meter">
        <div className="vu-meter-label">Mic</div>
        <div className="vu-meter-track">
          {Array.from({ length: bars }, (_, i) => (
            <div
              key={i}
              className={`vu-bar ${i < filled ? 'vu-bar--active' : ''} ${
                i >= bars * 0.7 ? 'vu-bar--high' : i >= bars * 0.4 ? 'vu-bar--mid' : 'vu-bar--low'
              }`}
            />
          ))}
        </div>
        <div className="vu-meter-value">{pct}%</div>
      </div>
      <div className="vu-meter vu-meter--rx">
        <div className="vu-meter-label">RX</div>
        <div className="vu-meter-track">
          {Array.from({ length: bars }, (_, i) => (
            <div
              key={i}
              className={`vu-bar ${i < rxFilled ? 'vu-bar--active' : ''} ${
                i >= bars * 0.7 ? 'vu-bar--high' : i >= bars * 0.4 ? 'vu-bar--mid' : 'vu-bar--low'
              }`}
            />
          ))}
        </div>
        <div className="vu-meter-value">{rxPct}%</div>
      </div>
    </div>
  )
}
