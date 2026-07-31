import { create } from 'zustand';

interface ConnectionStore {
  connected: boolean;
  reconnecting: boolean;
  id: string | null;
  name: string | null;
  admin: boolean;
  setConnected: (id: string, name: string, admin?: boolean) => void;
  setDisconnected: () => void;
  setReconnecting: (reconnecting: boolean) => void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  connected: false,
  reconnecting: false,
  id: null,
  name: null,
  admin: false,
  setConnected: (id, name, admin = false) =>
    set({ connected: true, id, name, admin, reconnecting: false }),
  setDisconnected: () =>
    set({ connected: false, id: null, name: null, admin: false, reconnecting: false }),
  setReconnecting: (reconnecting) => set({ reconnecting }),
}));
