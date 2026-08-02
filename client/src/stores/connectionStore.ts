import { create } from 'zustand';
import { SystemSettings } from '../types/index.ts';

export type LoginStep = 'none' | 'email_required' | 'confirm_required' | 'error';

const DEFAULT_SETTINGS: SystemSettings = {
  video: { width: 1280, height: 720, fps: 30, bitrate: 2500000 },
  maxAudioBytes: 512 * 1024,
  maxVideoBytes: 5 * 1024 * 1024,
};

interface ConnectionStore {
  connected: boolean;
  reconnecting: boolean;
  id: string | null;
  name: string | null;
  admin: boolean;
  loginStep: LoginStep;
  loginError: string;
  maintenance: boolean;
  maintenanceMessage: string;
  guest: boolean;
  guestMode: boolean;
  settings: SystemSettings;
  setConnected: (id: string, name: string, admin?: boolean) => void;
  setDisconnected: () => void;
  setReconnecting: (reconnecting: boolean) => void;
  setLoginStep: (step: LoginStep, error?: string) => void;
  setMaintenance: (enabled: boolean, message?: string) => void;
  setGuest: (guest: boolean) => void;
  setGuestMode: (enabled: boolean) => void;
  setSettings: (settings: SystemSettings) => void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  connected: false,
  reconnecting: false,
  id: null,
  name: null,
  admin: false,
  loginStep: 'none',
  loginError: '',
  maintenance: false,
  maintenanceMessage: '',
  guest: false,
  guestMode: false,
  settings: DEFAULT_SETTINGS,
  setConnected: (id, name, admin = false) =>
    set({ connected: true, id, name, admin, reconnecting: false, loginStep: 'none', loginError: '' }),
  setDisconnected: () =>
    set({ connected: false, id: null, name: null, admin: false, reconnecting: false, loginStep: 'none', loginError: '', maintenance: false, maintenanceMessage: '', guest: false }),
  setReconnecting: (reconnecting) => set({ reconnecting }),
  setLoginStep: (step, error = '') => set({ loginStep: step, loginError: error }),
  setMaintenance: (enabled, message = '') => set({ maintenance: enabled, maintenanceMessage: message }),
  setGuest: (guest) => set({ guest }),
  setGuestMode: (enabled) => set({ guestMode: enabled }),
  setSettings: (settings) => set({ settings }),
}));
