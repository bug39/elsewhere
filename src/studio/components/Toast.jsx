import { useEffect } from 'preact/hooks'
import { signal } from '@preact/signals'

export const toastQueue = signal([])

// SVG path data for toast icons (stroke paths)
const TOAST_ICONS = {
  success: 'M20 6L9 17l-5-5',
  error: 'M18 6L6 18M6 6l12 12',
  info: 'M12 8v4m0 4h.01'
}

/**
 * Show a toast notification
 * @param {string|Object} messageOrOptions - Message string or options object
 * @param {string} [type] - Toast type: 'info', 'success', 'error', 'hint'
 * @param {number} [duration] - Duration in ms (null for default)
 *
 * Options object format:
 * {
 *   message: string,
 *   type: 'info' | 'success' | 'error' | 'hint',
 *   duration: number,
 *   id: string,           // For deduplication - if toast with same id exists, skip
 *   action: { label: string, onClick: () => void }  // Optional action button
 * }
 */
export function showToast(messageOrOptions, type = 'info', duration = null) {
  // Support both simple (message, type, duration) and options object API
  const options = typeof messageOrOptions === 'string'
    ? { message: messageOrOptions, type, duration }
    : messageOrOptions

  const id = options.id || Date.now()
  const toastType = options.type || 'info'

  // Deduplication: skip if toast with same id already exists
  if (options.id && toastQueue.value.some(t => t.id === options.id)) {
    return
  }

  // Default duration: 4s for info/success, 8s for errors, 10s for hints
  const defaultDuration = toastType === 'error' ? 8000 : toastType === 'hint' ? 10000 : 4000
  const finalDuration = options.duration !== null && options.duration !== undefined
    ? options.duration
    : defaultDuration

  toastQueue.value = [...toastQueue.value, {
    id,
    message: options.message,
    type: toastType,
    duration: finalDuration,
    action: options.action || null
  }]
}

function ToastItem({ toast, onDismiss }) {
  useEffect(() => {
    if (toast.duration > 0) {
      const timer = setTimeout(() => onDismiss(toast.id), toast.duration)
      return () => clearTimeout(timer)
    }
  }, [toast.id, toast.duration, onDismiss])

  // Hint uses asterisk, others use stroke paths from config
  const isHint = toast.type === 'hint'
  const iconPath = TOAST_ICONS[toast.type] || TOAST_ICONS.info

  const handleAction = () => {
    if (toast.action?.onClick) {
      toast.action.onClick()
      onDismiss(toast.id)
    }
  }

  return (
    <div class={`toast toast--${toast.type}`} role="alert">
      {isHint ? (
        <span class="toast__icon toast__icon--hint">*</span>
      ) : (
        <svg class="toast__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d={iconPath} stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      )}
      <div class="toast__content">
        <div class="toast__message">{toast.message}</div>
      </div>
      {toast.action && (
        <button class="toast__action" onClick={handleAction}>
          {toast.action.label}
        </button>
      )}
      <button class="toast-dismiss" onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification">×</button>
    </div>
  )
}

export function ToastContainer() {
  const dismiss = (id) => {
    toastQueue.value = toastQueue.value.filter(t => t.id !== id)
  }
  if (toastQueue.value.length === 0) return null
  return (
    <div class="toast-container">
      {toastQueue.value.map(t => <ToastItem key={t.id} toast={t} onDismiss={dismiss} />)}
    </div>
  )
}
