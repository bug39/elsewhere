import { useState, useCallback, useRef, useEffect } from 'preact/hooks'
import * as THREE from 'three'
import { generationQueue, getVariationBatch, isBatchComplete, dismissItem, acceptItem } from '../state/generationQueue'
import { submitVariations } from '../state/queueProcessor'
import { PreviewRendererService } from '../services/PreviewRendererService'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { showToast } from './Toast'
import { generateId } from '../state/storage'
import { logVariationSelect, logAssetAccept, logAssetDiscard } from '../../shared/telemetry'
import { executeAssetCode } from '../../shared/safeExecution.js'

/**
 * Single variation preview card
 */
function VariationCard({ item, index, isSelected, onSelect, isDisabled }) {
  const previewRef = useRef(null)
  const previewInstanceRef = useRef(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!previewRef.current || !item?.result?.code) return

    let cancelled = false

    // Release previous instance
    if (previewInstanceRef.current) {
      PreviewRendererService.release(previewInstanceRef.current)
      previewInstanceRef.current = null
    }

    const loadAsset = async () => {
      setError(null)
      const result = await executeAssetCode(item.result.code, THREE)
      if (cancelled) return

      if (!result.success) {
        setError(result.error)
        return
      }

      // Acquire preview instance
      const preview = PreviewRendererService.acquire(previewRef.current, {
        background: 0xf5f5f5
      })
      previewInstanceRef.current = preview

      try {
        preview.addAsset(result.asset, {
          centerOnGround: true,
          fitCamera: true
        })
      } catch (err) {
        console.error('Failed to preview variation:', err)
        setError(err.message)
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
  }, [item?.result?.code])

  const isPending = item?.status === 'pending' || item?.status === 'generating'
  const isFailed = item?.status === 'failed'
  const isCompleted = item?.status === 'completed'

  return (
    <div
      class={`variation-card ${isSelected ? 'variation-card--selected' : ''} ${isDisabled ? 'variation-card--disabled' : ''}`}
      onClick={() => !isDisabled && isCompleted && onSelect(index)}
    >
      <div class="variation-card__header">
        <span class="variation-card__label">Variation {index + 1}</span>
        {isCompleted && (
          <input
            type="radio"
            checked={isSelected}
            onChange={() => onSelect(index)}
            class="variation-card__radio"
          />
        )}
      </div>

      <div
        ref={previewRef}
        class="variation-card__preview"
      >
        {isPending && (
          <div class="variation-card__loading">
            <div class="spinner" />
            <span>{item?.progress || 'Generating...'}</span>
          </div>
        )}
        {isFailed && (
          <div class="variation-card__error">
            <span>Failed</span>
            <span style="font-size: var(--text-xs); opacity: 0.7">
              {item?.error || 'Unknown error'}
            </span>
          </div>
        )}
        {error && isCompleted && (
          <div class="variation-card__error">
            Preview error: {error}
          </div>
        )}
      </div>

      {isCompleted && item?.result && (
        <div class="variation-card__info">
          <span class="variation-card__name">{item.result.name}</span>
          <span class="variation-card__category">{item.result.category}</span>
        </div>
      )}
    </div>
  )
}

/**
 * Modal for comparing and selecting from multiple variations
 * @param {{ batchId: string, onAccept: Function, onClose: Function, worldId: string|null }} props
 */
export function VariationGallery({ batchId, onAccept, onClose, worldId }) {
  const [selectedIndex, setSelectedIndex] = useState(null)
  const [editedPrompt, setEditedPrompt] = useState('')
  const modalRef = useFocusTrap(!!batchId, onClose)

  // Subscribe to queue changes to get batch items
  const batchItems = getVariationBatch(batchId)
  const isComplete = isBatchComplete(batchId)
  const completedItems = batchItems.filter(i => i.status === 'completed')
  const hasCompletedItems = completedItems.length > 0

  // Initialize prompt from first item
  useEffect(() => {
    if (batchItems.length > 0 && !editedPrompt) {
      setEditedPrompt(batchItems[0].prompt)
    }
  }, [batchItems])

  // Auto-select first completed item when batch completes
  useEffect(() => {
    if (isComplete && selectedIndex === null && completedItems.length > 0) {
      const firstCompletedIdx = batchItems.findIndex(i => i.status === 'completed')
      if (firstCompletedIdx >= 0) {
        setSelectedIndex(firstCompletedIdx)
      }
    }
  }, [isComplete, batchItems, completedItems.length])

  const handleAccept = useCallback(async () => {
    if (selectedIndex === null) return

    const item = batchItems[selectedIndex]
    if (!item?.result) return

    // Log variation selection
    logVariationSelect(batchId, selectedIndex, batchItems.length)

    // Accept the selected item
    const result = await acceptItem(item.id)
    if (!result) return

    // Log asset acceptance from variation
    const generationDuration = item.startedAt ? Date.now() - item.startedAt : null
    logAssetAccept(result.category, generationDuration, true)

    const libraryAsset = {
      id: generateId('lib'),
      name: result.name,
      category: result.category,
      generatedCode: result.code,
      thumbnail: result.thumbnail,
      thumbnailVersion: 2,
      tags: result.tags || [],
      isWalkingCharacter: false,
      preferredScale: 10
    }

    // M11 FIX: Await all dismissals to prevent race conditions
    await Promise.all(
      batchItems
        .filter(i => i.id !== item.id)
        .map(i => dismissItem(i.id))
    )

    onAccept(libraryAsset)
    onClose()
  }, [batchItems, selectedIndex, batchId, onAccept, onClose])

  const handleRegenerateAll = useCallback(async () => {
    // M11 FIX: Await all dismissals to prevent race conditions
    await Promise.all(batchItems.map(i => dismissItem(i.id)))

    // Submit new batch
    const result = await submitVariations(editedPrompt.trim(), worldId)
    if (result.success) {
      onClose()
      showToast('Regenerating variations...', 'info', 2000)
    }
  }, [batchItems, editedPrompt, worldId, onClose])

  const handleClose = useCallback(async () => {
    // Log discards for completed items
    batchItems.forEach(i => {
      if (i.status === 'completed' && i.result) {
        logAssetDiscard(i.result.category, 'close')
      }
    })
    // M11 FIX: Await all dismissals to prevent race conditions
    await Promise.all(batchItems.map(i => dismissItem(i.id)))
    onClose()
  }, [batchItems, onClose])

  if (!batchId) return null

  const progressText = isComplete
    ? `${completedItems.length} of ${batchItems.length} ready`
    : `Generating... ${completedItems.length}/${batchItems.length}`

  return (
    <div class="modal-overlay" onClick={handleClose}>
      <div
        ref={modalRef}
        class="modal variation-gallery-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="variation-gallery-title"
      >
        <div class="modal__header">
          <span id="variation-gallery-title" class="modal__title">Compare Variations</span>
          <span class="variation-gallery__progress">{progressText}</span>
          <button class="btn btn--icon btn--ghost" onClick={handleClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width: 14px; height: 14px">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div class="modal__body">
          {/* Prompt editor */}
          <div class="field" style="margin-bottom: var(--sp-4)">
            <label class="field__label">Prompt</label>
            <input
              type="text"
              class="input"
              value={editedPrompt}
              onInput={(e) => setEditedPrompt(e.target.value)}
              placeholder="Describe your asset..."
            />
          </div>

          {/* Variation cards grid */}
          <div class="variation-gallery__grid">
            {batchItems.map((item, index) => (
              <VariationCard
                key={item.id}
                item={item}
                index={index}
                isSelected={selectedIndex === index}
                onSelect={setSelectedIndex}
                isDisabled={!isComplete}
              />
            ))}
          </div>
        </div>

        <div class="modal__footer">
          <button class="btn btn--ghost" onClick={handleClose}>
            Cancel
          </button>
          <button
            class="btn"
            onClick={handleRegenerateAll}
            disabled={!editedPrompt.trim()}
          >
            Regenerate All
          </button>
          <button
            class="btn btn--primary"
            onClick={handleAccept}
            disabled={selectedIndex === null || !hasCompletedItems}
          >
            Accept Selected
          </button>
        </div>
      </div>
    </div>
  )
}
