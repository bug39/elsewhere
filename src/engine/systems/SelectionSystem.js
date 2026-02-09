/**
 * @fileoverview SelectionSystem - Manages raycasting, selection state, and highlights.
 * Handles instance picking, part selection, and delete hover highlighting.
 */

import * as THREE from 'three'
import { GRID_SIZE, TILE_SIZE, WORLD_SIZE } from '../../shared/constants'

/**
 * Manages selection state and raycasting for instances and terrain.
 */
export class SelectionSystem {
  /**
   * @param {Object} shared - Shared renderer state
   * @param {THREE.Scene} shared.scene - The Three.js scene
   * @param {THREE.PerspectiveCamera} shared.camera - The main camera
   * @param {THREE.WebGLRenderer} shared.renderer - The WebGL renderer
   * @param {Object} deps - Dependencies
   * @param {Function} deps.getInstanceMeshes - Returns Map of instanceId -> mesh
   * @param {Function} deps.getTerrainMesh - Returns terrain mesh
   */
  constructor(shared, deps) {
    this.shared = shared
    this.deps = deps

    // Current selection
    this.selectedInstance = null
    this.selectedPart = null

    // Selection cycling state (for crowded scenes)
    this._lastHitStack = []
    this._lastHitIndex = 0
    this._lastHitTime = 0
    this._lastHitScreenPos = null

    // Part highlighting
    this.highlightedParts = []

    // Delete hover highlighting
    this.deleteHighlight = null

    // Pooled raycasting objects
    this._raycaster = new THREE.Raycaster()
    this._mouseVec = new THREE.Vector2()
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    this._intersectionVec = new THREE.Vector3()

    // Cached selection helpers
    this._selectionHelpers = []
    this._selectionHelpersDirty = true

    // Cached bounding rect
    this._cachedRect = null
    this._cachedRectDirty = true
  }

  /**
   * Invalidate cached selection helpers.
   */
  invalidateCache() {
    this._selectionHelpersDirty = true
  }

  /**
   * Invalidate cached bounding rect.
   */
  invalidateRect() {
    this._cachedRectDirty = true
  }

  /**
   * Raycast to find instances or terrain at screen coordinates.
   * @param {number} x - Screen X coordinate
   * @param {number} y - Screen Y coordinate
   * @returns {Object|null} Hit result or null
   */
  raycast(x, y) {
    // Update cached bounding rect
    if (this._cachedRectDirty || !this._cachedRect) {
      this._cachedRect = this.shared.renderer.domElement.getBoundingClientRect()
      this._cachedRectDirty = false
    }
    const rect = this._cachedRect

    this._mouseVec.set(
      ((x - rect.left) / rect.width) * 2 - 1,
      -((y - rect.top) / rect.height) * 2 + 1
    )

    this._raycaster.setFromCamera(this._mouseVec, this.shared.camera)

    // Update selection helpers cache
    if (this._selectionHelpersDirty) {
      this._selectionHelpers = []
      const instanceMeshes = this.deps.getInstanceMeshes()
      for (const mesh of instanceMeshes.values()) {
        const helper = mesh.children?.find(c => c.name === '__selectionHelper__')
        if (helper) {
          this._selectionHelpers.push(helper)
        }
      }
      this._selectionHelpersDirty = false
    }

    // Raycast against selection helpers
    const instanceHits = this._raycaster.intersectObjects(this._selectionHelpers, false)

    if (instanceHits.length > 0) {
      const allHits = []
      for (const hit of instanceHits) {
        const instanceId = hit.object.parent?.userData?.instanceId
        if (instanceId && !allHits.find(h => h.instanceId === instanceId)) {
          allHits.push({ instanceId, point: hit.point, distance: hit.distance })
        }
      }

      if (allHits.length > 0) {
        const now = performance.now()
        const screenPos = { x, y }

        // Check for cycle click
        const isCycleClick = this._lastHitScreenPos &&
          Math.abs(screenPos.x - this._lastHitScreenPos.x) < 5 &&
          Math.abs(screenPos.y - this._lastHitScreenPos.y) < 5 &&
          (now - this._lastHitTime) < 500 &&
          this._lastHitStack.length > 1

        if (isCycleClick) {
          // L1 FIX: Ensure index is valid if hit count changed
          this._lastHitIndex = (this._lastHitIndex + 1) % this._lastHitStack.length
        } else {
          this._lastHitStack = allHits.map(h => h.instanceId)
          // L1 FIX: Reset index when creating new hit stack
          this._lastHitIndex = 0
        }

        this._lastHitTime = now
        this._lastHitScreenPos = screenPos

        const selectedId = this._lastHitStack[this._lastHitIndex]
        const selectedHit = allHits.find(h => h.instanceId === selectedId) || allHits[0]

        return {
          type: 'instance',
          instanceId: selectedHit.instanceId,
          point: selectedHit.point,
          cycleInfo: allHits.length > 1 ? {
            current: this._lastHitIndex + 1,
            total: this._lastHitStack.length
          } : null,
          allHits
        }
      }
    }

    // Reset cycling when clicking non-instance
    this._lastHitStack = []
    this._lastHitIndex = 0
    this._lastHitScreenPos = null

    // Check terrain
    const terrainMesh = this.deps.getTerrainMesh()
    if (terrainMesh) {
      const terrainHits = this._raycaster.intersectObject(terrainMesh)
      if (terrainHits.length > 0) {
        const point = terrainHits[0].point
        const tileX = Math.floor(point.x / TILE_SIZE)
        const tileZ = Math.floor(point.z / TILE_SIZE)
        const clampedTileX = Math.max(0, Math.min(GRID_SIZE - 1, tileX))
        const clampedTileZ = Math.max(0, Math.min(GRID_SIZE - 1, tileZ))
        return { type: 'terrain', tileX: clampedTileX, tileZ: clampedTileZ, point }
      }
    }

    return null
  }

  /**
   * Get world position from screen coordinates.
   * @param {number} x - Screen X coordinate
   * @param {number} y - Screen Y coordinate
   * @returns {number[]|null} [x, y, z] or null
   */
  getWorldPosition(x, y) {
    const hit = this.raycast(x, y)
    return this.getWorldPositionFromHit(hit)
  }

  /**
   * Get world position from a raycast hit.
   * @param {Object|null} hit - Raycast hit result
   * @returns {number[]|null} [x, y, z] snapped to grid, or null
   */
  getWorldPositionFromHit(hit) {
    if (hit && hit.point) {
      const snappedX = Math.floor(hit.point.x / TILE_SIZE) * TILE_SIZE + TILE_SIZE / 2
      const snappedZ = Math.floor(hit.point.z / TILE_SIZE) * TILE_SIZE + TILE_SIZE / 2
      return [snappedX, hit.point.y, snappedZ]
    }

    // Fallback: ground plane
    if (this._raycaster.ray.intersectPlane(this._groundPlane, this._intersectionVec)) {
      if (this._intersectionVec.x >= 0 && this._intersectionVec.x <= WORLD_SIZE &&
          this._intersectionVec.z >= 0 && this._intersectionVec.z <= WORLD_SIZE) {
        const snappedX = Math.floor(this._intersectionVec.x / TILE_SIZE) * TILE_SIZE + TILE_SIZE / 2
        const snappedZ = Math.floor(this._intersectionVec.z / TILE_SIZE) * TILE_SIZE + TILE_SIZE / 2
        return [snappedX, 0, snappedZ]
      }
    }

    return null
  }

  /**
   * Select an instance.
   * @param {string|null} instanceId - Instance to select
   */
  select(instanceId) {
    this.selectedInstance = instanceId
  }

  /**
   * Clear instance selection.
   */
  clearSelection() {
    this.selectedInstance = null
  }

  /**
   * Raycast to find a part within an instance.
   * @param {number} x - Screen X coordinate
   * @param {number} y - Screen Y coordinate
   * @param {string} instanceId - Instance to search within
   * @param {Function} collectParts - Function to collect selectable parts
   * @returns {Object|null} Part hit result
   */
  raycastPart(x, y, instanceId, collectParts) {
    const instanceMeshes = this.deps.getInstanceMeshes()
    const mesh = instanceMeshes.get(instanceId)
    if (!mesh) return null

    const rect = this.shared.renderer.domElement.getBoundingClientRect()
    this._mouseVec.set(
      ((x - rect.left) / rect.width) * 2 - 1,
      -((y - rect.top) / rect.height) * 2 + 1
    )

    this._raycaster.setFromCamera(this._mouseVec, this.shared.camera)

    // Get all meshes in instance
    const meshes = []
    mesh.traverse((child) => {
      if (child.isMesh && !child.name?.startsWith('__')) meshes.push(child)
    })

    const intersects = this._raycaster.intersectObjects(meshes, false)
    if (intersects.length === 0) return null

    // M7 FIX: Check mesh.children exists before accessing index
    const asset = mesh.children?.[0]
    if (!asset) return null

    const hitMesh = intersects[0].object
    const libraryId = mesh.userData?.libraryId || null
    const parts = collectParts(asset, libraryId)

    // Check if mesh itself is selectable
    let directPart = parts.find(p => p.object === hitMesh)
    if (directPart) {
      return { partName: directPart.displayName, object: directPart.object, point: intersects[0].point }
    }

    // Walk up to find containing group
    let current = hitMesh.parent
    while (current && current !== asset) {
      const partEntry = parts.find(p => p.object === current)
      if (partEntry) {
        return { partName: partEntry.displayName, object: partEntry.object, point: intersects[0].point }
      }
      current = current.parent
    }

    return null
  }

  /**
   * Select and highlight a part.
   * @param {string} instanceId - Instance containing the part
   * @param {string} partName - Name of the part
   * @param {Function} findPart - Function to find part by name
   */
  selectPart(instanceId, partName, findPart) {
    this.clearPartSelection()

    const instanceMeshes = this.deps.getInstanceMeshes()
    const mesh = instanceMeshes.get(instanceId)
    if (!mesh) return

    const asset = mesh.children[0]
    if (!asset) return

    const part = findPart(asset, partName)
    if (!part) return

    this.selectedPart = { instanceId, partName, object: part }

    // Highlight the part
    part.traverse((child) => {
      if (child.isMesh && child.material && !Array.isArray(child.material)) {
        const originalMat = child.material
        const highlightMat = originalMat.clone()
        if (highlightMat.emissive) {
          highlightMat.emissive.set(0xff8844)
        }
        child.material = highlightMat

        this.highlightedParts.push({
          mesh: child,
          originalMaterial: originalMat,
          highlightMaterial: highlightMat
        })
      }
    })
  }

  /**
   * Clear part selection and restore materials.
   */
  clearPartSelection() {
    if (this.highlightedParts.length === 0 && this.selectedPart === null) {
      return
    }

    for (const entry of this.highlightedParts) {
      if (entry.mesh && entry.originalMaterial) {
        entry.mesh.material = entry.originalMaterial
        if (entry.highlightMaterial) {
          entry.highlightMaterial.dispose()
        }
      }
    }
    this.highlightedParts = []
    this.selectedPart = null
  }

  /**
   * Highlight an instance for deletion.
   * @param {string} instanceId - Instance to highlight
   */
  highlightInstanceForDeletion(instanceId) {
    this.unhighlightInstance()

    const instanceMeshes = this.deps.getInstanceMeshes()
    const mesh = instanceMeshes.get(instanceId)
    if (!mesh) return

    this.deleteHighlight = { instanceId, originalEmissives: new Map() }

    mesh.traverse((child) => {
      if (child.isMesh && child.material && !Array.isArray(child.material)) {
        if (child.material.emissive) {
          if (!this.deleteHighlight.originalEmissives.has(child.material.uuid)) {
            this.deleteHighlight.originalEmissives.set(
              child.material.uuid,
              child.material.emissive.clone()
            )
          }
          child.material.emissive.set(0x880000)
        }
      }
    })
  }

  /**
   * Remove delete highlighting.
   */
  unhighlightInstance() {
    if (!this.deleteHighlight) return

    const instanceMeshes = this.deps.getInstanceMeshes()
    const mesh = instanceMeshes.get(this.deleteHighlight.instanceId)
    if (mesh) {
      mesh.traverse((child) => {
        if (child.isMesh && child.material?.emissive) {
          const original = this.deleteHighlight.originalEmissives.get(child.material.uuid)
          if (original) {
            child.material.emissive.copy(original)
          } else {
            child.material.emissive.set(0x000000)
          }
        }
      })
    }

    this.deleteHighlight = null
  }

  /**
   * Dispose of selection system resources.
   */
  dispose() {
    this.clearPartSelection()
    this.unhighlightInstance()
    this._selectionHelpers = []
    this._cachedRect = null
  }
}
