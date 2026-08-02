import React, { useState } from 'react'
import { useOnboardingStore } from '../stores/onboardingStore.ts'
import { completeOnboarding } from '../services/connectionService.ts'
import { useT } from '../i18n/index.ts'
import { RadioLogo } from '../ui/RadioLogo.tsx'

const STEP_ICONS = ['📻', '🚪', '🎤', '💬', '🌓']

export function OnboardingTour() {
  const open = useOnboardingStore((s) => s.open)
  const close = useOnboardingStore((s) => s.close)
  const [step, setStep] = useState(0)
  const t = useT()

  if (!open) return null

  const steps = [
    { title: t('onbWelcomeTitle'), text: t('onbWelcomeText') },
    { title: t('onbRoomsTitle'), text: t('onbRoomsText') },
    { title: t('onbMicTitle'), text: t('onbMicText') },
    { title: t('onbDmTitle'), text: t('onbDmText') },
    { title: t('onbThemeTitle'), text: t('onbThemeText') },
  ]

  const isLast = step === steps.length - 1

  function finish() {
    completeOnboarding()
    close()
  }

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true" aria-label={t('onbTitle')}>
      <div className="onboarding-card">
        <RadioLogo size={56} className="onboarding-logo" />
        <div className="onboarding-icon">{STEP_ICONS[step]}</div>
        <h3 className="onboarding-title">{steps[step].title}</h3>
        <p className="onboarding-text">{steps[step].text}</p>

        <div className="onboarding-dots" aria-hidden="true">
          {steps.map((_, i) => (
            <span key={i} className={`onboarding-dot${i === step ? ' onboarding-dot--active' : ''}`} />
          ))}
        </div>

        <div className="onboarding-actions">
          {step > 0 && (
            <button type="button" className="btn btn-cancel" onClick={() => setStep((s) => s - 1)}>
              {t('backButton')}
            </button>
          )}
          {isLast ? (
            <button type="button" className="btn btn-primary" onClick={finish}>
              {t('onbDone')}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => setStep((s) => s + 1)}>
              {t('continue')}
            </button>
          )}
          <button type="button" className="btn onboarding-skip" onClick={finish}>
            {t('onbSkip')}
          </button>
        </div>
      </div>
    </div>
  )
}
