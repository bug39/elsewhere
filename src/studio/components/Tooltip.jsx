import { useState, useRef, useEffect, useCallback } from 'preact/hooks'
import { createPortal } from 'preact/compat'
import { tooltipDismissCounter } from '../state/tooltipState'

/**
 * Tooltip component with delayed appearance and smart positioning
 *
 * @param {Object} props
 * @param {string} props.content - Main tooltip text
 * @param {string} [props.shortcut] - Optional keyboard shortcut to display
 * @param {string} [props.hint] - Optional additional hint text
 * @param {'top'|'bottom'|'left'|'right'} [props.position='top'] - Preferred position
 * @param {number} [props.delay=300] - Delay before showing tooltip (ms)
 * @param {preact.ComponentChildren} props.children - Element to attach tooltip to
 */
export function Tooltip({
  content,
  shortcut,
  hint,
  position = 'top',
  delay = 300,
  children
}) {
  const [isVisible, setIsVisible] = useState(false)
  const [coords, setCoords] = useState({ x: 0, y: 0 })
  const [actualPosition, setActualPosition] = useState(position)
  const triggerRef = useRef(null)
  const tooltipRef = useRef(null)
  const timeoutRef = useRef(null)

  const calculatePosition = useCallback(() => {
    if (!triggerRef.current || !tooltipRef.current) return

    const triggerRect = triggerRef.current.getBoundingClientRect()
    const tooltipRect = tooltipRef.current.getBoundingClientRect()
    const padding = 8
    const arrowSize = 6

    let x, y
    let finalPosition = position

    // Calculate initial position
    const positions = {
      top: {
        x: triggerRect.left + (triggerRect.width - tooltipRect.width) / 2,
        y: triggerRect.top - tooltipRect.height - arrowSize
      },
      bottom: {
        x: triggerRect.left + (triggerRect.width - tooltipRect.width) / 2,
        y: triggerRect.bottom + arrowSize
      },
      left: {
        x: triggerRect.left - tooltipRect.width - arrowSize,
        y: triggerRect.top + (triggerRect.height - tooltipRect.height) / 2
      },
      right: {
        x: triggerRect.right + arrowSize,
        y: triggerRect.top + (triggerRect.height - tooltipRect.height) / 2
      }
    }

    x = positions[position].x
    y = positions[position].y

    // Check viewport boundaries and flip if needed
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight
    }

    // Flip vertically if needed
    if (position === 'top' && y < padding) {
      finalPosition = 'bottom'
      y = positions.bottom.y
    } else if (position === 'bottom' && y + tooltipRect.height > viewport.height - padding) {
      finalPosition = 'top'
      y = positions.top.y
    }

    // Flip horizontally if needed
    if (position === 'left' && x < padding) {
      finalPosition = 'right'
      x = positions.right.x
    } else if (position === 'right' && x + tooltipRect.width > viewport.width - padding) {
      finalPosition = 'left'
      x = positions.left.x
    }

    // Constrain to viewport
    x = Math.max(padding, Math.min(x, viewport.width - tooltipRect.width - padding))
    y = Math.max(padding, Math.min(y, viewport.height - tooltipRect.height - padding))

    setCoords({ x, y })
    setActualPosition(finalPosition)
  }, [position])

  const showTooltip = useCallback(() => {
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true)
    }, delay)
  }, [delay])

  const hideTooltip = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    setIsVisible(false)
  }, [])

  // Calculate position when tooltip becomes visible
  useEffect(() => {
    if (isVisible) {
      // Use requestAnimationFrame to ensure tooltip is rendered before measuring
      requestAnimationFrame(() => {
        calculatePosition()
      })
    }
  }, [isVisible, calculatePosition])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  // Subscribe to global dismiss signal (hides tooltips when modals open)
  useEffect(() => {
    // Track initial value to detect changes
    const initialValue = tooltipDismissCounter.value
    return tooltipDismissCounter.subscribe((value) => {
      if (value !== initialValue) {
        hideTooltip()
      }
    })
  }, [hideTooltip])

  const tooltipElement = isVisible && createPortal(
    <div
      ref={tooltipRef}
      class={`tooltip-popup tooltip-popup--${actualPosition}`}
      style={{
        left: `${coords.x}px`,
        top: `${coords.y}px`
      }}
      role="tooltip"
    >
      <span class="tooltip-popup__content">{content}</span>
      {shortcut && <kbd class="tooltip-popup__shortcut">{shortcut}</kbd>}
      {hint && <span class="tooltip-popup__hint">{hint}</span>}
    </div>,
    document.body
  )

  return (
    <>
      <span
        ref={triggerRef}
        class="tooltip-trigger"
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
        onDragStart={hideTooltip}
      >
        {children}
      </span>
      {tooltipElement}

      <style>{`
        .tooltip-trigger {
          display: flex;
        }

        .tooltip-popup {
          position: fixed;
          z-index: var(--z-tooltip, 400);
          display: inline-flex;
          align-items: center;
          gap: var(--sp-2, 8px);
          padding: var(--sp-1, 4px) var(--sp-2, 8px);
          font-size: var(--text-xs, 10px);
          color: var(--white, #fff);
          background: var(--gray-900, #171717);
          border-radius: var(--radius-sm, 2px);
          white-space: nowrap;
          pointer-events: none;
          animation: tooltip-in var(--duration-fast, 100ms) var(--ease-out-expo, ease-out);
        }

        @keyframes tooltip-in {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }

        .tooltip-popup__content {
          font-weight: var(--weight-normal, 400);
        }

        .tooltip-popup__shortcut {
          font-family: var(--font-mono, monospace);
          font-size: var(--text-2xs, 9px);
          font-weight: var(--weight-light, 300);
          color: var(--gray-400, #a3a3a3);
          background: transparent;
          border: none;
          padding: 0;
        }

        .tooltip-popup__hint {
          font-size: var(--text-2xs, 9px);
          color: var(--gray-400, #a3a3a3);
          border-left: 1px solid var(--gray-600, #525252);
          padding-left: var(--sp-2, 8px);
          margin-left: var(--sp-1, 4px);
        }

        /* Arrow indicators via pseudo-elements */
        .tooltip-popup::after {
          content: '';
          position: absolute;
          border: 5px solid transparent;
        }

        .tooltip-popup--top::after {
          top: 100%;
          left: 50%;
          transform: translateX(-50%);
          border-top-color: var(--gray-900, #171717);
        }

        .tooltip-popup--bottom::after {
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%);
          border-bottom-color: var(--gray-900, #171717);
        }

        .tooltip-popup--left::after {
          left: 100%;
          top: 50%;
          transform: translateY(-50%);
          border-left-color: var(--gray-900, #171717);
        }

        .tooltip-popup--right::after {
          right: 100%;
          top: 50%;
          transform: translateY(-50%);
          border-right-color: var(--gray-900, #171717);
        }

        @media (prefers-reduced-motion: reduce) {
          .tooltip-popup {
            animation: none;
          }
        }
      `}</style>
    </>
  )
}
