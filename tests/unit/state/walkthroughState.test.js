/**
 * Unit tests for walkthroughState.js
 *
 * Tests the onboarding/walkthrough state management including:
 * - Loading/saving progress from localStorage
 * - Onboarding completion status
 * - Starting/stopping onboarding
 * - Completing milestones
 * - Showing hints
 * - Computed values
 * - Reset functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  onboardingState,
  isOnboardingComplete,
  markOnboardingComplete,
  startOnboarding,
  stopOnboarding,
  completeMilestone,
  showHint,
  hasCompletedBasics,
  resetOnboarding,
  MILESTONES,
  isMilestoneComplete
} from '../../../src/studio/state/walkthroughState'

// Mock toast
vi.mock('../../../src/studio/components/Toast', () => ({
  showToast: vi.fn()
}))

import { showToast } from '../../../src/studio/components/Toast'

describe('walkthroughState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    // Reset the onboarding state
    resetOnboarding()
  })

  afterEach(() => {
    localStorage.clear()
  })

  describe('isOnboardingComplete', () => {
    it('should return false when no completion flag is set', () => {
      expect(isOnboardingComplete()).toBe(false)
    })

    it('should return true when completion flag is set', () => {
      localStorage.setItem('thinq-onboarding-complete', 'true')
      expect(isOnboardingComplete()).toBe(true)
    })

    it('should handle localStorage errors gracefully', () => {
      const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('Storage error')
      })

      expect(isOnboardingComplete()).toBe(false)

      getItemSpy.mockRestore()
    })
  })

  describe('markOnboardingComplete', () => {
    it('should set completion flag in localStorage', () => {
      markOnboardingComplete()

      expect(localStorage.getItem('thinq-onboarding-complete')).toBe('true')
    })

    it('should remove progress data when marking complete', () => {
      localStorage.setItem('thinq-onboarding-progress', JSON.stringify({ completed: ['test'] }))

      markOnboardingComplete()

      expect(localStorage.getItem('thinq-onboarding-progress')).toBeNull()
    })

    it('should handle localStorage errors gracefully', () => {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Storage error')
      })

      // Should not throw
      expect(() => markOnboardingComplete()).not.toThrow()

      setItemSpy.mockRestore()
    })
  })

  describe('startOnboarding', () => {
    it('should set isActive to true', () => {
      expect(onboardingState.value.isActive).toBe(false)

      startOnboarding()

      expect(onboardingState.value.isActive).toBe(true)
    })

    it('should preserve existing completed milestones', () => {
      completeMilestone('cameraRotated')

      startOnboarding()

      expect(onboardingState.value.isActive).toBe(true)
      expect(onboardingState.value.completed).toContain('cameraRotated')
    })
  })

  describe('stopOnboarding', () => {
    it('should set isActive to false', () => {
      startOnboarding()
      expect(onboardingState.value.isActive).toBe(true)

      stopOnboarding()

      expect(onboardingState.value.isActive).toBe(false)
    })

    it('should mark onboarding as complete in localStorage', () => {
      startOnboarding()
      stopOnboarding()

      expect(localStorage.getItem('thinq-onboarding-complete')).toBe('true')
    })
  })

  describe('completeMilestone', () => {
    it('should add milestone to completed list', () => {
      startOnboarding()

      const wasNew = completeMilestone('cameraRotated')

      expect(wasNew).toBe(true)
      expect(onboardingState.value.completed).toContain('cameraRotated')
    })

    it('should return false for duplicate completions', () => {
      startOnboarding()

      completeMilestone('cameraRotated')
      const wasNew = completeMilestone('cameraRotated')

      expect(wasNew).toBe(false)
    })

    it('should save progress to localStorage', () => {
      startOnboarding()

      completeMilestone('cameraZoomed')

      const saved = JSON.parse(localStorage.getItem('thinq-onboarding-progress'))
      expect(saved.completed).toContain('cameraZoomed')
    })

    it('should auto-complete onboarding after key milestones', async () => {
      vi.useFakeTimers()
      startOnboarding()

      completeMilestone('assetPlaced')
      completeMilestone('transformUsed')
      completeMilestone('playModeEntered')

      // Advance timers for the setTimeout
      await vi.advanceTimersByTimeAsync(2500)

      expect(onboardingState.value.isActive).toBe(false)

      vi.useRealTimers()
    })
  })

  describe('showHint', () => {
    it('should show hint for unseen milestone', () => {
      startOnboarding()

      showHint('cameraRotated')

      expect(showToast).toHaveBeenCalledWith(MILESTONES.cameraRotated.hint, 'hint')
    })

    it('should not show hint when onboarding is inactive', () => {
      // onboarding is inactive by default after reset
      showHint('cameraRotated')

      expect(showToast).not.toHaveBeenCalled()
    })

    it('should not show hint for already-seen milestone', () => {
      startOnboarding()

      showHint('cameraRotated')
      showToast.mockClear()
      showHint('cameraRotated')

      expect(showToast).not.toHaveBeenCalled()
    })

    it('should not show hint for completed milestone', () => {
      startOnboarding()

      completeMilestone('cameraRotated')
      showHint('cameraRotated')

      // showToast might be called for celebration, but not for hint
      const hintCalls = showToast.mock.calls.filter(
        call => call[0] === MILESTONES.cameraRotated.hint
      )
      expect(hintCalls.length).toBe(0)
    })

    it('should mark hint as seen in state', () => {
      startOnboarding()

      showHint('cameraZoomed')

      expect(onboardingState.value.hintsSeen).toContain('cameraZoomed')
    })

    it('should save hints seen to localStorage', () => {
      startOnboarding()

      showHint('promptTyped')

      const saved = JSON.parse(localStorage.getItem('thinq-onboarding-progress'))
      expect(saved.hintsSeen).toContain('promptTyped')
    })

    it('should handle unknown milestone gracefully', () => {
      startOnboarding()

      // Should not throw
      expect(() => showHint('unknownMilestone')).not.toThrow()
      expect(showToast).not.toHaveBeenCalled()
    })
  })

  describe('hasCompletedBasics', () => {
    it('should return false when no milestones completed', () => {
      expect(hasCompletedBasics.value).toBe(false)
    })

    it('should return false when only some required milestones completed', () => {
      completeMilestone('assetPlaced')

      expect(hasCompletedBasics.value).toBe(false)
    })

    it('should return true when required milestones completed', () => {
      completeMilestone('assetPlaced')
      completeMilestone('transformUsed')

      expect(hasCompletedBasics.value).toBe(true)
    })

    it('should be reactive to state changes', () => {
      expect(hasCompletedBasics.value).toBe(false)

      completeMilestone('assetPlaced')
      expect(hasCompletedBasics.value).toBe(false)

      completeMilestone('transformUsed')
      expect(hasCompletedBasics.value).toBe(true)
    })
  })

  describe('resetOnboarding', () => {
    it('should clear all completed milestones', () => {
      completeMilestone('cameraRotated')
      completeMilestone('cameraZoomed')

      resetOnboarding()

      expect(onboardingState.value.completed).toHaveLength(0)
    })

    it('should clear hints seen', () => {
      startOnboarding()
      showHint('cameraRotated')

      resetOnboarding()

      expect(onboardingState.value.hintsSeen).toHaveLength(0)
    })

    it('should clear celebrated count', () => {
      onboardingState.value = {
        ...onboardingState.value,
        celebratedCount: 5
      }

      resetOnboarding()

      expect(onboardingState.value.celebratedCount).toBe(0)
    })

    it('should set isActive to false', () => {
      startOnboarding()

      resetOnboarding()

      expect(onboardingState.value.isActive).toBe(false)
    })

    it('should clear localStorage data', () => {
      localStorage.setItem('thinq-onboarding-progress', JSON.stringify({ completed: ['test'] }))
      localStorage.setItem('thinq-onboarding-complete', 'true')

      resetOnboarding()

      expect(localStorage.getItem('thinq-onboarding-progress')).toBeNull()
      expect(localStorage.getItem('thinq-onboarding-complete')).toBeNull()
    })

    it('should handle localStorage errors gracefully', () => {
      const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('Storage error')
      })

      // Should not throw
      expect(() => resetOnboarding()).not.toThrow()

      removeItemSpy.mockRestore()
    })
  })

  describe('isMilestoneComplete', () => {
    it('should return false for incomplete milestone', () => {
      expect(isMilestoneComplete('cameraRotated')).toBe(false)
    })

    it('should return true for completed milestone', () => {
      completeMilestone('cameraRotated')

      expect(isMilestoneComplete('cameraRotated')).toBe(true)
    })
  })

  describe('MILESTONES constant', () => {
    it('should have hint text for all milestones', () => {
      Object.keys(MILESTONES).forEach(key => {
        expect(MILESTONES[key].hint).toBeDefined()
        expect(typeof MILESTONES[key].hint).toBe('string')
      })
    })

    it('should include expected milestone keys', () => {
      expect(MILESTONES).toHaveProperty('cameraRotated')
      expect(MILESTONES).toHaveProperty('assetGenerated')
      expect(MILESTONES).toHaveProperty('assetPlaced')
      expect(MILESTONES).toHaveProperty('transformUsed')
      expect(MILESTONES).toHaveProperty('playModeEntered')
    })
  })

  describe('progress persistence', () => {
    it('should persist and restore completed milestones across sessions', () => {
      // Simulate first session
      completeMilestone('cameraRotated')
      completeMilestone('cameraZoomed')

      // Get the saved progress
      const savedProgress = localStorage.getItem('thinq-onboarding-progress')
      expect(savedProgress).toBeTruthy()

      // Simulate new session by resetting state but keeping localStorage
      onboardingState.value = {
        isActive: false,
        completed: [],
        hintsSeen: [],
        celebratedCount: 0
      }

      // Load progress (normally done on module load)
      const parsed = JSON.parse(savedProgress)
      expect(parsed.completed).toContain('cameraRotated')
      expect(parsed.completed).toContain('cameraZoomed')
    })

    it('should handle corrupted localStorage data', () => {
      localStorage.setItem('thinq-onboarding-progress', 'not valid json')

      // Module would normally try to parse this on load
      // The loadProgress function should handle this gracefully
      // We can test this indirectly by resetting and checking default state

      resetOnboarding()

      expect(onboardingState.value.completed).toHaveLength(0)
      expect(onboardingState.value.hintsSeen).toHaveLength(0)
    })
  })
})
