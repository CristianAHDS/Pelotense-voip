import React, { useState, useEffect } from 'react';
import { ConnectionPanel } from '../components/ConnectionPanel.tsx';
import { RoomList } from '../components/RoomList.tsx';
import { UserList } from '../components/UserList.tsx';
import { VoiceControls } from '../components/VoiceControls.tsx';
import { ChatPanel } from '../components/ChatPanel.tsx';
import { PrivateChatPanel } from '../components/PrivateChatPanel.tsx';
import { Toasts } from '../components/Toasts.tsx';
import { useConnectionStore } from '../stores/connectionStore.ts';
import { usePrivateChatStore } from '../stores/privateChatStore.ts';
import { useSettingsStore, applyTheme } from '../stores/settingsStore.ts';

type SheetTab = 'rooms' | 'users' | 'connection';

export function MainPage() {
  const connected = useConnectionStore((s) => s.connected);
  const reconnecting = useConnectionStore((s) => s.reconnecting);
  const connectedName = useConnectionStore((s) => s.name);
  const unreadCount = usePrivateChatStore((s) => Object.keys(s.unread).length);
  const theme = useSettingsStore((s) => s.theme);
  const cycleTheme = useSettingsStore((s) => s.cycleTheme);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetTab, setSheetTab] = useState<SheetTab>('rooms');

  useEffect(() => {
    setSheetOpen(false);
  }, [connected]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const statusClass = reconnecting
    ? 'reconnecting'
    : connected
      ? 'connected'
      : 'disconnected';

  const statusLabel = reconnecting
    ? 'Reconectando'
    : connected
      ? 'Conectado'
      : 'Offline';

  const statusTitle = reconnecting
    ? 'Reconnecting...'
    : connected
      ? `Connected as ${connectedName}`
      : 'Disconnected';

  const openSheet = (tab: SheetTab) => {
    setSheetTab(tab);
    setSheetOpen(true);
  };

  const themeIcon = theme === 'auto' ? '◐' : theme === 'light' ? '☀' : '☾';

  return (
    <div className="app-container">
      <header className="app-header">
        <button
          className="menu-toggle"
          onClick={() => openSheet('rooms')}
          aria-label="Open menu"
        >
          {sheetOpen ? '✕' : '☰'}
        </button>
        <h1>VoIP Client Rádio Pelotense 99.5FM</h1>
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
          aria-label={`Theme: ${theme}`}
          title={`Tema: ${theme}`}
        >
          {themeIcon}
        </button>
        <button
          className="menu-toggle menu-toggle--users"
          onClick={() => openSheet('users')}
          aria-label="Toggle users"
        >
          Users {sheetOpen ? '✕' : '▸'}
          {unreadCount > 0 && (
            <span className="menu-unread-badge">{unreadCount}</span>
          )}
        </button>
      </header>

      <div className="app-content">
        <aside className="sidebar sidebar-left">
          <ConnectionPanel />
          <VoiceControls />
        </aside>
        <main className="main-content">
          <RoomList />
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
            Salas
          </button>
          <button
            className={`mobile-sheet-tab ${sheetTab === 'users' ? 'mobile-sheet-tab--active' : ''}`}
            onClick={() => setSheetTab('users')}
          >
            Pessoas
          </button>
          <button
            className={`mobile-sheet-tab ${sheetTab === 'connection' ? 'mobile-sheet-tab--active' : ''}`}
            onClick={() => setSheetTab('connection')}
          >
            Conexão
          </button>
        </div>
        <div className="mobile-sheet-body">
          {sheetTab === 'rooms' && <RoomList />}
          {sheetTab === 'users' && <UserList />}
          {sheetTab === 'connection' && <ConnectionPanel />}
        </div>
      </div>

      <Toasts />
    </div>
  );
}
