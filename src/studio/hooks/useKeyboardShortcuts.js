/**
 * Keyboard shortcuts hook for Viewport
 *
 * Extracts all keyboard handling from Viewport.jsx to reduce component complexity.
 * Handles both edit mode (tools, transform, clipboard) and play mode (escape) shortcuts.
 */

import { useEffect, useRef } from 'preact/hooks'
import { showToast } from '../components/Toast'

// Lookup maps for keyboard shortcuts
const TOOL_SHORTCUTS = { '1': 'select', '2': 'terrain', '3': 'delete' }
const LEGACY_TOOL_SHORTCUTS = { v: 'select', t: 'terrain', x: 'delete' }
const TRANSFORM_MODES = { g: 'translate', r: 'rotate', s: 'scale' }

/**
 * @typedef {Object} KeyboardShortcutsOptions
 * @property {'edit'|'play'} mode - Current app mode
 * @property {string} tool - Current edit tool
 * @property {Object} world - World state and operations
 * @property {Object} selection - Selection state
 * @property {Object} rendererRef - Ref to WorldRenderer
 * @property {boolean} activeDialogue - Whether dialogue is open
 * @property {boolean} contextMenuOpen - Whether asset selection context menu is open
 * @property {Function} onModeChange - Callback to change mode
 * @property {Function} onToolChange - Callback to change tool
 * @property {Function} onSave - Callback to save world
 * @property {Function} onShowHelp - Callback to show help overlay
 * @property {Function} setTransformMode - Callback to set transform mode
 * @property {Function} onNavigateNext - Callback for Tab navigation (next asset)
 * @property {Function} onNavigatePrevious - Callback for Shift+Tab navigation (previous asset)
 * @property {Function} onResetNavigation - Callback to reset navigation session
 * @property {Object} playerControllerRef - Ref to PlayerController (for fly mode ESC handling)
 */

/**
 * Hook that manages all keyboard shortcuts for the Viewport
 *
 * @param {KeyboardShortcutsOptions} options
 * @returns {{ clipboardRef: Object, lastClickPositionRef: Object }}
 */
export function useKeyboardShortcuts({
  mode,
  tool,
  world,
  selection,
  rendererRef,
  activeDialogue,
  contextMenuOpen,
  onModeChange,
  onToolChange,
  onSave,
  onShowHelp,
  setTransformMode,
  onNavigateNext,
  onNavigatePrevious,
  onResetNavigation,
  playerControllerRef
}) {
  // Clipboard for copy/paste
  const clipboardRef = useRef(null)  // { libraryId, rotation, scale, partTweakOverrides }
  // Last click position for paste placement
  const lastClickPositionRef = useRef([100, 0, 100])  // Default to world center
  // Previous tool for spacebar toggle
  const previousToolRef = useRef('select')

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't handle if typing in input or in dialogue
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (activeDialogue) return

      // Guard against contentEditable elements (FIX for existing bug)
      if (e.target.isContentEditable) return

      // Global: Help overlay (?)
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault()
        onShowHelp?.()
        return
      }

      // Ctrl+S to save (global)
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        onSave?.()
        return
      }

      // Ctrl/Cmd+Enter to play (from edit mode)
      // Note: F5 removed to avoid browser refresh conflict
      if (mode === 'edit' && (e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        onModeChange?.('play')
        return
      }

      // ESC in play mode: exit fly mode first, then exit play mode
      if (e.code === 'Escape' && mode === 'play') {
        if (playerControllerRef?.current?.flyMode) {
          playerControllerRef.current.toggleFlyMode()
          return
        }
        onModeChange?.('edit')
        return
      }

      // ESC to deselect in edit mode
      if (e.code === 'Escape' && mode === 'edit') {
        e.preventDefault()
        if (selection.partName) {
          rendererRef.current?.clearPartSelection()
        }
        selection.clear()
        onResetNavigation?.()
        return
      }

      if (mode === 'edit') {
        // Home key: Reset camera to default view
        if (e.key === 'Home') {
          e.preventDefault()
          if (rendererRef.current) {
            rendererRef.current.resetCamera()
          }
          return
        }

        // Number keys 1-3: Quick tool switch (skip if context menu is open)
        if (!contextMenuOpen && TOOL_SHORTCUTS[e.key]) {
          e.preventDefault()
          previousToolRef.current = tool
          onToolChange?.(TOOL_SHORTCUTS[e.key])
          return
        }

        // Spacebar: Toggle between last two tools
        if (e.code === 'Space' && !e.metaKey && !e.ctrlKey) {
          e.preventDefault()
          const prevTool = previousToolRef.current
          previousToolRef.current = tool
          onToolChange?.(prevTool)
          return
        }

        // Tool shortcuts (legacy, still supported)
        const legacyTool = LEGACY_TOOL_SHORTCUTS[e.key.toLowerCase()]
        if (legacyTool) {
          previousToolRef.current = tool
          onToolChange?.(legacyTool)
          return
        }

        // Undo/Redo
        if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
          e.preventDefault()
          if (e.shiftKey) {
            world.redo()
          } else {
            world.undo()
          }
        }

        // Delete selected
        if ((e.key === 'Delete' || e.key === 'Backspace') && selection.instanceId) {
          e.preventDefault()
          world.deleteInstance(selection.instanceId)
          selection.clear()
        }

        // Copy selected instance (Cmd/Ctrl+C)
        if ((e.metaKey || e.ctrlKey) && e.key === 'c' && selection.instanceId) {
          e.preventDefault()
          const instance = world.data?.placedAssets?.find(a => a.instanceId === selection.instanceId)
          if (instance) {
            clipboardRef.current = {
              libraryId: instance.libraryId,
              rotation: instance.rotation,
              scale: instance.scale,
              partTweakOverrides: instance.partTweakOverrides
            }
            showToast('Copied asset', 'info', 2000)
          }
        }

        // Paste at last click position (Cmd/Ctrl+V)
        if ((e.metaKey || e.ctrlKey) && e.key === 'v' && clipboardRef.current) {
          e.preventDefault()
          const pos = lastClickPositionRef.current
          // Add small random offset to prevent exact overlap
          const offset = [Math.random() * 4 - 2, 0, Math.random() * 4 - 2]
          const newInstanceId = world.placeInstance(
            clipboardRef.current.libraryId,
            [pos[0] + offset[0], pos[1], pos[2] + offset[2]],
            clipboardRef.current.rotation,
            clipboardRef.current.scale
          )
          // Apply part tweaks if any
          if (clipboardRef.current.partTweakOverrides && newInstanceId) {
            world.updateInstance(newInstanceId, {
              partTweakOverrides: clipboardRef.current.partTweakOverrides
            })
          }
          showToast('Pasted asset', 'success', 2000)
        }

        // Duplicate in place (Cmd/Ctrl+D)
        if ((e.metaKey || e.ctrlKey) && e.key === 'd' && selection.instanceId) {
          e.preventDefault()
          const instance = world.data?.placedAssets?.find(a => a.instanceId === selection.instanceId)
          if (instance) {
            // Place with 2m offset
            const pos = instance.position
            const offset = [Math.random() * 4 - 2, 0, Math.random() * 4 - 2]
            const newInstanceId = world.placeInstance(
              instance.libraryId,
              [pos[0] + offset[0], pos[1], pos[2] + offset[2]],
              instance.rotation,
              instance.scale
            )
            // Apply part tweaks if any
            if (instance.partTweakOverrides && newInstanceId) {
              world.updateInstance(newInstanceId, {
                partTweakOverrides: instance.partTweakOverrides
              })
            }
            showToast('Duplicated asset', 'success', 2000)
          }
        }

        // Transform mode shortcuts (g/r/s)
        if (rendererRef.current && selection.instanceId && TRANSFORM_MODES[e.key]) {
          const mode = TRANSFORM_MODES[e.key]
          rendererRef.current.setTransformMode(mode)
          setTransformMode(mode)
        }

        // Focus camera on selected asset (F key)
        if (e.key === 'f' && rendererRef.current && selection.instanceId) {
          e.preventDefault()
          rendererRef.current.focusOnInstance(selection.instanceId)
        }

        // Tab: Navigate to nearest unvisited asset
        if (e.key === 'Tab' && !e.shiftKey) {
          e.preventDefault()
          onNavigateNext?.()
        }

        // Shift+Tab: Navigate back to previous asset
        if (e.key === 'Tab' && e.shiftKey) {
          e.preventDefault()
          onNavigatePrevious?.()
        }

        // Shift key enables grid snapping during transforms
        if (e.key === 'Shift' && rendererRef.current && mode === 'edit') {
          rendererRef.current.setSnappingActive(true)
        }

        // Alt key enables ground constraint during translate
        if (e.key === 'Alt' && rendererRef.current && mode === 'edit') {
          e.preventDefault() // Prevent browser menu on Mac
          rendererRef.current.setGroundConstraintActive(true)
        }
      }
    }

    const handleKeyUp = (e) => {
      // Shift key released - disable snapping
      if (e.key === 'Shift' && rendererRef.current) {
        rendererRef.current.setSnappingActive(false)
      }
      // Alt key released - disable ground constraint
      if (e.key === 'Alt' && rendererRef.current) {
        rendererRef.current.setGroundConstraintActive(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [mode, tool, world, selection, rendererRef, activeDialogue, contextMenuOpen, onModeChange, onToolChange, onSave, onShowHelp, setTransformMode, onNavigateNext, onNavigatePrevious, onResetNavigation, playerControllerRef])

  return {
    clipboardRef,
    lastClickPositionRef
  }
}
