import { signal, effect } from '@preact/signals'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { dismissAllTooltips } from '../state/tooltipState'

/**
 * Global state for confirm modal
 * Stores: { title, message, confirmText, cancelText, danger, resolve }
 */
export const confirmState = signal(null)

/**
 * Show a confirm dialog and return a Promise that resolves to true/false
 * @param {{ title?: string, message: string, confirmText?: string, cancelText?: string, danger?: boolean }} options
 * @returns {Promise<boolean>}
 */
export function showConfirm({ title = 'Confirm', message, confirmText = 'Confirm', cancelText = 'Cancel', danger = false }) {
  // Dismiss any open tooltips before showing the modal
  dismissAllTooltips()

  return new Promise((resolve) => {
    confirmState.value = {
      title,
      message,
      confirmText,
      cancelText,
      danger,
      resolve
    }
  })
}

/**
 * Close the confirm modal with a result
 */
function closeConfirm(result) {
  const state = confirmState.value
  if (state?.resolve) {
    state.resolve(result)
  }
  confirmState.value = null
}

/**
 * ConfirmModal component - mount once at app root
 */
export function ConfirmModal() {
  const state = confirmState.value
  const modalRef = useFocusTrap(!!state, () => closeConfirm(false))

  if (!state) return null

  // Split message on newlines for multi-line support
  const messageLines = state.message.split('\n').filter(line => line.trim())

  return (
    <div class="modal-overlay" onClick={() => closeConfirm(false)}>
      <div
        ref={modalRef}
        class={`modal modal--confirm ${state.danger ? 'modal--danger' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-message"
      >
        <div class="modal__header">
          <span id="confirm-modal-title" class="modal__title">{state.title}</span>
        </div>

        <div id="confirm-modal-message" class="modal__body">
          {messageLines.map((line, i) => (
            <p key={i} style={i < messageLines.length - 1 ? 'margin-bottom: var(--sp-2)' : ''}>
              {line}
            </p>
          ))}
        </div>

        <div class="modal__footer">
          <button
            class="btn"
            onClick={() => closeConfirm(false)}
          >
            {state.cancelText}
          </button>
          <button
            class={`btn ${state.danger ? 'btn--danger' : 'btn--primary'}`}
            onClick={() => closeConfirm(true)}
          >
            {state.confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
