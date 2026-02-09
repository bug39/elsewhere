import { signal, computed } from '@preact/signals'
import { showToast } from '../components/Toast'

// localStorage keys
const PROGRESS_KEY = 'thinq-onboarding-progress'
const COMPLETE_KEY = 'thinq-onboarding-complete'

/**
 * Onboarding milestones - things the user should discover
 * These are tracked in the background; hints only appear if user seems stuck
 */
export const MILESTONES = {
  // Camera basics
  cameraRotated: { hint: 'Right-click and drag to look around', celebrateMsg: 'Nice! You found the camera controls.' },
  cameraZoomed: { hint: 'Scroll to zoom in and out', celebrateMsg: null },

  // Generation flow
  apiKeySet: { hint: 'Set up your API key to start generating', celebrateMsg: null },
  promptTyped: { hint: 'Try describing something: "blue robot" or "oak tree"', celebrateMsg: null },
  assetGenerated: { hint: 'Press Enter to generate your asset!', celebrateMsg: 'Your first asset is generating!' },
  assetAccepted: { hint: 'Review your asset and click Accept to add it to your library', celebrateMsg: 'Added to your library!' },

  // Placement
  assetPlaced: { hint: 'Drag an asset from the library into the world', celebrateMsg: 'You placed your first asset!' },
  assetSelected: { hint: 'Click on an asset to select it', celebrateMsg: null },

  // Transforms
  transformUsed: { hint: 'Press G to move, R to rotate, S to scale', celebrateMsg: null },
  focusUsed: { hint: 'Select an asset, then press F to focus the camera on it', celebrateMsg: null },

  // Play mode
  playModeEntered: { hint: 'Click Play or press F5 to explore your world!', celebrateMsg: 'Welcome to your world!' }
}

/**
 * Load saved progress from localStorage
 */
function loadProgress() {
  try {
    const saved = localStorage.getItem(PROGRESS_KEY)
    if (saved) {
      return JSON.parse(saved)
    }
  } catch {
    // Ignore parse errors
  }
  return {
    completed: [], // Milestone IDs that have been achieved
    hintsSeen: [], // Hints that have been shown (don't repeat)
    celebratedCount: 0
  }
}

/**
 * Check if onboarding has been completed
 */
export function isOnboardingComplete() {
  try {
    return localStorage.getItem(COMPLETE_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * Mark onboarding as permanently complete
 */
export function markOnboardingComplete() {
  try {
    localStorage.setItem(COMPLETE_KEY, 'true')
    localStorage.removeItem(PROGRESS_KEY)
  } catch {
    // Ignore storage errors
  }
}

// Initialize state from localStorage
const savedProgress = loadProgress()

/**
 * Onboarding state signal
 */
export const onboardingState = signal({
  isActive: false,
  completed: savedProgress.completed || [],
  hintsSeen: savedProgress.hintsSeen || [],
  celebratedCount: savedProgress.celebratedCount || 0
})

/**
 * Computed: has user completed enough to be "done"?
 */
export const hasCompletedBasics = computed(() => {
  const { completed } = onboardingState.value
  // User is "done" if they've placed an asset and used transforms
  return completed.includes('assetPlaced') && completed.includes('transformUsed')
})

/**
 * Start onboarding (called after welcome modal)
 */
export function startOnboarding() {
  onboardingState.value = {
    ...onboardingState.value,
    isActive: true
  }
}

/**
 * Stop onboarding entirely
 */
export function stopOnboarding() {
  onboardingState.value = {
    ...onboardingState.value,
    isActive: false
  }
  markOnboardingComplete()
}

/**
 * Record that a milestone was achieved
 */
export function completeMilestone(milestoneId) {
  const current = onboardingState.value
  if (current.completed.includes(milestoneId)) return false // Already done

  const newCompleted = [...current.completed, milestoneId]

  onboardingState.value = {
    ...current,
    completed: newCompleted
  }

  // Save progress
  saveProgress()

  // Check if user has completed all basics
  if (newCompleted.includes('assetPlaced') && newCompleted.includes('transformUsed') && newCompleted.includes('playModeEntered')) {
    // They've learned the basics!
    setTimeout(() => {
      stopOnboarding()
    }, 2000)
  }

  return true // Was newly completed
}

/**
 * Show a hint to the user via toast notification
 */
export function showHint(milestoneId) {
  const current = onboardingState.value
  if (!current.isActive) return
  if (current.hintsSeen.includes(milestoneId)) return // Already shown
  if (current.completed.includes(milestoneId)) return // Already achieved

  const milestone = MILESTONES[milestoneId]
  if (!milestone) return

  // Mark as seen
  onboardingState.value = {
    ...current,
    hintsSeen: [...current.hintsSeen, milestoneId]
  }

  // Show as toast (hint type has 10s duration by default)
  showToast(milestone.hint, 'hint')

  saveProgress()
}

/**
 * Dismiss the current hint (no-op, toasts handle their own dismissal)
 * @deprecated Use toast dismiss instead
 */
export function dismissHint() {
  // No-op - hints now use toast system which handles its own dismissal
}

/**
 * Get celebration message for a milestone (if any)
 */
export function getCelebrationMessage(milestoneId) {
  return MILESTONES[milestoneId]?.celebrateMsg || null
}

/**
 * Increment celebrated count (for tracking)
 */
export function incrementCelebrated() {
  onboardingState.value = {
    ...onboardingState.value,
    celebratedCount: onboardingState.value.celebratedCount + 1
  }
  saveProgress()
}

/**
 * Check if a milestone is completed
 */
export function isMilestoneComplete(milestoneId) {
  return onboardingState.value.completed.includes(milestoneId)
}

/**
 * Save current progress to localStorage
 */
function saveProgress() {
  try {
    const { completed, hintsSeen, celebratedCount } = onboardingState.value
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({ completed, hintsSeen, celebratedCount }))
  } catch {
    // Ignore storage errors
  }
}

/**
 * Reset onboarding (for testing/debugging)
 */
export function resetOnboarding() {
  try {
    localStorage.removeItem(PROGRESS_KEY)
    localStorage.removeItem(COMPLETE_KEY)
  } catch {
    // Ignore
  }
  onboardingState.value = {
    isActive: false,
    completed: [],
    hintsSeen: [],
    celebratedCount: 0
  }
}
