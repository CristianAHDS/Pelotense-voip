import { EventType, EventPayloads, EventListener } from '../types/index.js'
import { logger } from './logger.js'

type AnyPayload = EventPayloads[keyof EventPayloads]

class EventBus {
  private listeners = new Map<string, Set<EventListener>>()

  on<E extends EventType>(event: E, listener: EventListener<EventPayloads[E]>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(listener as EventListener)
  }

  off<E extends EventType>(event: E, listener: EventListener<EventPayloads[E]>): void {
    const set = this.listeners.get(event)
    if (set) {
      set.delete(listener as EventListener)
      if (set.size === 0) this.listeners.delete(event)
    }
  }

  emit<E extends EventType>(event: E, payload: EventPayloads[E]): void {
    const set = this.listeners.get(event)
    if (!set || set.size === 0) return
    logger.debug('EventBus', `Emitting ${event}`, payload)
    set.forEach((listener) => {
      try {
        listener(payload)
      } catch (err) {
        logger.error('EventBus', `Error in listener for ${event}`, err)
      }
    })
  }

  clear(): void {
    this.listeners.clear()
  }
}

export const eventBus = new EventBus()
