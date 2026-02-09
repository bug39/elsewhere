import { useEffect, useRef } from 'preact/hooks'
import { showToast } from './Toast'
import {
  onboardingState,
  completeMilestone,
  showHint,
  getCelebrationMessage,
  isMilestoneComplete
} from '../state/walkthroughState'
import { appMode } from '../App'
import { generationQueue } from '../state/generationQueue'
import { hasApiKey } from '../state/queueProcessor'

// Timing constants (in ms)
const CAMERA_HINT_DELAY = 8000 // Show camera hint after 8s of no camera movement
const PLACEMENT_HINT_DELAY = 5000 // Show placement hint 5s after first asset in library
const TRANSFORM_HINT_DELAY = 5000 // Show transform hint 5s after first selection

/**
 * OnboardingHelper - Monitors user activity and provides contextual hints
 *
 * Design principles:
 * - Never blocks user interaction
 * - Shows hints only when user seems stuck (after delays)
 * - Celebrates achievements with brief toasts
 * - Unobtrusive and easy to ignore
 */
export function Walkthrough({ world, selection, viewportRef }) {
  // Refs for tracking state over time
  const lastCameraAngleRef = useRef(null)
  const lastCameraDistanceRef = useRef(null)
  const cameraIdleTimerRef = useRef(null)
  const placementHintTimerRef = useRef(null)
  const transformHintTimerRef = useRef(null)
  const initialLibraryLengthRef = useRef(null)
  const initialPlacedCountRef = useRef(null)

  const isActive = onboardingState.value.isActive

  // Initialize tracking refs
  useEffect(() => {
    if (world?.data?.library && initialLibraryLengthRef.current === null) {
      initialLibraryLengthRef.current = world.data.library.length
    }
    if (world?.data?.placedAssets && initialPlacedCountRef.current === null) {
      initialPlacedCountRef.current = world.data.placedAssets.length
    }
  }, [world?.data])

  // Monitor camera movement for camera-related milestones
  useEffect(() => {
    if (!isActive) return
    if (!viewportRef?.current?.rendererRef?.current) return

    const checkCamera = () => {
      const renderer = viewportRef.current?.rendererRef?.current
      if (!renderer?.orbitControls) return

      const controls = renderer.orbitControls
      const azimuth = controls.getAzimuthalAngle()
      const polar = controls.getPolarAngle()
      const distance = renderer.camera.position.distanceTo(controls.target)

      // Check for camera rotation
      if (lastCameraAngleRef.current !== null) {
        const deltaAzimuth = Math.abs(azimuth - lastCameraAngleRef.current.azimuth)
        const deltaPolar = Math.abs(polar - lastCameraAngleRef.current.polar)

        if (deltaAzimuth > 0.3 || deltaPolar > 0.3) {
          // User rotated camera!
          const isNew = completeMilestone('cameraRotated')
          if (isNew) {
            const msg = getCelebrationMessage('cameraRotated')
            if (msg) showToast(msg, 'success', 3000)
          }
          // Reset idle timer
          if (cameraIdleTimerRef.current) {
            clearTimeout(cameraIdleTimerRef.current)
            cameraIdleTimerRef.current = null
          }
        }
      }

      // Check for zoom
      if (lastCameraDistanceRef.current !== null) {
        const distanceChange = Math.abs(distance - lastCameraDistanceRef.current) / lastCameraDistanceRef.current
        if (distanceChange > 0.15) {
          completeMilestone('cameraZoomed')
          // Reset idle timer
          if (cameraIdleTimerRef.current) {
            clearTimeout(cameraIdleTimerRef.current)
            cameraIdleTimerRef.current = null
          }
        }
      }

      lastCameraAngleRef.current = { azimuth, polar }
      lastCameraDistanceRef.current = distance
    }

    // Poll camera state
    const interval = setInterval(checkCamera, 500)

    // Set up idle timer for camera hint (only if not already achieved)
    if (!isMilestoneComplete('cameraRotated')) {
      cameraIdleTimerRef.current = setTimeout(() => {
        showHint('cameraRotated')
      }, CAMERA_HINT_DELAY)
    }

    return () => {
      clearInterval(interval)
      if (cameraIdleTimerRef.current) {
        clearTimeout(cameraIdleTimerRef.current)
      }
    }
  }, [isActive, viewportRef])

  // Monitor for authenticated generation capability — auto-complete milestone when available
  useEffect(() => {
    if (!isActive) return
    if (hasApiKey()) {
      completeMilestone('apiKeySet')
    }
  }, [isActive])

  // Monitor generation queue for progress
  useEffect(() => {
    if (!isActive) return

    const queue = generationQueue.value

    // Check if user started generation
    if (queue.length > 0 && !isMilestoneComplete('assetGenerated')) {
      const isNew = completeMilestone('assetGenerated')
      if (isNew) {
        const msg = getCelebrationMessage('assetGenerated')
        if (msg) showToast(msg, 'info', 3000)
      }
    }
  }, [isActive, generationQueue.value])

  // Monitor library for new assets
  useEffect(() => {
    if (!isActive) return
    if (initialLibraryLengthRef.current === null) return

    const currentLength = world?.data?.library?.length || 0

    if (currentLength > initialLibraryLengthRef.current) {
      // New asset added to library!
      const isNew = completeMilestone('assetAccepted')
      if (isNew) {
        const msg = getCelebrationMessage('assetAccepted')
        if (msg) showToast(msg, 'success', 3000)

        // Now show placement hint after a delay if they haven't placed yet
        if (!isMilestoneComplete('assetPlaced')) {
          placementHintTimerRef.current = setTimeout(() => {
            showHint('assetPlaced')
          }, PLACEMENT_HINT_DELAY)
        }
      }
    }

    return () => {
      if (placementHintTimerRef.current) {
        clearTimeout(placementHintTimerRef.current)
      }
    }
  }, [isActive, world?.data?.library?.length])

  // Monitor placed assets
  useEffect(() => {
    if (!isActive) return
    if (initialPlacedCountRef.current === null) return

    const currentCount = world?.data?.placedAssets?.length || 0

    if (currentCount > initialPlacedCountRef.current) {
      // Asset placed!
      const isNew = completeMilestone('assetPlaced')
      if (isNew) {
        const msg = getCelebrationMessage('assetPlaced')
        if (msg) showToast(msg, 'success', 3000)

        // Show focus hint after a delay if they haven't used it yet
        if (!isMilestoneComplete('focusUsed')) {
          setTimeout(() => {
            showHint('focusUsed')
          }, 4000) // Show after celebration toast fades
        }
      }
      initialPlacedCountRef.current = currentCount
    }
  }, [isActive, world?.data?.placedAssets?.length])

  // Monitor selection for hints
  useEffect(() => {
    if (!isActive) return

    if (selection?.instanceId) {
      completeMilestone('assetSelected')

      // Show transform hint after delay if they haven't used transforms yet
      if (!isMilestoneComplete('transformUsed')) {
        transformHintTimerRef.current = setTimeout(() => {
          showHint('transformUsed')
        }, TRANSFORM_HINT_DELAY)
      }
    }

    return () => {
      if (transformHintTimerRef.current) {
        clearTimeout(transformHintTimerRef.current)
      }
    }
  }, [isActive, selection?.instanceId])

  // Monitor for transform key presses
  useEffect(() => {
    if (!isActive) return

    const handleKeyDown = (e) => {
      // Skip if typing
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return

      // Transform keys
      if (['g', 'r', 's'].includes(e.key.toLowerCase())) {
        completeMilestone('transformUsed')
      }

      // Focus key
      if (e.key.toLowerCase() === 'f' && selection?.instanceId) {
        completeMilestone('focusUsed')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isActive, selection?.instanceId])

  // Monitor for play mode
  useEffect(() => {
    if (!isActive) return

    if (appMode.value === 'play') {
      const isNew = completeMilestone('playModeEntered')
      if (isNew) {
        const msg = getCelebrationMessage('playModeEntered')
        if (msg) showToast(msg, 'success', 3000)
      }
    }
  }, [isActive, appMode.value])

  // This component only monitors activity - hints are shown via Toast system
  return null
}
