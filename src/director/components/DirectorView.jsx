import { useState, useRef, useEffect, useCallback } from 'preact/hooks'
import * as THREE from 'three'
import { showToast } from '../../studio/components/Toast'
import { planScene } from '../ScenePlanner'
import { resolveScene } from '../SpatialResolver'
import { SceneSequencer } from '../SceneSequencer'
import { WorldRenderer } from '../../engine/WorldRenderer'
import { assetGenerator } from '../../generator/AssetGenerator'

// Scale factor for assets in Director Mode (matches GAME_SCALE_FACTOR from sizeInvariants)
const ASSET_SCALE = 8

/**
 * Format time in MM:SS format
 * @param {number} seconds
 * @returns {string}
 */
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

/**
 * Generate a deterministic color from a string
 * @param {string} str
 * @returns {number} Hex color
 */
function hashStringToColor(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  // Use pastel-ish colors for visibility
  const h = Math.abs(hash) % 360
  const s = 60 + (Math.abs(hash >> 8) % 20)
  const l = 50 + (Math.abs(hash >> 16) % 20)
  // Convert HSL to hex
  const c = (1 - Math.abs(2 * l / 100 - 1)) * s / 100
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = l / 100 - c / 2
  let r, g, b
  if (h < 60) { r = c; g = x; b = 0 }
  else if (h < 120) { r = x; g = c; b = 0 }
  else if (h < 180) { r = 0; g = c; b = x }
  else if (h < 240) { r = 0; g = x; b = c }
  else if (h < 300) { r = x; g = 0; b = c }
  else { r = c; g = 0; b = x }
  return (Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255)
}

/**
 * Create a placeholder mesh for an asset
 * @param {string} assetId
 * @returns {THREE.Mesh}
 */
function createPlaceholderMesh(assetId) {
  const color = hashStringToColor(assetId)
  const geometry = new THREE.BoxGeometry(2, 2, 2)
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.7,
    metalness: 0.1
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.name = `placeholder_${assetId}`
  // Scale up to match generated assets
  mesh.scale.setScalar(ASSET_SCALE)
  return mesh
}

/**
 * DirectorView - Main view for Director Mode
 *
 * Allows users to describe a scene in natural language and generates
 * an animated video plan using Gemini AI, then resolves it to coordinates.
 */
export function DirectorView({ onHome }) {
  const [prompt, setPrompt] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [scenePlan, setScenePlan] = useState(null)
  const [resolvedScene, setResolvedScene] = useState(null)
  const [error, setError] = useState(null)
  const textareaRef = useRef(null)

  // Preview state
  const previewContainerRef = useRef(null)
  const rendererRef = useRef(null)
  const sequencerRef = useRef(null)
  const assetMeshesRef = useRef(new Map())

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [currentShotIndex, setCurrentShotIndex] = useState(0)

  // Asset generation status: { [assetId]: 'pending' | 'generating' | 'completed' | 'failed' }
  const [assetStatus, setAssetStatus] = useState({})

  // Initialize WorldRenderer when preview container is available
  useEffect(() => {
    if (!previewContainerRef.current) return

    const renderer = new WorldRenderer(previewContainerRef.current, {
      environment: 'studio',
      postProcessing: false
    })

    // Disable orbit controls during playback (will be controlled by sequencer)
    renderer.orbitControls.enabled = true

    rendererRef.current = renderer

    return () => {
      if (rendererRef.current) {
        rendererRef.current.dispose()
        rendererRef.current = null
      }
    }
  }, [])

  // Set up scene when resolvedScene changes
  useEffect(() => {
    if (!resolvedScene || !rendererRef.current) return

    const renderer = rendererRef.current

    // Clear existing meshes (could be placeholders or generated assets)
    assetMeshesRef.current.forEach(obj => {
      renderer.scene.remove(obj)
      // Handle both single meshes and groups
      if (obj.geometry) {
        obj.geometry.dispose()
        obj.material?.dispose()
      } else {
        // Traverse groups to dispose all geometries and materials
        obj.traverse?.(child => {
          if (child.geometry) child.geometry.dispose()
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(m => m.dispose())
            } else {
              child.material.dispose()
            }
          }
        })
      }
    })
    assetMeshesRef.current.clear()

    // Create placeholder meshes for each asset
    for (const asset of resolvedScene.assets) {
      const mesh = createPlaceholderMesh(asset.id)
      // Y offset: half the scaled height (2 * ASSET_SCALE / 2 = ASSET_SCALE)
      mesh.position.set(
        asset.initialPosition[0],
        asset.initialPosition[1] + ASSET_SCALE,
        asset.initialPosition[2]
      )
      mesh.rotation.y = asset.initialRotation
      renderer.scene.add(mesh)
      assetMeshesRef.current.set(asset.id, mesh)
    }

    // Reset asset generation status and start generating real assets
    setAssetStatus({})
    for (const asset of resolvedScene.assets) {
      generateAssetForScene(asset)
    }

    // Create sequencer
    const sequencer = new SceneSequencer({
      resolvedScene,
      renderer,
      assetMeshes: assetMeshesRef.current,
      assetScale: ASSET_SCALE,
      onShotChange: (index) => setCurrentShotIndex(index),
      onTimeUpdate: (time) => setCurrentTime(time),
      onComplete: () => {
        setIsPlaying(false)
        showToast('Playback complete', 'info', 2000)
      }
    })

    sequencerRef.current = sequencer

    // Wire sequencer to renderer's animation loop
    renderer.playMode = true
    renderer.orbitControls.enabled = false
    renderer.playModeUpdate = (dt) => {
      sequencer.update(dt)
    }

    // Reset playback state
    setIsPlaying(false)
    setCurrentTime(0)
    setCurrentShotIndex(0)

    return () => {
      if (sequencerRef.current) {
        sequencerRef.current.dispose()
        sequencerRef.current = null
      }
      if (renderer) {
        renderer.playMode = false
        renderer.playModeUpdate = null
        renderer.orbitControls.enabled = true
      }
    }
  }, [resolvedScene])

  // Playback controls
  const handlePlayPause = useCallback(() => {
    if (!sequencerRef.current) return

    if (isPlaying) {
      sequencerRef.current.pause()
      setIsPlaying(false)
    } else {
      sequencerRef.current.play()
      setIsPlaying(true)
    }
  }, [isPlaying])

  const handleStop = useCallback(() => {
    if (!sequencerRef.current) return
    sequencerRef.current.stop()
    setIsPlaying(false)
  }, [])

  const handleSeek = useCallback((e) => {
    if (!sequencerRef.current) return
    const time = parseFloat(e.target.value)
    sequencerRef.current.seek(time)
  }, [])

  // Click shot card to seek to that shot's start time
  const handleShotClick = useCallback((shotIndex) => {
    if (!sequencerRef.current || !resolvedScene) return
    const shot = resolvedScene.shots[shotIndex]
    if (shot) {
      sequencerRef.current.seek(shot.startTime)
    }
  }, [resolvedScene])

  /**
   * Generate a real 3D asset to replace a placeholder
   * @param {Object} assetDef - Asset definition from resolvedScene
   */
  async function generateAssetForScene(assetDef) {
    const { id } = assetDef

    // Find description from scenePlan.assets_needed (case-insensitive match)
    const assetInfo = scenePlan?.assets_needed?.find(a =>
      a.id.toLowerCase() === id.toLowerCase()
    )
    if (!assetInfo) return // No description available, keep placeholder

    setAssetStatus(prev => ({ ...prev, [id]: 'generating' }))

    try {
      const { asset } = await assetGenerator.generate(assetInfo.description, {
        maxAttempts: 2,
        usePlanning: true,
        useCompiler: true
      })

      // Replace placeholder mesh with generated asset
      const placeholder = assetMeshesRef.current.get(id)
      if (placeholder && rendererRef.current) {
        rendererRef.current.scene.remove(placeholder)
        placeholder.geometry?.dispose()
        placeholder.material?.dispose()

        // Scale up and position the new asset
        asset.scale.setScalar(ASSET_SCALE)
        asset.position.copy(placeholder.position)
        asset.rotation.y = placeholder.rotation.y

        rendererRef.current.scene.add(asset)
        assetMeshesRef.current.set(id, asset)
      }

      setAssetStatus(prev => ({ ...prev, [id]: 'completed' }))
    } catch (err) {
      console.error(`Failed to generate ${id}:`, err)
      setAssetStatus(prev => ({ ...prev, [id]: 'failed' }))
      // Keep placeholder on failure
    }
  }

  async function handleGenerate() {
    if (!prompt.trim()) {
      showToast('Please enter a scene description', 'error', 3000)
      return
    }

    setIsGenerating(true)
    setError(null)
    setScenePlan(null)
    setResolvedScene(null)

    try {
      const plan = await planScene(prompt)
      setScenePlan(plan)

      // Resolve semantic plan to coordinates
      const resolved = resolveScene(plan)
      setResolvedScene(resolved)

      showToast(`Scene planned: ${resolved.duration.toFixed(1)}s, ${resolved.assets.length} assets`, 'success', 3000)
    } catch (err) {
      console.error('Scene planning failed:', err)
      setError(err.message)
      showToast(`Failed: ${err.message}`, 'error', 5000)
    } finally {
      setIsGenerating(false)
    }
  }

  function handleKeyDown(e) {
    // Cmd/Ctrl+Enter to generate
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleGenerate()
    }
    // Space to play/pause when not in textarea
    if (e.key === ' ' && e.target !== textareaRef.current && resolvedScene) {
      e.preventDefault()
      handlePlayPause()
    }
  }

  const duration = resolvedScene?.duration || 0

  return (
    <div class="director" onKeyDown={handleKeyDown}>
      <header class="director__header">
        <button class="btn btn--ghost" onClick={onHome} aria-label="Back to home">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Back
        </button>
        <h1 class="director__title">Director Mode</h1>
        <div style="width: 80px" /> {/* Spacer for centering */}
      </header>

      <main class="director__main">
        <div class="director__input-section">
          <label class="director__label">Describe your scene</label>
          <textarea
            ref={textareaRef}
            class="director__textarea"
            placeholder="A knight approaches a dragon cave at sunset. The dragon emerges and they face off. Dramatic orchestral music."
            value={prompt}
            onInput={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isGenerating}
            rows={4}
          />
          <div class="director__actions">
            <span class="director__hint">Press {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Enter to generate</span>
            <button
              class={`btn btn--primary ${isGenerating ? 'btn--loading' : ''}`}
              onClick={handleGenerate}
              disabled={isGenerating || !prompt.trim()}
            >
              {isGenerating && <span class="btn__spinner" />}
              {isGenerating ? 'Planning...' : 'Generate Scene'}
            </button>
          </div>
        </div>

        {/* Preview canvas */}
        <div class="director__preview">
          <div ref={previewContainerRef} class="director__canvas" />

          {/* Empty state overlay */}
          {!scenePlan && !error && !isGenerating && (
            <div class="director__preview-empty">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="2" y="3" width="20" height="14" rx="2"/>
                <path d="M8 21h8M12 17v4"/>
              </svg>
              <p>Your animated scene will appear here</p>
            </div>
          )}

          {/* Loading overlay */}
          {isGenerating && (
            <div class="director__preview-loading">
              <div class="director__spinner" />
              <p>Planning your scene...</p>
            </div>
          )}

          {/* Error overlay */}
          {error && (
            <div class="director__preview-error">
              <p>Error: {error}</p>
              <button class="btn btn--ghost" onClick={() => setError(null)}>
                Dismiss
              </button>
            </div>
          )}

          {/* Playback controls */}
          {resolvedScene && (
            <div class="director__playback">
              <button
                class="director__playback-btn"
                onClick={handlePlayPause}
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16"/>
                    <rect x="14" y="4" width="4" height="16"/>
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                )}
              </button>

              <button
                class="director__playback-btn"
                onClick={handleStop}
                aria-label="Stop"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12"/>
                </svg>
              </button>

              <input
                type="range"
                class="director__timeline"
                min="0"
                max={duration}
                step="0.1"
                value={currentTime}
                onInput={handleSeek}
              />

              <span class="director__time">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>
          )}
        </div>

        {/* Scene plan display */}
        {scenePlan && (
          <div class="director__plan">
            <h2 class="director__plan-title">Scene Plan</h2>

            {/* Shots */}
            <section class="director__plan-section">
              <h3>Shots ({scenePlan.shots?.length || 0})</h3>
              <div class="director__shots">
                {scenePlan.shots?.map((shot, i) => (
                  <div
                    key={i}
                    class={`director__shot ${i === currentShotIndex && resolvedScene ? 'director__shot--active' : ''}`}
                    onClick={() => handleShotClick(i)}
                  >
                    <div class="director__shot-header">
                      <span class="director__shot-number">{i + 1}</span>
                      <span class="director__shot-beat">{shot.beat}</span>
                      <span class="director__shot-duration">{shot.duration_seconds}s</span>
                    </div>
                    <p class="director__shot-desc">{shot.description}</p>
                    <div class="director__shot-meta">
                      <span title="Spatial relationship">{shot.spatial_relationship}</span>
                      <span title="Camera style">{shot.camera_style}</span>
                      {shot.mood && <span title="Mood">{shot.mood}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Assets needed */}
            <section class="director__plan-section">
              <h3>Assets Needed ({scenePlan.assets_needed?.length || 0})</h3>
              <ul class="director__assets">
                {scenePlan.assets_needed?.map((asset, i) => (
                  <li key={i} class="director__asset-item">
                    <span>
                      <strong>{asset.id}</strong>: {asset.description}
                    </span>
                    <span class={`director__asset-status director__asset-status--${assetStatus[asset.id.toLowerCase()] || 'pending'}`}>
                      {assetStatus[asset.id.toLowerCase()] === 'generating' && '⏳'}
                      {assetStatus[asset.id.toLowerCase()] === 'completed' && '✓'}
                      {assetStatus[asset.id.toLowerCase()] === 'failed' && '✗'}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {/* Environment */}
            {scenePlan.environment && (
              <section class="director__plan-section">
                <h3>Environment</h3>
                <div class="director__environment">
                  {scenePlan.environment.time_of_day && (
                    <span>Time: {scenePlan.environment.time_of_day}</span>
                  )}
                  {scenePlan.environment.weather && (
                    <span>Weather: {scenePlan.environment.weather}</span>
                  )}
                  {scenePlan.environment.terrain && (
                    <span>Terrain: {scenePlan.environment.terrain}</span>
                  )}
                </div>
              </section>
            )}

            {/* Soundtrack */}
            {scenePlan.soundtrack && (
              <section class="director__plan-section">
                <h3>Soundtrack</h3>
                <div class="director__soundtrack">
                  {scenePlan.soundtrack.style && (
                    <span>Style: {scenePlan.soundtrack.style}</span>
                  )}
                  {scenePlan.soundtrack.tempo && (
                    <span>Tempo: {scenePlan.soundtrack.tempo}</span>
                  )}
                  {scenePlan.soundtrack.mood_progression && (
                    <span>Mood: {scenePlan.soundtrack.mood_progression}</span>
                  )}
                </div>
              </section>
            )}

            {/* Resolved Scene Data */}
            {resolvedScene && (
              <section class="director__plan-section director__resolved">
                <h3>Resolved Coordinates</h3>
                <div class="director__resolved-summary">
                  <span>Duration: {resolvedScene.duration.toFixed(1)}s</span>
                  <span>Assets: {resolvedScene.assets.length}</span>
                  <span>Shots: {resolvedScene.shots.length}</span>
                </div>

                <details class="director__resolved-details">
                  <summary>Asset Positions</summary>
                  <ul class="director__resolved-assets">
                    {resolvedScene.assets.map((asset, i) => (
                      <li key={i}>
                        <strong>{asset.id}</strong>:
                        ({asset.initialPosition[0].toFixed(0)}, {asset.initialPosition[2].toFixed(0)})
                        @ {(asset.initialRotation * 180 / Math.PI).toFixed(0)}°
                      </li>
                    ))}
                  </ul>
                </details>

                <details class="director__resolved-details">
                  <summary>Shot Timings</summary>
                  <ul class="director__resolved-shots">
                    {resolvedScene.shots.map((shot, i) => (
                      <li key={i}>
                        <strong>Shot {i + 1}</strong>: {shot.startTime.toFixed(1)}s - {shot.endTime.toFixed(1)}s
                        ({shot.animations.length} animations, {shot.camera.keyframes.length} camera keyframes)
                      </li>
                    ))}
                  </ul>
                </details>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
