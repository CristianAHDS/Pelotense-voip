import React, { useEffect } from 'react'
import { useUpdaterStore } from '../stores/updaterStore.ts'
import { checkForUpdates, installAppUpdate } from '../updater/appUpdater.ts'
import { useT } from '../i18n/index.ts'

export function UpdatePrompt() {
  const t = useT()
  const status = useUpdaterStore((s) => s.status)
  const version = useUpdaterStore((s) => s.version)
  const error = useUpdaterStore((s) => s.error)

  useEffect(() => {
    const timer = setTimeout(() => {
      checkForUpdates()
    }, 4000)
    return () => clearTimeout(timer)
  }, [])

  if (status !== 'available' && status !== 'downloading' && status !== 'error') return null

  const downloading = status === 'downloading'

  return (
    <div className="modal-overlay">
      <div
        className="update-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('updateAvailable')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="update-modal-icon" aria-hidden="true">⬆</div>
        <h3>{t('updateAvailable')}</h3>
        {status === 'error' ? (
          <p className="update-modal-desc">{t('updateError')}</p>
        ) : (
          <p className="update-modal-desc">
            {t('updateAvailableDesc', { version: version ?? '' })}
          </p>
        )}

        {downloading ? (
          <div className="update-modal-progress" role="status">
            <span className="update-modal-spinner" aria-hidden="true" />
            {t('updateDownloading')}
          </div>
        ) : (
          <div className="update-modal-actions">
            <button className="btn btn-cancel" onClick={() => useUpdaterStore.getState().setDone()}>
              {t('updateLater')}
            </button>
            {status === 'error' ? (
              <button className="btn btn-primary" onClick={() => checkForUpdates()}>
                {t('updateRetry')}
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => installAppUpdate()}>
                {t('updateInstall')}
              </button>
            )}
          </div>
        )}
        {error && status === 'error' && <p className="update-modal-error">{error}</p>}
      </div>
    </div>
  )
}
