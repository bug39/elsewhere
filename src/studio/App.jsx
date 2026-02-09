import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import { signal } from '@preact/signals'
import { PasscodeGate } from './components/PasscodeGate'
import { Header } from './components/Header'
import { LibraryPanel } from './components/LibraryPanel'
import { Viewport } from './components/Viewport'
import { Toolbar } from './components/Toolbar'
import { HomeScreen } from './components/HomeScreen'
import { DialogueEditor } from './components/DialogueEditor'
import { HelpOverlay } from './components/HelpOverlay'
import { ToastContainer, showToast } from './components/Toast'
import { ConfirmModal, showConfirm } from './components/ConfirmModal'
import { AssetReviewModal } from './components/AssetReviewModal'
import { VariationGallery } from './components/VariationGallery'
import { WelcomeModal } from './components/WelcomeModal'
import { SettingsModal, loadSettings } from './components/SettingsModal'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Walkthrough } from './components/Walkthrough'
import { TutorialBanner } from './components/TutorialBanner'
import { SceneGeneratorPanel } from './components/SceneGeneratorPanel'
import { DirectorView } from '../director/components/DirectorView'
import { onboardingState, startOnboarding, stopOnboarding, isOnboardingComplete } from './state/walkthroughState'
import { loadQueue, clearQueueForWorld, generationQueue, isBatchComplete, addToQueue } from './state/generationQueue'
import { captureWorldThumbnail } from '../generator/SceneCaptureService'
import { planThemePack } from '../generator/ThemePackPlanner'
import { initProcessor, hasApiKey, queueProcessor } from './state/queueProcessor'
import { recoverOrphanedWorlds, listWorlds, saveWorld } from './state/storage'
import { createTutorialWorld } from './data/tutorialWorld'
import { useWorld } from './hooks/useWorld'
import { useSelection } from './hooks/useSelection'
import { logModeChange, logToolChange, updateSessionState } from '../shared/telemetry'
import { loadFeatureFlags } from '../shared/featureFlags'
import './styles/app.css'

// App mode: 'home' | 'edit' | 'play' | 'director'
export const appMode = signal('home')

// Current tool: 'select' | 'place' | 'paint' | 'terrain' | 'delete'
export const currentTool = signal('select')

// Default panel widths (px)
const DEFAULT_LIBRARY_WIDTH = 300  // Wider to accommodate tabs

// Load panel state (collapsed + widths) from localStorage
function loadPanelState() {
  try {
    const saved = localStorage.getItem('thinq-panel-state')
    const defaults = {
      libraryCollapsed: false,
      libraryWidth: DEFAULT_LIBRARY_WIDTH
    }
    return saved ? { ...defaults, ...JSON.parse(saved) } : defaults
  } catch {
    return {
      libraryCollapsed: false,
      libraryWidth: DEFAULT_LIBRARY_WIDTH
    }
  }
}

export function App() {
  const [authenticated, setAuthenticated] = useState(null) // null = checking, false = no, true = yes
  const world = useWorld()
  const selection = useSelection()
  const viewportRef = useRef(null)
  const [transformMode, setTransformMode] = useState('translate')
  const [showHelpOverlay, setShowHelpOverlay] = useState(false)
  const [reviewItem, setReviewItem] = useState(null) // Queue item being reviewed
  const [variationBatchId, setVariationBatchId] = useState(null) // Variation batch being reviewed
  const [dialogueEditor, setDialogueEditor] = useState(null) // { instanceId, npcName, dialogue }
  const [isSaving, setIsSaving] = useState(false)
  const [showWelcome, setShowWelcome] = useState(!isOnboardingComplete())
  const [walkthroughReady, setWalkthroughReady] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showSceneGenerator, setShowSceneGenerator] = useState(false)
  const [panelState, setPanelState] = useState(loadPanelState)

  // Save panel state to localStorage
  const updatePanelState = useCallback((updates) => {
    setPanelState(prev => {
      const next = { ...prev, ...updates }
      localStorage.setItem('thinq-panel-state', JSON.stringify(next))
      return next
    })
  }, [])

  const toggleLibraryPanel = useCallback(() => {
    updatePanelState({ libraryCollapsed: !panelState.libraryCollapsed })
  }, [panelState.libraryCollapsed, updatePanelState])

  // Check auth on mount
  useEffect(() => {
    fetch('/api/auth/check')
      .then(r => r.json())
      .then(data => setAuthenticated(data.authenticated))
      .catch(() => setAuthenticated(false))
  }, [])

  // Load feature flags and generation queue on mount (after auth)
  useEffect(() => {
    if (!authenticated) return
    loadFeatureFlags()
    // P1-005 FIX: Recover orphaned worlds before loading queue
    recoverOrphanedWorlds().then(async () => {
      await loadQueue()
      initProcessor()

      // Auto-create tutorial world for first-time users
      const worlds = await listWorlds()
      if (worlds.length === 0 && !localStorage.getItem('thinq-tutorial-created')) {
        try {
          const tutorialData = await createTutorialWorld()
          await saveWorld(tutorialData)
          localStorage.setItem('thinq-tutorial-created', 'true')
          await world.load(tutorialData.meta.id)
          appMode.value = 'edit'
        } catch (err) {
          console.warn('[App] Failed to create tutorial world:', err)
        }
      }
    })
  }, [authenticated])

  // Auto-start onboarding for new users entering edit mode
  useEffect(() => {
    if (appMode.value === 'edit' && !walkthroughReady && !isOnboardingComplete()) {
      setWalkthroughReady(true)
      startOnboarding()
    }
  }, [appMode.value, walkthroughReady])

  // Global unhandled rejection handler - prevents silent failures
  useEffect(() => {
    const handleUnhandledRejection = (event) => {
      event.preventDefault()
      const errorMessage = event.reason?.message || String(event.reason) || 'Unknown error'
      console.error('[Unhandled Promise Rejection]', event.reason)
      showToast(`Error: ${errorMessage}`, 'error', 5000)
    }
    window.addEventListener('unhandledrejection', handleUnhandledRejection)
    return () => window.removeEventListener('unhandledrejection', handleUnhandledRejection)
  }, [])

  // Track previous panel state for H key toggle
  const previousPanelStateRef = useRef(null)

  // Global keyboard shortcuts for panel toggling
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Skip if user is typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      // Skip if in a modal
      if (document.querySelector('.modal-overlay')) return

      if (e.key === '[' && appMode.value === 'edit') {
        e.preventDefault()
        toggleLibraryPanel()
      } else if ((e.key === 'h' || e.key === 'H') && appMode.value === 'edit' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        // Toggle library panel visibility
        if (panelState.libraryCollapsed) {
          if (previousPanelStateRef.current) {
            updatePanelState(previousPanelStateRef.current)
          } else {
            updatePanelState({ libraryCollapsed: false })
          }
        } else {
          previousPanelStateRef.current = {
            libraryCollapsed: panelState.libraryCollapsed
          }
          updatePanelState({ libraryCollapsed: true })
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleLibraryPanel, panelState, updatePanelState])

  // Warn user about unsaved changes before closing
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (world.isDirty) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [world.isDirty])

  // H11 FIX: Clear selection if selected library asset no longer exists
  // P1-008 FIX: Also clear if selected instance no longer exists (due to cascading delete)
  // NOTE: Only triggers on library changes - instance deletion via delete tool should
  // clear selection directly, not via this effect (to avoid feedback loops)
  useEffect(() => {
    if (!world.data) return

    // Check library asset
    if (selection.libraryAssetId && world.data.library) {
      const assetExists = world.data.library.some(a => a.id === selection.libraryAssetId)
      if (!assetExists) {
        selection.clear()
        return
      }
    }

    // Check instance - runs when library changes trigger cascading instance deletion
    // We read current selection.instanceId (not from deps) to check if it still exists
    if (selection.instanceId && world.data.placedAssets) {
      const instanceExists = world.data.placedAssets.some(a => a.instanceId === selection.instanceId)
      if (!instanceExists) {
        selection.clear()
      }
    }
  }, [world.data?.library, selection.libraryAssetId])

  // Update telemetry session state when world data changes
  useEffect(() => {
    if (world.data) {
      updateSessionState({
        libraryCount: world.data.library?.length || 0,
        placedAssetsCount: world.data.placedAssets?.length || 0,
        undoDepth: world.undoCount,
        dirty: world.isDirty
      })
    }
  }, [world.data, world.undoCount, world.isDirty])

  // Auto-open variation gallery when batch completes
  useEffect(() => {
    if (variationBatchId && isBatchComplete(variationBatchId)) {
      // Batch is complete, gallery will show automatically
    }
  }, [variationBatchId, generationQueue.value])

  const handleVariationBatch = useCallback((batchId) => {
    setVariationBatchId(batchId)
  }, [])

  const handleNewWorld = useCallback((name, biome, themePrompt) => {
    const worldId = world.create(name, biome)
    appMode.value = 'edit'

    if (themePrompt) {
      generateThemePack(themePrompt, biome, worldId)
    }
  }, [world])

  /** Fire-and-forget theme pack generation — runs in background after world creation */
  async function generateThemePack(themePrompt, biome, worldId) {
    showToast('Planning your theme pack...', 'info', 3000)

    try {
      const pack = await planThemePack(themePrompt, { biome })

      let queued = 0
      for (const asset of pack.assets) {
        const result = await addToQueue(asset.description, worldId, { isVariation: true })
        if (result.item) queued++
      }

      if (queued > 0) {
        showToast(`${queued} assets queued for generation!`, 'success', 4000)
        queueProcessor.start()
        queueProcessor.processNext()
      }
    } catch (err) {
      console.error('[ThemePack] Generation failed:', err)
      showToast(`Theme pack failed: ${err.message}`, 'error', 5000)
    }
  }

  const handleLoadWorld = useCallback(async (worldId) => {
    // C2 FIX: Clear queue items from previous world before loading new one
    const previousWorldId = world.data?.meta?.id
    if (previousWorldId) {
      // H2 FIX: Warn about pending/generating items before switching worlds
      const pendingFromOldWorld = generationQueue.value.filter(
        i => i.worldId === previousWorldId &&
             (i.status === 'pending' || i.status === 'generating')
      )
      if (pendingFromOldWorld.length > 0) {
        const confirmed = await showConfirm({
          title: 'Switch World',
          message: `${pendingFromOldWorld.length} generation(s) in progress will stay with the previous world. Continue?`,
          confirmText: 'Continue'
        })
        if (!confirmed) return
      }
      // M3 FIX: Await clearQueueForWorld to prevent stale items
      await clearQueueForWorld(previousWorldId)
    }
    await world.load(worldId)
    appMode.value = 'edit'
  }, [world])

  const handlePlay = useCallback(() => {
    // M15 FIX: Clear selection when entering play mode to prevent stale state
    selection.clear()
    logModeChange('edit', 'play')
    appMode.value = 'play'
  }, [selection])

  const handleStopPlay = useCallback(() => {
    logModeChange('play', 'edit')
    appMode.value = 'edit'
  }, [])

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    try {
      // Capture thumbnail if renderer is available
      if (viewportRef.current?.rendererRef?.current?.scene) {
        try {
          const scene = viewportRef.current.rendererRef.current.scene
          const thumbnail = captureWorldThumbnail(scene)
          // Inject thumbnail into world data before save
          if (world.data?.meta) {
            world.data.meta.thumbnail = thumbnail
          }
        } catch (err) {
          console.warn('Failed to capture world thumbnail:', err)
          // Don't fail the save if thumbnail capture fails
        }
      }

      const result = await world.save()
      if (result.success) {
        showToast('World saved', 'success', 2000)
      } else {
        showToast(result.error || 'Failed to save. Check browser storage.', 'error', 8000)
      }
    } finally {
      setIsSaving(false)
    }
  }, [world])

  const handleOpenDialogue = useCallback((instanceId) => {
    const instance = world.data?.placedAssets?.find(a => a.instanceId === instanceId)
    const asset = world.data?.library?.find(a => a.id === instance?.libraryId)
    if (instance) {
      setDialogueEditor({
        instanceId,
        npcName: asset?.name || 'NPC',
        dialogue: instance.dialogue || { nodes: {}, startNode: null }
      })
    }
  }, [world.data])

  const handleSaveDialogue = useCallback((newDialogue) => {
    if (dialogueEditor?.instanceId) {
      world.updateInstance(dialogueEditor.instanceId, { dialogue: newDialogue })
    }
    setDialogueEditor(null)
  }, [dialogueEditor, world])

  // Queue review handler
  const handleReviewItem = useCallback((item) => {
    setReviewItem(item)
  }, [])

  const handleAcceptFromQueue = useCallback((libraryAsset) => {
    world.addLibraryAsset(libraryAsset)
    showToast(`"${libraryAsset.name}" added to library`, 'success', 3000)
  }, [world])

  // Handle welcome modal close - potentially start onboarding
  const handleWelcomeClose = useCallback((startTutorial = true) => {
    setShowWelcome(false)
    // Start onboarding if user chose to and hasn't completed it before
    if (startTutorial && !isOnboardingComplete()) {
      // Delay slightly to let the modal close animation complete
      setTimeout(() => {
        setWalkthroughReady(true)
        startOnboarding()
      }, 300)
    }
  }, [])

  // Auth gate
  if (authenticated === null) {
    return null // Checking auth, show nothing
  }
  if (!authenticated) {
    return <PasscodeGate onAuthenticated={() => setAuthenticated(true)} />
  }

  // Show home screen if not editing or playing
  if (appMode.value === 'home') {
    return (
      <ErrorBoundary>
        <HomeScreen
          onNewWorld={handleNewWorld}
          onLoadWorld={handleLoadWorld}
          onEnterDirector={() => appMode.value = 'director'}
        />
        {showWelcome && (
          <WelcomeModal onClose={handleWelcomeClose} />
        )}
      </ErrorBoundary>
    )
  }

  // Show director mode
  if (appMode.value === 'director') {
    return (
      <ErrorBoundary>
        <DirectorView onHome={() => appMode.value = 'home'} />
        <ToastContainer />
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary>
    <div class="studio-layout">
      <Header
        worldName={world.data?.meta?.name || 'Untitled'}
        mode={appMode.value}
        onPlay={handlePlay}
        onStopPlay={handleStopPlay}
        onSave={handleSave}
        onHome={() => appMode.value = 'home'}
        onShowHelp={() => setShowHelpOverlay(true)}
        onShowSettings={() => setShowSettings(true)}
        onShowSceneGenerator={() => setShowSceneGenerator(true)}
        onWorldNameChange={world.updateWorldName}
        isSaving={isSaving}
        isDirty={world.isDirty}
      />

      <div class="studio-main">
        {/* Keep LibraryPanel mounted to preserve search/filter state across play mode */}
        <LibraryPanel
          library={world.data?.library || []}
          placedAssets={world.data?.placedAssets || []}
          onAssetSelect={selection.selectLibraryAsset}
          selectedAssetId={selection.libraryAssetId}
          onReviewItem={handleReviewItem}
          onVariationBatch={handleVariationBatch}
          onDeleteAsset={world.removeLibraryAsset}
          worldId={world.data?.meta?.id || null}
          isCollapsed={panelState.libraryCollapsed}
          onToggleCollapse={toggleLibraryPanel}
          hidden={appMode.value !== 'edit'}
        />

        <div class="studio-center">
          <Viewport
            ref={viewportRef}
            world={world}
            selection={selection}
            mode={appMode.value}
            tool={currentTool.value}
            onModeChange={(newMode) => appMode.value = newMode}
            onToolChange={(tool) => currentTool.value = tool}
            onSave={handleSave}
            onShowHelp={() => setShowHelpOverlay(true)}
            transformMode={transformMode}
            onTransformModeChange={(mode) => {
              setTransformMode(mode)
              // Also update renderer directly for immediate feedback
              if (viewportRef.current?.rendererRef?.current) {
                viewportRef.current.rendererRef.current.setTransformMode(mode)
              }
            }}
          />

          {appMode.value === 'edit' && (
            <Toolbar
              currentTool={currentTool.value}
              onToolChange={(tool) => currentTool.value = tool}
              selection={selection}
              transformMode={transformMode}
              onTransformModeChange={(mode) => {
                setTransformMode(mode)
                // Update renderer directly when toolbar button clicked
                if (viewportRef.current?.rendererRef?.current) {
                  viewportRef.current.rendererRef.current.setTransformMode(mode)
                }
              }}
            />
          )}

          {appMode.value === 'edit' && <TutorialBanner />}
        </div>

      </div>

      {dialogueEditor && (
        <DialogueEditor
          dialogue={dialogueEditor.dialogue}
          npcName={dialogueEditor.npcName}
          onSave={handleSaveDialogue}
          onClose={() => setDialogueEditor(null)}
        />
      )}

      {/* Help Overlay */}
      {showHelpOverlay && (
        <HelpOverlay onClose={() => setShowHelpOverlay(false)} />
      )}

      {/* Asset Review Modal */}
      {reviewItem && (
        <AssetReviewModal
          item={reviewItem}
          onAccept={handleAcceptFromQueue}
          onClose={() => setReviewItem(null)}
          currentWorldId={world.data?.meta?.id}
        />
      )}

      {/* Variation Gallery Modal */}
      {variationBatchId && (
        <VariationGallery
          batchId={variationBatchId}
          onAccept={handleAcceptFromQueue}
          onClose={() => setVariationBatchId(null)}
          worldId={world.data?.meta?.id}
        />
      )}

      {/* Scene Generator Panel */}
      <SceneGeneratorPanel
        isOpen={showSceneGenerator}
        onClose={() => setShowSceneGenerator(false)}
        world={world}
        rendererRef={viewportRef.current?.rendererRef}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        rendererRef={viewportRef.current?.rendererRef}
      />

      <ToastContainer />
      <ConfirmModal />

      {/* Walkthrough overlay - only shows in edit mode when active */}
      {appMode.value === 'edit' && walkthroughReady && (
        <Walkthrough
          world={world}
          selection={selection}
          viewportRef={viewportRef}
        />
      )}
    </div>
    </ErrorBoundary>
  )
}
