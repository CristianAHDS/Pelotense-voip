import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { notifyNewMessage, requestNotificationPermission } from '../services/notifications.ts'

class MockNotification {
  static permission: NotificationPermission = 'granted'
  static requestPermission = vi.fn(() => Promise.resolve('granted' as NotificationPermission))
  static instances: MockNotification[] = []
  onclick: (() => void) | null = null
  close = vi.fn()
  constructor(
    public title: string,
    public options?: NotificationOptions,
  ) {
    MockNotification.instances.push(this)
  }
}

const { soundMock } = vi.hoisted(() => ({ soundMock: vi.fn() }))
vi.mock('../services/messageSound.ts', () => ({
  playMessageSound: soundMock,
}))

describe('notifications', () => {
  beforeEach(() => {
    MockNotification.instances = []
    MockNotification.requestPermission.mockClear()
    soundMock.mockClear()
    ;(globalThis as unknown as { Notification: unknown }).Notification = MockNotification
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('não notifica nem toca som quando a aba está visível e focada', () => {
    notifyNewMessage('#sala', 'Ana: oi')
    expect(MockNotification.instances).toHaveLength(0)
    expect(soundMock).not.toHaveBeenCalled()
  })

  it('notifica e toca som quando a aba está oculta', () => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    notifyNewMessage('#sala', 'Ana: oi')
    expect(MockNotification.instances).toHaveLength(1)
    expect(MockNotification.instances[0].title).toBe('#sala')
    expect(MockNotification.instances[0].options).toMatchObject({ body: 'Ana: oi' })
    expect(soundMock).toHaveBeenCalledTimes(1)
  })

  it('toca som mesmo sem permissão de notificação', () => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    MockNotification.permission = 'denied'
    notifyNewMessage('#sala', 'oi')
    expect(MockNotification.instances).toHaveLength(0)
    expect(soundMock).toHaveBeenCalledTimes(1)
  })

  it('não quebra quando Notification não existe', () => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    ;(globalThis as unknown as { Notification: unknown }).Notification = undefined
    expect(() => notifyNewMessage('#sala', 'oi')).not.toThrow()
    expect(soundMock).toHaveBeenCalledTimes(1)
  })

  it('requestNotificationPermission pede quando ainda não decidido', () => {
    MockNotification.permission = 'default'
    requestNotificationPermission()
    expect(MockNotification.requestPermission).toHaveBeenCalledTimes(1)
  })

  it('requestNotificationPermission não pede quando já concedido', () => {
    MockNotification.permission = 'granted'
    requestNotificationPermission()
    expect(MockNotification.requestPermission).not.toHaveBeenCalled()
  })
})
