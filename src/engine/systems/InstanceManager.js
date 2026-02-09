/**
 * @fileoverview InstanceManager - Manages placed asset instances in the scene.
 * Handles creation, updates, removal, and animation of instance meshes.
 */

import * as THREE from 'three'
import { normalizeRotation, normalizeScale } from '../../shared/transforms'
import { INSTANCE_SCALE } from '../../shared/constants'

/**
 * Manages placed asset instances and their meshes.
 */
export class InstanceManager {
  /**
   * @param {Object} shared - Shared renderer state
   * @param {THREE.Scene} shared.scene - The Three.js scene
   * @param {Object} deps - Dependencies
   * @param {Function} deps.getTerrainHeight - Function to get terrain height at (x, z)
   * @param {Object} deps.assetFactory - AssetMeshFactory instance
   * @param {Function} deps.onSelectionInvalidate - Callback when instance cache changes
   */
  constructor(shared, deps) {
    this.shared = shared
    this.deps = deps

    // Instance tracking
    this.instanceMeshes = new Map() // instanceId -> THREE.Object3D
    this.pendingMeshes = new Set() // instanceIds currently being created async

    // Data references
    this.currentLibrary = []
    this.currentPlacedAssets = []
    this.libraryMap = new Map() // id -> library asset
    this.instanceMap = new Map() // instanceId -> placed asset

    // Frustum culling pooled objects
    this._frustum = new THREE.Frustum()
    this._projScreenMatrix = new THREE.Matrix4()
    this._cullingSphere = new THREE.Sphere()

    // State
    this.isDisposed = false
    this.playMode = false
  }

  /**
   * Update world data and sync instances.
   * @param {Object} worldData - World data object
   * @param {Object} options - Update options
   * @param {boolean} options.isDragging - Whether a transform is in progress
   * @param {string|null} options.selectedInstance - Currently selected instance
   * @param {Object} options.transformControls - Transform controls reference
   * @param {Function} options.onDeleteHighlightClear - Callback to clear delete highlight
   * @param {Function} options.onPartSelectionClear - Callback to clear part selection
   */
  updateWorld(worldData, options = {}) {
    if (!worldData) return

    const {
      isDragging = false,
      selectedInstance = null,
      transformControls = null,
      onDeleteHighlightClear = null,
      onPartSelectionClear = null
    } = options

    // Update references
    this.currentLibrary = worldData.library || []
    this.currentPlacedAssets = worldData.placedAssets || []
    this.libraryMap = new Map(this.currentLibrary.map(a => [a.id, a]))
    this.instanceMap = new Map(this.currentPlacedAssets.map(a => [a.instanceId, a]))

    // Remove deleted instances
    const currentIds = new Set(this.currentPlacedAssets.map(a => a.instanceId))
    for (const [id, mesh] of this.instanceMeshes) {
      if (!currentIds.has(id)) {
        if (onDeleteHighlightClear) onDeleteHighlightClear(id)
        if (transformControls?.object === mesh) {
          transformControls.detach()
        }
        this.shared.scene.remove(mesh)
        this.deps.assetFactory.disposeObject(mesh)
        this.instanceMeshes.delete(id)
        this.deps.onSelectionInvalidate()
      }
    }

    // Add/update instances
    for (const instance of this.currentPlacedAssets) {
      let mesh = this.instanceMeshes.get(instance.instanceId)

      if (!mesh) {
        // Skip if async creation in progress
        if (this.pendingMeshes.has(instance.instanceId)) continue

        // Skip mesh replacement during drag of selected instance
        if (isDragging && selectedInstance === instance.instanceId) continue

        // Start async mesh creation
        this.createInstanceAsync(instance, {
          selectedInstance,
          transformControls,
          onDeleteHighlightClear,
          onPartSelectionClear
        })
        continue
      }

      // Update transform for existing mesh
      this.updateInstanceTransform(instance, mesh)

      // Re-attach gizmo if selected
      if (selectedInstance === instance.instanceId && transformControls?.object === mesh) {
        transformControls.detach()
        transformControls.attach(mesh)
      }
    }
  }

  /**
   * Create an instance mesh asynchronously.
   * @param {Object} instance - Instance data
   * @param {Object} options - Creation options
   */
  async createInstanceAsync(instance, options) {
    const {
      selectedInstance,
      transformControls,
      onDeleteHighlightClear,
      onPartSelectionClear
    } = options

    this.pendingMeshes.add(instance.instanceId)

    // Show loading placeholder immediately
    const placeholder = this.deps.assetFactory.createLoadingPlaceholderMesh()
    placeholder.userData.instanceId = instance.instanceId
    placeholder.userData.libraryId = instance.libraryId
    this.instanceMeshes.set(instance.instanceId, placeholder)
    this.deps.onSelectionInvalidate()
    this.shared.scene.add(placeholder)

    // Position placeholder
    const terrainHeight = this.deps.getTerrainHeight(instance.position[0], instance.position[2])
    placeholder.position.set(
      instance.position[0],
      instance.position[1] + terrainHeight,
      instance.position[2]
    )
    placeholder.rotation.y = normalizeRotation(instance.rotation, instance.instanceId)
    placeholder.scale.setScalar(normalizeScale(instance.scale, instance.instanceId))

    // C4 FIX: Use try/finally to ensure pendingMeshes is always cleaned up
    let realMesh = null
    try {
      // Create actual mesh
      const libraryAsset = this.libraryMap.get(instance.libraryId)
      realMesh = await this.deps.assetFactory.createAssetMeshAsync(libraryAsset, instance)
    } catch (err) {
      console.error(`[InstanceManager] Failed to create mesh for ${instance.instanceId}:`, err)
      // Clean up placeholder on error - leave placeholder visible as error indicator
      return
    } finally {
      // C4 FIX: Always remove from pending set, even on error
      this.pendingMeshes.delete(instance.instanceId)
    }

    // Check if disposed during async
    if (this.isDisposed) {
      this.deps.assetFactory.disposeObject(realMesh)
      return
    }

    // Check if instance still exists
    const currentPlaceholder = this.instanceMeshes.get(instance.instanceId)
    if (!currentPlaceholder) {
      this.deps.assetFactory.disposeObject(realMesh)
      return
    }

    // Clear highlights/selections for this instance
    if (onDeleteHighlightClear) onDeleteHighlightClear(instance.instanceId)
    if (onPartSelectionClear) onPartSelectionClear(instance.instanceId)

    // Replace placeholder with real mesh
    this.shared.scene.remove(currentPlaceholder)
    this.deps.assetFactory.disposeObject(currentPlaceholder)

    realMesh.userData.instanceId = instance.instanceId
    realMesh.userData.libraryId = instance.libraryId
    this.instanceMeshes.set(instance.instanceId, realMesh)
    this.shared.scene.add(realMesh)

    // Apply transform with centerOffset
    this.updateInstanceTransform(instance, realMesh)

    // Re-select if this was selected
    if (selectedInstance === instance.instanceId && transformControls) {
      transformControls.attach(realMesh)
    }
  }

  /**
   * Update an instance mesh's transform.
   * @param {Object} instance - Instance data
   * @param {THREE.Object3D} mesh - The mesh to update
   */
  updateInstanceTransform(instance, mesh) {
    const terrainHeight = this.deps.getTerrainHeight(instance.position[0], instance.position[2])
    const centerOffset = mesh.userData.centerOffset || new THREE.Vector3()
    const scale = normalizeScale(instance.scale, instance.instanceId)

    mesh.position.set(
      instance.position[0] + centerOffset.x * scale,
      instance.position[1] + terrainHeight + centerOffset.y * scale,
      instance.position[2] + centerOffset.z * scale
    )
    mesh.rotation.y = normalizeRotation(instance.rotation, instance.instanceId)
    mesh.scale.setScalar(scale)
  }

  /**
   * Get a mesh by instance ID.
   * @param {string} instanceId - Instance ID
   * @returns {THREE.Object3D|null} The mesh or null
   */
  getMesh(instanceId) {
    return this.instanceMeshes.get(instanceId) || null
  }

  /**
   * Get all instance meshes.
   * @returns {Map} Map of instanceId -> mesh
   */
  getAllMeshes() {
    return this.instanceMeshes
  }

  /**
   * Rebuild a specific instance mesh.
   * @param {string} instanceId - Instance to rebuild
   * @param {Object} transformControls - Transform controls reference
   */
  rebuildInstanceMesh(instanceId, transformControls) {
    const oldMesh = this.instanceMeshes.get(instanceId)
    if (!oldMesh) return

    const instance = this.instanceMap.get(instanceId)
    if (!instance) return

    // Store transforms
    const position = oldMesh.position.clone()
    const rotation = oldMesh.rotation.clone()
    const scale = oldMesh.scale.clone()

    // Remove old mesh
    this.shared.scene.remove(oldMesh)
    this.deps.assetFactory.disposeObject(oldMesh)

    // Create new mesh
    const libraryAsset = this.libraryMap.get(instance.libraryId)
    const newMesh = this.deps.assetFactory.createAssetMesh(libraryAsset, instance)
    newMesh.userData.instanceId = instance.instanceId
    newMesh.userData.libraryId = instance.libraryId

    // Restore transforms
    newMesh.position.copy(position)
    newMesh.rotation.copy(rotation)
    newMesh.scale.copy(scale)

    this.instanceMeshes.set(instanceId, newMesh)
    this.shared.scene.add(newMesh)

    if (transformControls?.object?.userData?.instanceId === instanceId) {
      transformControls.attach(newMesh)
    }
  }

  /**
   * Rebuild all instances using a specific library asset.
   * @param {string} libraryId - Library asset ID
   * @param {Array} [updatedLibrary] - Optional updated library
   * @param {Object} transformControls - Transform controls reference
   */
  rebuildInstancesByLibraryId(libraryId, updatedLibrary, transformControls) {
    if (updatedLibrary) {
      this.currentLibrary = updatedLibrary
      this.libraryMap = new Map(this.currentLibrary.map(asset => [asset.id, asset]))
    }

    // Clear cached module
    this.deps.assetFactory.clearModuleCache(libraryId)

    // Rebuild affected instances
    for (const [instanceId, mesh] of this.instanceMeshes) {
      if (mesh.userData?.libraryId === libraryId) {
        this.rebuildInstanceMesh(instanceId, transformControls)
      }
    }
  }

  /**
   * Animate visible instances (called from render loop).
   * @param {number} dt - Delta time
   * @param {THREE.PerspectiveCamera} camera - The camera for frustum culling
   */
  animateInstances(dt, camera) {
    // Update frustum
    this._projScreenMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    )
    this._frustum.setFromProjectionMatrix(this._projScreenMatrix)

    // Animate visible instances
    for (const [id, mesh] of this.instanceMeshes) {
      // Skip NPCs in play mode (NPCController handles them)
      if (this.playMode && mesh.userData?.isNPC) continue

      if (mesh.userData?.animate) {
        const radius = (mesh.userData.boundingRadius || 1) * mesh.scale.x
        this._cullingSphere.set(mesh.position, radius)

        if (this._frustum.intersectsSphere(this._cullingSphere)) {
          try {
            mesh.userData.animate.call(mesh, dt)

            // Sync selection helper with bob animation offset
            // Use cached references (set in AssetMeshFactory.wrapAssetInContainer)
            // to avoid per-frame find()/getObjectByName() allocations
            const asset = mesh.userData._cachedAsset
            if (asset?.userData?._animBobOffset !== undefined) {
              const helper = mesh.userData._cachedSelectionHelper
              if (helper) {
                helper.position.y = asset.userData._animBobOffset
              }
            }
          } catch (err) {
            console.error(`[thinq] Animate error for ${id}, disabling:`, err)
            mesh.userData.animate = null
          }
        }
      }
    }
  }

  /**
   * Set play mode state.
   * @param {boolean} enabled - Whether play mode is active
   */
  setPlayMode(enabled) {
    this.playMode = enabled
  }

  /**
   * Preview instance transform (for inspector live preview).
   * @param {string} instanceId - Instance to preview
   * @param {Object} updates - Transform updates
   * @param {Object} transformControls - Transform controls reference
   */
  previewInstanceTransform(instanceId, updates, transformControls) {
    const mesh = this.instanceMeshes.get(instanceId)
    if (!mesh) return

    if (updates.position) {
      mesh.position.set(updates.position[0], updates.position[1], updates.position[2])
    }
    if (updates.rotation !== undefined) {
      mesh.rotation.y = updates.rotation
    }
    if (updates.scale !== undefined) {
      // P2-T02 FIX: Clamp scale to valid range
      const clampedScale = Math.max(INSTANCE_SCALE.min, Math.min(INSTANCE_SCALE.max, updates.scale))
      mesh.scale.setScalar(clampedScale)
    }

    if (transformControls?.object === mesh) {
      transformControls.update()
    }
  }

  /**
   * Dispose of all instance resources.
   */
  dispose() {
    this.isDisposed = true

    for (const mesh of this.instanceMeshes.values()) {
      this.deps.assetFactory.disposeObject(mesh)
      this.shared.scene.remove(mesh)
    }
    this.instanceMeshes.clear()
    this.pendingMeshes.clear()
  }
}
