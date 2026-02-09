import { useRef, useCallback, useEffect } from 'preact/hooks'

/**
 * Resize handle for panel edges.
 *
 * @param {Object} props
 * @param {'left'|'right'} props.side - Which side of the panel the handle is on
 * @param {function} props.onResize - Called with delta px during drag
 * @param {function} [props.onResizeEnd] - Called when drag ends with final width
 * @param {number} props.minWidth - Minimum panel width
 * @param {number} props.maxWidth - Maximum panel width
 * @param {number} props.currentWidth - Current panel width
 * @param {boolean} [props.disabled] - Whether resizing is disabled (e.g., panel collapsed)
 */
export function ResizeHandle({
  side,
  onResize,
  onResizeEnd,
  minWidth,
  maxWidth,
  currentWidth,
  disabled = false
}) {
  const isDraggingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  const handleMouseDown = useCallback((e) => {
    if (disabled) return

    e.preventDefault()
    isDraggingRef.current = true
    startXRef.current = e.clientX
    startWidthRef.current = currentWidth

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [currentWidth, disabled])

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDraggingRef.current) return

      // Calculate delta based on which side the handle is on
      let delta = e.clientX - startXRef.current
      if (side === 'left') {
        delta = -delta // Dragging left handle leftward increases width
      }

      const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidthRef.current + delta))
      onResize(newWidth)
    }

    const handleMouseUp = () => {
      if (!isDraggingRef.current) return

      isDraggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''

      onResizeEnd?.()
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [side, minWidth, maxWidth, onResize, onResizeEnd])

  if (disabled) return null

  return (
    <div
      class={`resize-handle resize-handle--${side}`}
      onMouseDown={handleMouseDown}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={currentWidth}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
    />
  )
}
