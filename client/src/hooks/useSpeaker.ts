import { useCallback } from 'react'
import { useVoiceStore } from '../stores/voiceStore.ts'
import { getVoiceManager } from '../services/connectionService.ts'

export function useSpeaker() {
  const { volume } = useVoiceStore()

  const setVolume = useCallback((v: number) => {
    useVoiceStore.getState().setVolume(v)
    const vm = getVoiceManager()
    if (vm) vm.setVolume(v)
  }, [])

  return { volume, setVolume }
}
