import { useEffect, useRef } from 'preact/hooks'

/**
 * Hook to trap focus within a container (for modals)
 * - Tab cycles through focusable elements within the container
 * - Escape key calls onClose
 * - Focus returns to trigger element when closed
 *
 * @param {boolean} isActive - Whether the focus trap is active
 * @param {function} onClose - Callback when escape is pressed
 */
export function useFocusTrap(isActive, onClose) {
  const containerRef = useRef(null)
  const previousActiveElement = useRef(null)

  useEffect(() => {
    if (!isActive) return

    // Store the previously focused element
    previousActiveElement.current = document.activeElement

    // Get all focusable elements within the container
    const getFocusableElements = () => {
      if (!containerRef.current) return []
      return containerRef.current.querySelectorAll(
        'button:not([disabled]):not([tabindex="-1"]), [href]:not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])'
      )
    }

    // Focus the first focusable element
    const focusFirst = () => {
      const focusable = getFocusableElements()
      if (focusable.length > 0) {
        focusable[0].focus()
      }
    }

    // Handle keyboard events
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose?.()
        return
      }

      if (e.key !== 'Tab') return

      const focusable = getFocusableElements()
      if (focusable.length === 0) return

      const firstFocusable = focusable[0]
      const lastFocusable = focusable[focusable.length - 1]

      // Shift+Tab from first element -> go to last
      if (e.shiftKey && document.activeElement === firstFocusable) {
        e.preventDefault()
        lastFocusable.focus()
      }
      // Tab from last element -> go to first
      else if (!e.shiftKey && document.activeElement === lastFocusable) {
        e.preventDefault()
        firstFocusable.focus()
      }
    }

    // Focus the first element after a short delay (to ensure DOM is ready)
    const focusTimeout = setTimeout(focusFirst, 50)

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      clearTimeout(focusTimeout)
      document.removeEventListener('keydown', handleKeyDown)

      // Return focus to the previously focused element
      if (previousActiveElement.current && previousActiveElement.current.focus) {
        previousActiveElement.current.focus()
      }
    }
  }, [isActive, onClose])

  return containerRef
}
