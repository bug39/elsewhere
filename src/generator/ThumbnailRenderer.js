import * as THREE from 'three'
import { PARTS_EDITOR_PIPELINE, applyRenderPipeline, addPipelineLights } from '../shared/renderPipeline'

const THUMBNAIL_SIZE = 256
const THUMBNAIL_CACHE_MAX_SIZE = 100
const THUMBNAIL_TARGET_SIZE = 2.0  // Normalize all assets to fit within 2x2x2 cube

/**
 * Renders a thumbnail image of a THREE.Object3D
 */
export class ThumbnailRenderer {
  constructor() {
    // Offscreen renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true
    })
    this.renderer.setSize(THUMBNAIL_SIZE, THUMBNAIL_SIZE)
    this.renderer.setPixelRatio(1)
    applyRenderPipeline(this.renderer, PARTS_EDITOR_PIPELINE)

    // Scene for thumbnail rendering (transparent background)
    this.scene = new THREE.Scene()

    this.scene.background = null

    // Camera
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)

    addPipelineLights(this.scene, PARTS_EDITOR_PIPELINE)

    // Thumbnail cache: libraryId -> dataUrl
    this.cache = new Map()
  }

  /**
   * Generate a thumbnail for an asset with optional caching
   * @param {THREE.Object3D} asset - The asset to render
   * @param {string} [libraryId] - Optional library ID for cache lookup
   * @returns {string} Base64 data URL
   */
  render(asset, libraryId = null) {
    // Check cache first if libraryId provided
    if (libraryId && this.cache.has(libraryId)) {
      return this.cache.get(libraryId)
    }

    // Clone the asset without userData (which may contain cyclic references from animate functions)
    const clone = this.cloneWithoutUserData(asset)

    // Reset ALL transforms to measure intrinsic geometry size
    // CRITICAL: Scale must be reset BEFORE measuring, because Box3.setFromObject()
    // measures in world space (includes the object's scale transform)
    clone.position.set(0, 0, 0)
    clone.rotation.set(0, 0, 0)
    clone.scale.set(1, 1, 1)  // MUST reset scale BEFORE measuring

    // Measure intrinsic geometry size (now that scale is 1)
    const measureBox = new THREE.Box3().setFromObject(clone)
    const measureSize = measureBox.getSize(new THREE.Vector3())
    const maxDim = Math.max(measureSize.x, measureSize.y, measureSize.z)

    // Apply normalization scale to fit asset within THUMBNAIL_TARGET_SIZE cube
    if (maxDim > 0.001) {  // Guard against zero-size assets
      const normalizeScale = THUMBNAIL_TARGET_SIZE / maxDim
      clone.scale.set(normalizeScale, normalizeScale, normalizeScale)
    }
    // No else needed - scale stays at 1 for degenerate cases

    // Add to scene
    this.scene.add(clone)

    // Calculate bounding box and fit camera
    const box = new THREE.Box3().setFromObject(clone)
    const center = box.getCenter(new THREE.Vector3())

    // Position asset bottom on ground
    const bottomY = box.min.y
    clone.position.y -= bottomY

    // Recalculate bounds after repositioning
    box.setFromObject(clone)
    box.getCenter(center)

    // Calculate distance using box half-extent, not sphere diagonal
    // Sphere radius is sqrt(3)x larger than half-extent for cubes, making assets appear small
    const size = box.getSize(new THREE.Vector3())
    const frameDim = Math.max(size.x, size.y, size.z)
    const fov = this.camera.fov * (Math.PI / 180)
    // Camera is placed at diagonal offset (0.8, 0.4, 0.8), actual distance = 1.2 × base distance
    // Account for this so margin calculation is accurate
    const diagonalFactor = Math.sqrt(0.8*0.8 + 0.4*0.4 + 0.8*0.8)  // ≈ 1.2
    const baseDistance = (frameDim / 2) / Math.tan(fov / 2) * 1.35  // 1.35 = ~15% margin each side
    const distance = baseDistance / diagonalFactor
    this.camera.position.set(
      center.x + distance * 0.8,
      center.y + distance * 0.4,
      center.z + distance * 0.8
    )
    this.camera.lookAt(center)
    this.camera.updateProjectionMatrix()

    // Render
    this.renderer.render(this.scene, this.camera)

    // Get data URL
    const dataUrl = this.renderer.domElement.toDataURL('image/png')

    // Cleanup
    this.scene.remove(clone)
    this.disposeObject(clone)

    // Store in cache if libraryId provided
    if (libraryId) {
      // Evict oldest entries if cache is full
      if (this.cache.size >= THUMBNAIL_CACHE_MAX_SIZE) {
        const oldestKey = this.cache.keys().next().value
        this.cache.delete(oldestKey)
      }
      this.cache.set(libraryId, dataUrl)
    }

    return dataUrl
  }

  /**
   * Generate a thumbnail asynchronously using toBlob() for non-blocking PNG encoding.
   * Eliminates 50-100ms main-thread stalls per generation.
   *
   * @param {THREE.Object3D} asset - The asset to render
   * @param {string} [libraryId] - Optional library ID for cache lookup
   * @returns {Promise<string>} Base64 data URL
   */
  async renderAsync(asset, libraryId = null) {
    // Check cache first if libraryId provided
    if (libraryId && this.cache.has(libraryId)) {
      return this.cache.get(libraryId)
    }

    // Clone the asset without userData (which may contain cyclic references from animate functions)
    const clone = this.cloneWithoutUserData(asset)

    // Reset ALL transforms to measure intrinsic geometry size
    clone.position.set(0, 0, 0)
    clone.rotation.set(0, 0, 0)
    clone.scale.set(1, 1, 1)

    // Measure intrinsic geometry size
    const measureBox = new THREE.Box3().setFromObject(clone)
    const measureSize = measureBox.getSize(new THREE.Vector3())
    const maxDim = Math.max(measureSize.x, measureSize.y, measureSize.z)

    // Apply normalization scale
    if (maxDim > 0.001) {
      const normalizeScale = THUMBNAIL_TARGET_SIZE / maxDim
      clone.scale.set(normalizeScale, normalizeScale, normalizeScale)
    }

    // Add to scene
    this.scene.add(clone)

    // Calculate bounding box and fit camera
    const box = new THREE.Box3().setFromObject(clone)
    const center = box.getCenter(new THREE.Vector3())

    // Position asset bottom on ground
    const bottomY = box.min.y
    clone.position.y -= bottomY

    // Recalculate bounds after repositioning
    box.setFromObject(clone)
    box.getCenter(center)

    // Calculate camera distance
    const size = box.getSize(new THREE.Vector3())
    const frameDim = Math.max(size.x, size.y, size.z)
    const fov = this.camera.fov * (Math.PI / 180)
    const diagonalFactor = Math.sqrt(0.8*0.8 + 0.4*0.4 + 0.8*0.8)
    const baseDistance = (frameDim / 2) / Math.tan(fov / 2) * 1.35
    const distance = baseDistance / diagonalFactor
    this.camera.position.set(
      center.x + distance * 0.8,
      center.y + distance * 0.4,
      center.z + distance * 0.8
    )
    this.camera.lookAt(center)
    this.camera.updateProjectionMatrix()

    // Render
    this.renderer.render(this.scene, this.camera)

    // Get data URL asynchronously using toBlob() + FileReader
    // This moves PNG encoding off the main thread
    const dataUrl = await new Promise((resolve, reject) => {
      this.renderer.domElement.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Failed to create blob from canvas'))
          return
        }
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      }, 'image/png')
    })

    // Cleanup
    this.scene.remove(clone)
    this.disposeObject(clone)

    // Store in cache if libraryId provided
    if (libraryId) {
      if (this.cache.size >= THUMBNAIL_CACHE_MAX_SIZE) {
        const oldestKey = this.cache.keys().next().value
        this.cache.delete(oldestKey)
      }
      this.cache.set(libraryId, dataUrl)
    }

    return dataUrl
  }

  /**
   * Invalidate a cached thumbnail (call when asset is modified)
   * @param {string} libraryId - The library ID to invalidate
   */
  invalidate(libraryId) {
    this.cache.delete(libraryId)
  }

  /**
   * Clear the entire thumbnail cache
   */
  clearCache() {
    this.cache.clear()
  }

  /**
   * Clone an object without userData to avoid cyclic reference issues
   */
  cloneWithoutUserData(obj) {
    const clone = obj.clone(false) // shallow clone, no children
    clone.userData = {} // clear userData which may have cyclic refs

    // Deep-clone geometry and materials to avoid corrupting originals on dispose
    if (clone.geometry) {
      clone.geometry = clone.geometry.clone()
    }
    if (clone.material) {
      clone.material = Array.isArray(clone.material)
        ? clone.material.map(m => m.clone())
        : clone.material.clone()
    }

    // Recursively clone children
    for (const child of obj.children) {
      clone.add(this.cloneWithoutUserData(child))
    }

    return clone
  }

  /**
   * Recursively dispose of an object and its children
   */
  disposeObject(obj) {
    obj.traverse((child) => {
      if (child.geometry) {
        child.geometry.dispose()
      }
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose())
        } else {
          child.material.dispose()
        }
      }
    })
  }

  /**
   * Dispose of the renderer
   */
  dispose() {
    this.renderer.dispose()
  }
}

// Singleton instance
let thumbnailRenderer = null

export function getThumbnailRenderer() {
  if (!thumbnailRenderer) {
    thumbnailRenderer = new ThumbnailRenderer()
  }
  return thumbnailRenderer
}

export function generateThumbnail(asset, libraryId = null) {
  return getThumbnailRenderer().render(asset, libraryId)
}

/**
 * Generate thumbnail asynchronously (non-blocking).
 * Use this for background generation where UI responsiveness matters.
 * @param {THREE.Object3D} asset - The asset to render
 * @param {string} [libraryId] - Optional library ID for cache lookup
 * @returns {Promise<string>} Base64 data URL
 */
export async function generateThumbnailAsync(asset, libraryId = null) {
  return getThumbnailRenderer().renderAsync(asset, libraryId)
}

export function invalidateThumbnail(libraryId) {
  if (thumbnailRenderer) {
    thumbnailRenderer.invalidate(libraryId)
  }
}
