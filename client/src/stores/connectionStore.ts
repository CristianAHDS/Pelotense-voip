import { create } from 'zustand';

export type LoginStep = 'none' | 'email_required' | 'confirm_required' | 'error';

interface ConnectionStore {
  connected: boolean;
  reconnecting: boolean;
  id: string | null;
  name: string | null;
  admin: boolean;
  loginStep: LoginStep;
  loginError: string;
  setConnected: (id: string, name: string, admin?: boolean) => void;
  setDisconnected: () => void;
  setReconnecting: (reconnecting: boolean) => void;
  setLoginStep: (step: LoginStep, error?: string) => void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  connected: false,
  reconnecting: false,
  id: null,
  name: null,
  admin: false,
  loginStep: 'none',
  loginError: '',
  setConnected: (id, name, admin = false) =>
    set({ connected: true, id, name, admin, reconnecting: false, loginStep: 'none', loginError: '' }),
  setDisconnected: () =>
    set({ connected: false, id: null, name: null, admin: false, reconnecting: false, loginStep: 'none', loginError: '' }),
  setReconnecting: (reconnecting) => set({ reconnecting }),
  setLoginStep: (step, error = '') => set({ loginStep: step, loginError: error }),
}));
