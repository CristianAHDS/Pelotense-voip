import React, { useEffect, useState, useMemo } from 'react'

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

  const particles = useMemo(() =>
    Array.from({ length: 12 }, (_, i) => ({
      id: i,
      left: `${Math.random() * 100}%`,
      size: `${4 + Math.random() * 8}px`,
      delay: `${Math.random() * 3}s`,
      duration: `${4 + Math.random() * 6}s`,
    })),
  [])

  if (phase === 'gone') return null

  return (
    <div
      className={`splash-screen${phase === 'fading' ? ' splash-screen--fading' : ''}`}
      aria-hidden="true"
    >
      <div className="splash-particles">
        {particles.map((p) => (
          <div
            key={p.id}
            className="splash-particle"
            style={{
              left: p.left,
              width: p.size,
              height: p.size,
              animationDelay: p.delay,
              animationDuration: p.duration,
            }}
          />
        ))}
      </div>
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
