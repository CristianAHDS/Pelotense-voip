import React from 'react'
import { MainPage } from './pages/MainPage.tsx'
import { ViewerPage } from './pages/ViewerPage.tsx'
import { JoinPage } from './pages/JoinPage.tsx'
import './App.css'

export function App() {
  if (window.location.pathname.startsWith('/viewer')) {
    return <ViewerPage />
  }
  if (window.location.pathname.startsWith('/join')) {
    return <JoinPage />
  }
  return <MainPage />
}
