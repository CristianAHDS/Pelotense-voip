import React, { useState } from 'react'
import { ConnectionPanel } from '../components/ConnectionPanel.tsx'
import { RoomList } from '../components/RoomList.tsx'
import { UserList } from '../components/UserList.tsx'
import { VoiceControls } from '../components/VoiceControls.tsx'

export function MainPage() {
  const [showLeft, setShowLeft] = useState(false)
  const [showRight, setShowRight] = useState(false)

  const closeLeft = () => setShowLeft(false)
  const closeRight = () => setShowRight(false)
  const closeAll = () => { setShowLeft(false); setShowRight(false) }

  return (
    <div className="app-container">
      <header className="app-header">
        <button
          className="menu-toggle"
          onClick={() => { setShowLeft(!showLeft); setShowRight(false) }}
          aria-label="Toggle controls"
        >
          {showLeft ? '✕' : '☰'}
        </button>
        <h1>VoIP Client</h1>
        <button
          className="menu-toggle"
          onClick={() => { setShowRight(!showRight); setShowLeft(false) }}
          aria-label="Toggle users"
        >
          Users {showRight ? '✕' : '▸'}
        </button>
      </header>

      <div className="app-content">
        {showLeft && <div className="sidebar-backdrop" onClick={closeLeft} />}
        {showRight && <div className="sidebar-backdrop" onClick={closeRight} />}

        <aside className={`sidebar sidebar-left ${showLeft ? 'sidebar--open' : ''}`}>
          <ConnectionPanel />
          <VoiceControls />
        </aside>
        <main className="main-content">
          <RoomList />
        </main>
        <aside className={`sidebar sidebar-right ${showRight ? 'sidebar--open' : ''}`}>
          <UserList />
        </aside>
      </div>
    </div>
  )
}
