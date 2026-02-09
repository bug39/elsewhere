/**
 * Unit tests for tooltipState.js
 *
 * Tests the global tooltip dismiss signal including:
 * - Initial counter state
 * - dismissAllTooltips increments counter
 * - Counter pattern prevents stale closures
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { tooltipDismissCounter, dismissAllTooltips } from '../../../src/studio/state/tooltipState'

describe('tooltipState', () => {
  beforeEach(() => {
    // Reset the counter to a known state
    // Note: In production, the counter only increments and is never reset
    // For testing, we track the value before tests
  })

  describe('tooltipDismissCounter', () => {
    it('should be a signal with numeric value', () => {
      expect(typeof tooltipDismissCounter.value).toBe('number')
    })

    it('should have an initial value of 0 or greater', () => {
      // The counter may have been incremented by previous tests
      expect(tooltipDismissCounter.value).toBeGreaterThanOrEqual(0)
    })
  })

  describe('dismissAllTooltips', () => {
    it('should increment the counter when called', () => {
      const initialValue = tooltipDismissCounter.value

      dismissAllTooltips()

      expect(tooltipDismissCounter.value).toBe(initialValue + 1)
    })

    it('should increment counter on each call', () => {
      const initialValue = tooltipDismissCounter.value

      dismissAllTooltips()
      dismissAllTooltips()
      dismissAllTooltips()

      expect(tooltipDismissCounter.value).toBe(initialValue + 3)
    })

    it('should use counter pattern (not boolean) to avoid stale closures', () => {
      // This test documents the design decision:
      // Using a counter instead of a boolean allows components with stale
      // closure references to still detect dismiss events by comparing
      // their captured value against the current signal value
      const capturedValue = tooltipDismissCounter.value

      dismissAllTooltips()

      // A component can detect the dismiss by comparing:
      // capturedValue !== tooltipDismissCounter.value
      expect(capturedValue).not.toBe(tooltipDismissCounter.value)
    })
  })
})
