import React, { useEffect, useState } from 'react'

// V2.16 — Splash de abertura com a identidade da rádio. Some sozinho.
export function SplashScreen() {
  const [phase, setPhase] = useState<'visible' | 'fading' | 'gone'>('visible')

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('fading'), 1400)
    const t2 = setTimeout(() => setPhase('gone'), 1900)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [])

  if (phase === 'gone') return null

  return (
    <div
      className={`splash-screen${phase === 'fading' ? ' splash-screen--fading' : ''}`}
      aria-hidden="true"
    >
      <div className="splash-logo-box">
        <img src="/img/radio-logo.png" alt="" className="splash-logo-img" />
      </div>
      <div className="splash-title">Rádio Pelotense</div>
      <div className="splash-subtitle">99.5 FM</div>
      <div className="splash-eq" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <i key={i} />
        ))}
      </div>
    </div>
  )
}
