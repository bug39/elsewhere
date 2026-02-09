/**
 * @fileoverview WorldRenderer - Orchestrates 3D scene rendering for the world editor.
 * Coordinates subsystems for terrain, lighting, assets, transforms, and selection.
 *
 * Architecture:
 * - TerrainSystem: Heightmap mesh creation and height queries
 * - LightingSystem: Lights, shadows, sky, environment, post-processing
 * - AssetMeshFactory: Creates meshes from generated code, manages caching
 * - TransformSystem: TransformControls, snapping, ground constraint
 * - SelectionSystem: Raycasting, selection state, highlights
 * - InstanceManager: Placed instance lifecycle and animation
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { applyRenderPipeline, PARTS_EDITOR_PIPELINE, PIPELINE_ACES, PIPELINE_NEUTRAL } from '../shared/renderPipeline'
import { GRID_SIZE, TILE_SIZE, WORLD_SIZE } from '../shared/constants'
import { logWebGL, recordFrameTime } from '../shared/telemetry'
import { InstancedAssetManager } from './InstancedAssetManager'
import { normalizeRotation, normalizeScale } from '../shared/transforms'

// Subsystems
import { TerrainSystem } from './systems/TerrainSystem'
import { LightingSystem } from './systems/LightingSystem'
import { AssetMeshFactory } from './systems/AssetMeshFactory'
import { TransformSystem } from './systems/TransformSystem'
import { SelectionSystem } from './systems/SelectionSystem'
import { InstanceManager } from './systems/InstanceManager'
import { SKY_COLORS, RESIZE_THROTTLE_MS } from './shared/rendererUtils'

// Procedural anti-aliased grid shader - crisp lines at any distance
// Uses fwidth() for screen-space anti-aliasing of grid lines
const ProceduralGridShader = {
  uniforms: {
    color: { value: new THREE.Color(0x888888) },
    gridSize: { value: 10.0 },  // Size of each grid cell
    lineWidth: { value: 0.003 }, // Line width as fraction of cell
    opacity: { value: 0.4 }
  },
  vertexShader: `
    varying vec2 vWorldXZ;
    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldXZ = worldPosition.xz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 color;
    uniform float gridSize;
    uniform float lineWidth;
    uniform float opacity;
    varying vec2 vWorldXZ;

    void main() {
      // Calculate grid coordinates
      vec2 gridCoord = vWorldXZ / gridSize;

      // Get fractional part (distance to nearest grid line)
      vec2 grid = abs(fract(gridCoord - 0.5) - 0.5);

      // Use fwidth for screen-space anti-aliasing
      vec2 lineAA = fwidth(gridCoord) * 1.5;

      // Calculate line intensity with anti-aliasing
      vec2 lines = smoothstep(lineAA, vec2(0.0), grid - lineWidth);
      float line = max(lines.x, lines.y);

      if (line < 0.01) discard;
      gl_FragColor = vec4(color, line * opacity);
    }
  `
}

export class WorldRenderer {
  constructor(container, options = {}) {
    this.container = container
    this.renderPipeline = options.renderPipeline || PARTS_EDITOR_PIPELINE
    this.renderOptions = {
      environment: options.environment ?? this.renderPipeline.environment ?? 'none',
      postProcessing: options.postProcessing ?? this.renderPipeline.postProcessing ?? false,
      lightIntensityScale: options.lightIntensityScale ?? 1.0,
      frontFillIntensity: options.frontFillIntensity ?? 0.0,
      rimFillIntensity: options.rimFillIntensity ?? 0.0
    }

    // Core Three.js objects
    this.scene = null
    this.camera = null
    this.renderer = null
    this.orbitControls = null
    this.gridMesh = null

    // Subsystems (initialized in init())
    this.terrain = null
    this.lighting = null
    this.assetFactory = null
    this.transform = null
    this.selection = null
    this.instances = null

    // Instanced asset manager (experimental)
    this.instancedAssetManager = new InstancedAssetManager()
    this.useInstancing = false

    // Animation
    this.animationId = null
    this.clock = new THREE.Clock()
    this.playMode = false
    this.playModeUpdate = null

    // State
    this.darkMode = false
    this.isDisposed = false
    this.mode = 'edit'

    // WebGL context loss recovery
    this.isContextLost = false
    this.contextLostOverlay = null
    this._handleContextLost = this._handleContextLost.bind(this)
    this._handleContextRestored = this._handleContextRestored.bind(this)

    // Resize throttling
    this._resizePending = false
    this._lastResizeTime = 0

    // Resize observer
    this.resizeObserver = null

    // Public callbacks
    this.onTransformChange = null
    this.onTransformDragging = null
    this.onAssetError = options.onAssetError || null

    this.init()
  }

  init() {
    // Create scene
    this.scene = new THREE.Scene()
    const horizonColor = this.darkMode ? SKY_COLORS.dark.horizon : SKY_COLORS.light.horizon
    this.scene.background = new THREE.Color(horizonColor)

    // Create camera
    const worldCenter = WORLD_SIZE / 2
    const aspect = this.container.clientWidth / this.container.clientHeight
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.5, 5000)
    this.camera.position.set(worldCenter + 50, 100, worldCenter + 50)
    this.camera.lookAt(worldCenter, 0, worldCenter)

    // Create renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    // Disable automatic shadow updates - we'll update manually via LightingSystem
    // This provides 20-40% GPU frame-time reduction in static scenes
    this.renderer.shadowMap.autoUpdate = false
    applyRenderPipeline(this.renderer, this.renderPipeline)
    this.container.appendChild(this.renderer.domElement)

    // Set canvas background to prevent flash on resize
    this._updateCanvasBackground()

    // WebGL context loss handlers
    this.renderer.domElement.addEventListener('webglcontextlost', this._handleContextLost, false)
    this.renderer.domElement.addEventListener('webglcontextrestored', this._handleContextRestored, false)

    // Create orbit controls
    this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement)
    this.orbitControls.target.set(worldCenter, 0, worldCenter)
    this.orbitControls.enableDamping = true
    this.orbitControls.dampingFactor = 0.1
    this.orbitControls.maxPolarAngle = Math.PI * 0.45
    this.orbitControls.minDistance = 10
    this.orbitControls.maxDistance = Infinity
    this.orbitControls.screenSpacePanning = false  // Keep target on horizontal plane
    this.orbitControls.update()

    // Shared state for subsystems
    const shared = {
      scene: this.scene,
      camera: this.camera,
      renderer: this.renderer,
      container: this.container,
      orbitControls: this.orbitControls
    }

    // Initialize subsystems
    this.terrain = new TerrainSystem(shared)

    this.lighting = new LightingSystem(shared, {
      postProcessing: this.renderOptions.postProcessing
    })
    this.lighting.init()

    this.assetFactory = new AssetMeshFactory({
      onAssetError: this.onAssetError
    })

    this.transform = new TransformSystem(shared, {
      getTerrainHeight: (x, z) => this.terrain.getTerrainHeight(x, z)
    })
    this.transform.init()

    // Wire transform callbacks
    this.transform.onTransformChange = (instanceId, update) => {
      if (this.onTransformChange) this.onTransformChange(instanceId, update)
    }
    this.transform.onTransformDragging = (height) => {
      if (this.onTransformDragging) this.onTransformDragging(height)
    }
    this.transform.onTransformComplete = () => {
      // Mark shadows dirty after transform completes (object moved/scaled)
      this.lighting.markShadowDirty()
    }

    this.selection = new SelectionSystem(shared, {
      getInstanceMeshes: () => this.instances.getAllMeshes(),
      getTerrainMesh: () => this.terrain.terrainMesh
    })

    this.instances = new InstanceManager(shared, {
      getTerrainHeight: (x, z) => this.terrain.getTerrainHeight(x, z),
      assetFactory: this.assetFactory,
      onSelectionInvalidate: () => this.selection.invalidateCache()
    })

    // Create procedural grid plane (anti-aliased lines at any distance)
    const gridWorldSize = WORLD_SIZE * 2
    const gridGeometry = new THREE.PlaneGeometry(gridWorldSize, gridWorldSize)
    gridGeometry.rotateX(-Math.PI / 2)  // Lay flat on XZ plane

    this.gridMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(ProceduralGridShader.uniforms),
      vertexShader: ProceduralGridShader.vertexShader,
      fragmentShader: ProceduralGridShader.fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    })
    this.gridMaterial.uniforms.gridSize.value = TILE_SIZE

    this.gridMesh = new THREE.Mesh(gridGeometry, this.gridMaterial)
    this.gridMesh.position.set(WORLD_SIZE / 2, 0.02, WORLD_SIZE / 2)
    this.scene.add(this.gridMesh)

    // Handle resize
    this.handleResize = this.handleResize.bind(this)
    window.addEventListener('resize', this.handleResize)
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.handleResize())
      this.resizeObserver.observe(this.container)
    }

    // Start render loop
    this.animate()
  }

  // ============================================================
  // Public API - World Updates
  // ============================================================

  updateWorld(worldData) {
    if (!worldData) return

    // Update terrain
    if (worldData.terrain) {
      this.terrain.updateTerrain(
        worldData.terrain.heightmap,
        worldData.terrain.biome,
        this.darkMode
      )
    }

    // Update instances
    this.instances.updateWorld(worldData, {
      isDragging: this.transform.isDragging,
      selectedInstance: this.selection.selectedInstance,
      transformControls: this.transform.transformControls,
      onDeleteHighlightClear: (id) => {
        if (this.selection.deleteHighlight?.instanceId === id) {
          this.selection.unhighlightInstance()
        }
      },
      onPartSelectionClear: (id) => {
        if (this.selection.selectedPart?.instanceId === id) {
          this.selection.clearPartSelection()
        }
      }
    })

    // Mark shadows dirty after world changes (terrain or instances)
    this.lighting.markShadowDirty()
  }

  // ============================================================
  // Public API - Selection
  // ============================================================

  selectInstance(instanceId) {
    if (this.selection.selectedInstance === instanceId) return

    this.selection.select(instanceId)

    if (!instanceId) {
      this.transform.detach()
      return
    }

    const mesh = this.instances.getMesh(instanceId)
    if (mesh && !mesh.userData?.isLoadingPlaceholder) {
      this.transform.attach(mesh)
    }
  }

  get selectedInstance() {
    return this.selection.selectedInstance
  }

  get selectedPart() {
    return this.selection.selectedPart
  }

  focusOnInstance(instanceId, duration = 300) {
    const mesh = this.instances.getMesh(instanceId)
    if (!mesh) return

    const box = new THREE.Box3().setFromObject(mesh)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)

    const fov = this.camera.fov * (Math.PI / 180)
    const fitDistance = Math.max((maxDim / 2) / Math.tan(fov / 2) * 2.5, 10)

    const currentDir = new THREE.Vector3()
    currentDir.subVectors(this.camera.position, this.orbitControls.target).normalize()
    const targetCameraPos = center.clone().add(currentDir.multiplyScalar(fitDistance))

    const startCameraPos = this.camera.position.clone()
    const startTarget = this.orbitControls.target.clone()
    const startTime = performance.now()

    const animateFocus = () => {
      if (this.isDisposed) return

      const elapsed = performance.now() - startTime
      const t = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - t, 3)

      this.camera.position.lerpVectors(startCameraPos, targetCameraPos, eased)
      this.orbitControls.target.lerpVectors(startTarget, center, eased)
      this.orbitControls.update()

      if (t < 1) requestAnimationFrame(animateFocus)
    }

    requestAnimationFrame(animateFocus)
  }

  /**
   * Reset camera to default view (world center from above-right)
   * @param {number} duration - Animation duration in ms (default 300)
   */
  resetCamera(duration = 300) {
    const worldCenter = WORLD_SIZE / 2
    const targetCameraPos = new THREE.Vector3(worldCenter + 50, 100, worldCenter + 50)
    const targetLookAt = new THREE.Vector3(worldCenter, 0, worldCenter)

    const startCameraPos = this.camera.position.clone()
    const startTarget = this.orbitControls.target.clone()
    const startTime = performance.now()

    const animateReset = () => {
      if (this.isDisposed) return

      const elapsed = performance.now() - startTime
      const t = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - t, 3)

      this.camera.position.lerpVectors(startCameraPos, targetCameraPos, eased)
      this.orbitControls.target.lerpVectors(startTarget, targetLookAt, eased)
      this.orbitControls.update()

      if (t < 1) requestAnimationFrame(animateReset)
    }

    requestAnimationFrame(animateReset)
  }

  // ============================================================
  // Public API - Raycasting
  // ============================================================

  raycast(x, y) {
    return this.selection.raycast(x, y)
  }

  getWorldPosition(x, y) {
    return this.selection.getWorldPosition(x, y)
  }

  getWorldPositionFromHit(hit) {
    return this.selection.getWorldPositionFromHit(hit)
  }

  // ============================================================
  // Public API - Transforms
  // ============================================================

  setTransformMode(mode) {
    this.transform.setMode(mode)
  }

  get transformMode() {
    return this.transform.transformMode
  }

  get transformControls() {
    return this.transform.transformControls
  }

  get isDragging() {
    return this.transform.isDragging
  }

  setSnappingActive(active) {
    this.transform.setSnappingActive(active)
  }

  setGroundConstraintActive(active) {
    this.transform.setGroundConstraintActive(active)
  }

  setGizmoSize(mesh) {
    this.transform.setGizmoSize(mesh)
  }

  // ============================================================
  // Public API - Terrain
  // ============================================================

  getTerrainHeight(x, z) {
    return this.terrain.getTerrainHeight(x, z)
  }

  get terrainMesh() {
    return this.terrain.terrainMesh
  }

  get currentHeightmap() {
    return this.terrain.currentHeightmap
  }

  // ============================================================
  // Public API - Lighting & Appearance
  // ============================================================

  setDarkMode(enabled) {
    this.darkMode = enabled
    this.lighting.setDarkMode(enabled)

    // Update grid color via shader uniform
    if (this.gridMaterial) {
      const gridColor = enabled ? 0x555566 : 0x888888
      this.gridMaterial.uniforms.color.value.setHex(gridColor)
    }

    this._updateCanvasBackground()
  }

  applyLightingPreset(presetId) {
    this.lighting.applyLightingPreset(presetId)
  }

  get currentLightingPreset() {
    return this.lighting.currentLightingPreset
  }

  setShadowQuality(quality) {
    this.lighting.setShadowQuality(quality)
  }

  setPostProcessingEnabled(enabled) {
    this.lighting.setPostProcessingEnabled(enabled)
    this.renderOptions.postProcessing = enabled
  }

  get postProcessingEnabled() {
    return this.lighting.postProcessingEnabled
  }

  getSaturation() {
    return this.lighting.getSaturation()
  }

  setSaturation(value) {
    this.lighting.setSaturation(value)
  }

  getShadowLift() {
    return this.lighting.getShadowLift()
  }

  setShadowLift(value) {
    this.lighting.setShadowLift(value)
  }

  setRenderPipeline(pipelineType) {
    const pipeline = pipelineType === 'neutral' ? PIPELINE_NEUTRAL : PIPELINE_ACES
    this.renderPipeline = pipeline
    applyRenderPipeline(this.renderer, pipeline)
  }

  // ============================================================
  // Public API - Parts
  // ============================================================

  collectSelectableParts(asset, libraryId = null) {
    return this.assetFactory.collectSelectableParts(asset, libraryId)
  }

  findPartByName(asset, name) {
    return this.assetFactory.findPartByName(asset, name)
  }

  selectPart(instanceId, partName) {
    this.selection.selectPart(instanceId, partName, (asset, name) =>
      this.assetFactory.findPartByName(asset, name)
    )
  }

  clearPartSelection() {
    this.selection.clearPartSelection()

    // Detach transform if attached to a part
    if (this.transform.object && !this.transform.object.userData?.instanceId) {
      this.transform.detach()
    }
  }

  raycastPart(x, y, instanceId) {
    return this.selection.raycastPart(x, y, instanceId, (asset, libraryId) =>
      this.assetFactory.collectSelectableParts(asset, libraryId)
    )
  }

  applyPartTweaks(asset, tweaks) {
    this.assetFactory.applyPartTweaks(asset, tweaks)
  }

  invalidatePartsCache(libraryId = null) {
    this.assetFactory.invalidatePartsCache(libraryId)
  }

  // ============================================================
  // Public API - Instance Management
  // ============================================================

  get instanceMeshes() {
    return this.instances.getAllMeshes()
  }

  get currentLibrary() {
    return this.instances.currentLibrary
  }

  get currentPlacedAssets() {
    return this.instances.currentPlacedAssets
  }

  get libraryMap() {
    return this.instances.libraryMap
  }

  get instanceMap() {
    return this.instances.instanceMap
  }

  rebuildInstanceMesh(instanceId) {
    // Clear highlights
    if (this.selection.deleteHighlight?.instanceId === instanceId) {
      this.selection.unhighlightInstance()
    }
    if (this.selection.selectedPart?.instanceId === instanceId) {
      this.selection.clearPartSelection()
    }

    this.instances.rebuildInstanceMesh(instanceId, this.transform.transformControls)
  }

  rebuildInstancesByLibraryId(libraryId, updatedLibrary = null) {
    // Clear module cache
    this.assetFactory.clearModuleCache(libraryId)

    this.instances.rebuildInstancesByLibraryId(
      libraryId,
      updatedLibrary,
      this.transform.transformControls
    )
  }

  highlightInstanceForDeletion(instanceId) {
    this.selection.highlightInstanceForDeletion(instanceId)
  }

  unhighlightInstance() {
    this.selection.unhighlightInstance()
  }

  get deleteHighlight() {
    return this.selection.deleteHighlight
  }

  previewInstanceTransform(instanceId, updates) {
    this.instances.previewInstanceTransform(
      instanceId,
      updates,
      this.transform.transformControls
    )
  }

  createAssetMesh(libraryId, instance = null) {
    const libraryAsset = this.instances.libraryMap.get(libraryId)
    return this.assetFactory.createAssetMesh(libraryAsset, instance)
  }

  // ============================================================
  // Render Loop
  // ============================================================

  animate() {
    this.animationId = requestAnimationFrame(() => this.animate())

    const dt = this.clock.getDelta()

    // Record frame timing for FPS telemetry
    recordFrameTime(dt * 1000)

    // Update orbit controls (skip in play mode)
    if (!this.playMode) {
      this.orbitControls.update()
    }

    // Play mode update
    if (this.playMode && this.playModeUpdate) {
      this.playModeUpdate(dt)
    }

    // Animate instances (pass playMode so InstanceManager can skip NPCs)
    this.instances.setPlayMode(this.playMode)
    this.instances.animateInstances(dt, this.camera)

    // Update shadows only when dirty (gated for performance)
    this.lighting.updateShadowsIfNeeded()

    // Render
    if (!this.lighting.render()) {
      this.renderer.render(this.scene, this.camera)
    }
  }

  renderFrame() {
    if (this.isDisposed) return

    if (!this.lighting.render()) {
      this.renderer.render(this.scene, this.camera)
    }
  }

  // ============================================================
  // Resize Handling
  // ============================================================

  handleResize() {
    const now = performance.now()

    if (now - this._lastResizeTime < RESIZE_THROTTLE_MS) {
      if (!this._resizePending) {
        this._resizePending = true
        requestAnimationFrame(() => {
          this._resizePending = false
          this._doResize()
        })
      }
      return
    }

    this._lastResizeTime = now
    this._doResize()
  }

  _doResize() {
    if (this.isDisposed) return

    const width = this.container.clientWidth
    const height = this.container.clientHeight

    if (width <= 0 || height <= 0) return

    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()

    this.renderer.setSize(width, height)
    this.lighting.handleResize(width, height)
    this.selection.invalidateRect()

    this.renderFrame()
  }

  _updateCanvasBackground() {
    const colors = this.darkMode ? SKY_COLORS.dark : SKY_COLORS.light
    const hex = colors.horizon.toString(16).padStart(6, '0')
    const cssColor = `#${hex}`
    this.renderer.domElement.style.backgroundColor = cssColor
    this.container.style.backgroundColor = cssColor
  }

  // ============================================================
  // WebGL Context Loss Recovery
  // ============================================================

  _handleContextLost(event) {
    event.preventDefault()
    this.isContextLost = true

    logWebGL('context_lost', { time: Date.now() })

    if (this.animationId) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }

    this._showContextLostOverlay()
  }

  _handleContextRestored(event) {
    logWebGL('context_restored', { time: Date.now() })
    this._rebuildAfterContextLoss()
  }

  _showContextLostOverlay() {
    if (this.contextLostOverlay) return

    const overlay = document.createElement('div')
    overlay.className = 'webgl-context-lost-overlay'
    overlay.innerHTML = `
      <div class="webgl-context-lost-content">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <h3>Graphics Context Lost</h3>
        <p class="webgl-context-message">The 3D viewport has lost its graphics context.</p>
        <button class="webgl-restore-button">Try Recovery</button>
      </div>
      <style>
        .webgl-context-lost-overlay {
          position: absolute; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0, 0, 0, 0.9); display: flex;
          align-items: center; justify-content: center; z-index: 1000;
        }
        .webgl-context-lost-content { text-align: center; color: white; padding: 32px; max-width: 400px; }
        .webgl-context-lost-content svg { color: #f59e0b; margin-bottom: 16px; }
        .webgl-context-lost-content h3 { margin: 0 0 12px 0; font-size: 20px; }
        .webgl-context-lost-content p { margin: 0 0 20px 0; color: #a0a0a0; font-size: 14px; }
        .webgl-restore-button {
          padding: 12px 24px; background: #6366f1; color: white; border: none;
          border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer;
        }
        .webgl-restore-button:hover { background: #5558e3; }
      </style>
    `

    const button = overlay.querySelector('.webgl-restore-button')
    const message = overlay.querySelector('.webgl-context-message')
    let recoveryAttempts = 0

    button.addEventListener('click', () => {
      if (!this.isContextLost) {
        this._hideContextLostOverlay()
      } else {
        recoveryAttempts++
        this.handleResize()
        button.textContent = 'Recovering...'
        button.disabled = true

        setTimeout(() => {
          if (!this.isContextLost) {
            this._hideContextLostOverlay()
          } else if (recoveryAttempts >= 2) {
            message.textContent = 'Recovery failed. Reloading the page should restore graphics.'
            button.textContent = 'Reload Page'
            button.disabled = false
            button.onclick = () => window.location.reload()
          } else {
            message.textContent = 'Recovery in progress. Try again if the viewport remains blank.'
            button.textContent = 'Try Again'
            button.disabled = false
          }
        }, 2000)
      }
    })

    this.container.appendChild(overlay)
    this.contextLostOverlay = overlay
  }

  _hideContextLostOverlay() {
    if (this.contextLostOverlay) {
      this.contextLostOverlay.remove()
      this.contextLostOverlay = null
    }
  }

  _rebuildAfterContextLoss() {
    this.isContextLost = false
    this._hideContextLostOverlay()

    // Rebuild subsystems
    this.lighting.rebuildAfterContextLoss()
    this.terrain.invalidateHash()

    // Clear and rebuild instances
    this.assetFactory.clearModuleCache()
    this.instances.dispose()
    this.instances = new InstanceManager({
      scene: this.scene,
      camera: this.camera,
      renderer: this.renderer
    }, {
      getTerrainHeight: (x, z) => this.terrain.getTerrainHeight(x, z),
      assetFactory: this.assetFactory,
      onSelectionInvalidate: () => this.selection.invalidateCache()
    })

    this.selection.invalidateCache()

    // Restart animation
    this.animate()
  }

  // ============================================================
  // Instancing (Experimental)
  // ============================================================

  setInstancingEnabled(enabled) {
    if (this.useInstancing === enabled) return
    this.useInstancing = enabled

    if (this.instances.currentPlacedAssets?.length > 0) {
      this.rebuildInstancing()
    }
  }

  rebuildInstancing() {
    // Remove all instanced meshes from scene
    for (const mesh of this.instancedAssetManager.getAllMeshes()) {
      this.scene.remove(mesh)
    }

    if (!this.useInstancing) {
      this.instancedAssetManager.dispose()
      return
    }

    // Implementation would go here for full instancing support
  }

  // ============================================================
  // Disposal
  // ============================================================

  dispose() {
    this.isDisposed = true

    // Remove event listeners
    if (this.renderer?.domElement) {
      this.renderer.domElement.removeEventListener('webglcontextlost', this._handleContextLost)
      this.renderer.domElement.removeEventListener('webglcontextrestored', this._handleContextRestored)
    }
    this._hideContextLostOverlay()

    window.removeEventListener('resize', this.handleResize)
    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
      this.resizeObserver = null
    }

    if (this.animationId) {
      cancelAnimationFrame(this.animationId)
    }

    // Dispose controls
    this.orbitControls.dispose()

    // Dispose subsystems
    this.terrain.dispose()
    this.lighting.dispose()
    this.transform.dispose()
    this.selection.dispose()
    this.instances.dispose()
    this.assetFactory.dispose()

    // Dispose grid
    if (this.gridMesh) {
      this.scene.remove(this.gridMesh)
      this.gridMesh.geometry?.dispose()
      this.gridMesh.material?.dispose()
    }

    // Dispose instanced manager
    for (const mesh of this.instancedAssetManager.getAllMeshes()) {
      this.scene.remove(mesh)
    }
    this.instancedAssetManager.dispose()

    // Dispose renderer
    this.renderer.dispose()
    this.container.removeChild(this.renderer.domElement)
  }
}
