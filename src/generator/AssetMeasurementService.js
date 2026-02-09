/**
 * AssetMeasurementService - Measures actual bounding boxes of generated assets
 *
 * This service solves a key problem in scene generation: assets are placed based on
 * LLM-estimated sizes, not actual geometry. A "pond" might be a flat disc or a chunky blob,
 * and placement algorithms can't know without measuring.
 *
 * The service:
 * 1. Takes generated asset code
 * 2. Executes it in an isolated offscreen scene
 * 3. Computes the actual THREE.Box3 bounding box
 * 4. Returns precise dimensions for collision detection
 */

import * as THREE from 'three'

/**
 * Measurement result for an asset
 * @typedef {Object} AssetMeasurement
 * @property {number} width - X-axis extent in meters (at scale 1)
 * @property {number} depth - Z-axis extent in meters (at scale 1)
 * @property {number} height - Y-axis extent in meters (at scale 1)
 * @property {number} footprintArea - width × depth, for coverage calculations
 * @property {{x: number, y: number, z: number}} centerOffset - Distance from origin to geometric center
 * @property {{x: number, y: number, z: number}} min - Bounding box minimum
 * @property {{x: number, y: number, z: number}} max - Bounding box maximum
 */

export class AssetMeasurementService {
  constructor() {
    // Measurements cache: assetCode hash -> measurement
    this.cache = new Map()
  }

  /**
   * Measure the actual bounding box of an asset from its code.
   *
   * @param {string} assetCode - Generated asset code containing createAsset(THREE)
   * @param {Object} [options] - Options
   * @param {number} [options.scale=1] - Scale to apply when measuring
   * @returns {Promise<AssetMeasurement>} Measured dimensions
   */
  async measureAsset(assetCode, options = {}) {
    const { scale = 1 } = options

    // Check cache first (using code hash)
    const cacheKey = this.hashCode(assetCode)
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)
      // Scale cached measurements if requested scale differs
      if (scale !== 1) {
        return this.scaleMeasurement(cached, scale)
      }
      return cached
    }

    try {
      // Execute the asset code to get the THREE.Group
      const asset = await this.executeAssetCode(assetCode)

      // Measure at scale 1 for caching
      const measurement = this.measureObject(asset)

      // Cache the base measurement
      this.cache.set(cacheKey, measurement)

      // Clean up
      this.disposeObject(asset)

      // Return scaled measurement if needed
      if (scale !== 1) {
        return this.scaleMeasurement(measurement, scale)
      }

      return measurement
    } catch (error) {
      console.error('[AssetMeasurement] Failed to measure asset:', error.message)
      // Return a default 2×2×2 measurement on failure (matches universal baseline)
      return {
        width: 2,
        depth: 2,
        height: 2,
        footprintArea: 4,
        centerOffset: { x: 0, y: 1, z: 0 },
        min: { x: -1, y: 0, z: -1 },
        max: { x: 1, y: 2, z: 1 },
        error: error.message
      }
    }
  }

  /**
   * Measure an already-instantiated THREE.Object3D
   *
   * @param {THREE.Object3D} object - The object to measure
   * @returns {AssetMeasurement} Measured dimensions
   */
  measureObject(object) {
    // Reset transforms for accurate measurement
    const originalPosition = object.position.clone()
    const originalRotation = object.rotation.clone()
    const originalScale = object.scale.clone()

    object.position.set(0, 0, 0)
    object.rotation.set(0, 0, 0)
    object.scale.set(1, 1, 1)

    // Compute bounding box
    const box = new THREE.Box3().setFromObject(object)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())

    // Restore transforms
    object.position.copy(originalPosition)
    object.rotation.copy(originalRotation)
    object.scale.copy(originalScale)

    return {
      width: size.x,
      depth: size.z,
      height: size.y,
      footprintArea: size.x * size.z,
      centerOffset: { x: center.x, y: center.y, z: center.z },
      min: { x: box.min.x, y: box.min.y, z: box.min.z },
      max: { x: box.max.x, y: box.max.y, z: box.max.z }
    }
  }

  /**
   * Scale a measurement by a given factor
   *
   * @param {AssetMeasurement} measurement - Base measurement
   * @param {number} scale - Scale factor
   * @returns {AssetMeasurement} Scaled measurement
   */
  scaleMeasurement(measurement, scale) {
    return {
      width: measurement.width * scale,
      depth: measurement.depth * scale,
      height: measurement.height * scale,
      footprintArea: measurement.footprintArea * scale * scale,
      centerOffset: {
        x: measurement.centerOffset.x * scale,
        y: measurement.centerOffset.y * scale,
        z: measurement.centerOffset.z * scale
      },
      min: {
        x: measurement.min.x * scale,
        y: measurement.min.y * scale,
        z: measurement.min.z * scale
      },
      max: {
        x: measurement.max.x * scale,
        y: measurement.max.y * scale,
        z: measurement.max.z * scale
      }
    }
  }

  /**
   * Execute asset code and return the created asset.
   * Uses the same blob URL pattern as the main asset loading system.
   *
   * @param {string} code - Asset code with createAsset(THREE) export
   * @returns {Promise<THREE.Object3D>} The created asset
   */
  async executeAssetCode(code) {
    // Create blob URL for dynamic import
    const blob = new Blob([code], { type: 'application/javascript' })
    const blobUrl = URL.createObjectURL(blob)

    try {
      // Dynamic import
      const module = await import(/* @vite-ignore */ blobUrl)

      if (typeof module.createAsset !== 'function') {
        throw new Error('Asset code does not export createAsset function')
      }

      // Execute createAsset with THREE
      const asset = module.createAsset(THREE)

      if (!asset || !(asset instanceof THREE.Object3D)) {
        throw new Error('createAsset did not return a valid THREE.Object3D')
      }

      return asset
    } finally {
      URL.revokeObjectURL(blobUrl)
    }
  }

  /**
   * Simple hash for cache keys
   * @param {string} str - String to hash
   * @returns {string} Hash string
   */
  hashCode(str) {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32bit integer
    }
    return hash.toString(16)
  }

  /**
   * Recursively dispose of an object's geometry and materials
   * @param {THREE.Object3D} object - Object to dispose
   */
  disposeObject(object) {
    object.traverse((child) => {
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
   * Clear the measurement cache
   */
  clearCache() {
    this.cache.clear()
  }

  /**
   * Get cache statistics
   * @returns {{size: number}}
   */
  getCacheStats() {
    return { size: this.cache.size }
  }
}

// Singleton instance
let measurementService = null

/**
 * Get the singleton AssetMeasurementService instance
 * @returns {AssetMeasurementService}
 */
export function getAssetMeasurementService() {
  if (!measurementService) {
    measurementService = new AssetMeasurementService()
  }
  return measurementService
}

/**
 * Measure an asset from its code
 * @param {string} assetCode - Asset code
 * @param {Object} [options] - Options
 * @returns {Promise<AssetMeasurement>}
 */
export function measureAsset(assetCode, options = {}) {
  return getAssetMeasurementService().measureAsset(assetCode, options)
}

/**
 * Measure an already-instantiated THREE.Object3D
 * @param {THREE.Object3D} object - Object to measure
 * @returns {AssetMeasurement}
 */
export function measureObject(object) {
  return getAssetMeasurementService().measureObject(object)
}
