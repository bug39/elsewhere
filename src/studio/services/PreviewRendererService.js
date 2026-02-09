import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { PARTS_EDITOR_PIPELINE, applyRenderPipeline, addPipelineLights } from '../../shared/renderPipeline'

/**
 * Shared preview renderer service that pools WebGL contexts to reduce GPU memory usage.
 * Instead of each modal/preview creating its own renderer (50-200MB GPU each),
 * this service maintains a small pool of reusable renderers.
 */

const MAX_POOL_SIZE = 3 // Maximum concurrent preview renderers
const DEFAULT_BACKGROUND = 0xf5f5f5

/**
 * A single preview instance with scene, camera, renderer, and controls
 */
class PreviewInstance {
  constructor() {
    this.scene = null
    this.camera = null
    this.renderer = null
    this.orbitControls = null
    this.transformControls = null
    this.animationId = null
    this.container = null
    this.lastTime = performance.now()
    this.assetRef = null
    this.gridRef = null
    this.lightsRef = null
    this.onAnimate = null // Optional callback for animation
    this.isActive = false
  }

  /**
   * Initialize the preview instance
   * @param {HTMLElement} container - Container element to attach renderer
   * @param {Object} options - Configuration options
   * @param {boolean} options.withTransformControls - Whether to include TransformControls
   * @param {number} options.background - Background color (hex)
   * @param {Function} options.onAnimate - Optional animation callback (dt) => void
   */
  init(container, options = {}) {
    const {
      withTransformControls = false,
      background = DEFAULT_BACKGROUND,
      onAnimate = null
    } = options

    this.container = container
    this.onAnimate = onAnimate
    this.isActive = true
    // Reset lastTime to prevent dt spike on first frame after reuse
    this.lastTime = performance.now()

    const width = container.clientWidth || 400
    const height = container.clientHeight || 300

    // Scene
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(background)

    // Camera
    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100)
    this.camera.position.set(3, 2, 3)

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setSize(width, height)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    applyRenderPipeline(this.renderer, PARTS_EDITOR_PIPELINE)

    container.appendChild(this.renderer.domElement)

    // Orbit controls
    this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement)
    this.orbitControls.enableDamping = true
    this.orbitControls.dampingFactor = 0.1
    this.orbitControls.target.set(0, 0.5, 0)

    // Optional transform controls
    if (withTransformControls) {
      this.transformControls = new TransformControls(this.camera, this.renderer.domElement)
      this.transformControls.addEventListener('dragging-changed', (event) => {
        this.orbitControls.enabled = !event.value
      })
      this.scene.add(this.transformControls)
    }

    // Lighting
    this.lightsRef = addPipelineLights(this.scene, PARTS_EDITOR_PIPELINE)

    // Ground grid
    this.gridRef = new THREE.GridHelper(10, 20, 0x444444, 0x333333)
    this.gridRef.position.y = -0.01
    this.scene.add(this.gridRef)

    // Start animation loop
    this.animate()

    return this
  }

  /**
   * Animation loop
   */
  animate() {
    if (!this.isActive) return

    this.animationId = requestAnimationFrame(() => this.animate())

    const now = performance.now()
    const dt = (now - this.lastTime) / 1000
    this.lastTime = now

    // Call custom animation callback
    if (this.onAnimate) {
      this.onAnimate(dt)
    }

    // Animate asset if it has an animate function
    if (this.assetRef?.userData?.animate) {
      try {
        this.assetRef.userData.animate.call(this.assetRef, dt)
      } catch (err) {
        // Disable broken animate functions
        this.assetRef.userData.animate = null
      }
    }

    this.orbitControls.update()
    this.renderer.render(this.scene, this.camera)
  }

  /**
   * Add an asset to the preview scene
   * @param {THREE.Object3D} asset - The asset to add
   * @param {Object} options - Options
   * @param {boolean} options.centerOnGround - Position asset with bottom at y=0
   * @param {boolean} options.fitCamera - Adjust camera to fit the asset
   */
  addAsset(asset, options = {}) {
    const { centerOnGround = true, fitCamera = true } = options

    // Remove previous asset
    this.clearAsset()

    if (centerOnGround) {
      const box = new THREE.Box3().setFromObject(asset)
      const bottomY = box.min.y
      asset.position.y -= bottomY
    }

    this.scene.add(asset)
    this.assetRef = asset

    if (fitCamera) {
      const box = new THREE.Box3().setFromObject(asset)
      const center = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z)

      this.camera.position.set(
        center.x + maxDim * 1.5,
        center.y + maxDim,
        center.z + maxDim * 1.5
      )
      this.orbitControls.target.copy(center)
      this.orbitControls.update()
    }

    return asset
  }

  /**
   * Clear the current asset from the scene
   */
  clearAsset() {
    if (this.assetRef) {
      this.scene.remove(this.assetRef)
      this.disposeObject(this.assetRef)
      this.assetRef = null
    }
  }

  /**
   * Update renderer size when container resizes
   */
  handleResize() {
    if (!this.container || !this.renderer || !this.camera) return

    const width = this.container.clientWidth
    const height = this.container.clientHeight

    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }

  /**
   * Get the TransformControls (if enabled)
   */
  getTransformControls() {
    return this.transformControls
  }

  /**
   * Attach transform controls to an object
   */
  attachTransformControls(object) {
    if (this.transformControls) {
      this.transformControls.attach(object)
    }
  }

  /**
   * Detach transform controls
   */
  detachTransformControls() {
    if (this.transformControls) {
      this.transformControls.detach()
    }
  }

  /**
   * Dispose of a THREE.Object3D and its resources
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
   * Clean up and release resources
   * @param {boolean} fullDispose - If true, dispose renderer (for pool removal)
   */
  release(fullDispose = false) {
    this.isActive = false

    if (this.animationId) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }

    // Clear asset
    this.clearAsset()

    // Remove DOM element
    if (this.container && this.renderer?.domElement?.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement)
    }

    this.container = null
    this.onAnimate = null

    if (fullDispose) {
      // Full cleanup for pool removal
      if (this.transformControls) {
        this.scene.remove(this.transformControls)
        this.transformControls.dispose()
        this.transformControls = null
      }

      if (this.orbitControls) {
        this.orbitControls.dispose()
        this.orbitControls = null
      }

      if (this.gridRef) {
        this.scene.remove(this.gridRef)
        this.gridRef.geometry?.dispose()
        this.gridRef.material?.dispose()
        this.gridRef = null
      }

      // Dispose lights
      if (this.lightsRef) {
        Object.values(this.lightsRef).forEach(light => {
          if (light) {
            this.scene.remove(light)
            light.dispose?.()
          }
        })
        this.lightsRef = null
      }

      if (this.renderer) {
        this.renderer.dispose()
        this.renderer = null
      }

      this.scene = null
      this.camera = null
    }
  }
}

/**
 * Singleton service for managing preview renderers
 */
class PreviewRendererServiceClass {
  constructor() {
    this.pool = [] // Available (released) instances
    this.active = new Set() // Currently in-use instances
  }

  /**
   * Acquire a preview renderer instance
   * @param {HTMLElement} container - Container to attach renderer to
   * @param {Object} options - Configuration options
   * @returns {PreviewInstance}
   */
  acquire(container, options = {}) {
    let instance

    // Try to reuse a pooled instance
    if (this.pool.length > 0) {
      instance = this.pool.pop()
    } else {
      // Create new instance (always allowed for now, pool just for reuse)
      instance = new PreviewInstance()
    }

    instance.init(container, options)
    this.active.add(instance)

    return instance
  }

  /**
   * Release a preview renderer back to the pool
   * @param {PreviewInstance} instance - The instance to release
   */
  release(instance) {
    if (!instance) return

    this.active.delete(instance)

    // Clean up but don't dispose renderer (keep for reuse)
    instance.release(false)

    // Add to pool if under limit, otherwise fully dispose
    if (this.pool.length < MAX_POOL_SIZE) {
      this.pool.push(instance)
    } else {
      instance.release(true)
    }
  }

  /**
   * Get current stats for debugging
   */
  getStats() {
    return {
      poolSize: this.pool.length,
      activeCount: this.active.size,
      maxPoolSize: MAX_POOL_SIZE
    }
  }

  /**
   * Dispose all instances (call on app shutdown)
   */
  disposeAll() {
    for (const instance of this.active) {
      instance.release(true)
    }
    this.active.clear()

    for (const instance of this.pool) {
      instance.release(true)
    }
    this.pool = []
  }
}

// Singleton export
export const PreviewRendererService = new PreviewRendererServiceClass()

// Also export the class for testing
export { PreviewInstance }
