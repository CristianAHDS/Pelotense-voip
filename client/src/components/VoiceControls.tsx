import React from 'react'
import { useVoice } from '../hooks/useVoice.ts'
import { useConnectionStore } from '../stores/connectionStore.ts'

export function VoiceControls() {
  const { muted, talking, volume, toggleMute, setVolume } = useVoice()
  const connected = useConnectionStore((s) => s.connected)

  return (
    <div className="panel voice-controls">
      <h2>Voice</h2>
      <div className="voice-controls-row">
        <button
          onClick={toggleMute}
          disabled={!connected}
          className={`btn btn-mic ${muted ? 'muted' : 'unmuted'}`}
        >
          {muted ? 'Unmute' : 'Mute'}
        </button>
        {talking && <span className="talking-indicator">Talking...</span>}
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
    </div>
  )
}
