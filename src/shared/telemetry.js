/**
 * Centralized telemetry and event logging for thinq
 *
 * Provides structured event logging following the schema from UI_UX_FUZZ_TEST_REPORT.md.
 * Events are buffered and can be exported for debugging and analysis.
 */

import { signal } from '@preact/signals'

// Configuration
const MAX_EVENTS = 1000  // Maximum events to keep in memory
const FUZZ_RUN_ID = `fuzz_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

// Event buffer (circular buffer)
const events = []

// Telemetry enabled state
export const telemetryEnabled = signal(true)

// Current session state (updated by app)
const sessionState = {
  worldsCount: 0,
  libraryCount: 0,
  placedAssetsCount: 0,
  undoDepth: 0,
  redoDepth: 0,
  dirty: false
}

/**
 * Event types following the schema
 */
export const EVENT_TYPE = {
  // User interactions
  CLICK: 'click',
  KEYDOWN: 'keydown',

  // Navigation
  ROUTE: 'route',
  MODE_CHANGE: 'mode_change',
  TOOL_CHANGE: 'tool_change',

  // Generation lifecycle
  JOB_START: 'job_start',
  JOB_PROGRESS: 'job_progress',
  JOB_COMPLETE: 'job_complete',
  JOB_FAIL: 'job_fail',

  // Variation and refinement
  VARIATION_START: 'variation_start',
  VARIATION_SELECT: 'variation_select',
  PROMPT_REFINE: 'prompt_refine',
  ASSET_ACCEPT: 'asset_accept',
  ASSET_DISCARD: 'asset_discard',

  // State changes
  UNDO: 'undo',
  REDO: 'redo',
  SAVE: 'save',
  LOAD: 'load',

  // Errors
  ERROR: 'error',
  WEBGL: 'webgl',
  STORAGE: 'storage',

  // Performance
  PERF_FPS: 'perf_fps',
  PERF_MEMORY: 'perf_memory',
  PERF_LONG_TASK: 'perf_long_task'
}

/**
 * Log an event
 * @param {string} eventType - One of EVENT_TYPE values
 * @param {Object} payload - Event-specific data
 */
export function logEvent(eventType, payload = {}) {
  if (!telemetryEnabled.value) return

  const event = {
    schema_version: '1.0',
    run_id: FUZZ_RUN_ID,
    timestamp: Date.now(),
    event_type: eventType,
    payload: {
      ...payload,
      // Include memory if available
      memory_mb: getMemoryUsage()
    },
    session_state: { ...sessionState }
  }

  // Add to buffer (circular)
  events.push(event)
  if (events.length > MAX_EVENTS) {
    events.shift()
  }

  // Also log to console in development
  if (import.meta.env?.DEV) {
    console.debug(`[Telemetry] ${eventType}`, payload)
  }
}

/**
 * Update session state for event context
 * @param {Object} updates - Partial session state updates
 */
export function updateSessionState(updates) {
  Object.assign(sessionState, updates)
}

/**
 * Get current memory usage in MB (if available)
 * @returns {number|null}
 */
function getMemoryUsage() {
  if (performance?.memory?.usedJSHeapSize) {
    return Math.round(performance.memory.usedJSHeapSize / 1024 / 1024)
  }
  return null
}

/**
 * Get all logged events
 * @returns {Array}
 */
export function getEvents() {
  return [...events]
}

/**
 * Clear all events
 */
export function clearEvents() {
  events.length = 0
}

/**
 * Export events as JSON string
 * @returns {string}
 */
export function exportEvents() {
  return JSON.stringify(events, null, 2)
}

/**
 * Download events as JSON file
 */
export function downloadEvents() {
  const blob = new Blob([exportEvents()], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `thinq-telemetry-${FUZZ_RUN_ID}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Get the current fuzz run ID
 * @returns {string}
 */
export function getRunId() {
  return FUZZ_RUN_ID
}

// Convenience logging functions

/**
 * Log a mode change event
 * @param {string} from - Previous mode
 * @param {string} to - New mode
 */
export function logModeChange(from, to) {
  logEvent(EVENT_TYPE.MODE_CHANGE, { from, to })
}

/**
 * Log a tool change event
 * @param {string} from - Previous tool
 * @param {string} to - New tool
 */
export function logToolChange(from, to) {
  logEvent(EVENT_TYPE.TOOL_CHANGE, { from, to })
}

/**
 * Log a generation start event
 * @param {string} generationId - Queue item ID
 * @param {string} prompt - User's prompt
 * @param {number} promptLength - Length of prompt
 * @param {string} worldId - World ID
 */
export function logJobStart(generationId, prompt, promptLength, worldId) {
  logEvent(EVENT_TYPE.JOB_START, {
    generation_id: generationId,
    prompt: prompt.slice(0, 100), // Truncate for privacy
    prompt_length: promptLength,
    world_id: worldId
  })
}

/**
 * Log a generation completion event
 * @param {string} generationId - Queue item ID
 * @param {number} durationMs - Time taken
 * @param {string} category - Asset category
 */
export function logJobComplete(generationId, durationMs, category) {
  logEvent(EVENT_TYPE.JOB_COMPLETE, {
    generation_id: generationId,
    duration_ms: durationMs,
    category
  })
}

/**
 * Log a generation failure event
 * @param {string} generationId - Queue item ID
 * @param {string} errorMessage - Error message
 * @param {string} errorType - Error type/category
 */
export function logJobFail(generationId, errorMessage, errorType) {
  logEvent(EVENT_TYPE.JOB_FAIL, {
    generation_id: generationId,
    error_message: errorMessage,
    error_type: errorType
  })
}

/**
 * Log an error event
 * @param {string} message - Error message
 * @param {string} stack - Stack trace
 * @param {string} component - Component where error occurred
 */
export function logError(message, stack, component) {
  logEvent(EVENT_TYPE.ERROR, {
    error_message: message,
    error_stack: stack?.slice(0, 500), // Truncate stack
    component
  })
}

/**
 * Log a WebGL event
 * @param {string} type - 'context_lost' | 'context_restored' | 'error'
 * @param {Object} details - Additional details
 */
export function logWebGL(type, details = {}) {
  logEvent(EVENT_TYPE.WEBGL, { type, ...details })
}

/**
 * Log a storage event
 * @param {string} operation - 'save' | 'load' | 'delete' | 'quota_warning'
 * @param {boolean} success - Whether operation succeeded
 * @param {number} quotaPercent - Storage quota usage percentage
 */
export function logStorage(operation, success, quotaPercent = null) {
  logEvent(EVENT_TYPE.STORAGE, {
    operation,
    success,
    quota_percent: quotaPercent
  })
}

/**
 * Log the start of a variation batch
 * @param {string} batchId - Unique batch identifier
 * @param {string} prompt - User's prompt
 * @param {number} variationCount - Number of variations being generated
 */
export function logVariationStart(batchId, prompt, variationCount = 3) {
  logEvent(EVENT_TYPE.VARIATION_START, {
    batch_id: batchId,
    prompt: prompt.slice(0, 100),
    prompt_length: prompt.length,
    variation_count: variationCount
  })
}

/**
 * Log selection of a variation from a batch
 * @param {string} batchId - Batch identifier
 * @param {number} selectedIndex - Which variation was chosen (0, 1, 2)
 * @param {number} totalVariations - Total variations in batch
 */
export function logVariationSelect(batchId, selectedIndex, totalVariations) {
  logEvent(EVENT_TYPE.VARIATION_SELECT, {
    batch_id: batchId,
    selected_index: selectedIndex,
    total_variations: totalVariations
  })
}

/**
 * Log a prompt refinement (editing and regenerating)
 * @param {string} originalPrompt - Original prompt before edit
 * @param {string} newPrompt - Edited prompt
 * @param {number} iterationCount - Which refinement iteration this is
 */
export function logPromptRefine(originalPrompt, newPrompt, iterationCount) {
  logEvent(EVENT_TYPE.PROMPT_REFINE, {
    original_length: originalPrompt.length,
    new_length: newPrompt.length,
    iteration_count: iterationCount,
    prompt_changed: originalPrompt !== newPrompt
  })
}

/**
 * Log asset acceptance into library
 * @param {string} category - Asset category
 * @param {number} generationDurationMs - Time from queue to completion
 * @param {boolean} fromVariation - Whether this came from variation gallery
 */
export function logAssetAccept(category, generationDurationMs = null, fromVariation = false) {
  logEvent(EVENT_TYPE.ASSET_ACCEPT, {
    category,
    generation_duration_ms: generationDurationMs,
    from_variation: fromVariation
  })
}

/**
 * Log asset discard (user rejects generated asset)
 * @param {string} category - Asset category
 * @param {string} reason - Why it was discarded ('discard', 'regenerate', 'close')
 */
export function logAssetDiscard(category, reason) {
  logEvent(EVENT_TYPE.ASSET_DISCARD, {
    category,
    reason
  })
}

// Performance monitoring

let fpsFrameTimes = []
let lastFpsReport = 0
const FPS_REPORT_INTERVAL = 5000 // Report every 5 seconds

/**
 * Record a frame time for FPS calculation
 * @param {number} deltaMs - Time since last frame in ms
 */
export function recordFrameTime(deltaMs) {
  if (!telemetryEnabled.value) return

  fpsFrameTimes.push(deltaMs)

  // Keep only last 60 frames
  if (fpsFrameTimes.length > 60) {
    fpsFrameTimes.shift()
  }

  // Report FPS periodically
  const now = Date.now()
  if (now - lastFpsReport > FPS_REPORT_INTERVAL && fpsFrameTimes.length >= 30) {
    const avgFrameTime = fpsFrameTimes.reduce((a, b) => a + b, 0) / fpsFrameTimes.length
    const avgFps = Math.round(1000 / avgFrameTime)
    const minFps = Math.round(1000 / Math.max(...fpsFrameTimes))
    const maxFps = Math.round(1000 / Math.min(...fpsFrameTimes))

    logEvent(EVENT_TYPE.PERF_FPS, {
      fps_avg: avgFps,
      fps_min: minFps,
      fps_max: maxFps
    })

    lastFpsReport = now
    fpsFrameTimes = []
  }
}

// Set up global error handler
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    logError(event.message, event.error?.stack, 'global')
  })

  window.addEventListener('unhandledrejection', (event) => {
    const message = event.reason?.message || String(event.reason)
    const stack = event.reason?.stack
    logError(message, stack, 'unhandled_promise')
  })
}
