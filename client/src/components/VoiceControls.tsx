import React, { useEffect, useState, useRef } from 'react';
import { useVoice } from '../hooks/useVoice.ts';
import { useMicTest } from '../hooks/useMicTest.ts';
import { useConnectionStore } from '../stores/connectionStore.ts';
import { useRoomStore } from '../stores/roomStore.ts';
import { useVoiceStore } from '../stores/voiceStore.ts';
import { getVoiceManager } from '../services/connectionService.ts';
import type { MicrophoneInfo } from '../audio/index.ts';
import { isTauri } from '../utils/isTauri.ts';
import { useT } from '../i18n/index.ts';

interface Props {
  compact?: boolean;
}

const IS_HTTPS = window.location.protocol === 'https:' || isTauri();
const HTTPS_CLIENT_PORT = 3443;
const HTTPS_HOST = `${window.location.hostname}:${HTTPS_CLIENT_PORT}`;
const MIC_DEVICE_KEY = 'voip_mic_device';

function loadSavedMic(): string {
  try {
    return localStorage.getItem(MIC_DEVICE_KEY) ?? '';
  } catch {
    /* ignore */
  }
  return '';
}

function saveMicDevice(deviceId: string): void {
  try {
    localStorage.setItem(MIC_DEVICE_KEY, deviceId);
  } catch {
    /* ignore */
  }
}

export function VoiceControls({ compact }: Props) {
  const t = useT();
  const {
    muted,
    volume,
    level,
    rxLevel,
    noiseSuppression,
    toggleMute,
    setVolume,
  } = useVoice();
  const micTest = useMicTest();
  const prevMutedRef = useRef(false);
  const connected = useConnectionStore((s) => s.connected);
  const currentRoomName = useRoomStore((s) => s.currentRoomName);
  const micDisabled = currentRoomName === 'Boletins gravados';
  const [micDevices, setMicDevices] = useState<MicrophoneInfo[]>([]);
  const [micDevice, setMicDevice] = useState(loadSavedMic);
  useEffect(() => {
    if (currentRoomName === 'Boletins gravados') {
      const state = useVoiceStore.getState();
      if (!state.muted) {
        state.setMuted(true);
      }
    }
  }, [currentRoomName]);

  useEffect(() => {
    if (!connected) return;
    const vm = getVoiceManager();
    if (!vm) return;
    let cancelled = false;
    vm.listMicrophones().then((devices) => {
      if (cancelled) return;
      setMicDevices(devices);
      const saved = loadSavedMic();
      if (devices.some((d) => d.deviceId === saved)) {
        setMicDevice(saved);
        void vm.setMicrophone(saved);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [connected]);

  function handleMicChange(deviceId: string): void {
    setMicDevice(deviceId);
    saveMicDevice(deviceId);
    const vm = getVoiceManager();
    void vm?.setMicrophone(deviceId);
  }

  function handleMicTest(): void {
    if (micTest.testing) {
      micTest.stop();
      useVoiceStore.getState().setMuted(prevMutedRef.current);
    } else {
      prevMutedRef.current = muted;
      useVoiceStore.getState().setMuted(true);
      micTest.start();
    }
  }

  function handleNoiseSuppression(): void {
    const newValue = !noiseSuppression;
    useVoiceStore.getState().setNoiseSuppression(newValue);
    const vm = getVoiceManager();
    void vm?.setNoiseSuppression(newValue);
  }

  const pct = Math.round((Number.isFinite(level) ? level : 0) * 100);
  const bars = compact ? 8 : 10;
  const filled = Math.round((Number.isFinite(level) ? level : 0) * bars);
  const rxPct = Math.round((Number.isFinite(rxLevel) ? rxLevel : 0) * 100);
  const rxFilled = Math.round((Number.isFinite(rxLevel) ? rxLevel : 0) * bars);

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
            <label>{t('vol')}</label>
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
      );
    }

    return (
      <div className="panel voice-controls">
        <h2>{t('voiceTitle')}</h2>
        <div className="voice-controls-row">
          <button disabled className="btn btn-mic muted">
            {t('micUnavailable')}
          </button>
        </div>
        <div className="wss-hint" style={{ marginTop: 8 }}>
          {t('micHttpsHintPre')}
          <a
            href={`https://${HTTPS_HOST}/`}
            target="_blank"
            rel="noopener noreferrer"
          >
            https://{HTTPS_HOST}/
          </a>
          {t('micHttpsHintPost')}
        </div>
        <div className="vu-meter">
          <div className="vu-meter-label">{t('micLabel')}</div>
          <div className="vu-meter-track">
            {Array.from({ length: bars }, (_, i) => (
              <div key={i} className="vu-bar" />
            ))}
          </div>
          <div className="vu-meter-value">--%</div>
        </div>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="voice-bar">
        <button
          onClick={toggleMute}
          disabled={!connected || micDisabled}
          className={`voice-bar-mic ${muted || micDisabled ? 'muted' : 'unmuted'}`}
        >
          {micDisabled ? t('muted') : muted ? t('unmute') : t('mute')}
        </button>
        {!muted && !micDisabled && level > 0.02 && (
          <div className="voice-wave">
            {Array.from({ length: 6 }, (_, i) => (
              <div
                key={i}
                className="voice-wave-bar"
                style={{ animationDelay: `${i * 0.12}s` }}
              />
            ))}
          </div>
        )}
        {micDevices.length > 1 && (
          <select
            className="voice-bar-mic-select"
            value={micDevice}
            onChange={(e) => handleMicChange(e.target.value)}
            title={t('selectMicrophone')}
            aria-label={t('selectMicrophone')}
            disabled={!connected}
          >
            <option value="">{t('defaultMic')}</option>
            {micDevices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || t('microphoneFallback', { n: i + 1 })}
              </option>
            ))}
          </select>
        )}
        <div className="voice-bar-vu">
          <div className="voice-bar-vu-track">
            {Array.from({ length: bars }, (_, i) => (
              <div
                key={i}
                className={`vu-bar ${i < filled ? 'vu-bar--active' : ''} ${
                  i >= bars * 0.7
                    ? 'vu-bar--high'
                    : i >= bars * 0.4
                      ? 'vu-bar--mid'
                      : 'vu-bar--low'
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
                  i >= bars * 0.7
                    ? 'vu-bar--high'
                    : i >= bars * 0.4
                      ? 'vu-bar--mid'
                      : 'vu-bar--low'
                }`}
              />
            ))}
          </div>
          <span className="voice-bar-vu-label voice-bar-vu-label--rx">
            {t('rxPct', { n: rxPct })}
          </span>
        </div>
        <div className="voice-bar-volume">
          <label>{t('vol')}</label>
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
    );
  }

  return (
    <div className="panel voice-controls">
      <h2>{t('voiceTitle')}</h2>
      <div className="voice-controls-row">
        <button
          onClick={toggleMute}
          disabled={!connected || micDisabled}
          className={`btn btn-mic ${muted || micDisabled ? 'muted' : 'unmuted'}`}
        >
          {micDisabled ? t('muted') : muted ? t('unmute') : t('mute')}
        </button>
      </div>
      {micDevices.length > 1 && (
        <div className="mic-select-wrap">
          <label className="mic-select-label">{t('microphoneLabel')}</label>
          <select
            className="mic-select"
            value={micDevice}
            onChange={(e) => handleMicChange(e.target.value)}
            disabled={!connected}
          >
            <option value="">{t('defaultMic')}</option>
            {micDevices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || t('microphoneFallback', { n: i + 1 })}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="volume-control">
        <label>{t('volumeLabel', { n: Math.round(volume * 100) })}</label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
        />
      </div>
      <div className="noise-suppression-control">
        <button
          className={`noise-suppression-toggle ${noiseSuppression ? 'on' : 'off'}`}
          onClick={handleNoiseSuppression}
          role="switch"
          aria-checked={noiseSuppression}
          title={
            noiseSuppression
              ? t('noiseSuppressionOff')
              : t('noiseSuppressionOn')
          }
        >
          <span className="noise-suppression-knob">
            <span className="noise-suppression-icon">
              {noiseSuppression ? '✓' : '✕'}
            </span>
          </span>
        </button>
        <span className="noise-suppression-text">{t('noiseSuppression')}</span>
      </div>
      <div className="mic-test-control">
        <button
          onClick={handleMicTest}
          className={`btn btn-mic-test ${micTest.testing ? 'testing' : ''}`}
          title={micTest.testing ? t('stopTestMic') : t('testMic')}
        >
          {micTest.testing ? t('micTestStop') : t('micTestStart')}
        </button>
        {micTest.testing && (
          <div className="mic-test-live">
            <div className="vu-meter">
              <div className="vu-meter-track">
                {Array.from({ length: bars }, (_, i) => (
                  <div
                    key={i}
                    className={`vu-bar ${i < Math.round(micTest.level * bars) ? 'vu-bar--active' : ''} ${
                      i >= bars * 0.7
                        ? 'vu-bar--high'
                        : i >= bars * 0.4
                          ? 'vu-bar--mid'
                          : 'vu-bar--low'
                    }`}
                  />
                ))}
              </div>
              <div className="vu-meter-value">
                {Math.round(micTest.level * 100)}%
              </div>
            </div>
            <span className="mic-test-hint">{t('micTestHint')}</span>
          </div>
        )}
      </div>
      <div className="vu-meter">
        <div className="vu-meter-label">{t('micLabel')}</div>
        <div className="vu-meter-track">
          {Array.from({ length: bars }, (_, i) => (
            <div
              key={i}
              className={`vu-bar ${i < filled ? 'vu-bar--active' : ''} ${
                i >= bars * 0.7
                  ? 'vu-bar--high'
                  : i >= bars * 0.4
                    ? 'vu-bar--mid'
                    : 'vu-bar--low'
              }`}
            />
          ))}
        </div>
        <div className="vu-meter-value">{pct}%</div>
      </div>
      <div className="vu-meter vu-meter--rx">
        <div className="vu-meter-label">{t('rxLabel')}</div>
        <div className="vu-meter-track">
          {Array.from({ length: bars }, (_, i) => (
            <div
              key={i}
              className={`vu-bar ${i < rxFilled ? 'vu-bar--active' : ''} ${
                i >= bars * 0.7
                  ? 'vu-bar--high'
                  : i >= bars * 0.4
                    ? 'vu-bar--mid'
                    : 'vu-bar--low'
              }`}
            />
          ))}
        </div>
        <div className="vu-meter-value">{rxPct}%</div>
      </div>
    </div>
  );
}
