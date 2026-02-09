/**
 * Platform detection utilities
 */

/**
 * Returns true if running on macOS or iOS
 * @returns {boolean}
 */
export function isMac() {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform)
}

/**
 * Returns platform-appropriate modifier key name
 * @returns {'Cmd'|'Ctrl'}
 */
export function modKey() {
  return isMac() ? 'Cmd' : 'Ctrl'
}

/**
 * Returns platform-appropriate modifier symbol
 * @returns {'⌘'|'Ctrl'}
 */
export function modSymbol() {
  return isMac() ? '⌘' : 'Ctrl'
}
