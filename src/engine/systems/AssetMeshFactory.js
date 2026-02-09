/**
 * @fileoverview AssetMeshFactory - Creates Three.js meshes from generated asset code.
 * Handles code execution, caching, normalization, and part management.
 */

import * as THREE from 'three'
import { validateCodeSafety, executeWithTimeout } from '../../generator/CodeSandbox'
import { LRUCache } from '../shared/rendererUtils'

/**
 * Factory for creating Three.js meshes from generated asset code.
 */
export class AssetMeshFactory {
  /**
   * @param {Object} options - Factory options
   * @param {Function} [options.onAssetError] - Callback for asset loading errors
   */
  constructor(options = {}) {
    this.onAssetError = options.onAssetError || null

    // LRU cache for loaded asset modules (libraryId -> createAsset function)
    this.assetModules = new LRUCache(50)

    // Parts cache for performance (libraryId -> parts array)
    this._partsCache = new Map()

    // Pooled objects for performance (avoid per-call allocations)
    this._pooledBox = new THREE.Box3()
    this._pooledVec1 = new THREE.Vector3()
    this._pooledVec2 = new THREE.Vector3()
    this._pooledVec3 = new THREE.Vector3()
  }

  /**
   * Create a mesh from a library asset (synchronous, for cached assets).
   * @param {Object} libraryAsset - The library asset definition
   * @param {Object} [instance] - Optional instance data with partTweakOverrides
   * @returns {THREE.Object3D} The created mesh or placeholder
   */
  createAssetMesh(libraryAsset, instance = null) {
    if (!libraryAsset || !libraryAsset.generatedCode) {
      console.warn(`No code found for library asset ${libraryAsset?.id}`)
      return this.createPlaceholderMesh()
    }

    try {
      // Check if module is cached
      if (!this.assetModules.has(libraryAsset.id)) {
        // Security check
        const safetyResult = validateCodeSafety(libraryAsset.generatedCode)
        if (!safetyResult.valid) {
          console.warn(`Unsafe code in library asset ${libraryAsset.id}: ${safetyResult.error}`)
          return this.createPlaceholderMesh()
        }

        // Load module synchronously
        const cleanCode = libraryAsset.generatedCode.replace(/^\s*export\s+/, '')
        const wrappedCode = `
          return (function(THREE) {
            ${cleanCode}
            return createAsset;
          })
        `
        const createModule = new Function(wrappedCode)()
        const createAsset = createModule(THREE)
        this.assetModules.set(libraryAsset.id, createAsset)
      }

      const createAsset = this.assetModules.get(libraryAsset.id)
      const asset = createAsset(THREE)

      // Normalize to category-appropriate size (same as async path)
      const category = libraryAsset.category || 'props'
      this.normalizeAssetSize(asset, category)

      // Apply shadows
      asset.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true
          child.receiveShadow = true
        }
      })

      // Apply part tweaks
      if (libraryAsset.partTweaks?.length > 0) {
        this.applyPartTweaks(asset, libraryAsset.partTweaks)
      }
      if (instance?.partTweakOverrides?.length > 0) {
        this.applyPartTweaks(asset, instance.partTweakOverrides)
      }

      return this.wrapAssetInContainer(asset)
    } catch (err) {
      console.error(`Failed to create asset ${libraryAsset.id}:`, err)
      if (this.onAssetError) {
        this.onAssetError(libraryAsset.name || libraryAsset.id, err.message || 'Unknown error')
      }
      return this.createPlaceholderMesh()
    }
  }

  /**
   * Create a mesh from a library asset (async with timeout protection).
   * @param {Object} libraryAsset - The library asset definition
   * @param {Object} [instance] - Optional instance data with partTweakOverrides
   * @returns {Promise<THREE.Object3D>} The created mesh or placeholder
   */
  async createAssetMeshAsync(libraryAsset, instance = null) {
    if (!libraryAsset || !libraryAsset.generatedCode) {
      console.warn(`No code found for library asset ${libraryAsset?.id}`)
      return this.createPlaceholderMesh()
    }

    try {
      // Check if module is cached
      if (!this.assetModules.has(libraryAsset.id)) {
        const safetyResult = validateCodeSafety(libraryAsset.generatedCode)
        if (!safetyResult.valid) {
          console.warn(`Unsafe code in library asset ${libraryAsset.id}: ${safetyResult.error}`)
          return this.createPlaceholderMesh()
        }

        const cleanCode = libraryAsset.generatedCode.replace(/^\s*export\s+/, '')
        const wrappedCode = `
          return (function(THREE) {
            ${cleanCode}
            return createAsset;
          })
        `

        // Execute with timeout
        const createModule = await executeWithTimeout(() => {
          return new Function(wrappedCode)()
        })
        const createAsset = createModule(THREE)
        this.assetModules.set(libraryAsset.id, createAsset)
      }

      const createAsset = this.assetModules.get(libraryAsset.id)

      // Execute asset creation with timeout
      const asset = await executeWithTimeout(() => createAsset(THREE))

      // Normalize to category-appropriate size
      const category = libraryAsset.category || 'props'
      this.normalizeAssetSize(asset, category)

      // Apply shadows
      asset.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true
          child.receiveShadow = true
        }
      })

      // Apply part tweaks
      if (libraryAsset.partTweaks?.length > 0) {
        this.applyPartTweaks(asset, libraryAsset.partTweaks)
      }
      if (instance?.partTweakOverrides?.length > 0) {
        this.applyPartTweaks(asset, instance.partTweakOverrides)
      }

      return this.wrapAssetInContainer(asset)
    } catch (err) {
      console.error(`Failed to create asset ${libraryAsset.id}:`, err)
      if (this.onAssetError) {
        this.onAssetError(libraryAsset.name || libraryAsset.id, err.message || 'Unknown error')
      }
      return this.createPlaceholderMesh()
    }
  }

  /**
   * Wrap an asset in a container group with proper positioning.
   * @param {THREE.Object3D} asset - The raw asset
   * @returns {THREE.Group} Container with asset positioned correctly
   */
  wrapAssetInContainer(asset) {
    const container = new THREE.Group()
    container.add(asset)

    // Position so bottom is at y=0 (reuse pooled box)
    this._pooledBox.setFromObject(asset)
    const bottomY = this._pooledBox.min.y
    asset.position.y -= bottomY

    // Center on visual center for gizmo placement (reuse pooled box)
    this._pooledBox.setFromObject(asset)
    const center = this.computeVisualCenter(asset)
    const size = this._pooledBox.getSize(this._pooledVec3)

    container.userData.centerOffset = center.clone()
    container.userData.boundingRadius = Math.sqrt(size.x * size.x + size.y * size.y + size.z * size.z) / 2

    asset.position.sub(center)

    // Add invisible selection helper
    const helperGeo = new THREE.BoxGeometry(size.x, size.y, size.z)
    const helperMat = new THREE.MeshBasicMaterial({
      visible: false,
      transparent: true,
      opacity: 0
    })
    const selectionHelper = new THREE.Mesh(helperGeo, helperMat)
    selectionHelper.position.set(0, 0, 0)
    selectionHelper.name = '__selectionHelper__'
    selectionHelper.raycast = THREE.Mesh.prototype.raycast
    container.add(selectionHelper)

    // Cache references for O(1) access in animation loop (avoids per-frame find/getObjectByName)
    container.userData._cachedAsset = asset
    container.userData._cachedSelectionHelper = selectionHelper

    // Copy userData to container
    if (asset.userData.animate) {
      container.userData.animate = asset.userData.animate.bind(asset)
    }
    if (asset.userData.parts) {
      container.userData.parts = asset.userData.parts
    }

    return container
  }

  /**
   * Compute visual center using volume-weighted mesh centroids.
   * @param {THREE.Object3D} asset - The asset to analyze
   * @returns {THREE.Vector3} Volume-weighted visual center
   */
  computeVisualCenter(asset) {
    const meshData = []
    let totalWeight = 0

    // Use pooled objects for traverse to avoid per-mesh allocations
    asset.traverse(obj => {
      if (!obj.isMesh) return

      this._pooledBox.setFromObject(obj)
      const center = this._pooledBox.getCenter(this._pooledVec1).clone()  // Clone needed for storage
      const size = this._pooledBox.getSize(this._pooledVec2)

      // Use volume as weight; fallback to surface area for flat meshes
      let weight = size.x * size.y * size.z
      if (weight < 0.001) {
        weight = Math.max(size.x * size.y, size.y * size.z, size.x * size.z)
      }

      if (weight > 0) {
        meshData.push({ center, weight })
        totalWeight += weight
      }
    })

    // Fallback: bounding box center
    if (totalWeight === 0) {
      return this._pooledBox.setFromObject(asset).getCenter(new THREE.Vector3())
    }

    // Compute volume-weighted centroid
    const visualCenter = new THREE.Vector3()
    for (const { center, weight } of meshData) {
      visualCenter.addScaledVector(center, weight / totalWeight)
    }

    // Clamp to bounding box (reuse pooled box)
    this._pooledBox.setFromObject(asset)
    visualCenter.clamp(this._pooledBox.min, this._pooledBox.max)

    return visualCenter
  }

  /**
   * Normalize asset to universal baseline size.
   *
   * ALL assets are normalized to fit within a 2-unit bounding box (max dimension).
   * This provides a consistent baseline where:
   * - scale 1 = 2 meters max dimension
   * - scale 10 = 20 meters max dimension
   *
   * The judge-based evaluation system then visually assesses relative sizes
   * and suggests multiplier-based corrections during the refinement loop.
   *
   * Why universal normalization?
   * - Category baselines can't capture the vast range within categories (ant vs elephant)
   * - Users can generate anything imaginable, so hardcoded baselines always fail
   * - Visual feedback from the judge is more reliable than specification
   *
   * @param {THREE.Object3D} asset - The loaded asset
   * @param {string} category - Asset category (stored for metadata only)
   * @returns {THREE.Object3D} The normalized asset
   */
  normalizeAssetSize(asset, category) {
    // Universal normalization: all assets fit in ~2 unit bounding box
    const TARGET_SIZE = 2.0

    // Reuse pooled objects to avoid per-call allocations
    this._pooledBox.setFromObject(asset)
    const size = this._pooledBox.getSize(this._pooledVec1)
    const maxDim = Math.max(size.x, size.y, size.z)

    if (maxDim > 0.01) {
      const normalizationFactor = TARGET_SIZE / maxDim
      asset.scale.multiplyScalar(normalizationFactor)
    }

    // Store metadata for debugging and future reference (clone needed for storage)
    asset.userData.originalSize = size.clone()
    asset.userData.normalizedTo = TARGET_SIZE
    asset.userData.category = category
    asset.userData.normalizedBy = 'maxDimension'  // Always max dimension now

    // Diagnostic logging for scale chain debugging (reuse pooled objects)
    this._pooledBox.setFromObject(asset)
    const postSize = this._pooledBox.getSize(this._pooledVec2)
    console.log(`[AssetMeshFactory] Normalized: ${category}`)
    console.log(`[AssetMeshFactory]   Pre-norm:  ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)}`)
    console.log(`[AssetMeshFactory]   Strategy:  universal (all assets → ${TARGET_SIZE} units max)`)
    console.log(`[AssetMeshFactory]   Post-norm: ${postSize.x.toFixed(2)} × ${postSize.y.toFixed(2)} × ${postSize.z.toFixed(2)}`)

    return asset
  }

  /**
   * Create a placeholder mesh for failed assets.
   * @returns {THREE.Mesh} Red placeholder cube
   */
  createPlaceholderMesh() {
    const geo = new THREE.BoxGeometry(1, 2, 1)
    const mat = new THREE.MeshStandardMaterial({ color: 0xff6b6b })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
  }

  /**
   * Create a loading placeholder mesh.
   * @returns {THREE.Mesh} Gray translucent placeholder
   */
  createLoadingPlaceholderMesh() {
    const geo = new THREE.BoxGeometry(1, 2, 1)
    const mat = new THREE.MeshStandardMaterial({
      color: 0x888888,
      transparent: true,
      opacity: 0.5
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.castShadow = false
    mesh.receiveShadow = true
    mesh.userData.isLoadingPlaceholder = true
    return mesh
  }

  /**
   * Apply part tweaks to an asset.
   * @param {THREE.Object3D} asset - The asset to modify
   * @param {Array} tweaks - Array of part tweaks
   */
  applyPartTweaks(asset, tweaks) {
    if (!tweaks || tweaks.length === 0) return

    for (const tweak of tweaks) {
      const part = this.findPartByName(asset, tweak.name)
      if (!part) continue

      // Tweaks are OFFSETS from the original transform, not absolute values
      if (tweak.position) {
        // Add offset to current position
        part.position.x += tweak.position[0]
        part.position.y += tweak.position[1]
        part.position.z += tweak.position[2]
      }
      if (tweak.rotation) {
        // Add offset to current rotation (in radians)
        part.rotation.x += THREE.MathUtils.degToRad(tweak.rotation[0])
        part.rotation.y += THREE.MathUtils.degToRad(tweak.rotation[1])
        part.rotation.z += THREE.MathUtils.degToRad(tweak.rotation[2])
      }
      if (tweak.scale) {
        // Multiply scale factors with current scale
        part.scale.x *= tweak.scale[0]
        part.scale.y *= tweak.scale[1]
        part.scale.z *= tweak.scale[2]
      }

      // Apply pivot position override if specified
      // This adjusts where the animation pivot point is located
      if (tweak.pivotPosition && asset.userData?.parts) {
        // Find the pivot in userData.parts by matching the part name
        const pivotName = `${tweak.name}_pivot`
        const pivot = asset.userData.parts[pivotName] || asset.userData.parts[tweak.name]
        if (pivot && pivot.isObject3D) {
          // Store original pivot position for potential reset
          if (!pivot.userData._originalPivotPosition) {
            pivot.userData._originalPivotPosition = pivot.position.clone()
          }
          pivot.position.set(
            tweak.pivotPosition[0],
            tweak.pivotPosition[1],
            tweak.pivotPosition[2]
          )
        }
      }

      // Apply animation config to pivot for runtime use
      if (tweak.animConfig && asset.userData?.parts) {
        const pivotName = `${tweak.name}_pivot`
        const pivot = asset.userData.parts[pivotName] || asset.userData.parts[tweak.name]
        if (pivot && pivot.isObject3D) {
          pivot.userData.animConfig = { ...tweak.animConfig }
        }
      }
    }
  }

  /**
   * Collect selectable parts from an asset.
   * @param {THREE.Object3D} asset - The asset to analyze
   * @param {string|null} libraryId - Optional library ID for caching
   * @returns {Array} Array of selectable parts
   */
  collectSelectableParts(asset, libraryId = null) {
    if (libraryId && this._partsCache.has(libraryId)) {
      return this._partsCache.get(libraryId)
    }

    const parts = []
    const selectableObjects = new Set()
    const coveredMeshes = new Set()
    const userDataParts = new Set()
    const nameCounts = new Map()
    let unnamedIndex = 0

    const getDepth = (obj) => {
      let depth = 0
      let current = obj.parent
      while (current && current !== asset) {
        depth++
        current = current.parent
      }
      return depth
    }

    const addSelectable = (obj) => {
      selectableObjects.add(obj)
      obj.traverse((child) => {
        if (child.isMesh) coveredMeshes.add(child)
      })
    }

    const ensureUniqueName = (obj, type) => {
      const baseName = obj.name && obj.name.trim()
        ? obj.name.trim()
        : `${type}_${unnamedIndex++}`
      const seenCount = nameCounts.get(baseName) || 0
      const uniqueName = seenCount === 0 ? baseName : `${baseName}_${seenCount + 1}`
      nameCounts.set(baseName, seenCount + 1)
      if (obj.name !== uniqueName) {
        obj.name = uniqueName
      }
      return uniqueName
    }

    // Check userData.parts first
    if (asset.userData?.parts) {
      const animParts = asset.userData.parts
      for (const [key, value] of Object.entries(animParts)) {
        if (Array.isArray(value)) {
          value.forEach((obj, index) => {
            if (obj && obj.isObject3D) {
              if (!obj.name) obj.name = `${key}_${index}`
              userDataParts.add(obj)
              addSelectable(obj)
            }
          })
        } else if (value && value.isObject3D) {
          if (!value.name) value.name = key
          userDataParts.add(value)
          addSelectable(value)
        }
      }
    }

    // Find named groups and meshes
    asset.traverse((obj) => {
      if (obj === asset) return
      if (obj.name && !obj.name.startsWith('__')) {
        if (obj.isGroup || obj.isMesh) {
          let isCovered = false
          selectableObjects.forEach(sel => {
            sel.traverse(child => {
              if (child === obj) isCovered = true
            })
          })
          if (!isCovered) {
            addSelectable(obj)
          }
        }
      }
    })

    // Add to parts array
    selectableObjects.forEach((obj) => {
      const depth = getDepth(obj)
      const type = obj.isGroup ? 'group' : 'mesh'
      parts.push({
        object: obj,
        depth,
        type,
        displayName: ensureUniqueName(obj, type),
        fromUserData: userDataParts.has(obj)
      })
    })

    // Add orphan meshes
    asset.traverse((obj) => {
      if (obj.isMesh && !obj.name?.startsWith('__') && !coveredMeshes.has(obj)) {
        const depth = getDepth(obj)
        parts.push({
          object: obj,
          depth,
          type: 'mesh',
          displayName: ensureUniqueName(obj, 'mesh'),
          fromUserData: false
        })
      }
    })

    parts.sort((a, b) => a.depth - b.depth)

    if (libraryId) {
      this._partsCache.set(libraryId, parts)
    }

    return parts
  }

  /**
   * Find a part by name in an asset hierarchy.
   * @param {THREE.Object3D} asset - The asset to search
   * @param {string} name - The part name
   * @returns {THREE.Object3D|null} The found part or null
   */
  findPartByName(asset, name) {
    // Check userData.parts first
    if (asset.userData?.parts) {
      for (const [key, value] of Object.entries(asset.userData.parts)) {
        if (key === name && value && value.isObject3D) {
          return value
        }
        if (Array.isArray(value)) {
          for (let i = 0; i < value.length; i++) {
            const obj = value[i]
            if (obj && obj.isObject3D) {
              if (!obj.name) obj.name = `${key}_${i}`
              if (obj.name === name) return obj
            }
          }
        } else if (value && value.isObject3D) {
          if (!value.name) value.name = key
          if (value.name === name) return value
        }
      }
    }

    // Traverse hierarchy
    let found = null
    asset.traverse((obj) => {
      if (!found && obj.name === name) {
        found = obj
      }
    })
    return found
  }

  /**
   * Dispose of an object and its children.
   * @param {THREE.Object3D} obj - Object to dispose
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
   * Invalidate parts cache.
   * @param {string|null} libraryId - Specific ID or null for all
   */
  invalidatePartsCache(libraryId = null) {
    if (libraryId) {
      this._partsCache.delete(libraryId)
    } else {
      this._partsCache.clear()
    }
  }

  /**
   * Clear the module cache.
   * @param {string|null} libraryId - Specific ID or null for all
   */
  clearModuleCache(libraryId = null) {
    if (libraryId) {
      this.assetModules.delete(libraryId)
    } else {
      this.assetModules.clear()
    }
  }

  /**
   * Dispose of all resources.
   */
  dispose() {
    this.assetModules.clear()
    this._partsCache.clear()
  }
}
