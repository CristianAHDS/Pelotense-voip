import React, { useState } from 'react';
import { ConnectionPanel } from '../components/ConnectionPanel.tsx';
import { RoomList } from '../components/RoomList.tsx';
import { UserList } from '../components/UserList.tsx';
import { VoiceControls } from '../components/VoiceControls.tsx';
import { ChatPanel } from '../components/ChatPanel.tsx';
import { PrivateChatPanel } from '../components/PrivateChatPanel.tsx';
import { usePrivateChatStore } from '../stores/privateChatStore.ts';

export function MainPage() {
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);
  const unreadCount = usePrivateChatStore((s) => Object.keys(s.unread).length);

  const closeLeft = () => setShowLeft(false);
  const closeRight = () => setShowRight(false);
  const closeAll = () => {
    setShowLeft(false);
    setShowRight(false);
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <button
          className="menu-toggle"
          onClick={() => {
            setShowLeft(!showLeft);
            setShowRight(false);
          }}
          aria-label="Toggle controls"
        >
          {showLeft ? '✕' : '☰'}
        </button>
        <h1>VoIP Client Rádio Pelotense 99.5FM</h1>
        <button
          className="menu-toggle menu-toggle--users"
          onClick={() => {
            setShowRight(!showRight);
            setShowLeft(false);
          }}
          aria-label="Toggle users"
        >
          Users {showRight ? '✕' : '▸'}
          {unreadCount > 0 && (
            <span className="menu-unread-badge">{unreadCount}</span>
          )}
        </button>
      </header>

      <div className="app-content">
        {showLeft && <div className="sidebar-backdrop" onClick={closeLeft} />}
        {showRight && <div className="sidebar-backdrop" onClick={closeRight} />}

        <aside
          className={`sidebar sidebar-left ${showLeft ? 'sidebar--open' : ''}`}
        >
          <ConnectionPanel />
          <VoiceControls />
        </aside>
        <main className="main-content">
          <RoomList />
          <ChatPanel />
          <PrivateChatPanel />
        </main>
        <aside
          className={`sidebar sidebar-right ${showRight ? 'sidebar--open' : ''}`}
        >
          <UserList />
        </aside>
      </div>
      <div className="voice-mobile-bar">
        <VoiceControls compact />
      </div>
    </div>
  );
}
