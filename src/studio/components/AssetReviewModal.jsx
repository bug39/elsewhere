import { useState, useCallback, useRef, useEffect } from 'preact/hooks'
import * as THREE from 'three'
import { generateId } from '../state/storage'
import { acceptItem, dismissItem, retryItem } from '../state/generationQueue'
import { submitRefinement } from '../state/queueProcessor'
import { PreviewRendererService } from '../services/PreviewRendererService'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { showConfirm } from './ConfirmModal'
import { showToast } from './Toast'
import { isFeatureEnabled } from '../../shared/featureFlags'
import { logPromptRefine, logAssetAccept, logAssetDiscard } from '../../shared/telemetry'
import { executeAssetCode } from '../../shared/safeExecution.js'

const MAX_REFINEMENTS = 5

/**
 * Full-screen modal for reviewing a generated asset before accepting
 * @param {{ item: Object, onAccept: Function, onClose: Function, currentWorldId: string|null }} props
 */
const SCALE_OPTIONS = [
  { value: 1, label: '1x (small ~2m)' },
  { value: 5, label: '5x (~10m)' },
  { value: 10, label: '10x (~20m, default)' },
  { value: 20, label: '20x (~40m, large)' }
]

export function AssetReviewModal({ item, onAccept, onClose, currentWorldId }) {
  const [isWalkingCharacter, setIsWalkingCharacter] = useState(false)
  const [showCharacterQuestion, setShowCharacterQuestion] = useState(false)
  const [placementScale, setPlacementScale] = useState(10)
  const [error, setError] = useState(null)
  const [editedPrompt, setEditedPrompt] = useState('')
  const [refinementCount, setRefinementCount] = useState(0)

  const previewRef = useRef(null)
  const previewInstanceRef = useRef(null)
  const modalRef = useFocusTrap(!!item, onClose)

  // Reset edited prompt when item changes
  useEffect(() => {
    if (item) {
      setEditedPrompt(item.prompt)
      setRefinementCount(item.refinementCount || 0)
    }
  }, [item])

  const promptRefinementEnabled = isFeatureEnabled('promptRefinement')
  const hasPromptChanged = promptRefinementEnabled && editedPrompt.trim() !== item?.prompt
  const canRefine = refinementCount < MAX_REFINEMENTS

  // Initialize preview renderer using shared service
  useEffect(() => {
    if (!previewRef.current || !item) return

    let cancelled = false

    // Release any previous instance
    if (previewInstanceRef.current) {
      PreviewRendererService.release(previewInstanceRef.current)
      previewInstanceRef.current = null
    }

    const loadAsset = async () => {
      setError(null) // Clear stale errors

      const result = await executeAssetCode(item.result.code, THREE)
      if (cancelled) return

      if (!result.success) {
        setError(result.error)
        return
      }

      // Acquire preview instance (only after successful execution)
      const preview = PreviewRendererService.acquire(previewRef.current, {
        background: 0xf5f5f5
      })
      previewInstanceRef.current = preview

      try {
        preview.addAsset(result.asset, {
          centerOnGround: true,
          fitCamera: true
        })

        // Check if this might be a walking character
        const category = item.result.category
        if (category === 'characters' || category === 'creatures') {
          setShowCharacterQuestion(true)
        }
      } catch (err) {
        console.error('Failed to load asset for preview:', err)
        setError(err.message)
        // Release on render failure
        if (previewInstanceRef.current) {
          PreviewRendererService.release(previewInstanceRef.current)
          previewInstanceRef.current = null
        }
      }
    }

    loadAsset()

    return () => {
      cancelled = true
      if (previewInstanceRef.current) {
        PreviewRendererService.release(previewInstanceRef.current)
        previewInstanceRef.current = null
      }
    }
  }, [item])

  // Handle accept
  const handleAccept = useCallback(async () => {
    if (!item?.result) return

    // H2 FIX: Validate worldId - warn if asset was generated in different world
    if (item.worldId && currentWorldId && item.worldId !== currentWorldId) {
      const confirmed = await showConfirm({
        title: 'Different World',
        message: 'This asset was generated in a different world. Add to current world anyway?',
        confirmText: 'Add Anyway'
      })
      if (!confirmed) return
    }

    const result = await acceptItem(item.id)
    if (!result) return

    // Log telemetry
    const generationDuration = item.startedAt ? Date.now() - item.startedAt : null
    logAssetAccept(result.category, generationDuration, false)

    const libraryAsset = {
      id: generateId('lib'),
      name: result.name,
      category: result.category,
      generatedCode: result.code,
      thumbnail: result.thumbnail,
      thumbnailVersion: 2,  // Matches current ThumbnailRenderer formula
      tags: result.tags || [],
      isWalkingCharacter,
      preferredScale: placementScale,
      originalPrompt: result.originalPrompt || null,
      v3Schema: result.v3Schema || null
    }

    onAccept(libraryAsset)
    onClose()
  }, [item, isWalkingCharacter, onAccept, onClose, currentWorldId, placementScale])

  // Handle dismiss
  const handleDismiss = useCallback(() => {
    if (item) {
      logAssetDiscard(item.result?.category || 'unknown', 'discard')
      dismissItem(item.id)
    }
    onClose()
  }, [item, onClose])

  // Handle regenerate (retry) - with warning about creating new asset
  const handleRegenerate = useCallback(async () => {
    if (!item) return
    // Warn user this creates a new asset, not a modification
    const confirmed = await showConfirm({
      title: 'Generate New Asset',
      message: 'This will generate a completely new asset from the same prompt.\n\nThe current asset will be discarded. Continue?',
      confirmText: 'Generate New',
      danger: true
    })
    if (!confirmed) return
    retryItem(item.id)
    onClose()
  }, [item, onClose])

  // Handle regenerate with edited prompt
  const handleRegenerateWithChanges = useCallback(async () => {
    if (!item || !hasPromptChanged) return

    if (!canRefine) {
      showToast(`Maximum refinements reached (${MAX_REFINEMENTS}). Try a different approach.`, 'error', 5000)
      return
    }

    const newRefinementCount = refinementCount + 1

    // Log the refinement
    logPromptRefine(item.prompt, editedPrompt.trim(), newRefinementCount)

    // Dismiss current item and submit refinement
    await dismissItem(item.id)
    const result = await submitRefinement(editedPrompt.trim(), item.worldId, newRefinementCount)

    if (result.success) {
      onClose()
    }
  }, [item, editedPrompt, hasPromptChanged, canRefine, refinementCount, onClose])

  if (!item) return null

  return (
    <div class="modal-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        class="modal modal--xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-modal-title"
        data-walkthrough="review-modal"
      >
        <div class="modal__header">
          <span id="review-modal-title" class="modal__title">Review: {item.result?.name || 'Generated Asset'}</span>
          <button class="btn btn--icon btn--ghost" onClick={onClose} aria-label="Close review modal">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width: 14px; height: 14px">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div class="modal__body">
          {/* Editable prompt */}
          <div class="field" style="margin-bottom: var(--sp-3)">
            <label class="field__label" style="display: flex; justify-content: space-between; align-items: center">
              <span>Prompt</span>
              {promptRefinementEnabled && refinementCount > 0 && (
                <span style="font-size: var(--text-2xs); color: var(--text-tertiary); font-weight: normal">
                  Refinement {refinementCount}/{MAX_REFINEMENTS}
                </span>
              )}
            </label>
            {promptRefinementEnabled ? (
              <input
                type="text"
                class="input"
                value={editedPrompt}
                onInput={(e) => setEditedPrompt(e.target.value)}
                style="font-size: var(--text-sm)"
                placeholder="Describe your asset..."
              />
            ) : (
              <div style="padding: var(--sp-2); background: var(--gray-50); border-radius: var(--radius-sm); font-size: var(--text-sm); color: var(--text-secondary)">
                {item.prompt}
              </div>
            )}
            {hasPromptChanged && (
              <div style="margin-top: var(--sp-1); font-size: var(--text-xs); color: var(--accent)">
                Prompt modified - click "Regenerate" to create a new version
              </div>
            )}
          </div>

          {/* Preview area */}
          <div
            ref={previewRef}
            class="asset-preview-container"
          >
            {error && (
              <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(185, 28, 28, 0.1); display: flex; align-items: center; justify-content: center; color: var(--negative); font-size: var(--text-sm); padding: var(--sp-4)">
                Failed to preview: {error}
              </div>
            )}
          </div>

          {/* Walking character question */}
          {showCharacterQuestion && !error && (
            <div style="margin-top: var(--sp-4); padding: var(--sp-3); background: var(--gray-50); border: 1px solid var(--line); border-radius: var(--radius-sm)">
              <div style="font-size: var(--text-sm); margin-bottom: var(--sp-2); color: var(--text-secondary)">
                Does this character walk?
              </div>
              <div style="display: flex; gap: var(--sp-2)">
                <button
                  class={isWalkingCharacter ? 'btn btn--primary' : 'btn'}
                  onClick={() => setIsWalkingCharacter(true)}
                  style="flex: 1"
                >
                  Yes, it walks
                </button>
                <button
                  class={!isWalkingCharacter ? 'btn btn--primary' : 'btn'}
                  onClick={() => setIsWalkingCharacter(false)}
                  style="flex: 1"
                >
                  No, static only
                </button>
              </div>
            </div>
          )}

          {/* Scale selection */}
          {!error && (
            <div style="margin-top: var(--sp-4); padding: var(--sp-3); background: var(--gray-50); border: 1px solid var(--line); border-radius: var(--radius-sm)">
              <div style="font-size: var(--text-sm); margin-bottom: var(--sp-2); color: var(--text-secondary)">
                Placement Scale
              </div>
              <div style="font-size: var(--text-xs); color: var(--text-tertiary); margin-bottom: var(--sp-2)">
                Assets are generated at ~2m size. Choose scale for placement:
              </div>
              <div style="display: flex; gap: var(--sp-2); flex-wrap: wrap">
                {SCALE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    class={placementScale === opt.value ? 'btn btn--primary btn--sm' : 'btn btn--sm'}
                    onClick={() => setPlacementScale(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Post-processing adjustments */}
          {item.result?.adjustments?.length > 0 && (
            <div style="margin-top: var(--sp-3); padding: var(--sp-2); background: rgba(var(--accent-rgb), 0.1); border: 1px solid var(--accent); border-radius: var(--radius-sm); font-size: var(--text-xs)">
              <span style="color: var(--accent); font-weight: 500">Adjustments made: </span>
              <span style="color: var(--text-secondary)">
                {item.result.adjustments.join(', ')}
              </span>
            </div>
          )}

          {/* Category info */}
          <div style="margin-top: var(--sp-3); font-size: var(--text-xs); color: var(--text-tertiary)">
            Category: {item.result?.category} | Generated {new Date(item.createdAt).toLocaleTimeString()}
          </div>
        </div>

        <div class="modal__footer">
          <button class="btn btn--ghost" onClick={handleDismiss}>
            Discard
          </button>
          {hasPromptChanged ? (
            <button
              class="btn btn--primary"
              onClick={handleRegenerateWithChanges}
              disabled={!canRefine}
              title={canRefine ? 'Generate with updated prompt' : `Maximum refinements reached (${MAX_REFINEMENTS})`}
            >
              Regenerate
            </button>
          ) : (
            <>
              <button
                class="btn"
                onClick={handleRegenerate}
                title="Creates a completely new asset from scratch"
              >
                Generate New
              </button>
              <button class="btn btn--primary" onClick={handleAccept} disabled={!!error}>
                Accept
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
