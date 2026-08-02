import React from 'react'

// Logo de ondas de rádio (V2.16 splash / V2.3 mini-player).
export function RadioLogo({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Torre / corpo do rádio */}
      <rect x="19" y="26" width="10" height="16" rx="2" fill="currentColor" opacity="0.9" />
      <circle cx="24" cy="16" r="5" fill="currentColor" />
      {/* Ondas emitidas */}
      <path
        d="M32 11a10 10 0 0 1 0 10"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M37 7a16 16 0 0 1 0 18"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        opacity="0.55"
      />
      <path
        d="M42 3a22 22 0 0 1 0 26"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        opacity="0.28"
      />
      <path
        d="M16 11a10 10 0 0 0 0 10"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M11 7a16 16 0 0 0 0 18"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  )
}
