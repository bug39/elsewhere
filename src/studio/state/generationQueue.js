import { signal } from '@preact/signals'
import { get, set } from 'idb-keyval'
import { generateId } from './storage'

const QUEUE_KEY = 'thinq-generation-queue'
const FIRST_COMPLETION_KEY = 'thinq-first-completion-done'
const MAX_QUEUE_SIZE = 15

/**
 * @typedef {Object} QueueItem
 * @property {string} id - Unique identifier (gen_xxx)
 * @property {string|null} worldId - The world this item belongs to (null = all worlds)
 * @property {string} prompt - User's prompt
 * @property {'pending'|'generating'|'completed'|'failed'} status
 * @property {string} progress - Current progress message
 * @property {string} createdAt - ISO timestamp
 * @property {string|null} error - Error message if failed
 * @property {Object|null} result - Generated asset result
 * @property {string} result.code - Generated Three.js code
 * @property {string} result.thumbnail - Base64 thumbnail
 * @property {string} result.name - Derived asset name
 * @property {string} result.category - Guessed category
 * @property {number} refinementCount - Number of times this prompt was refined (0 for original)
 * @property {boolean} isRefinement - Skip duplicate check if true
 * @property {string|null} batchId - Links variations together (null for non-batch items)
 * @property {number|null} variationIndex - Position in batch (0, 1, 2) for variations
 */

/** @type {import('@preact/signals').Signal<QueueItem[]>} */
export const generationQueue = signal([])

/** @type {import('@preact/signals').Signal<QueueItem|null>} */
export const activeGeneration = signal(null)

/**
 * Load queue from IndexedDB
 * Resets any 'generating' items to 'pending' (interrupted by browser close)
 */
export async function loadQueue() {
  try {
    const stored = await get(QUEUE_KEY)
    if (stored && Array.isArray(stored)) {
      // Reset interrupted generations to pending
      const restored = stored.map(item => ({
        ...item,
        status: item.status === 'generating' ? 'pending' : item.status,
        progress: item.status === 'generating' ? '' : item.progress
      }))
      generationQueue.value = restored
      return restored
    }
  } catch (err) {
    console.error('[GenerationQueue] Failed to load queue:', err)
  }
  return []
}

/**
 * Save queue to IndexedDB
 */
export async function saveQueue() {
  try {
    await set(QUEUE_KEY, generationQueue.value)
  } catch (err) {
    console.error('[GenerationQueue] Failed to save queue:', err)
  }
}

// Debounced save for non-critical operations (prevents blocking during rapid interactions)
let saveTimeout = null
function saveQueueDebounced() {
  clearTimeout(saveTimeout)
  saveTimeout = setTimeout(() => saveQueue(), 100)
}

/**
 * Check if a prompt is already in the queue (pending or generating)
 * @param {string} prompt
 * @returns {{ duplicate: boolean, position: number|null }}
 */
export function checkDuplicate(prompt) {
  const normalizedPrompt = prompt.trim().toLowerCase()
  const activeItems = generationQueue.value.filter(i =>
    i.status === 'pending' || i.status === 'generating'
  )
  const idx = activeItems.findIndex(i =>
    i.prompt.trim().toLowerCase() === normalizedPrompt
  )
  if (idx >= 0) {
    return { duplicate: true, position: idx + 1 }
  }
  return { duplicate: false, position: null }
}

/**
 * Get the current pending/generating queue size
 * @returns {number}
 */
export function getActiveQueueSize() {
  return generationQueue.value.filter(i =>
    i.status === 'pending' || i.status === 'generating'
  ).length
}

/**
 * @typedef {Object} AddToQueueOptions
 * @property {boolean} [isRefinement=false] - Skip duplicate check for refinements
 * @property {number} [refinementCount=0] - Number of times this prompt was refined
 * @property {string|null} [batchId=null] - Links variations together
 * @property {number|null} [variationIndex=null] - Position in batch (0, 1, 2)
 * @property {boolean} [isVariation=false] - Skip duplicate check for variations
 */

/**
 * Add a new item to the queue
 * @param {string} prompt
 * @param {string|null} worldId - Optional world ID to associate this item with
 * @param {AddToQueueOptions} [options={}] - Additional options for refinements and variations
 * @returns {{ item: QueueItem|null, error: string|null, duplicate: boolean, queueFull: boolean }}
 */
export async function addToQueue(prompt, worldId = null, options = {}) {
  const {
    isRefinement = false,
    refinementCount = 0,
    batchId = null,
    variationIndex = null,
    isVariation = false
  } = options

  const normalizedPrompt = prompt.trim()

  // Check for duplicate (skip for refinements and variations)
  if (!isRefinement && !isVariation) {
    const { duplicate, position } = checkDuplicate(normalizedPrompt)
    if (duplicate) {
      return {
        item: null,
        error: `Already queued (position ${position})`,
        duplicate: true,
        queueFull: false
      }
    }
  }

  // Check queue size limit
  const activeSize = getActiveQueueSize()
  if (activeSize >= MAX_QUEUE_SIZE) {
    return {
      item: null,
      error: `Queue full (max ${MAX_QUEUE_SIZE} items)`,
      duplicate: false,
      queueFull: true
    }
  }

  const item = {
    id: generateId('gen'),
    worldId,  // C2 FIX: Track which world this item belongs to
    prompt: normalizedPrompt,
    status: 'pending',
    progress: '',
    createdAt: new Date().toISOString(),
    error: null,
    result: null,
    refinementCount,
    isRefinement,
    batchId,
    variationIndex
  }

  generationQueue.value = [...generationQueue.value, item]
  // M16 FIX: Await saveQueue to prevent data loss on quick close
  await saveQueue()

  return { item, error: null, duplicate: false, queueFull: false }
}

/**
 * Update a queue item's properties
 * @param {string} id
 * @param {Partial<QueueItem>} updates
 */
export async function updateQueueItem(id, updates) {
  generationQueue.value = generationQueue.value.map(item =>
    item.id === id ? { ...item, ...updates } : item
  )
  // M16 FIX: Await saveQueue
  await saveQueue()
}

/**
 * Get a queue item by ID
 * @param {string} id
 * @returns {QueueItem|undefined}
 */
export function getQueueItem(id) {
  return generationQueue.value.find(item => item.id === id)
}

/**
 * Remove an item from the queue (dismiss)
 * @param {string} id
 */
export function dismissItem(id) {
  generationQueue.value = generationQueue.value.filter(item => item.id !== id)
  // Use debounced save for non-critical operation (won't block UI)
  saveQueueDebounced()
}

/**
 * Retry a failed item (reset to pending)
 * @param {string} id
 */
export async function retryItem(id) {
  // C1 FIX: Await updateQueueItem to ensure state is persisted before returning
  await updateQueueItem(id, {
    status: 'pending',
    progress: '',
    error: null,
    result: null
  })
}

/**
 * Accept a completed item - returns the result and removes from queue
 * @param {string} id
 * @returns {Promise<Object|null>} The result object or null if not found/completed
 */
export async function acceptItem(id) {
  const item = generationQueue.value.find(i => i.id === id)
  if (!item || item.status !== 'completed' || !item.result) {
    return null
  }

  const result = item.result
  // C2 FIX: Await dismissItem to ensure queue persistence completes before returning
  await dismissItem(id)
  return result
}

/**
 * Get the first pending item (for processor)
 * @returns {QueueItem|undefined}
 */
export function getNextPending() {
  return generationQueue.value.find(item => item.status === 'pending')
}

/**
 * Get counts for queue status badge
 * @returns {{ pending: number, generating: number, completed: number, failed: number, total: number }}
 */
export function getQueueCounts() {
  const items = generationQueue.value
  return {
    pending: items.filter(i => i.status === 'pending').length,
    generating: items.filter(i => i.status === 'generating').length,
    completed: items.filter(i => i.status === 'completed').length,
    failed: items.filter(i => i.status === 'failed').length,
    total: items.length
  }
}

/**
 * Check if queue has any items needing attention (completed or failed)
 * @returns {boolean}
 */
export function hasItemsNeedingAttention() {
  return generationQueue.value.some(i =>
    i.status === 'completed' || i.status === 'failed'
  )
}

/**
 * Check if queue is currently processing
 * @returns {boolean}
 */
export function isProcessing() {
  return generationQueue.value.some(i => i.status === 'generating')
}

/**
 * Clear all completed and failed items
 */
export function clearFinishedItems() {
  generationQueue.value = generationQueue.value.filter(i =>
    i.status === 'pending' || i.status === 'generating'
  )
  // Use debounced save for non-critical operation (won't block UI)
  saveQueueDebounced()
}

/**
 * C2 FIX: Get queue items for a specific world (includes items with no worldId)
 * @param {string|null} worldId
 * @returns {QueueItem[]}
 */
export function getQueueForWorld(worldId) {
  return generationQueue.value.filter(i => !i.worldId || i.worldId === worldId)
}

/**
 * C2 FIX: Clear queue items for a specific world (on world switch)
 * Removes completed/failed items that belong to the old world
 * @param {string} worldId
 */
export function clearQueueForWorld(worldId) {
  if (!worldId) return
  generationQueue.value = generationQueue.value.filter(i =>
    // Keep items from other worlds or items without a world
    i.worldId !== worldId ||
    // Keep pending/generating items even from this world
    i.status === 'pending' || i.status === 'generating'
  )
  // Use debounced save for non-critical operation (won't block UI)
  saveQueueDebounced()
}

/**
 * Move a pending item up in the queue (closer to front)
 * @param {string} id
 */
export function moveItemUp(id) {
  const items = [...generationQueue.value]
  const index = items.findIndex(i => i.id === id)

  // Can't move if not found, already first, or not pending
  if (index <= 0 || items[index].status !== 'pending') return

  // Find the previous pending item to swap with
  let swapIndex = -1
  for (let i = index - 1; i >= 0; i--) {
    if (items[i].status === 'pending') {
      swapIndex = i
      break
    }
  }

  if (swapIndex === -1) return // No pending item above to swap with

  // Swap
  [items[swapIndex], items[index]] = [items[index], items[swapIndex]]
  generationQueue.value = items
  // Use debounced save for non-critical operation (won't block UI during rapid reordering)
  saveQueueDebounced()
}

/**
 * Move a pending item down in the queue (further from front)
 * @param {string} id
 */
export function moveItemDown(id) {
  const items = [...generationQueue.value]
  const index = items.findIndex(i => i.id === id)

  // Can't move if not found, already last, or not pending
  if (index === -1 || index >= items.length - 1 || items[index].status !== 'pending') return

  // Find the next pending item to swap with
  let swapIndex = -1
  for (let i = index + 1; i < items.length; i++) {
    if (items[i].status === 'pending') {
      swapIndex = i
      break
    }
  }

  if (swapIndex === -1) return // No pending item below to swap with

  // Swap
  [items[index], items[swapIndex]] = [items[swapIndex], items[index]]
  generationQueue.value = items
  // Use debounced save for non-critical operation (won't block UI during rapid reordering)
  saveQueueDebounced()
}

/**
 * Check if a pending item can move up
 * @param {string} id
 * @returns {boolean}
 */
export function canMoveUp(id) {
  const items = generationQueue.value
  const index = items.findIndex(i => i.id === id)
  if (index <= 0 || items[index].status !== 'pending') return false

  // Check if there's a pending item above
  for (let i = index - 1; i >= 0; i--) {
    if (items[i].status === 'pending') return true
  }
  return false
}

/**
 * Check if a pending item can move down
 * @param {string} id
 * @returns {boolean}
 */
export function canMoveDown(id) {
  const items = generationQueue.value
  const index = items.findIndex(i => i.id === id)
  if (index === -1 || index >= items.length - 1 || items[index].status !== 'pending') return false

  // Check if there's a pending item below
  for (let i = index + 1; i < items.length; i++) {
    if (items[i].status === 'pending') return true
  }
  return false
}

/** @type {boolean|null} */
let firstCompletionDoneCache = null

/**
 * Check if the first completion has already happened (for first-time UX)
 * @returns {boolean}
 */
export function isFirstCompletionDone() {
  if (firstCompletionDoneCache !== null) {
    return firstCompletionDoneCache
  }
  // Check localStorage synchronously for immediate access
  try {
    firstCompletionDoneCache = localStorage.getItem(FIRST_COMPLETION_KEY) === 'true'
  } catch {
    firstCompletionDoneCache = false
  }
  return firstCompletionDoneCache
}

/**
 * Mark that the first completion has happened
 */
export function markFirstCompletionDone() {
  firstCompletionDoneCache = true
  try {
    localStorage.setItem(FIRST_COMPLETION_KEY, 'true')
  } catch {
    // Ignore storage errors
  }
}

// ================================
// Variation Batch Support
// ================================

/**
 * Add a batch of variations for the same prompt
 * @param {string} prompt
 * @param {string|null} worldId
 * @param {number} [count=3] - Number of variations to generate
 * @returns {Promise<{ batchId: string, items: QueueItem[] }>}
 */
export async function addVariationBatch(prompt, worldId, count = 3) {
  const batchId = generateId('batch')
  const items = []

  for (let i = 0; i < count; i++) {
    const result = await addToQueue(prompt, worldId, {
      batchId,
      variationIndex: i,
      isVariation: true
    })
    if (result.item) {
      items.push(result.item)
    }
  }

  return { batchId, items }
}

/**
 * Get all items belonging to a variation batch
 * @param {string} batchId
 * @returns {QueueItem[]}
 */
export function getVariationBatch(batchId) {
  return generationQueue.value.filter(i => i.batchId === batchId)
}

/**
 * Check if all items in a batch have completed (or failed)
 * @param {string} batchId
 * @returns {boolean}
 */
export function isBatchComplete(batchId) {
  const batch = getVariationBatch(batchId)
  return batch.length > 0 && batch.every(i =>
    i.status === 'completed' || i.status === 'failed'
  )
}

/**
 * Get count of completed items in a batch
 * @param {string} batchId
 * @returns {{ total: number, completed: number, failed: number }}
 */
export function getBatchProgress(batchId) {
  const batch = getVariationBatch(batchId)
  return {
    total: batch.length,
    completed: batch.filter(i => i.status === 'completed').length,
    failed: batch.filter(i => i.status === 'failed').length
  }
}
