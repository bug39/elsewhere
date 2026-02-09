/**
 * Feature flags for A/B testing and gradual feature rollout
 *
 * Flags are stored in localStorage and can be overridden via browser console:
 *   localStorage.setItem('thinq-feature-flags', JSON.stringify({variationGallery: false}))
 */

import { signal } from '@preact/signals'

const FLAGS_KEY = 'thinq-feature-flags'

/**
 * Default flag values
 * New features start enabled by default (opt-out model)
 */
const DEFAULT_FLAGS = {
  /** Enable generating 3 variations at once */
  variationGallery: true,

  /** Enable editing prompts in review modal for refinement */
  promptRefinement: true,

  /** Show creation statistics on home screen */
  creationStats: true,

  /** Enable GPU instancing for repeated assets (3+ instances of same asset)
   *  Provides 3-10x draw-call reduction for scenes with many repeated assets */
  enableInstancing: true,

  /** Enable render-on-demand (only render when scene changes)
   *  Provides 30%+ idle CPU reduction. Disabled by default for safe rollout.
   *  When enabled, continuous rendering only occurs in play mode or during orbit damping. */
  enableRenderOnDemand: false,

  /** Use legacy asset generator pipeline (de8025b snapshot) for A/B comparison */
  legacyAssetGenerator: false
}

/**
 * Current feature flag values
 * @type {import('@preact/signals').Signal<Record<string, boolean>>}
 */
export const featureFlags = signal({ ...DEFAULT_FLAGS })

/**
 * Load feature flags from localStorage
 * Should be called once on app initialization
 */
export function loadFeatureFlags() {
  try {
    const stored = localStorage.getItem(FLAGS_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      // Merge stored flags with defaults (defaults take precedence for new flags)
      featureFlags.value = { ...DEFAULT_FLAGS, ...parsed }
    }
  } catch (e) {
    console.error('[FeatureFlags] Failed to load flags:', e)
  }
}

/**
 * Check if a specific feature is enabled
 * @param {keyof typeof DEFAULT_FLAGS} flag
 * @returns {boolean}
 */
export function isFeatureEnabled(flag) {
  return featureFlags.value[flag] === true
}

/**
 * Enable or disable a feature flag
 * Persists to localStorage immediately
 * @param {keyof typeof DEFAULT_FLAGS} flag
 * @param {boolean} enabled
 */
export function setFeatureFlag(flag, enabled) {
  featureFlags.value = { ...featureFlags.value, [flag]: enabled }
  try {
    localStorage.setItem(FLAGS_KEY, JSON.stringify(featureFlags.value))
  } catch (e) {
    console.error('[FeatureFlags] Failed to save flags:', e)
  }
}

/**
 * Reset all feature flags to defaults
 */
export function resetFeatureFlags() {
  featureFlags.value = { ...DEFAULT_FLAGS }
  try {
    localStorage.removeItem(FLAGS_KEY)
  } catch (e) {
    // Ignore storage errors
  }
}

/**
 * Get all current flag values (for debugging/telemetry)
 * @returns {Record<string, boolean>}
 */
export function getAllFlags() {
  return { ...featureFlags.value }
}
