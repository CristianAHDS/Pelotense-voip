import React, { useEffect } from 'react'
import { MainPage } from './pages/MainPage.tsx'
import { ViewerPage } from './pages/ViewerPage.tsx'
import { JoinPage } from './pages/JoinPage.tsx'
import { setNotificationSound, setNotificationVolume } from './services/messageSound.ts'
import './App.css'

export function App() {
  useEffect(() => {
    const sound = localStorage.getItem('voip_notif_sound') ?? 'beep'
    const volume = parseFloat(localStorage.getItem('voip_notif_volume') ?? '0.7')
    setNotificationSound(sound)
    setNotificationVolume(isNaN(volume) ? 0.7 : volume)
  }, [])

  if (window.location.pathname.startsWith('/viewer')) {
    return <ViewerPage />
  }
  if (window.location.pathname.startsWith('/join')) {
    return <JoinPage />
  }
  return <MainPage />
}
