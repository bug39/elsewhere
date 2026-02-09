import { useEffect, useRef, useCallback, useState, useImperativeHandle } from 'preact/hooks'
import { forwardRef } from 'preact/compat'
import * as THREE from 'three'
import { WorldRenderer } from '../../engine/WorldRenderer'
import { GRID_SIZE } from '../../shared/constants'
import { loadSettings } from './SettingsModal'
import { npcController } from '../../engine/NPCController'
import { DialogueBox } from './DialogueBox'
import { SelectionContextMenu } from './SelectionContextMenu'
import { showToast } from './Toast'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { usePlayMode } from '../hooks/usePlayMode'
import { useAssetNavigation } from '../hooks/useAssetNavigation'
import { modKey } from '../../shared/platform'

export const Viewport = forwardRef(function Viewport({ world, selection, mode, tool, onModeChange, onToolChange, onSave, onShowHelp, transformMode: transformModeProp, onTransformModeChange }, ref) {
  const containerRef = useRef(null)
  const rendererRef = useRef(null)
  const isDraggingRef = useRef(false)
  const hoveredInstanceRef = useRef(null)
  const lastRaycastTimeRef = useRef(0)
  const RAYCAST_THROTTLE_MS = 16 // ~60fps

  // Right-click context menu tracking
  const rightClickStartRef = useRef(null)
  const rightClickTimerRef = useRef(null)
  const RIGHT_CLICK_HOLD_MS = 400

  // Dialogue state
  const [activeDialogue, setActiveDialogue] = useState(null)
  const [dialogueNpcName, setDialogueNpcName] = useState('')
  const [dialogueNpcId, setDialogueNpcId] = useState(null)

  // Transform mode state
  const [localTransformMode, setLocalTransformMode] = useState('translate')
  const transformMode = transformModeProp ?? localTransformMode
  const setTransformMode = (mode) => {
    setLocalTransformMode(mode)
    onTransformModeChange?.(mode)
  }

  // UI state
  const [cycleInfo, setCycleInfo] = useState(null)
  const [selectedHeight, setSelectedHeight] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('thinq-studio-dark-mode') === 'true'
  })

  // Expose rendererRef to parent
  useImperativeHandle(ref, () => ({
    rendererRef
  }), [])

  // Use extracted hooks
  const { playerControllerRef } = usePlayMode({
    mode,
    rendererRef,
    world,
    isDialogueActive: !!activeDialogue,
    onExitPlayMode: () => onModeChange?.('edit')
  })

  // Asset navigation for Tab/Shift+Tab
  const { navigateToNext, navigateToPrevious, resetNavigation } = useAssetNavigation({
    world,
    selection,
    rendererRef
  })

  const { clipboardRef, lastClickPositionRef } = useKeyboardShortcuts({
    mode,
    tool,
    world,
    selection,
    rendererRef,
    activeDialogue,
    contextMenuOpen: !!contextMenu,
    onModeChange,
    onToolChange,
    onSave,
    onShowHelp,
    setTransformMode,
    onNavigateNext: navigateToNext,
    onNavigatePrevious: navigateToPrevious,
    onResetNavigation: resetNavigation,
    playerControllerRef
  })

  // Initialize renderer
  useEffect(() => {
    if (!containerRef.current) return

    rendererRef.current = new WorldRenderer(containerRef.current, {
      onAssetError: (assetName, error) => {
        showToast(`Failed to load asset "${assetName}": ${error}`, 'error', 5000)
      }
    })

    // Expose renderer to console for debugging
    window.renderer = rendererRef.current

    // Apply saved render settings
    const renderSettings = loadSettings()
    rendererRef.current.applyLightingPreset(renderSettings.lightingPreset)
    rendererRef.current.setSaturation(renderSettings.saturation)
    if (renderSettings.shadowLift !== undefined) {
      rendererRef.current.setShadowLift(renderSettings.shadowLift)
    }
    rendererRef.current.setPostProcessingEnabled(renderSettings.postProcessing)
    rendererRef.current.setShadowQuality(renderSettings.shadowQuality)

    // Apply dark mode setting
    const isDarkMode = localStorage.getItem('thinq-studio-dark-mode') === 'true'
    rendererRef.current.setDarkMode(isDarkMode)

    return () => {
      npcController.clear()
      if (rendererRef.current) {
        rendererRef.current.dispose()
        rendererRef.current = null
      }
    }
  }, [])

  // Set up transform change callbacks
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.onTransformChange = (instanceId, updates) => {
        world.updateInstance(instanceId, updates)
      }
      rendererRef.current.onTransformDragging = (height) => {
        setSelectedHeight(height)
      }
    }
  }, [world])

  // Apply dark mode changes
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setDarkMode(darkMode)
      localStorage.setItem('thinq-studio-dark-mode', darkMode ? 'true' : 'false')
    }
  }, [darkMode])

  // Update world when data changes
  useEffect(() => {
    if (rendererRef.current && world.data) {
      rendererRef.current.updateWorld(world.data)
      npcController.syncNPCs(
        world.data.placedAssets || [],
        world.data.library || [],
        rendererRef.current.instanceMeshes,
        rendererRef.current.libraryMap
      )
    }
  }, [world.data])

  // Update selection
  useEffect(() => {
    if (rendererRef.current && mode === 'edit') {
      if (rendererRef.current.selectedInstance !== selection.instanceId) {
        rendererRef.current.selectInstance(selection.instanceId)
      }
      if (!selection.instanceId || selection.selectionType !== 'part') {
        if (rendererRef.current.selectedPart) {
          rendererRef.current.clearPartSelection()
        }
      }
    }
  }, [selection.instanceId, selection.selectionType, mode])

  // Clear delete highlight when tool changes
  useEffect(() => {
    if (rendererRef.current && (tool !== 'delete' || mode !== 'edit')) {
      rendererRef.current.unhighlightInstance()
      hoveredInstanceRef.current = null
    }
  }, [tool, mode])

  // Note: OrbitControls stays enabled for terrain tool to allow scroll-zoom.
  // Rotation/pan are prevented via capture-phase handlers that stopPropagation()
  // on pointer events, while wheel events pass through for zoom.

  // Handle click for selection/placement/NPC interaction
  const handleClick = useCallback((e) => {
    // Guard against clicks during terrain drag OR transform gizmo drag
    if (!rendererRef.current || isDraggingRef.current || rendererRef.current.isDragging) return

    const hit = rendererRef.current.raycast(e.clientX, e.clientY)

    // Track click position for paste
    if (mode === 'edit' && hit?.point) {
      lastClickPositionRef.current = [hit.point.x, 0, hit.point.z]
    }

    // Play mode: NPC interaction is handled via E key, not clicks
    if (mode === 'play') {
      return
    }

    // Edit mode handling
    if (tool === 'select') {
      if (hit?.type === 'instance') {
        setCycleInfo(hit.cycleInfo || null)

        if ((e.ctrlKey || e.metaKey) && selection.instanceId === hit.instanceId) {
          const partHit = rendererRef.current.raycastPart(e.clientX, e.clientY, hit.instanceId)
          if (partHit) {
            rendererRef.current.selectPart(hit.instanceId, partHit.partName)
            selection.selectPart(hit.instanceId, partHit.partName)
          }
        } else {
          rendererRef.current.clearPartSelection()
          rendererRef.current.selectInstance(hit.instanceId)
          selection.selectInstance(hit.instanceId)
        }
      } else {
        setCycleInfo(null)
        rendererRef.current.clearPartSelection()
        rendererRef.current.selectInstance(null)
        selection.clear()
      }
    // Note: terrain tool is handled entirely in capture phase handlers
    } else if (tool === 'delete' && hit?.type === 'instance') {
      world.deleteInstance(hit.instanceId)
      if (selection.instanceId === hit.instanceId) {
        selection.clear()
      }
    }
  }, [mode, tool, selection, world, playerControllerRef, lastClickPositionRef])

  // Handle dialogue close
  const handleDialogueClose = useCallback(() => {
    if (dialogueNpcId) {
      const npcExists = npcController.get(dialogueNpcId)
      if (npcExists) {
        npcController.endDialogue(dialogueNpcId)
      }
    }
    setActiveDialogue(null)
    setDialogueNpcName('')
    setDialogueNpcId(null)
  }, [dialogueNpcId])

  // E key NPC interaction in play mode (raycast from screen center)
  useEffect(() => {
    if (mode !== 'play') return

    const handleInteract = (e) => {
      if (e.code !== 'KeyE') return
      if (activeDialogue) return // Already in dialogue
      if (!rendererRef.current || !containerRef.current) return

      // Raycast from screen center (where crosshair is)
      const rect = containerRef.current.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2

      const hit = rendererRef.current.raycast(centerX, centerY)
      if (hit?.type === 'instance') {
        const instance = world.data?.placedAssets?.find(a => a.instanceId === hit.instanceId)
        const libraryAsset = world.data?.library?.find(a => a.id === instance?.libraryId)
        const isNPC = libraryAsset?.category === 'characters' || libraryAsset?.category === 'creatures'

        if (isNPC && instance?.dialogue?.startNode) {
          const playerPos = playerControllerRef.current?.mesh?.position || null
          npcController.startDialogue(hit.instanceId, playerPos)
          setActiveDialogue(instance.dialogue)
          setDialogueNpcName(libraryAsset?.name || 'NPC')
          setDialogueNpcId(hit.instanceId)
        }
      }
    }

    window.addEventListener('keydown', handleInteract)
    return () => window.removeEventListener('keydown', handleInteract)
  }, [mode, activeDialogue, world.data, playerControllerRef])

  // Show context menu for overlapping assets
  const showAssetContextMenu = useCallback((clientX, clientY) => {
    if (!rendererRef.current || mode === 'play' || tool !== 'select') return

    const hit = rendererRef.current.raycast(clientX, clientY)
    if (hit?.type === 'instance' && hit.allHits?.length > 1) {
      const items = hit.allHits.map(h => {
        const instance = world.data?.placedAssets?.find(a => a.instanceId === h.instanceId)
        const libraryAsset = world.data?.library?.find(a => a.id === instance?.libraryId)
        return {
          instanceId: h.instanceId,
          assetName: libraryAsset?.name || 'Unknown Asset'
        }
      })
      setContextMenu({
        items,
        position: { x: clientX, y: clientY }
      })
    }
  }, [mode, tool, world])

  // Handle right-click context menu
  const handleContextMenu = useCallback((e) => {
    // Always prevent browser context menu in viewport
    e.preventDefault()
    e.stopPropagation()

    // In play mode, don't process further - PlayerController handles camera orbit
    if (!rendererRef.current || mode === 'play') return false

    if (tool === 'terrain') {
      const hit = rendererRef.current.raycast(e.clientX, e.clientY)
      if (hit?.type === 'terrain') {
        if (hit.tileX < 0 || hit.tileX >= GRID_SIZE || hit.tileZ < 0 || hit.tileZ >= GRID_SIZE) return false
        const currentHeight = world.data.terrain.heightmap[hit.tileZ]?.[hit.tileX] ?? 0
        world.setTerrainHeight(hit.tileX, hit.tileZ, Math.max(0, currentHeight - 1))
      }
    }
    return false
  }, [mode, tool, world])

  // Handle context menu selection
  const handleContextMenuSelect = useCallback((instanceId) => {
    if (rendererRef.current) {
      rendererRef.current.clearPartSelection()
      rendererRef.current.selectInstance(instanceId)
      selection.selectInstance(instanceId)
    }
    setContextMenu(null)
    setCycleInfo(null)
  }, [selection])

  // Capture-phase POINTER handlers to intercept events BEFORE OrbitControls can process them
  // OrbitControls uses pointer events (not mouse events) since Three.js r125+.
  // By stopping propagation in capture phase, the event never reaches the canvas.
  const handlePointerDownCapture = useCallback((e) => {
    // In play mode, stop propagation to prevent OrbitControls from interfering
    // PlayerController handles camera via window event listeners
    if (mode === 'play') {
      e.stopPropagation()
      return
    }

    if (tool === 'terrain' && rendererRef.current) {
      e.stopPropagation()
      isDraggingRef.current = false

      // Handle initial terrain click (raise on left, lower on right)
      const hit = rendererRef.current.raycast(e.clientX, e.clientY)
      if (hit?.type === 'terrain') {
        if (hit.tileX >= 0 && hit.tileX < GRID_SIZE && hit.tileZ >= 0 && hit.tileZ < GRID_SIZE) {
          const currentHeight = world.data.terrain.heightmap[hit.tileZ]?.[hit.tileX] ?? 0
          if (e.button === 2 || e.shiftKey) {
            world.setTerrainHeight(hit.tileX, hit.tileZ, Math.max(0, currentHeight - 1))
          } else if (e.button === 0) {
            world.setTerrainHeight(hit.tileX, hit.tileZ, Math.min(currentHeight + 1, 25))
          }
        }
      }
    }
  }, [mode, tool, world])

  const handlePointerMoveCapture = useCallback((e) => {
    // In play mode, stop propagation to prevent OrbitControls from interfering
    if (mode === 'play') {
      e.stopPropagation()
      return
    }

    if (tool === 'terrain' && rendererRef.current && (e.buttons === 1 || e.buttons === 2)) {
      e.stopPropagation()
      isDraggingRef.current = true

      const hit = rendererRef.current.raycast(e.clientX, e.clientY)
      if (hit?.type === 'terrain') {
        if (hit.tileX >= 0 && hit.tileX < GRID_SIZE && hit.tileZ >= 0 && hit.tileZ < GRID_SIZE) {
          const currentHeight = world.data.terrain.heightmap[hit.tileZ]?.[hit.tileX] ?? 0
          if (e.buttons === 2 || e.shiftKey) {
            world.setTerrainHeight(hit.tileX, hit.tileZ, Math.max(0, currentHeight - 1))
          } else {
            world.setTerrainHeight(hit.tileX, hit.tileZ, Math.min(currentHeight + 1, 25))
          }
        }
      }
    }
  }, [mode, tool, world])

  const handlePointerUpCapture = useCallback((e) => {
    // In play mode, stop propagation to prevent OrbitControls from interfering
    if (mode === 'play') {
      e.stopPropagation()
      return
    }

    if (tool === 'terrain') {
      e.stopPropagation()
      isDraggingRef.current = false
    }
  }, [mode, tool])

  // Mouse handlers (bubble phase)
  const handleMouseDown = useCallback((e) => {
    isDraggingRef.current = false

    // Right-click: skip context menu handling for terrain tool
    // (terrain uses right-click for lowering, not asset selection menu)
    if (e.button === 2 && tool !== 'terrain') {
      rightClickStartRef.current = { x: e.clientX, y: e.clientY }
      if (rightClickTimerRef.current) {
        clearTimeout(rightClickTimerRef.current)
      }
      const x = e.clientX, y = e.clientY
      rightClickTimerRef.current = setTimeout(() => {
        rightClickTimerRef.current = null
        showAssetContextMenu(x, y)
      }, RIGHT_CLICK_HOLD_MS)
    }
  }, [tool, showAssetContextMenu])

  const handleMouseMove = useCallback((e) => {
    // Early throttle check for delete tool (most common high-frequency case)
    // This skips all other work when throttled, reducing unnecessary computation
    if (mode === 'edit' && tool === 'delete') {
      const now = performance.now()
      if (now - lastRaycastTimeRef.current < RAYCAST_THROTTLE_MS) return
      lastRaycastTimeRef.current = now

      if (!rendererRef.current) return

      const hit = rendererRef.current.raycast(e.clientX, e.clientY)
      const newHoveredId = hit?.type === 'instance' ? hit.instanceId : null

      if (newHoveredId !== hoveredInstanceRef.current) {
        if (hoveredInstanceRef.current) {
          rendererRef.current.unhighlightInstance()
        }
        hoveredInstanceRef.current = newHoveredId
        if (newHoveredId) {
          rendererRef.current.highlightInstanceForDeletion(newHoveredId)
        }
      }
      return  // Delete tool handled, no need for context menu logic
    }

    // Cancel context menu timer if panning (only relevant for non-delete tools)
    if (rightClickStartRef.current && rightClickTimerRef.current && (e.buttons & 2)) {
      const dx = e.clientX - rightClickStartRef.current.x
      const dy = e.clientY - rightClickStartRef.current.y
      if (dx * dx + dy * dy > 9) {
        clearTimeout(rightClickTimerRef.current)
        rightClickTimerRef.current = null
        rightClickStartRef.current = null
      }
    }

    // Note: terrain tool drag is handled entirely in capture phase (handleMouseMoveCapture)
  }, [mode, tool])

  const handleMouseUp = useCallback((e) => {
    isDraggingRef.current = false

    if (e?.button === 2) {
      rightClickStartRef.current = null
    }
    // Note: OrbitControls stays enabled; terrain tool uses capture-phase
    // stopPropagation to prevent rotation/pan while allowing scroll zoom
  }, [])

  // Handle drop from library panel
  const handleDrop = useCallback((e) => {
    e.preventDefault()

    if (!rendererRef.current || mode === 'play') return

    const assetId = e.dataTransfer.getData('application/x-thinq-asset')
    if (!assetId) return

    const pos = rendererRef.current.getWorldPosition(e.clientX, e.clientY)
    if (pos) {
      // P2-LP02 FIX: Query terrain height at placement position instead of hardcoding to 0
      pos[1] = rendererRef.current?.getTerrainHeight?.(pos[0], pos[2]) ?? 0
      const libraryAsset = world.data?.library?.find(a => a.id === assetId)
      const scale = libraryAsset?.preferredScale || 10
      world.placeInstance(assetId, pos, 0, scale)
    }
  }, [mode, world])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  return (
    <div
      ref={containerRef}
      class="viewport"
      data-tool={mode === 'edit' ? tool : null}
      data-mode={mode}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onPointerDownCapture={handlePointerDownCapture}
      onPointerMoveCapture={handlePointerMoveCapture}
      onPointerUpCapture={handlePointerUpCapture}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <div class="viewport-overlay">
        <div class="viewport-info">
          {mode === 'edit' && (
            <>
              <div>Tool: {tool}</div>
              {selection.instanceId && (
                <>
                  <div style="display: flex; gap: var(--sp-2); align-items: center">
                    <span>Selected: {selection.instanceId.slice(0, 12)}...</span>
                    {cycleInfo && (
                      <span style="color: var(--accent); font-size: var(--text-2xs)">
                        ({cycleInfo.current}/{cycleInfo.total} overlapping)
                      </span>
                    )}
                  </div>
                  {selection.partName && <div>Part: {selection.partName}</div>}
                  {selectedHeight !== null && selectedHeight > 0.1 && (
                    <div style="color: var(--accent)">Height: {selectedHeight.toFixed(1)}m</div>
                  )}
                  {!selection.partName && <div style="color: var(--text-ghost)">{modKey()}+click to select parts</div>}
                </>
              )}
              {tool === 'terrain' && <div>Left-drag: raise | Right-drag or Shift: lower</div>}
              {world.canUndo && <div>Undo: {world.undoCount}</div>}
            </>
          )}
          {mode === 'play' && !activeDialogue && (
            playerControllerRef.current?.flyMode ? (
              <>
                <div>FLY CAM | WASD: Move | Space: Up | C: Down</div>
                <div>Shift: Fast | Scroll: Speed ({(playerControllerRef.current?.flySpeedMultiplier ?? 1).toFixed(1)}x)</div>
                <div>F: Exit fly mode | ESC: Exit fly mode</div>
              </>
            ) : (
              <>
                <div>WASD: Move | Shift: Run | Space: Jump</div>
                <div>Mouse: Look around | E: Talk to NPC | F: Fly cam</div>
                <div>ESC: Exit play mode</div>
              </>
            )
          )}
        </div>
        {mode === 'edit' && (
          <button
            class="viewport-toggle-btn"
            data-mode={darkMode ? 'night' : 'day'}
            onClick={() => setDarkMode(!darkMode)}
            title={darkMode ? 'Switch to daytime lighting' : 'Switch to nighttime lighting'}
          >
            {darkMode ? '☀ Day' : '☾ Night'}
          </button>
        )}
      </div>


      {activeDialogue && (
        <DialogueBox
          dialogue={activeDialogue}
          npcName={dialogueNpcName}
          onClose={handleDialogueClose}
        />
      )}

      {contextMenu && (
        <SelectionContextMenu
          items={contextMenu.items}
          position={contextMenu.position}
          onSelect={handleContextMenuSelect}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
})
