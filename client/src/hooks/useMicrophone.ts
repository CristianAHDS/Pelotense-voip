import { useCallback } from 'react'
import { useVoiceStore } from '../stores/voiceStore.ts'
import { getVoiceManager } from '../services/connectionService.ts'

export function useMicrophone() {
  const { muted, talking } = useVoiceStore()

  const startMic = useCallback(async () => {
    const vm = getVoiceManager()
    if (vm) await vm.startMicrophone()
  }, [])

  const stopMic = useCallback(() => {
    const vm = getVoiceManager()
    if (vm) vm.stopMicrophone()
  }, [])

  const toggleMute = useCallback(() => {
    const next = !muted
    useVoiceStore.getState().setMuted(next)
    const vm = getVoiceManager()
    if (next) {
      vm?.stopMicrophone()
    } else {
      vm?.startMicrophone()
    }
  }, [muted])

  const setMuted = useCallback((v: boolean) => {
    const vm = getVoiceManager()
    if (v) {
      vm?.stopMicrophone()
    } else {
      vm?.startMicrophone()
    }
    useVoiceStore.getState().setMuted(v)
  }, [])

  return { muted, talking, toggleMute, setMuted, startMic, stopMic }
}
