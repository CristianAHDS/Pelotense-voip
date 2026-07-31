import { useMicrophone } from './useMicrophone.ts'
import { useSpeaker } from './useSpeaker.ts'
import { useVoiceStore } from '../stores/voiceStore.ts'

export function useVoice() {
  const mic = useMicrophone()
  const speaker = useSpeaker()
  const { level, rxLevel } = useVoiceStore()

  return {
    ...mic,
    ...speaker,
    level,
    rxLevel,
  }
}
