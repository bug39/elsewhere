/**
 * Token usage tracker for Gemini API calls
 *
 * Tracks prompt/output tokens per session and persists to sessionStorage.
 * Use getSessionUsage() to retrieve current totals.
 */

const STORAGE_KEY = 'thinq-token-usage'

/**
 * @typedef {Object} TokenUsage
 * @property {number} promptTokens - Input tokens
 * @property {number} outputTokens - Output tokens
 * @property {number} thinkingTokens - Thinking/reasoning tokens (if enabled)
 */

/**
 * @typedef {Object} UsageRecord
 * @property {string} operation - Type of operation (plan, generate, etc.)
 * @property {string} prompt - Truncated prompt for debugging
 * @property {TokenUsage} usage - Token counts
 * @property {number} timestamp - Unix timestamp
 */

/**
 * @typedef {Object} SessionUsage
 * @property {number} totalPromptTokens - Total input tokens this session
 * @property {number} totalOutputTokens - Total output tokens this session
 * @property {number} totalThinkingTokens - Total thinking tokens this session
 * @property {number} requestCount - Number of API calls
 * @property {UsageRecord[]} records - Individual usage records
 */

/**
 * Get current session usage from sessionStorage
 * @returns {SessionUsage}
 */
export function getSessionUsage() {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (e) {
    console.warn('[tokenUsage] Failed to read session storage:', e)
  }

  return {
    totalPromptTokens: 0,
    totalOutputTokens: 0,
    totalThinkingTokens: 0,
    requestCount: 0,
    records: []
  }
}

/**
 * Record token usage from a Gemini API call
 * @param {string} operation - Operation type (e.g., 'plan', 'generate')
 * @param {string} prompt - The prompt sent (will be truncated)
 * @param {TokenUsage} usage - Token counts from the API response
 */
export function recordUsage(operation, prompt, usage) {
  const session = getSessionUsage()

  // Update totals
  session.totalPromptTokens += usage.promptTokens || 0
  session.totalOutputTokens += usage.outputTokens || 0
  session.totalThinkingTokens += usage.thinkingTokens || 0
  session.requestCount += 1

  // Add record (truncate prompt for storage efficiency)
  session.records.push({
    operation,
    prompt: prompt.slice(0, 100) + (prompt.length > 100 ? '...' : ''),
    usage,
    timestamp: Date.now()
  })

  // Keep only last 50 records to prevent storage bloat
  if (session.records.length > 50) {
    session.records = session.records.slice(-50)
  }

  // Persist
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch (e) {
    console.warn('[tokenUsage] Failed to write session storage:', e)
  }

  // Log to console in dev mode
  if (import.meta.env.DEV) {
    console.log(`[tokenUsage] ${operation}: ${usage.promptTokens} in, ${usage.outputTokens} out` +
      (usage.thinkingTokens ? `, ${usage.thinkingTokens} thinking` : '') +
      ` | Session total: ${session.totalPromptTokens} in, ${session.totalOutputTokens} out`)
  }

  return session
}

/**
 * Clear session usage (e.g., for testing)
 */
export function clearSessionUsage() {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch (e) {
    console.warn('[tokenUsage] Failed to clear session storage:', e)
  }
}

/**
 * Get a summary string of current session usage
 * @returns {string}
 */
export function getUsageSummary() {
  const session = getSessionUsage()
  const totalTokens = session.totalPromptTokens + session.totalOutputTokens + session.totalThinkingTokens
  return `${session.requestCount} requests | ${totalTokens.toLocaleString()} total tokens (${session.totalPromptTokens.toLocaleString()} in, ${session.totalOutputTokens.toLocaleString()} out)`
}
