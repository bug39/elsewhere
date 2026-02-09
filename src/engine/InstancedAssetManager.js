import * as THREE from 'three'

/**
 * Manages instanced rendering for repeated assets.
 * When multiple copies of the same static asset are placed, this uses
 * THREE.InstancedMesh to render them in a single draw call.
 *
 * Eligibility criteria:
 * - 3+ instances of the same library asset
 * - Single-mesh asset (no complex hierarchy)
 * - No animation (userData.animate)
 * - Not an NPC (userData.isNPC)
 */

const MIN_INSTANCES_FOR_INSTANCING = 3
const MAX_INSTANCES_PER_MESH = 1000

/**
 * @typedef {Object} InstanceData
 * @property {string} instanceId - Unique instance ID
 * @property {THREE.Matrix4} matrix - Transform matrix
 * @property {THREE.Vector3} position - World position
 * @property {number} rotation - Y rotation in radians
 * @property {number} scale - Uniform scale
 */

/**
 * @typedef {Object} InstancedGroup
 * @property {string} libraryId - Library asset ID
 * @property {THREE.InstancedMesh} mesh - The instanced mesh
 * @property {THREE.BufferGeometry} geometry - Shared geometry
 * @property {THREE.Material} material - Shared material
 * @property {Map<string, number>} instanceIdToIndex - instanceId -> instance index
 * @property {InstanceData[]} instances - Instance data array
 * @property {number} count - Current instance count
 */

export class InstancedAssetManager {
  constructor() {
    /** @type {Map<string, InstancedGroup>} libraryId -> InstancedGroup */
    this.groups = new Map()

    /** @type {Set<string>} libraryIds that are not eligible for instancing */
    this.ineligible = new Set()

    /** @type {Map<string, string>} instanceId -> libraryId for quick lookup */
    this.instanceToLibrary = new Map()
  }

  /**
   * Check if an asset is eligible for instancing
   * @param {THREE.Object3D} asset - The asset to check
   * @param {Object} libraryAsset - Library asset data
   * @returns {boolean}
   */
  isEligibleForInstancing(asset, libraryAsset) {
    // Skip if marked as ineligible
    if (this.ineligible.has(libraryAsset.id)) {
      return false
    }

    // Must not be animated
    if (asset.userData?.animate) {
      this.ineligible.add(libraryAsset.id)
      return false
    }

    // Must not be a walking character / NPC
    if (libraryAsset.isWalkingCharacter) {
      this.ineligible.add(libraryAsset.id)
      return false
    }

    // Must be a simple single-mesh asset (or mesh with selection helper only)
    let meshCount = 0
    let singleMesh = null

    asset.traverse((child) => {
      if (child.isMesh && !child.name?.startsWith('__')) {
        meshCount++
        singleMesh = child
      }
    })

    // Only single-mesh assets are eligible
    if (meshCount !== 1) {
      this.ineligible.add(libraryAsset.id)
      return false
    }

    return true
  }

  /**
   * Check if we should create an instanced group for this library asset
   * @param {string} libraryId - Library asset ID
   * @param {number} instanceCount - Number of instances of this asset
   * @returns {boolean}
   */
  shouldInstance(libraryId, instanceCount) {
    if (this.ineligible.has(libraryId)) {
      return false
    }
    return instanceCount >= MIN_INSTANCES_FOR_INSTANCING
  }

  /**
   * Create an instanced group for a library asset
   * @param {string} libraryId - Library asset ID
   * @param {THREE.Object3D} templateAsset - Template asset to extract geometry/material from
   * @param {number} maxInstances - Maximum number of instances
   * @returns {InstancedGroup|null}
   */
  createGroup(libraryId, templateAsset, maxInstances = MAX_INSTANCES_PER_MESH) {
    // Find the single mesh in the template
    let sourceMesh = null
    templateAsset.traverse((child) => {
      if (child.isMesh && !child.name?.startsWith('__')) {
        sourceMesh = child
      }
    })

    if (!sourceMesh) {
      this.ineligible.add(libraryId)
      return null
    }

    // Clone geometry and material to avoid sharing issues
    const geometry = sourceMesh.geometry.clone()
    const material = sourceMesh.material.clone()

    // Create instanced mesh
    const instancedMesh = new THREE.InstancedMesh(geometry, material, maxInstances)
    instancedMesh.count = 0 // Start with 0 visible instances
    instancedMesh.castShadow = true
    instancedMesh.receiveShadow = true
    instancedMesh.frustumCulled = true

    // Store metadata
    instancedMesh.userData.isInstancedGroup = true
    instancedMesh.userData.libraryId = libraryId

    const group = {
      libraryId,
      mesh: instancedMesh,
      geometry,
      material,
      instanceIdToIndex: new Map(),
      instances: [],
      count: 0
    }

    this.groups.set(libraryId, group)
    return group
  }

  /**
   * Add an instance to the appropriate group
   * @param {string} libraryId - Library asset ID
   * @param {string} instanceId - Instance ID
   * @param {THREE.Vector3} position - World position
   * @param {number} rotation - Y rotation in radians
   * @param {number} scale - Uniform scale
   * @param {THREE.Vector3} centerOffset - Center offset from asset creation
   * @returns {boolean} True if added to instanced group
   */
  addInstance(libraryId, instanceId, position, rotation, scale, centerOffset = null) {
    const group = this.groups.get(libraryId)
    if (!group) return false

    // Check if already exists
    if (group.instanceIdToIndex.has(instanceId)) {
      // Update existing instance
      return this.updateInstance(instanceId, position, rotation, scale, centerOffset)
    }

    // Check capacity
    if (group.count >= MAX_INSTANCES_PER_MESH) {
      return false
    }

    // Create transform matrix
    const matrix = new THREE.Matrix4()
    const pos = new THREE.Vector3(position.x, position.y, position.z)

    // Apply center offset if provided
    if (centerOffset) {
      pos.x += centerOffset.x * scale
      pos.y += centerOffset.y * scale
      pos.z += centerOffset.z * scale
    }

    matrix.compose(
      pos,
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation),
      new THREE.Vector3(scale, scale, scale)
    )

    // Add to group
    const index = group.count
    group.instanceIdToIndex.set(instanceId, index)
    group.instances[index] = {
      instanceId,
      matrix,
      position: pos.clone(),
      rotation,
      scale
    }
    group.count++

    // Update instanced mesh
    group.mesh.setMatrixAt(index, matrix)
    group.mesh.count = group.count
    group.mesh.instanceMatrix.needsUpdate = true

    // Track instance -> library mapping
    this.instanceToLibrary.set(instanceId, libraryId)

    return true
  }

  /**
   * Update an existing instance's transform
   * @param {string} instanceId - Instance ID
   * @param {THREE.Vector3} position - New world position
   * @param {number} rotation - New Y rotation in radians
   * @param {number} scale - New uniform scale
   * @param {THREE.Vector3} centerOffset - Center offset from asset creation
   * @returns {boolean}
   */
  updateInstance(instanceId, position, rotation, scale, centerOffset = null) {
    const libraryId = this.instanceToLibrary.get(instanceId)
    if (!libraryId) return false

    const group = this.groups.get(libraryId)
    if (!group) return false

    const index = group.instanceIdToIndex.get(instanceId)
    if (index === undefined) return false

    // Create new transform matrix
    const matrix = new THREE.Matrix4()
    const pos = new THREE.Vector3(position.x, position.y, position.z)

    // Apply center offset if provided
    if (centerOffset) {
      pos.x += centerOffset.x * scale
      pos.y += centerOffset.y * scale
      pos.z += centerOffset.z * scale
    }

    matrix.compose(
      pos,
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation),
      new THREE.Vector3(scale, scale, scale)
    )

    // Update stored data
    group.instances[index] = {
      instanceId,
      matrix,
      position: pos.clone(),
      rotation,
      scale
    }

    // Update instanced mesh
    group.mesh.setMatrixAt(index, matrix)
    group.mesh.instanceMatrix.needsUpdate = true

    return true
  }

  /**
   * Remove an instance from its group
   * @param {string} instanceId - Instance ID to remove
   * @returns {boolean}
   */
  removeInstance(instanceId) {
    const libraryId = this.instanceToLibrary.get(instanceId)
    if (!libraryId) return false

    const group = this.groups.get(libraryId)
    if (!group) return false

    const index = group.instanceIdToIndex.get(instanceId)
    if (index === undefined) return false

    // If not the last instance, swap with the last one
    const lastIndex = group.count - 1
    if (index !== lastIndex) {
      const lastInstance = group.instances[lastIndex]

      // Move last instance to removed position
      group.mesh.setMatrixAt(index, lastInstance.matrix)
      group.instances[index] = lastInstance
      group.instanceIdToIndex.set(lastInstance.instanceId, index)
    }

    // Remove last slot
    group.instanceIdToIndex.delete(instanceId)
    group.instances.pop()
    group.count--
    group.mesh.count = group.count
    group.mesh.instanceMatrix.needsUpdate = true

    // Clean up mapping
    this.instanceToLibrary.delete(instanceId)

    return true
  }

  /**
   * Check if an instance is managed by this manager
   * @param {string} instanceId - Instance ID
   * @returns {boolean}
   */
  hasInstance(instanceId) {
    return this.instanceToLibrary.has(instanceId)
  }

  /**
   * Get the instanced mesh for a library asset
   * @param {string} libraryId - Library asset ID
   * @returns {THREE.InstancedMesh|null}
   */
  getInstancedMesh(libraryId) {
    const group = this.groups.get(libraryId)
    return group?.mesh || null
  }

  /**
   * Get instance count for a library asset
   * @param {string} libraryId - Library asset ID
   * @returns {number}
   */
  getInstanceCount(libraryId) {
    const group = this.groups.get(libraryId)
    return group?.count || 0
  }

  /**
   * Dispose of a specific group
   * @param {string} libraryId - Library asset ID
   */
  disposeGroup(libraryId) {
    const group = this.groups.get(libraryId)
    if (!group) return

    // Clean up mappings
    for (const instanceId of group.instanceIdToIndex.keys()) {
      this.instanceToLibrary.delete(instanceId)
    }

    // Dispose resources
    group.geometry.dispose()
    group.material.dispose()

    this.groups.delete(libraryId)
  }

  /**
   * Dispose of all groups and resources
   */
  dispose() {
    for (const libraryId of this.groups.keys()) {
      this.disposeGroup(libraryId)
    }
    this.groups.clear()
    this.ineligible.clear()
    this.instanceToLibrary.clear()
  }

  /**
   * Get all instanced meshes (for adding to scene)
   * @returns {THREE.InstancedMesh[]}
   */
  getAllMeshes() {
    return Array.from(this.groups.values()).map(g => g.mesh)
  }

  /**
   * Get stats for debugging
   * @returns {Object}
   */
  getStats() {
    const stats = {
      groupCount: this.groups.size,
      totalInstances: 0,
      ineligibleCount: this.ineligible.size,
      groups: []
    }

    for (const [libraryId, group] of this.groups) {
      stats.totalInstances += group.count
      stats.groups.push({
        libraryId,
        instanceCount: group.count
      })
    }

    return stats
  }
}
