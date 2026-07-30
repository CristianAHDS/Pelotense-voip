import { useMicrophone } from './useMicrophone.ts'
import { useSpeaker } from './useSpeaker.ts'
import { useVoiceStore } from '../stores/voiceStore.ts'

export function useVoice() {
  const mic = useMicrophone()
  const speaker = useSpeaker()
  const { talking } = useVoiceStore()

  return {
    ...mic,
    ...speaker,
    talking,
  }
}
