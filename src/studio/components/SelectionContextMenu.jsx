import { useEffect, useRef, useCallback } from 'preact/hooks'
import { createPortal } from 'preact/compat'

/**
 * Context menu for selecting from multiple overlapping assets.
 * Shows asset names with number key shortcuts for quick selection.
 *
 * @param {Object} props
 * @param {Array<{instanceId: string, assetName: string}>} props.items - Overlapping assets to choose from
 * @param {{x: number, y: number}} props.position - Screen position for menu
 * @param {(instanceId: string) => void} props.onSelect - Called when user selects an asset
 * @param {() => void} props.onClose - Called when menu should close
 */
export function SelectionContextMenu({ items, position, onSelect, onClose }) {
  const menuRef = useRef(null)

  // Handle click outside to close
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose()
      }
    }

    // Use mousedown to close before click event fires
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  // Handle keyboard shortcuts (1-9 to select, Escape to close)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }

      // Number keys 1-9 for quick selection
      const num = parseInt(e.key, 10)
      if (num >= 1 && num <= 9 && num <= items.length) {
        e.preventDefault()
        onSelect(items[num - 1].instanceId)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [items, onSelect, onClose])

  // Position menu within viewport bounds
  const adjustedPosition = useCallback(() => {
    const menuWidth = 200
    const menuHeight = items.length * 32 + 16  // Estimate based on item count
    const padding = 8

    let x = position.x
    let y = position.y

    // Keep menu within viewport
    if (x + menuWidth > window.innerWidth - padding) {
      x = window.innerWidth - menuWidth - padding
    }
    if (y + menuHeight > window.innerHeight - padding) {
      y = window.innerHeight - menuHeight - padding
    }

    return { x: Math.max(padding, x), y: Math.max(padding, y) }
  }, [position, items.length])

  const pos = adjustedPosition()

  return createPortal(
    <div
      ref={menuRef}
      class="context-menu"
      style={{
        left: `${pos.x}px`,
        top: `${pos.y}px`
      }}
    >
      <div class="context-menu__header">Select Asset</div>
      {items.map((item, i) => (
        <button
          key={item.instanceId}
          class="context-menu__item"
          onClick={() => onSelect(item.instanceId)}
        >
          <span class="context-menu__name">{item.assetName}</span>
          {i < 9 && <span class="context-menu__hint">{i + 1}</span>}
        </button>
      ))}
    </div>,
    document.body
  )
}
