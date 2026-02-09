/**
 * Asset navigation hook for Tab/Shift+Tab spatial jumping
 *
 * Provides nearest-neighbor navigation through placed assets:
 * - Tab: Jump to nearest unvisited asset, focus camera
 * - Shift+Tab: Go back to previous asset in history
 * - Automatically wraps when all assets visited
 */

import { useRef, useCallback } from 'preact/hooks'

// World center fallback when no selection exists
const WORLD_CENTER = [200, 0, 200]

/**
 * Calculate 3D Euclidean distance between two positions
 * @param {[number, number, number]} a
 * @param {[number, number, number]} b
 * @returns {number}
 */
function distance3D(a, b) {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/**
 * @typedef {Object} AssetNavigationOptions
 * @property {Object} world - World state with data.placedAssets
 * @property {Object} selection - Selection state with instanceId and selectInstance
 * @property {Object} rendererRef - Ref to WorldRenderer for camera focus
 */

/**
 * Hook that manages spatial navigation between placed assets
 *
 * @param {AssetNavigationOptions} options
 * @returns {{ navigateToNext: Function, navigateToPrevious: Function, resetNavigation: Function }}
 */
export function useAssetNavigation({ world, selection, rendererRef }) {
  // Track visited assets in current navigation session
  const visitedSetRef = useRef(new Set())
  // History stack for Shift+Tab
  const historyStackRef = useRef([])

  /**
   * Navigate to the nearest unvisited asset
   * If all visited, clears visited set and starts fresh
   */
  const navigateToNext = useCallback(() => {
    const assets = world.data?.placedAssets
    if (!assets || assets.length === 0) return

    // Get current position (selected asset or world center)
    let currentPos = WORLD_CENTER
    if (selection.instanceId) {
      const currentAsset = assets.find(a => a.instanceId === selection.instanceId)
      if (currentAsset) {
        currentPos = currentAsset.position
      }
    }

    // Find unvisited assets
    let unvisited = assets.filter(a => !visitedSetRef.current.has(a.instanceId))

    // If all visited, wrap around
    if (unvisited.length === 0) {
      visitedSetRef.current.clear()
      unvisited = assets
    }

    // Find nearest unvisited asset
    let nearest = null
    let nearestDist = Infinity
    for (const asset of unvisited) {
      // Skip current selection (don't jump to self)
      if (asset.instanceId === selection.instanceId) continue

      const dist = distance3D(currentPos, asset.position)
      if (dist < nearestDist) {
        nearestDist = dist
        nearest = asset
      }
    }

    // Handle edge case: only one asset in world
    if (!nearest && unvisited.length === 1 && !selection.instanceId) {
      nearest = unvisited[0]
    }

    if (!nearest) return

    // Push current to history (if we have a selection)
    if (selection.instanceId) {
      historyStackRef.current.push(selection.instanceId)
    }

    // Mark target as visited
    visitedSetRef.current.add(nearest.instanceId)

    // Select and focus
    selection.selectInstance(nearest.instanceId)
    rendererRef.current?.focusOnInstance(nearest.instanceId)
  }, [world.data?.placedAssets, selection, rendererRef])

  /**
   * Navigate back to previous asset in history
   * Skips deleted assets
   */
  const navigateToPrevious = useCallback(() => {
    const assets = world.data?.placedAssets
    if (!assets || historyStackRef.current.length === 0) return

    // Pop from history, skip deleted assets
    let targetId = null
    while (historyStackRef.current.length > 0) {
      const candidateId = historyStackRef.current.pop()
      // Verify asset still exists
      if (assets.some(a => a.instanceId === candidateId)) {
        targetId = candidateId
        break
      }
    }

    if (!targetId) return

    // Select and focus
    selection.selectInstance(targetId)
    rendererRef.current?.focusOnInstance(targetId)
  }, [world.data?.placedAssets, selection, rendererRef])

  /**
   * Reset navigation session (called on Escape or mode change)
   */
  const resetNavigation = useCallback(() => {
    visitedSetRef.current.clear()
    historyStackRef.current = []
  }, [])

  return {
    navigateToNext,
    navigateToPrevious,
    resetNavigation
  }
}
