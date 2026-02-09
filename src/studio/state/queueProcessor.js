import { assetGenerator } from '../../generator/AssetGenerator'
import { legacyAssetGenerator } from '../../generator/legacy/AssetGeneratorLegacy.js'
import { generateThumbnailAsync } from '../../generator/ThumbnailRenderer'
import { showToast } from '../components/Toast'
import { logVariationStart } from '../../shared/telemetry'
import { isFeatureEnabled } from '../../shared/featureFlags'
import {
  generationQueue,
  activeGeneration,
  getNextPending,
  getQueueItem,
  updateQueueItem,
  isProcessing,
  addToQueue,
  addVariationBatch
} from './generationQueue'

/**
 * Background queue processor singleton
 * Processes one generation at a time, updates queue state, shows notifications
 */
class QueueProcessor {
  constructor() {
    this.running = false
    this.processingPromise = null
    this.currentItemId = null
    this.currentGenerator = null
    // P1-001+003 FIX: Mutex for concurrent processItem calls
    this._processingMutex = Promise.resolve()
  }

  /**
   * P1-001 FIX: Acquire mutex for exclusive processItem access
   * Prevents race conditions when multiple processNext() calls overlap
   * @returns {Promise<Function>} Release function to call when done
   */
  async _acquireMutex() {
    const prev = this._processingMutex
    let release
    this._processingMutex = new Promise(resolve => { release = resolve })
    await prev
    return release
  }

  /**
   * Start the processor loop
   * Will process items until queue is empty or stopped
   */
  start() {
    if (this.running) return

    this.running = true
    this.processLoop()
  }

  /**
   * Stop the processor
   * Note: Does not cancel current generation, just prevents next one
   */
  stop() {
    this.running = false
  }

  /**
   * Cancel the current generation in progress
   */
  cancelCurrent() {
    if (this.currentItemId) {
      const generator = this.currentGenerator || assetGenerator
      generator.cancel()
      return true
    }
    return false
  }

  /**
   * Main processing loop
   * Checks for pending items and processes them sequentially
   */
  async processLoop() {
    while (this.running) {
      // Check if already processing something
      if (isProcessing()) {
        // Wait a bit and check again
        await this.sleep(1000)
        continue
      }

      // Get next pending item
      const item = getNextPending()
      if (!item) {
        // No items to process, wait and check again
        await this.sleep(1000)
        continue
      }

      // Process this item
      await this.processItem(item)
    }
  }

  /**
   * Process a single queue item
   * P1-001+003 FIX: Protected by mutex to prevent concurrent processing
   * @param {Object} item Queue item to process
   */
  async processItem(item) {
    // P1-001 FIX: Acquire mutex to prevent concurrent processItem calls
    const release = await this._acquireMutex()

    try {
      // P1-004 FIX: Re-validate item is still pending after acquiring mutex
      // Another processItem call may have completed this item while we were waiting
      const currentItem = getQueueItem(item.id)
      if (!currentItem || currentItem.status !== 'pending') {
        console.log(`[QueueProcessor] Item ${item.id} no longer pending (status: ${currentItem?.status}), skipping`)
        return
      }

      console.log(`[QueueProcessor] Starting generation for: ${item.prompt}`)

      this.currentItemId = item.id

      // P1-003 FIX: await status update to ensure persistence before proceeding
      await updateQueueItem(item.id, {
        status: 'generating',
        progress: 'Starting...',
        startedAt: Date.now()
      })
      activeGeneration.value = item

      const useLegacyGenerator = isFeatureEnabled('legacyAssetGenerator')
      const generator = useLegacyGenerator ? legacyAssetGenerator : assetGenerator
      this.currentGenerator = generator

      // Set up progress callback (fire-and-forget OK for frequent progress updates)
      generator.setProgressCallback((msg) => {
        updateQueueItem(item.id, { progress: msg })
      })

      // Generate the asset
      const { asset, code, postProcessAdjustments, v3Schema } = await generator.generate(item.prompt)

      // Derive name and category
      const name = generator.deriveName(item.prompt)
      const category = generator.guessCategory(item.prompt)

      // Mark item complete immediately with pending thumbnail
      // This eliminates 50-100ms main-thread stalls from sync toDataURL()
      await updateQueueItem(item.id, {
        status: 'completed',
        progress: 'Ready for review',
        result: {
          code,
          thumbnail: null,  // Will be set asynchronously
          thumbnailPending: true,
          name,
          category,
          tags: item.prompt.toLowerCase().split(/\s+/).filter(t => t.length > 2),
          adjustments: postProcessAdjustments || [],
          originalPrompt: item.prompt,
          v3Schema: v3Schema || null
        }
      })

      // Generate thumbnail asynchronously (fire-and-forget, non-blocking)
      // Uses toBlob() which moves PNG encoding off the main thread
      generateThumbnailAsync(asset).then(async (thumbnail) => {
        // Update queue item with the generated thumbnail
        await updateQueueItem(item.id, {
          result: {
            code,
            thumbnail,
            thumbnailPending: false,
            name,
            category,
            tags: item.prompt.toLowerCase().split(/\s+/).filter(t => t.length > 2),
            adjustments: postProcessAdjustments || [],
            originalPrompt: item.prompt,
            v3Schema: v3Schema || null
          }
        })
      }).catch(err => {
        console.warn(`[QueueProcessor] Async thumbnail generation failed:`, err)
        // Item already marked complete, just leave thumbnail as null
      })

      console.log(`[QueueProcessor] Generation completed: ${name}`)
      showToast(`"${name}" is ready!`, 'success', 5000)

    } catch (err) {
      console.error(`[QueueProcessor] Generation failed:`, err)

      // Check if this was a cancellation
      const isCancelled = err.message === 'Generation cancelled' || err.name === 'AbortError'

      if (isCancelled) {
        // P1-003 FIX: await failure status update
        await updateQueueItem(item.id, {
          status: 'failed',
          progress: '',
          error: 'Cancelled by user'
        })
        showToast('Generation cancelled', 'info', 3000)
      } else {
        // P1-003 FIX: await failure status update
        await updateQueueItem(item.id, {
          status: 'failed',
          progress: '',
          error: err.message || 'Generation failed'
        })
        showToast(`Generation failed: ${err.message}`, 'error', 6000)
      }

    } finally {
      this.currentItemId = null
      this.currentGenerator = null
      activeGeneration.value = null
      assetGenerator.setProgressCallback(null)
      legacyAssetGenerator.setProgressCallback(null)
      // P1-001 FIX: Release mutex
      release()
    }
  }

  /**
   * Force process the next pending item immediately
   * Useful for manual retry or when adding new items
   */
  async processNext() {
    if (isProcessing()) {
      console.log('[QueueProcessor] Already processing, skipping processNext')
      return
    }

    const item = getNextPending()
    if (item) {
      await this.processItem(item)

      // Continue processing if there are more items
      if (this.running) {
        const next = getNextPending()
        if (next) {
          this.processNext()
        }
      }
    }
  }

  /**
   * Helper for async sleep
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// Singleton instance
export const queueProcessor = new QueueProcessor()

/**
 * Initialize the queue processor
 * Call this on app mount after loading the queue
 */
export function initProcessor() {
  queueProcessor.start()
}

/**
 * Cancel the current generation in progress
 * @returns {boolean} True if there was a generation to cancel
 */
export function cancelGeneration() {
  return queueProcessor.cancelCurrent()
}

/**
 * Add a prompt to the queue and ensure processor is running
 * This is the main entry point for users submitting prompts
 * @returns {{ success: boolean, item: Object|null }}
 */
export async function submitGeneration(prompt, worldId = null) {
  const result = await addToQueue(prompt, worldId)

  if (result.duplicate) {
    showToast(`"${prompt.slice(0, 20)}${prompt.length > 20 ? '...' : ''}" is already queued`, 'info', 3000)
    return { success: false, item: null }
  }

  if (result.queueFull) {
    showToast('Queue is full. Wait for some items to complete.', 'error', 4000)
    return { success: false, item: null }
  }

  if (result.error) {
    showToast(result.error, 'error', 4000)
    return { success: false, item: null }
  }

  showToast('Asset queued for generation', 'info', 2000)

  // Ensure processor is running and trigger immediate processing
  queueProcessor.start()
  queueProcessor.processNext()

  return { success: true, item: result.item }
}

/**
 * Check if API key is configured
 * @returns {boolean}
 */
export function hasApiKey() {
  return true // Auth handled server-side via proxy
}

/**
 * Submit a refinement of an existing prompt
 * Bypasses duplicate check and tracks refinement count
 * @param {string} prompt - The refined prompt
 * @param {string|null} worldId
 * @param {number} refinementCount - How many times this has been refined
 * @returns {Promise<{ success: boolean, item: Object|null }>}
 */
export async function submitRefinement(prompt, worldId, refinementCount) {
  if (!hasApiKey()) {
    showToast('Session expired. Please refresh the page.', 'error', 6000)
    return { success: false, item: null }
  }

  const result = await addToQueue(prompt, worldId, {
    isRefinement: true,
    refinementCount
  })

  if (result.queueFull) {
    showToast('Queue is full. Wait for some items to complete.', 'error', 4000)
    return { success: false, item: null }
  }

  if (result.error) {
    showToast(result.error, 'error', 4000)
    return { success: false, item: null }
  }

  showToast('Regenerating with updated prompt...', 'info', 2000)

  // Ensure processor is running
  queueProcessor.start()
  queueProcessor.processNext()

  return { success: true, item: result.item }
}

/**
 * Submit a batch of variations for the same prompt
 * @param {string} prompt
 * @param {string|null} worldId
 * @returns {Promise<{ success: boolean, batchId: string|null }>}
 */
export async function submitVariations(prompt, worldId) {
  if (!hasApiKey()) {
    showToast('Session expired. Please refresh the page.', 'error', 6000)
    return { success: false, batchId: null }
  }

  const result = await addVariationBatch(prompt, worldId, 3)

  if (result.items.length === 0) {
    showToast('Queue is full. Wait for some items to complete.', 'error', 4000)
    return { success: false, batchId: null }
  }

  // Log telemetry
  logVariationStart(result.batchId, prompt, result.items.length)

  const truncatedPrompt = prompt.length > 20 ? prompt.slice(0, 20) + '...' : prompt
  showToast(`Generating 3 variations of "${truncatedPrompt}"`, 'info', 3000)

  // Ensure processor is running
  queueProcessor.start()
  queueProcessor.processNext()

  return { success: true, batchId: result.batchId }
}
