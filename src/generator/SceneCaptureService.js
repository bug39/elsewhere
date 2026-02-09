/**
 * SceneCaptureService - Multi-angle screenshot capture for scene evaluation
 *
 * Captures scene screenshots at various camera angles for vision API analysis.
 * Uses an offscreen renderer to avoid disrupting the main viewport.
 */

import * as THREE from 'three'
import { WORLD_SIZE, SCENE_GENERATION } from '../shared/constants'
import { PARTS_EDITOR_PIPELINE, applyRenderPipeline, addPipelineLights } from '../shared/renderPipeline'

const DEFAULT_SIZE = 768  // Higher resolution for better vision API evaluation
const WORLD_THUMBNAIL_SIZE = 256  // Smaller size for home screen thumbnails
const CAPTURE_CACHE_MAX = 10

/**
 * Camera preset definitions for scene capture
 * Each preset provides a different perspective for evaluation.
 * Cameras are positioned relative to the SCENE zone (380m), using SCENE_GENERATION.SIZE.
 */
export const CAMERA_PRESETS = {
  // Bird's eye view of the scene zone - shows overall layout and density
  // Scales with SCENE_GENERATION.SIZE so the full scene is visible
  overview: {
    name: 'Overview',
    getPosition: (center) => new THREE.Vector3(
      center.x + SCENE_GENERATION.SIZE * 0.04,
      SCENE_GENERATION.SIZE * 0.55,
      center.z + SCENE_GENERATION.SIZE * 0.12
    ),
    getLookAt: (center) => new THREE.Vector3(center.x, 0, center.z),
    fov: 55
  },

  // Elevated corner view - shows depth and spatial relationships within scene
  cornerNE: {
    name: 'Corner NE',
    getPosition: (center) => new THREE.Vector3(
      center.x + SCENE_GENERATION.SIZE * 0.6,
      SCENE_GENERATION.SIZE * 0.8,
      center.z + SCENE_GENERATION.SIZE * 0.6
    ),
    getLookAt: (center) => new THREE.Vector3(center.x, 0, center.z),
    fov: 50
  },

  // Elevated corner view - opposite angle
  cornerSW: {
    name: 'Corner SW',
    getPosition: (center) => new THREE.Vector3(
      center.x - SCENE_GENERATION.SIZE * 0.6,
      SCENE_GENERATION.SIZE * 0.8,
      center.z - SCENE_GENERATION.SIZE * 0.6
    ),
    getLookAt: (center) => new THREE.Vector3(center.x, 0, center.z),
    fov: 50
  },

  // Ground level perspective - shows how it feels to walk through
  groundLevel: {
    name: 'Ground Level',
    getPosition: (center) => new THREE.Vector3(
      center.x - SCENE_GENERATION.SIZE * 0.4,
      8,
      center.z - SCENE_GENERATION.SIZE * 0.4
    ),
    getLookAt: (center) => new THREE.Vector3(center.x + 15, 5, center.z + 15),
    fov: 70
  },

  // Side view - shows vertical distribution
  sideEast: {
    name: 'Side East',
    getPosition: (center) => new THREE.Vector3(
      center.x + SCENE_GENERATION.SIZE * 0.8,
      SCENE_GENERATION.SIZE * 0.5,
      center.z
    ),
    getLookAt: (center) => new THREE.Vector3(center.x, 0, center.z),
    fov: 50
  },

  // True orthographic top-down view - ideal for detecting XZ overlaps
  // Unlike perspective views, this shows exact footprint intersections
  topDown: {
    name: 'Top Down (Orthographic)',
    type: 'orthographic',
    altitude: 300,
    frustumSize: 400,  // Capture full 380m zone + 20m margin
    getPosition: (center) => new THREE.Vector3(center.x, 300, center.z),
    getLookAt: (center) => new THREE.Vector3(center.x, 0, center.z)
  }
}

/**
 * Default camera presets for scene evaluation
 */
export const DEFAULT_CAPTURE_PRESETS = ['overview', 'cornerNE', 'groundLevel']

export class SceneCaptureService {
  constructor(size = DEFAULT_SIZE) {
    this.size = size
    this.renderer = null
    this.camera = null
    this.cache = new Map()
    this.initialized = false
  }

  /**
   * Initialize the offscreen renderer
   * Called lazily on first capture
   */
  initialize() {
    if (this.initialized) return

    // Create offscreen renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true
    })
    this.renderer.setSize(this.size, this.size)
    this.renderer.setPixelRatio(1)
    applyRenderPipeline(this.renderer, PARTS_EDITOR_PIPELINE)

    // Create camera (will be configured per-capture)
    this.camera = new THREE.PerspectiveCamera(60, 1, 1, WORLD_SIZE * 2)

    this.initialized = true
  }

  /**
   * Capture a screenshot of the scene from a specific camera preset
   *
   * @param {THREE.Scene} scene - The Three.js scene to capture
   * @param {string} presetName - Name of camera preset to use
   * @param {Object} options - Additional options
   * @returns {string} Base64-encoded PNG image data (without data URL prefix)
   */
  capture(scene, presetName = 'overview', options = {}) {
    this.initialize()

    const {
      center = { x: WORLD_SIZE / 2, z: WORLD_SIZE / 2 },
      includeDataUrlPrefix = false
    } = options

    const preset = CAMERA_PRESETS[presetName]
    if (!preset) {
      throw new Error(`Unknown camera preset: ${presetName}`)
    }

    // Configure camera for this preset
    this.camera.fov = preset.fov
    this.camera.position.copy(preset.getPosition(center))
    this.camera.lookAt(preset.getLookAt(center))
    this.camera.updateProjectionMatrix()

    // Render scene
    this.renderer.render(scene, this.camera)

    // Get image data
    const dataUrl = this.renderer.domElement.toDataURL('image/png')

    if (includeDataUrlPrefix) {
      return dataUrl
    }

    // Strip the data URL prefix to get raw base64
    return dataUrl.replace(/^data:image\/png;base64,/, '')
  }

  /**
   * Capture multiple screenshots from different angles
   *
   * @param {THREE.Scene} scene - The Three.js scene to capture
   * @param {string[]} presetNames - Array of preset names to capture
   * @param {Object} options - Additional options
   * @returns {Array<{preset: string, data: string}>} Array of captures with preset names
   */
  captureMultiple(scene, presetNames = DEFAULT_CAPTURE_PRESETS, options = {}) {
    return presetNames.map(preset => ({
      preset,
      name: CAMERA_PRESETS[preset]?.name || preset,
      data: this.capture(scene, preset, options)
    }))
  }

  /**
   * Capture a single overview shot - most common use case
   *
   * @param {THREE.Scene} scene - The Three.js scene
   * @param {Object} options - Additional options
   * @returns {string} Base64-encoded PNG
   */
  captureOverview(scene, options = {}) {
    return this.capture(scene, 'overview', options)
  }

  /**
   * Capture a true orthographic top-down view of the scene.
   * Unlike perspective cameras, orthographic projection shows exact XZ footprints
   * without any depth distortion, making overlaps clearly visible.
   *
   * This is ideal for verifier analysis because:
   * 1. Overlapping assets show as intersecting shapes
   * 2. Asset spacing is accurately represented
   * 3. No perspective foreshortening
   *
   * @param {THREE.Scene} scene - The Three.js scene to capture
   * @param {Object} options - Additional options
   * @param {Object} [options.center] - Center point {x, z}, defaults to scene center
   * @param {number} [options.frustumSize=140] - Orthographic frustum size (zone width + margin)
   * @param {boolean} [options.includeDataUrlPrefix=false] - Include data URL prefix
   * @returns {string} Base64-encoded PNG
   */
  captureOrthographic(scene, options = {}) {
    this.initialize()

    const {
      center = { x: SCENE_GENERATION.CENTER_X, z: SCENE_GENERATION.CENTER_Z },
      frustumSize = CAMERA_PRESETS.topDown.frustumSize,
      includeDataUrlPrefix = false
    } = options

    const preset = CAMERA_PRESETS.topDown

    // Create orthographic camera (temporary, not stored as this.camera)
    const halfSize = frustumSize / 2
    const orthoCamera = new THREE.OrthographicCamera(
      -halfSize, halfSize,   // left, right
      halfSize, -halfSize,   // top, bottom (inverted for Y-down in screen space)
      1, 500                 // near, far
    )

    // Position straight above scene center looking down
    orthoCamera.position.set(center.x, preset.altitude, center.z)
    orthoCamera.lookAt(center.x, 0, center.z)
    orthoCamera.updateProjectionMatrix()

    // Render scene
    this.renderer.render(scene, orthoCamera)

    // Get image data
    const dataUrl = this.renderer.domElement.toDataURL('image/png')

    if (includeDataUrlPrefix) {
      return dataUrl
    }

    return dataUrl.replace(/^data:image\/png;base64,/, '')
  }

  /**
   * Capture focused on a specific zone/quadrant
   *
   * @param {THREE.Scene} scene - The Three.js scene
   * @param {Object} zoneBounds - {minX, maxX, minZ, maxZ}
   * @param {Object} options - Additional options
   * @returns {string} Base64-encoded PNG
   */
  captureZone(scene, zoneBounds, options = {}) {
    this.initialize()

    // M9 FIX: Validate zone bounds
    const minX = zoneBounds?.minX ?? 0
    const maxX = zoneBounds?.maxX ?? WORLD_SIZE
    const minZ = zoneBounds?.minZ ?? 0
    const maxZ = zoneBounds?.maxZ ?? WORLD_SIZE

    // Ensure min < max (swap if inverted)
    const validMinX = Math.min(minX, maxX)
    const validMaxX = Math.max(minX, maxX)
    const validMinZ = Math.min(minZ, maxZ)
    const validMaxZ = Math.max(minZ, maxZ)

    const centerX = (validMinX + validMaxX) / 2
    const centerZ = (validMinZ + validMaxZ) / 2
    const zoneSize = Math.max(
      validMaxX - validMinX,
      validMaxZ - validMinZ,
      10  // M9 FIX: Minimum zone size to prevent camera issues
    )

    // Position camera to frame the zone
    const height = zoneSize * 0.8
    const offset = zoneSize * 0.3

    this.camera.fov = 50
    this.camera.position.set(centerX + offset, height, centerZ + offset)
    this.camera.lookAt(centerX, 0, centerZ)
    this.camera.updateProjectionMatrix()

    this.renderer.render(scene, this.camera)

    const dataUrl = this.renderer.domElement.toDataURL('image/png')
    return options.includeDataUrlPrefix
      ? dataUrl
      : dataUrl.replace(/^data:image\/png;base64,/, '')
  }

  /**
   * Create a composite image from multiple captures
   * Useful for giving the vision model multiple perspectives at once
   *
   * @param {THREE.Scene} scene - The Three.js scene
   * @param {string[]} presetNames - Presets to include
   * @param {Object} options - Additional options
   * @returns {string} Base64-encoded composite PNG
   */
  captureComposite(scene, presetNames = ['overview', 'cornerNE'], options = {}) {
    const captures = this.captureMultiple(scene, presetNames, {
      ...options,
      includeDataUrlPrefix: true
    })

    // Create composite canvas
    const cols = Math.min(captures.length, 2)
    const rows = Math.ceil(captures.length / cols)
    const compositeCanvas = document.createElement('canvas')
    compositeCanvas.width = this.size * cols
    compositeCanvas.height = this.size * rows
    const ctx = compositeCanvas.getContext('2d')

    // Draw each capture
    const images = captures.map((capture, index) => {
      return new Promise((resolve) => {
        const img = new Image()
        img.onload = () => {
          const col = index % cols
          const row = Math.floor(index / cols)
          ctx.drawImage(img, col * this.size, row * this.size)
          resolve()
        }
        img.src = capture.data
      })
    })

    // Return promise that resolves to composite
    return Promise.all(images).then(() => {
      const dataUrl = compositeCanvas.toDataURL('image/png')
      return options.includeDataUrlPrefix
        ? dataUrl
        : dataUrl.replace(/^data:image\/png;base64,/, '')
    })
  }

  /**
   * Capture a screenshot from a specific position looking at a target.
   * Used for dynamic camera control requested by the evaluator.
   *
   * @param {THREE.Scene} scene - The Three.js scene to capture
   * @param {{x: number, y: number, z: number}} position - Camera position
   * @param {{x: number, y: number, z: number}} lookAt - Point to look at
   * @param {Object} options - Additional options
   * @returns {string} Base64-encoded PNG image data (without data URL prefix)
   */
  captureAtPosition(scene, position, lookAt, options = {}) {
    this.initialize()

    const { fov = 60, includeDataUrlPrefix = false } = options

    // Configure camera for this specific view
    this.camera.fov = fov
    this.camera.position.set(position.x, position.y, position.z)
    this.camera.lookAt(lookAt.x, lookAt.y, lookAt.z)
    this.camera.updateProjectionMatrix()

    // Render scene
    this.renderer.render(scene, this.camera)

    // Get image data
    const dataUrl = this.renderer.domElement.toDataURL('image/png')

    if (includeDataUrlPrefix) {
      return dataUrl
    }

    return dataUrl.replace(/^data:image\/png;base64,/, '')
  }

  /**
   * Capture focused on a quadrant of the scene.
   * Used when evaluator requests views of specific areas.
   *
   * @param {THREE.Scene} scene - The Three.js scene
   * @param {string} quadrant - 'NE', 'NW', 'SE', 'SW', 'N', 'S', 'E', 'W', 'center'
   * @param {Object} options - Additional options
   * @returns {string} Base64-encoded PNG
   */
  captureQuadrant(scene, quadrant, options = {}) {
    this.initialize()

    const sceneCenterX = SCENE_GENERATION.CENTER_X
    const sceneCenterZ = SCENE_GENERATION.CENTER_Z
    const offset = SCENE_GENERATION.SIZE * 0.25

    // Calculate quadrant center
    let targetX = sceneCenterX
    let targetZ = sceneCenterZ

    if (quadrant.includes('N')) targetZ -= offset
    if (quadrant.includes('S')) targetZ += offset
    if (quadrant.includes('E')) targetX += offset
    if (quadrant.includes('W')) targetX -= offset

    // Position camera above and offset from quadrant center
    const cameraHeight = 40
    const cameraOffset = 20

    const position = {
      x: targetX + cameraOffset,
      y: cameraHeight,
      z: targetZ + cameraOffset
    }

    const lookAt = {
      x: targetX,
      y: 0,
      z: targetZ
    }

    return this.captureAtPosition(scene, position, lookAt, { fov: 55, ...options })
  }

  /**
   * Clear any cached captures
   */
  clearCache() {
    this.cache.clear()
  }

  /**
   * Dispose of renderer resources
   */
  dispose() {
    if (this.renderer) {
      this.renderer.dispose()
      this.renderer = null
    }
    this.camera = null
    this.cache.clear()
    this.initialized = false
  }

  /**
   * Get the current capture size
   */
  getSize() {
    return this.size
  }

  /**
   * Set a new capture size
   * @param {number} size - New size in pixels
   */
  setSize(size) {
    this.size = size
    if (this.renderer) {
      this.renderer.setSize(size, size)
    }
  }
}

// Singleton instance
let sceneCaptureService = null

/**
 * Get the singleton SceneCaptureService instance
 * @param {number} size - Optional size override
 * @returns {SceneCaptureService}
 */
export function getSceneCaptureService(size = DEFAULT_SIZE) {
  if (!sceneCaptureService) {
    sceneCaptureService = new SceneCaptureService(size)
  }
  return sceneCaptureService
}

/**
 * Capture a scene overview screenshot
 * @param {THREE.Scene} scene - The scene to capture
 * @param {Object} options - Capture options
 * @returns {string} Base64-encoded PNG
 */
export function captureSceneOverview(scene, options = {}) {
  return getSceneCaptureService().captureOverview(scene, options)
}

/**
 * Capture multiple scene angles
 * @param {THREE.Scene} scene - The scene to capture
 * @param {string[]} presets - Camera presets to use
 * @param {Object} options - Capture options
 * @returns {Array<{preset: string, data: string}>}
 */
export function captureSceneMultiple(scene, presets, options = {}) {
  return getSceneCaptureService().captureMultiple(scene, presets, options)
}

/**
 * Capture a world thumbnail for home screen display
 * Uses smaller resolution for storage efficiency
 * @param {THREE.Scene} scene - The scene to capture
 * @returns {string} Base64 data URL for direct storage
 */
export function captureWorldThumbnail(scene) {
  const service = getSceneCaptureService()

  // Store original size, resize for thumbnail
  const originalSize = service.size
  service.setSize(WORLD_THUMBNAIL_SIZE)

  try {
    return service.capture(scene, 'overview', {
      includeDataUrlPrefix: true  // HomeScreen expects data URL format
    })
  } finally {
    // Restore original size
    service.setSize(originalSize)
  }
}
