import { useCallback } from 'react'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { useSettingsStore } from '../stores/settingsStore.ts'
import { disconnectFromServer } from '../services/connectionService.ts'

export function useConnection() {
  const { connected, id, name } = useConnectionStore()
  const { serverHost, serverWsPort } = useSettingsStore()

  const disconnect = useCallback(() => {
    disconnectFromServer()
  }, [])

  return { connected, id, name, serverHost, serverWsPort, disconnect }
}
