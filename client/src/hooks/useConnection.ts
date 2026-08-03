import { useCallback } from 'react'
import { useConnectionStore } from '../stores/connectionStore.ts'
import { disconnectFromServer } from '../services/connectionService.ts'

export function useConnection() {
  const { connected, id, name } = useConnectionStore()

  const disconnect = useCallback(() => {
    disconnectFromServer()
  }, [])

  return { connected, id, name, disconnect }
}
