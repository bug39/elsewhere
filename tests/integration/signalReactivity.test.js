/**
 * Integration tests for Preact signal reactivity patterns
 *
 * Tests signal behavior used throughout the app including:
 * - Signal triggers subscribers on update
 * - Batch multiple updates
 * - Effect cleanup on dispose
 * - No stale closure with signal.value
 * - Computed signal updates correctly
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { signal, computed, effect, batch } from '@preact/signals'

describe('signalReactivity', () => {
  describe('basic signal behavior', () => {
    it('should trigger subscribers on update', () => {
      const count = signal(0)
      const subscriber = vi.fn()

      // Subscribe via effect
      const dispose = effect(() => {
        subscriber(count.value)
      })

      // Initial call
      expect(subscriber).toHaveBeenCalledTimes(1)
      expect(subscriber).toHaveBeenCalledWith(0)

      // Update
      count.value = 5
      expect(subscriber).toHaveBeenCalledTimes(2)
      expect(subscriber).toHaveBeenCalledWith(5)

      dispose()
    })

    it('should not trigger on same value assignment', () => {
      const value = signal('test')
      const subscriber = vi.fn()

      const dispose = effect(() => {
        subscriber(value.value)
      })

      expect(subscriber).toHaveBeenCalledTimes(1)

      // Same value
      value.value = 'test'
      expect(subscriber).toHaveBeenCalledTimes(1)

      // Different value
      value.value = 'changed'
      expect(subscriber).toHaveBeenCalledTimes(2)

      dispose()
    })
  })

  describe('batch updates', () => {
    it('should batch multiple updates into single notification', () => {
      const a = signal(1)
      const b = signal(2)
      const subscriber = vi.fn()

      const dispose = effect(() => {
        subscriber(a.value + b.value)
      })

      expect(subscriber).toHaveBeenCalledTimes(1)
      expect(subscriber).toHaveBeenCalledWith(3)

      // Batch multiple updates
      batch(() => {
        a.value = 10
        b.value = 20
      })

      // Should only trigger once for both updates
      expect(subscriber).toHaveBeenCalledTimes(2)
      expect(subscriber).toHaveBeenLastCalledWith(30)

      dispose()
    })

    it('should work with nested batches', () => {
      const value = signal(0)
      const subscriber = vi.fn()

      const dispose = effect(() => {
        subscriber(value.value)
      })

      expect(subscriber).toHaveBeenCalledTimes(1)

      batch(() => {
        value.value = 1
        batch(() => {
          value.value = 2
        })
        value.value = 3
      })

      // Only final value matters, notified once
      expect(subscriber).toHaveBeenCalledTimes(2)
      expect(subscriber).toHaveBeenLastCalledWith(3)

      dispose()
    })
  })

  describe('effect cleanup', () => {
    it('should cleanup effect on dispose', () => {
      const value = signal(0)
      const subscriber = vi.fn()

      const dispose = effect(() => {
        subscriber(value.value)
      })

      expect(subscriber).toHaveBeenCalledTimes(1)

      dispose()

      // Should not be called after dispose
      value.value = 100
      expect(subscriber).toHaveBeenCalledTimes(1)
    })

    it('should run cleanup function returned from effect', () => {
      const value = signal(0)
      const cleanup = vi.fn()

      const dispose = effect(() => {
        value.value // Subscribe
        return cleanup
      })

      expect(cleanup).not.toHaveBeenCalled()

      // Update triggers cleanup of previous effect
      value.value = 1
      expect(cleanup).toHaveBeenCalledTimes(1)

      // Dispose also triggers cleanup
      dispose()
      expect(cleanup).toHaveBeenCalledTimes(2)
    })
  })

  describe('stale closure prevention', () => {
    it('should always read current value with signal.value', () => {
      const count = signal(0)

      // Simulate a callback that might have stale closure
      const callback = () => count.value

      expect(callback()).toBe(0)

      count.value = 5
      expect(callback()).toBe(5)

      count.value = 100
      expect(callback()).toBe(100)
    })

    it('should not have stale values in async callbacks', async () => {
      const value = signal('initial')

      const asyncCallback = async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
        return value.value
      }

      const promise1 = asyncCallback()
      value.value = 'changed'
      const promise2 = asyncCallback()

      // Both should see current value at time of .value access
      expect(await promise1).toBe('changed')
      expect(await promise2).toBe('changed')
    })
  })

  describe('computed signals', () => {
    it('should update when dependencies change', () => {
      const firstName = signal('John')
      const lastName = signal('Doe')
      const fullName = computed(() => `${firstName.value} ${lastName.value}`)

      expect(fullName.value).toBe('John Doe')

      firstName.value = 'Jane'
      expect(fullName.value).toBe('Jane Doe')

      lastName.value = 'Smith'
      expect(fullName.value).toBe('Jane Smith')
    })

    it('should only recompute when accessed after change', () => {
      const count = signal(0)
      const computeFn = vi.fn(() => count.value * 2)
      const doubled = computed(computeFn)

      // Not computed until accessed
      expect(computeFn).not.toHaveBeenCalled()

      // First access computes
      expect(doubled.value).toBe(0)
      expect(computeFn).toHaveBeenCalledTimes(1)

      // Same value doesn't recompute
      expect(doubled.value).toBe(0)
      expect(computeFn).toHaveBeenCalledTimes(1)

      // Change dependency
      count.value = 5

      // Access triggers recompute
      expect(doubled.value).toBe(10)
      expect(computeFn).toHaveBeenCalledTimes(2)
    })

    it('should chain computed signals correctly', () => {
      const base = signal(2)
      const doubled = computed(() => base.value * 2)
      const quadrupled = computed(() => doubled.value * 2)

      expect(quadrupled.value).toBe(8)

      base.value = 3
      expect(quadrupled.value).toBe(12)
    })

    it('should work with effects', () => {
      const a = signal(1)
      const b = signal(2)
      const sum = computed(() => a.value + b.value)
      const subscriber = vi.fn()

      const dispose = effect(() => {
        subscriber(sum.value)
      })

      expect(subscriber).toHaveBeenCalledWith(3)

      a.value = 10
      expect(subscriber).toHaveBeenCalledWith(12)

      b.value = 20
      expect(subscriber).toHaveBeenCalledWith(30)

      dispose()
    })
  })

  describe('object signal patterns', () => {
    it('should detect object mutation via reassignment', () => {
      const state = signal({ count: 0 })
      const subscriber = vi.fn()

      const dispose = effect(() => {
        subscriber(state.value.count)
      })

      expect(subscriber).toHaveBeenCalledWith(0)

      // Direct mutation doesn't trigger (expected behavior)
      state.value.count = 5
      expect(subscriber).toHaveBeenCalledTimes(1) // Still 1

      // Reassignment triggers
      state.value = { count: 10 }
      expect(subscriber).toHaveBeenCalledTimes(2)
      expect(subscriber).toHaveBeenLastCalledWith(10)

      dispose()
    })

    it('should use spread pattern for immutable updates', () => {
      const state = signal({ x: 0, y: 0 })
      const subscriber = vi.fn()

      const dispose = effect(() => {
        subscriber({ ...state.value })
      })

      expect(subscriber).toHaveBeenCalledTimes(1)

      // Immutable update pattern
      state.value = { ...state.value, x: 100 }
      expect(subscriber).toHaveBeenCalledTimes(2)
      expect(subscriber).toHaveBeenLastCalledWith({ x: 100, y: 0 })

      dispose()
    })
  })
})
