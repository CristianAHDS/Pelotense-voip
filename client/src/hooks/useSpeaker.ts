import { useCallback } from 'react'
import { useVoiceStore } from '../stores/voiceStore.ts'

export function useSpeaker() {
  const { volume, setVolume } = useVoiceStore()

  const play = useCallback((_data: ArrayBuffer) => {
  }, [])

  return { volume, setVolume, play }
}
