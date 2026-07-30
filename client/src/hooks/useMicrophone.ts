import { useCallback } from 'react'
import { useVoiceStore } from '../stores/voiceStore.ts'

export function useMicrophone() {
  const { muted, toggleMute, setMuted } = useVoiceStore()

  const startMic = useCallback(async () => {
    return true
  }, [])

  const stopMic = useCallback(() => {
  }, [])

  return { muted, toggleMute, setMuted, startMic, stopMic }
}
