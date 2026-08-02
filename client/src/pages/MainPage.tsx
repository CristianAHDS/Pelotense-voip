import React, { useState, useEffect } from 'react';
import { ConnectionPanel } from '../components/ConnectionPanel.tsx';
import { RoomList } from '../components/RoomList.tsx';
import { UserList } from '../components/UserList.tsx';
import { VoiceControls } from '../components/VoiceControls.tsx';
import { ChatPanel } from '../components/ChatPanel.tsx';
import { PrivateChatPanel } from '../components/PrivateChatPanel.tsx';
import { Toasts } from '../components/Toasts.tsx';
import { AccountPrefsModal } from '../components/AccountPrefsModal.tsx';
import { FullscreenChat } from '../components/FullscreenChat.tsx';
import { FullscreenDm } from '../components/FullscreenDm.tsx';
import { AdminPanel } from '../components/AdminPanel.tsx';
import { MiniPlayer } from '../components/MiniPlayer.tsx';
import { SplashScreen } from '../components/SplashScreen.tsx';
import { WelcomePanel } from '../components/WelcomePanel.tsx';
import { useConnectionStore } from '../stores/connectionStore.ts';
import { useAccountStore } from '../stores/accountStore.ts';
import { useRoomStore } from '../stores/roomStore.ts';
import { usePrivateChatStore } from '../stores/privateChatStore.ts';
import { useSettingsStore, applyTheme } from '../stores/settingsStore.ts';
import { useT } from '../i18n/index.ts';

type SheetTab = 'rooms' | 'users' | 'connection';

export function MainPage() {
  const connected = useConnectionStore((s) => s.connected);
  const reconnecting = useConnectionStore((s) => s.reconnecting);
  const connectedName = useConnectionStore((s) => s.name);
  const isAdmin = useConnectionStore((s) => s.admin);
  const currentRoomName = useRoomStore((s) => s.currentRoomName);
  const unreadCount = usePrivateChatStore((s) => Object.keys(s.unread).length);
  const theme = useSettingsStore((s) => s.theme);
  const cycleTheme = useSettingsStore((s) => s.cycleTheme);
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const t = useT();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetTab, setSheetTab] = useState<SheetTab>('rooms');

  useEffect(() => {
    setSheetOpen(false);
  }, [connected]);

  // No mobile, o sheet de salas/usuários/conexão deve fechar sozinho quando o
  // usuário entra numa sala (ao invés de ficar cobrindo o chat).
  useEffect(() => {
    if (currentRoomName) {
      setSheetOpen(false);
    }
  }, [currentRoomName]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const statusClass = reconnecting
    ? 'reconnecting'
    : connected
      ? 'connected'
      : 'disconnected';

  const statusLabel = reconnecting
    ? t('statusReconnecting')
    : connected
      ? t('statusConnected')
      : t('statusOffline');

  const statusTitle = reconnecting
    ? t('statusReconnecting')
    : connected
      ? t('connectedAs', { name: connectedName ?? '' })
      : t('statusOffline');

  const openSheet = (tab: SheetTab) => {
    setSheetTab(tab);
    setSheetOpen(true);
  };

  const themeIcon = theme === 'auto' ? '◐' : theme === 'light' ? '☀' : '☾';

  return (
    <div className="app-container">
      <div className="app-bg" aria-hidden="true" />
      <SplashScreen />
      <header className="app-header">
        <button
          className="menu-toggle"
          onClick={() => openSheet('rooms')}
          aria-label={t('openMenu')}
        >
          {sheetOpen ? '✕' : '☰'}
        </button>
        <h1>
          <img src="/img/radio-logo.png" alt="" className="app-logo" />
          <span className="app-title">Rádio Pelotense</span>
          <span className="app-title-freq">99.5 FM</span>
        </h1>
        {currentRoomName && (
          <div
            className="current-room-indicator"
            role="status"
            aria-live="polite"
            title={t('youAreIn', { room: currentRoomName })}
          >
            <span className="current-room-indicator-dot" />
            <span className="current-room-indicator-label">{t('statusIn')}</span>
            <span className="current-room-indicator-name">{currentRoomName}</span>
          </div>
        )}
        <div
          className={`status-pill status-pill--${statusClass}`}
          title={statusTitle}
          role="status"
          aria-live="polite"
        >
          <span className="status-pill-dot" />
          <span>{statusLabel}</span>
        </div>
        <button
          className="theme-toggle"
          onClick={cycleTheme}
          aria-label={t('themeToggle', { theme })}
          title={t('themeToggle', { theme })}
        >
          {themeIcon}
        </button>
        <button
          className="lang-toggle"
          onClick={() => setLanguage(language === 'pt' ? 'en' : 'pt')}
          aria-label={t('language')}
          title={t('language')}
        >
          {language === 'pt' ? 'EN' : 'PT'}
        </button>
        <button
          className="menu-toggle menu-toggle--users"
          onClick={() => openSheet('users')}
          aria-label={t('toggleUsers')}
        >
          Users {sheetOpen ? '✕' : '▸'}
          {unreadCount > 0 && (
            <span className="menu-unread-badge">{unreadCount}</span>
          )}
        </button>
      </header>

      <div className="app-content">
        <aside className="sidebar sidebar-left">
          <MiniPlayer />
          <ConnectionPanel />
          <VoiceControls />
          {connected && (
            <button
              className="btn btn-account-prefs"
              onClick={() => useAccountStore.getState().openPrefs()}
              title={t('accountPrefs')}
            >
              ⚙ {t('accountPrefs')}
            </button>
          )}
          {connected && isAdmin && (
            <button
              className="btn btn-account-prefs btn-admin"
              onClick={() => useAccountStore.getState().openAdmin()}
              title={t('adminPanel')}
            >
              🛡 {t('adminPanel')}
            </button>
          )}
        </aside>
        <main className="main-content">
          <RoomList />
          <WelcomePanel />
          <ChatPanel />
          <PrivateChatPanel />
        </main>
        <aside className="sidebar sidebar-right">
          <UserList />
        </aside>
      </div>

      <div className="voice-mobile-bar">
        <VoiceControls compact />
      </div>

      {sheetOpen && (
        <div
          className="mobile-sheet-backdrop mobile-sheet-backdrop--visible"
          onClick={() => setSheetOpen(false)}
        />
      )}
      <div className={`mobile-sheet ${sheetOpen ? 'mobile-sheet--open' : ''}`}>
        <div className="mobile-sheet-handle" />
        <div className="mobile-sheet-tabs">
          <button
            className={`mobile-sheet-tab ${sheetTab === 'rooms' ? 'mobile-sheet-tab--active' : ''}`}
            onClick={() => setSheetTab('rooms')}
          >
            {t('roomsTab')}
          </button>
          <button
            className={`mobile-sheet-tab ${sheetTab === 'users' ? 'mobile-sheet-tab--active' : ''}`}
            onClick={() => setSheetTab('users')}
          >
            {t('peopleTab')}
          </button>
          <button
            className={`mobile-sheet-tab ${sheetTab === 'connection' ? 'mobile-sheet-tab--active' : ''}`}
            onClick={() => setSheetTab('connection')}
          >
            {t('connectionTab')}
          </button>
        </div>
        <div className="mobile-sheet-body">
          {sheetTab === 'rooms' && <RoomList />}
          {sheetTab === 'users' && <UserList />}
          {sheetTab === 'connection' && <ConnectionPanel />}
        </div>
      </div>

      <Toasts />
      <AccountPrefsModal />
      <FullscreenChat />
      <FullscreenDm />
      <AdminPanel />
    </div>
  );
}
