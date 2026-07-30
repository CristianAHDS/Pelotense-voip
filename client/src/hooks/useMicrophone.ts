import { useCallback } from 'react'
import { useVoiceStore } from '../stores/voiceStore.ts'
import { getVoiceManager } from '../services/connectionService.ts'

export function useMicrophone() {
  const { muted } = useVoiceStore()

  const startMic = useCallback(async () => {
    const vm = getVoiceManager()
    if (vm) await vm.startMicrophone()
  }, [])

  const stopMic = useCallback(() => {
    const vm = getVoiceManager()
    if (vm) vm.stopMicrophone()
  }, [])

  const toggleMute = useCallback(async () => {
    const next = !muted
    const vm = getVoiceManager()
    if (next) {
      vm?.stopMicrophone()
      useVoiceStore.getState().setMuted(true)
    } else {
      useVoiceStore.getState().setMuted(false)
      if (vm) {
        const ok = await vm.startMicrophone()
        if (!ok) useVoiceStore.getState().setMuted(true)
      }
    }
  }, [muted])

  const setMuted = useCallback(async (v: boolean) => {
    const vm = getVoiceManager()
    if (v) {
      vm?.stopMicrophone()
      useVoiceStore.getState().setMuted(true)
    } else {
      useVoiceStore.getState().setMuted(false)
      if (vm) {
        const ok = await vm.startMicrophone()
        if (!ok) useVoiceStore.getState().setMuted(true)
      }
    }
  }, [])

  return { muted, toggleMute, setMuted, startMic, stopMic }
}
