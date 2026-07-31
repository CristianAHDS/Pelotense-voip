import { describe, it, expect, beforeEach } from 'vitest'
import { useSettingsStore, applyTheme, type ThemeMode } from '../stores/settingsStore.ts'

function currentTheme(): string | null {
  return document.documentElement.getAttribute('data-theme')
}

describe('settingsStore theme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    useSettingsStore.setState({ theme: 'auto' })
  })

  it('mantém valores padrão', () => {
    expect(useSettingsStore.getState().theme).toBe('auto')
  })

  it('setTheme persiste e aplica o data-theme no root', () => {
    useSettingsStore.getState().setTheme('dark')
    expect(currentTheme()).toBe('dark')
    expect(localStorage.getItem('voip_theme')).toBe('dark')

    useSettingsStore.getState().setTheme('light')
    expect(currentTheme()).toBe('light')
  })

  it('no modo auto remove o data-theme (segue o sistema)', () => {
    useSettingsStore.getState().setTheme('light')
    useSettingsStore.getState().setTheme('auto')
    expect(currentTheme()).toBeNull()
  })

  it('cycleTheme alterna auto → light → dark → auto', () => {
    expect(useSettingsStore.getState().theme).toBe('auto')
    useSettingsStore.getState().cycleTheme()
    expect(useSettingsStore.getState().theme).toBe('light')
    useSettingsStore.getState().cycleTheme()
    expect(useSettingsStore.getState().theme).toBe('dark')
    useSettingsStore.getState().cycleTheme()
    expect(useSettingsStore.getState().theme).toBe('auto')
  })

  it('applyTheme aplica o tema informado diretamente', () => {
    applyTheme('light' as ThemeMode)
    expect(currentTheme()).toBe('light')
    applyTheme('auto' as ThemeMode)
    expect(currentTheme()).toBeNull()
  })
})
