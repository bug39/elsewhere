import { useState, useCallback, useEffect, useMemo } from 'preact/hooks'
import { submitGeneration, submitVariations, hasApiKey, cancelGeneration, queueProcessor } from '../state/queueProcessor'
import { isFeatureEnabled } from '../../shared/featureFlags'
import {
  generationQueue,
  addToQueue,
  dismissItem,
  retryItem,
  moveItemUp,
  moveItemDown,
  getQueueForWorld,
  isFirstCompletionDone,
  markFirstCompletionDone
} from '../state/generationQueue'
import { planThemePack } from '../../generator/ThemePackPlanner'
import { showToast } from './Toast'
import { Tooltip } from './Tooltip'


/**
 * Format elapsed time in seconds
 */
function formatElapsed(startedAt) {
  if (!startedAt) return ''
  const seconds = Math.floor((Date.now() - startedAt) / 1000)
  return `${seconds}s`
}

// Static stage info for non-generating statuses
const STATUS_STAGE_INFO = {
  pending: { stage: 'Queued', progress: 0 },
  completed: { stage: 'Ready', progress: 100 },
  failed: { stage: 'Failed', progress: 0 }
}

/**
 * Get stage info based on generation status and progress
 */
function getStageInfo(item) {
  if (STATUS_STAGE_INFO[item.status]) return STATUS_STAGE_INFO[item.status]

  // For generating status, determine stage based on elapsed time
  // Typical generation takes 8-15 seconds
  const elapsed = item.startedAt ? (Date.now() - item.startedAt) / 1000 : 0
  if (elapsed < 2) return { stage: 'Planning', progress: 10 }
  if (elapsed < 5) return { stage: 'Generating', progress: 40 }
  if (elapsed < 10) return { stage: 'Rendering', progress: 70 }
  return { stage: 'Finalizing', progress: 90 }
}

/**
 * Hook to get elapsed time that updates every second
 */
function useElapsedTime(startedAt, isActive) {
  const [elapsed, setElapsed] = useState(() => formatElapsed(startedAt))

  useEffect(() => {
    if (!isActive || !startedAt) return

    // Update immediately
    setElapsed(formatElapsed(startedAt))

    // Update every second
    const interval = setInterval(() => {
      setElapsed(formatElapsed(startedAt))
    }, 1000)

    return () => clearInterval(interval)
  }, [startedAt, isActive])

  return elapsed
}

/**
 * Single queue item row
 */
function QueueItemRow({ item, onReview, showReorderButtons, isFirst, isLast }) {
  const isGenerating = item.status === 'generating'
  const elapsed = useElapsedTime(item.startedAt, isGenerating)
  const stageInfo = getStageInfo(item)

  const handleRetry = useCallback((e) => {
    e.stopPropagation()
    retryItem(item.id)
  }, [item.id])

  const handleCancel = useCallback((e) => {
    e.stopPropagation()
    cancelGeneration()
  }, [])

  const handleDismiss = useCallback((e) => {
    e.stopPropagation()
    dismissItem(item.id)
  }, [item.id])

  const handleClick = useCallback(() => {
    if (item.status === 'completed') {
      onReview(item)
    }
  }, [item, onReview])

  const handleErrorClick = useCallback((e) => {
    e.stopPropagation()
    if (item.error) {
      showToast(item.error, 'error', 10000)
    }
  }, [item.error])

  const handleMoveUp = useCallback((e) => {
    e.stopPropagation()
    moveItemUp(item.id)
  }, [item.id])

  const handleMoveDown = useCallback((e) => {
    e.stopPropagation()
    moveItemDown(item.id)
  }, [item.id])

  const truncatedPrompt = item.prompt.length > 24
    ? item.prompt.slice(0, 24) + '...'
    : item.prompt

  const errorText = item.error || 'Failed'
  const isErrorTruncated = errorText.length > 30

  return (
    <div
      class={`gen-queue-item gen-queue-item--${item.status}`}
      onClick={handleClick}
      style={item.status === 'completed' ? { cursor: 'pointer' } : undefined}
    >
      <div class="gen-queue-item__icon">
        {item.status === 'generating' && (
          <div class="gen-queue-item__spinner" />
        )}
        {item.status === 'pending' && (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width: 14px; height: 14px; opacity: 0.4">
            <circle cx="12" cy="12" r="10" stroke-width="2"/>
          </svg>
        )}
        {item.status === 'completed' && (
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--positive)" style="width: 14px; height: 14px">
            <path d="M20 6L9 17l-5-5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        )}
        {item.status === 'failed' && (
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--negative)" style="width: 14px; height: 14px">
            <circle cx="12" cy="12" r="10" stroke-width="2"/>
            <line x1="15" y1="9" x2="9" y2="15" stroke-width="2"/>
            <line x1="9" y1="9" x2="15" y2="15" stroke-width="2"/>
          </svg>
        )}
      </div>

      <div class="gen-queue-item__content">
        <span class="gen-queue-item__name">
          {item.status === 'completed' ? item.result?.name || truncatedPrompt : truncatedPrompt}
        </span>
        <div class="gen-queue-item__status-wrap">
          <span
            class="gen-queue-item__status"
            title={item.status === 'failed' ? errorText : undefined}
            onClick={item.status === 'failed' && isErrorTruncated ? handleErrorClick : undefined}
            style={item.status === 'failed' && isErrorTruncated ? { cursor: 'pointer' } : undefined}
          >
            {item.status === 'generating' && (
              <>
                <span class="gen-queue-item__stage">{stageInfo.stage}</span>
                {elapsed && <span style="opacity: 0.6; margin-left: 4px">({elapsed})</span>}
              </>
            )}
            {item.status === 'pending' && 'Queued'}
            {item.status === 'completed' && 'Ready'}
            {item.status === 'failed' && (isErrorTruncated ? errorText.slice(0, 30) + '...' : errorText)}
          </span>
          {item.status === 'generating' && (
            <div class="gen-queue-item__progress">
              <div
                class="gen-queue-item__progress-bar"
                style={{ width: `${stageInfo.progress}%` }}
              />
            </div>
          )}
        </div>
      </div>

      <div class="gen-queue-item__actions">
        {/* Reorder buttons for pending items */}
        {showReorderButtons && item.status === 'pending' && (
          <>
            <button
              class="btn btn--xs btn--ghost gen-queue-item__reorder"
              onClick={handleMoveUp}
              disabled={isFirst}
              title="Move up"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width: 12px; height: 12px">
                <path d="M18 15l-6-6-6 6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <button
              class="btn btn--xs btn--ghost gen-queue-item__reorder"
              onClick={handleMoveDown}
              disabled={isLast}
              title="Move down"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width: 12px; height: 12px">
                <path d="M6 9l6 6 6-6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </>
        )}
        {item.status === 'generating' && (
          <button class="btn btn--xs" onClick={handleCancel} title="Cancel generation">
            Cancel
          </button>
        )}
        {item.status === 'completed' && (
          <button class="btn btn--xs btn--primary" onClick={handleClick}>
            Review
          </button>
        )}
        {item.status === 'failed' && (
          <button class="btn btn--xs" onClick={handleRetry}>
            Retry
          </button>
        )}
        <button
          class="btn btn--xs btn--ghost gen-queue-item__dismiss"
          onClick={handleDismiss}
          title="Dismiss"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width: 12px; height: 12px">
            <line x1="18" y1="6" x2="6" y2="18" stroke-width="2"/>
            <line x1="6" y1="6" x2="18" y2="18" stroke-width="2"/>
          </svg>
        </button>
      </div>
    </div>
  )
}

/**
 * Unified generation section at bottom of library panel
 * - Prompt input with submit
 * - Collapsible suggestions
 * - Always-visible inline queue
 */
export function GenerationSection({ onReviewItem, onVariationBatch, worldId }) {
  const [prompt, setPrompt] = useState('')
  const [themePrompt, setThemePrompt] = useState('')
  const [themeLoading, setThemeLoading] = useState(false)

  const items = worldId ? getQueueForWorld(worldId) : generationQueue.value

  const handleSubmit = useCallback((e) => {
    e.preventDefault()
    if (!prompt.trim()) return

    // Check for authenticated proxy session before submitting
    if (!hasApiKey()) {
      showToast('Session expired. Please refresh the page.', 'error', 6000)
      return
    }

    submitGeneration(prompt.trim(), worldId)
    setPrompt('')
  }, [prompt])

  const handleGenerateVariations = useCallback(async () => {
    if (!prompt.trim()) return

    // Check for authenticated proxy session before submitting
    if (!hasApiKey()) {
      showToast('Session expired. Please refresh the page.', 'error', 6000)
      return
    }

    const result = await submitVariations(prompt.trim(), worldId)
    if (result.success && result.batchId) {
      onVariationBatch?.(result.batchId)
      setPrompt('')
    }
  }, [prompt, worldId, onVariationBatch])

  const handleThemePack = useCallback(async () => {
    if (!themePrompt.trim() || themeLoading) return

    if (!hasApiKey()) {
      showToast('Session expired. Please refresh the page.', 'error', 6000)
      return
    }

    setThemeLoading(true)
    showToast('Planning your theme pack...', 'info', 3000)

    try {
      const pack = await planThemePack(themePrompt.trim())

      let queued = 0
      for (const asset of pack.assets) {
        const result = await addToQueue(asset.description, worldId, { isVariation: true })
        if (result.item) queued++
      }

      if (queued > 0) {
        showToast(`${queued} assets queued for generation!`, 'success', 4000)
        queueProcessor.start()
        queueProcessor.processNext()
      }
      setThemePrompt('')
    } catch (err) {
      console.error('[ThemePack] Generation failed:', err)
      showToast(`Theme pack failed: ${err.message}`, 'error', 5000)
    } finally {
      setThemeLoading(false)
    }
  }, [themePrompt, themeLoading, worldId])


  const handleReview = useCallback((item) => {
    // Check if this is the first completion ever
    if (!isFirstCompletionDone()) {
      markFirstCompletionDone()
    }
    onReviewItem(item)
  }, [onReviewItem])

  // Memoize queue filtering to prevent recalculation on every render
  const { activeCount, readyCount, pendingItems } = useMemo(() => {
    let active = 0, ready = 0
    const pending = []
    for (const item of items) {
      if (item.status === 'generating' || item.status === 'pending') active++
      if (item.status === 'completed') ready++
      if (item.status === 'pending') pending.push(item)
    }
    return { activeCount: active, readyCount: ready, pendingItems: pending }
  }, [items])

  return (
    <div class="generation-section">
      {/* Hero section: Input at top with prominent styling */}
      <div class="generation-section__hero">
        <div class="generation-section__hero-label">Create New Asset</div>
        <form class="generation-section__form" onSubmit={handleSubmit}>
          <input
            type="text"
            class="generation-section__input"
            placeholder="Describe your 3D asset..."
            value={prompt}
            onInput={(e) => setPrompt(e.target.value)}
            aria-label="Asset description"
            data-walkthrough="generation-input"
          />
          {isFeatureEnabled('variationGallery') && (
            <Tooltip content="Generate 3 variations" position="top">
              <button
                type="button"
                class="generation-section__submit generation-section__submit--variations"
                onClick={handleGenerateVariations}
                disabled={!prompt.trim()}
                aria-label="Generate 3 variations"
              >
                x3
              </button>
            </Tooltip>
          )}
          <Tooltip content="Generate new asset" shortcut="Enter" position="top">
            <button
              type="submit"
              class="generation-section__submit"
              disabled={!prompt.trim()}
              aria-label="Generate asset"
              data-walkthrough="generation-submit"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width: 16px; height: 16px">
                <path d="M5 12h14M12 5l7 7-7 7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </Tooltip>
        </form>
      </div>

      {/* Theme Pack section */}
      <div class="generation-section__hero">
        <div class="generation-section__hero-label">Theme Pack</div>
        <div class="generation-section__form">
          <input
            type="text"
            class="generation-section__input"
            placeholder="e.g. haunted graveyard"
            value={themePrompt}
            onInput={(e) => setThemePrompt(e.target.value)}
            aria-label="Theme description"
          />
          <Tooltip content="Generate 6-10 themed assets" position="top">
            <button
              type="button"
              class="generation-section__submit"
              onClick={handleThemePack}
              disabled={!themePrompt.trim() || themeLoading}
              aria-label="Generate theme pack"
            >
              {themeLoading ? (
                <div class="gen-queue-item__spinner" />
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width: 16px; height: 16px">
                  <rect x="3" y="3" width="7" height="7" rx="1" stroke-width="2"/>
                  <rect x="14" y="3" width="7" height="7" rx="1" stroke-width="2"/>
                  <rect x="3" y="14" width="7" height="7" rx="1" stroke-width="2"/>
                  <rect x="14" y="14" width="7" height="7" rx="1" stroke-width="2"/>
                </svg>
              )}
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Queue section */}
      <div class="generation-section__queue-section">
        <div class="generation-section__queue-header">
          <span>Queue</span>
          {activeCount > 0 && (
            <span class="generation-section__badge generation-section__badge--active">
              {activeCount}
            </span>
          )}
          {readyCount > 0 && (
            <span class="generation-section__badge generation-section__badge--ready">
              {readyCount} ready
            </span>
          )}
        </div>

        <div class="generation-section__queue">
          {items.length === 0 ? (
            <div class="generation-section__empty">
              Your generated assets will appear here
            </div>
          ) : (
            items.map((item, index) => {
              // For pending items, calculate position among pending items for reorder
              const pendingIndex = item.status === 'pending'
                ? pendingItems.findIndex(p => p.id === item.id)
                : -1
              return (
                <QueueItemRow
                  key={item.id}
                  item={item}
                  onReview={handleReview}
                  showReorderButtons={pendingItems.length > 1}
                  isFirst={pendingIndex === 0}
                  isLast={pendingIndex === pendingItems.length - 1}
                />
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
