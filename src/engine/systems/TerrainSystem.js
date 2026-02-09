/**
 * @fileoverview TerrainSystem - Manages terrain mesh creation and height queries.
 * Creates Minecraft-style stepped terrain with biome-based vertex colors.
 */

import * as THREE from 'three'
import { GRID_SIZE, TILE_SIZE } from '../../shared/constants'
import { BIOME_COLORS, SKY_COLORS, hashTerrain } from '../shared/rendererUtils'

/**
 * Manages terrain mesh creation, updates, and height queries.
 */
export class TerrainSystem {
  /**
   * @param {Object} shared - Shared renderer state
   * @param {THREE.Scene} shared.scene - The Three.js scene
   */
  constructor(shared) {
    this.shared = shared
    this.terrainMesh = null
    this.lastTerrainHash = null
    this.currentHeightmap = null
  }

  /**
   * Create or update terrain mesh from heightmap data.
   * Uses memoization via hash to skip redundant rebuilds.
   * @param {number[][]} heightmap - 2D array of height values
   * @param {string} biome - Biome identifier (grass, desert, snow, etc.)
   * @param {boolean} darkMode - Whether dark mode is active
   * @returns {boolean} True if terrain was updated, false if unchanged
   */
  updateTerrain(heightmap, biome, darkMode) {
    if (!heightmap) return false

    this.currentHeightmap = heightmap
    const terrainHash = hashTerrain(heightmap, biome)

    if (terrainHash === this.lastTerrainHash) {
      return false // No change
    }

    this.createTerrainMesh(heightmap, biome, darkMode)
    this.lastTerrainHash = terrainHash
    return true
  }

  /**
   * Create stepped terrain geometry (Minecraft-style).
   * @param {number[][]} heightmap - 2D array of height values
   * @param {string} biome - Biome identifier
   * @param {boolean} darkMode - Whether dark mode is active
   */
  createTerrainMesh(heightmap, biome, darkMode) {
    // Remove existing terrain
    if (this.terrainMesh) {
      this.shared.scene.remove(this.terrainMesh)
      this.terrainMesh.geometry.dispose()
      if (Array.isArray(this.terrainMesh.material)) {
        this.terrainMesh.material.forEach(m => m.dispose())
      } else {
        this.terrainMesh.material.dispose()
      }
    }

    const colors = BIOME_COLORS[biome] || BIOME_COLORS.grass

    // Update fog to match sky dome horizon (don't override to white)
    const skyColors = darkMode ? SKY_COLORS.dark : SKY_COLORS.light
    if (this.shared.scene.fog) {
      this.shared.scene.fog.color = new THREE.Color(skyColors.horizon)
    }

    // Create stepped terrain geometry
    const geometry = new THREE.BufferGeometry()
    const vertices = []
    const normals = []
    const uvs = []
    const indices = []
    const colorAttrib = []

    // For each tile, create a flat top and side walls if needed
    for (let z = 0; z < GRID_SIZE; z++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const height = (heightmap[z]?.[x] ?? 0) * 2 // Scale height
        const baseIdx = vertices.length / 3

        // World position
        const wx = x * TILE_SIZE
        const wz = z * TILE_SIZE

        // Color based on height
        let color
        if (height > 6) {
          color = new THREE.Color(colors.tertiary)
        } else if (height > 2) {
          color = new THREE.Color(colors.secondary)
        } else {
          color = new THREE.Color(colors.primary)
        }

        // Top face (quad = 2 triangles)
        vertices.push(
          wx, height, wz,
          wx + TILE_SIZE, height, wz,
          wx + TILE_SIZE, height, wz + TILE_SIZE,
          wx, height, wz + TILE_SIZE
        )
        normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0)
        uvs.push(0, 0, 1, 0, 1, 1, 0, 1)
        colorAttrib.push(
          color.r, color.g, color.b,
          color.r, color.g, color.b,
          color.r, color.g, color.b,
          color.r, color.g, color.b
        )
        // CCW winding for upward-facing normal
        indices.push(
          baseIdx, baseIdx + 2, baseIdx + 1,
          baseIdx, baseIdx + 3, baseIdx + 2
        )

        // Side faces (only if adjacent tile is lower)
        const addSideFace = (nx, nz, normalX, normalZ) => {
          const neighborHeight = (heightmap[nz]?.[nx] ?? 0) * 2
          if (neighborHeight >= height) return

          const sideBaseIdx = vertices.length / 3
          const sideColor = new THREE.Color(colors.secondary).multiplyScalar(0.92)

          // Determine which edge
          let v0, v1, v2, v3
          if (normalX === -1) { // Left edge
            v0 = [wx, neighborHeight, wz]
            v1 = [wx, height, wz]
            v2 = [wx, height, wz + TILE_SIZE]
            v3 = [wx, neighborHeight, wz + TILE_SIZE]
          } else if (normalX === 1) { // Right edge
            v0 = [wx + TILE_SIZE, neighborHeight, wz + TILE_SIZE]
            v1 = [wx + TILE_SIZE, height, wz + TILE_SIZE]
            v2 = [wx + TILE_SIZE, height, wz]
            v3 = [wx + TILE_SIZE, neighborHeight, wz]
          } else if (normalZ === -1) { // Front edge
            v0 = [wx + TILE_SIZE, neighborHeight, wz]
            v1 = [wx + TILE_SIZE, height, wz]
            v2 = [wx, height, wz]
            v3 = [wx, neighborHeight, wz]
          } else { // Back edge
            v0 = [wx, neighborHeight, wz + TILE_SIZE]
            v1 = [wx, height, wz + TILE_SIZE]
            v2 = [wx + TILE_SIZE, height, wz + TILE_SIZE]
            v3 = [wx + TILE_SIZE, neighborHeight, wz + TILE_SIZE]
          }

          vertices.push(...v0, ...v1, ...v2, ...v3)
          normals.push(
            normalX, 0, normalZ,
            normalX, 0, normalZ,
            normalX, 0, normalZ,
            normalX, 0, normalZ
          )
          uvs.push(0, 0, 0, 1, 1, 1, 1, 0)
          colorAttrib.push(
            sideColor.r, sideColor.g, sideColor.b,
            sideColor.r, sideColor.g, sideColor.b,
            sideColor.r, sideColor.g, sideColor.b,
            sideColor.r, sideColor.g, sideColor.b
          )
          indices.push(
            sideBaseIdx, sideBaseIdx + 1, sideBaseIdx + 2,
            sideBaseIdx, sideBaseIdx + 2, sideBaseIdx + 3
          )
        }

        // Check all 4 neighbors
        addSideFace(x - 1, z, -1, 0)
        addSideFace(x + 1, z, 1, 0)
        addSideFace(x, z - 1, 0, -1)
        addSideFace(x, z + 1, 0, 1)
      }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colorAttrib, 3))
    geometry.setIndex(indices)

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.6,
      metalness: 0.0,
      side: THREE.DoubleSide
    })

    this.terrainMesh = new THREE.Mesh(geometry, material)
    this.terrainMesh.castShadow = true
    this.terrainMesh.receiveShadow = true
    this.terrainMesh.name = 'terrain'
    this.shared.scene.add(this.terrainMesh)
  }

  /**
   * Get terrain height at a world position.
   * @param {number} x - World X position
   * @param {number} z - World Z position
   * @returns {number} Terrain height at this position (scaled by 2 like mesh creation)
   */
  getTerrainHeight(x, z) {
    if (!this.currentHeightmap) return 0

    // Convert world coordinates to tile indices
    const tileX = Math.floor(x / TILE_SIZE)
    const tileZ = Math.floor(z / TILE_SIZE)

    // Clamp to valid grid bounds
    if (tileX < 0 || tileX >= GRID_SIZE || tileZ < 0 || tileZ >= GRID_SIZE) {
      return 0
    }

    // Get height from heightmap and scale by 2 (matches createTerrainMesh)
    const height = this.currentHeightmap[tileZ]?.[tileX] ?? 0
    return height * 2
  }

  /**
   * Force terrain hash to be recalculated on next update.
   * Used after WebGL context loss recovery.
   */
  invalidateHash() {
    this.lastTerrainHash = null
  }

  /**
   * Dispose of terrain resources.
   */
  dispose() {
    if (this.terrainMesh) {
      this.shared.scene.remove(this.terrainMesh)
      this.terrainMesh.geometry.dispose()
      if (Array.isArray(this.terrainMesh.material)) {
        this.terrainMesh.material.forEach(m => m.dispose())
      } else {
        this.terrainMesh.material.dispose()
      }
      this.terrainMesh = null
    }
    this.lastTerrainHash = null
    this.currentHeightmap = null
  }
}
