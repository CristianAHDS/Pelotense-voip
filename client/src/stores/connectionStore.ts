import { create } from 'zustand';

interface ConnectionStore {
  connected: boolean;
  reconnecting: boolean;
  id: string | null;
  name: string | null;
  setConnected: (id: string, name: string) => void;
  setDisconnected: () => void;
  setReconnecting: (reconnecting: boolean) => void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  connected: false,
  reconnecting: false,
  id: null,
  name: null,
  setConnected: (id, name) =>
    set({ connected: true, id, name, reconnecting: false }),
  setDisconnected: () =>
    set({ connected: false, id: null, name: null, reconnecting: false }),
  setReconnecting: (reconnecting) => set({ reconnecting }),
}));
