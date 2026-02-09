/**
 * Terrain modification and placement rebalancing
 *
 * Provides terrain heightmap manipulation and post-processing
 * to ensure even distribution across the scene zone.
 */

import { GRID_SIZE, TILE_SIZE, SCENE_GENERATION } from '../../shared/constants'
import { parseSemanticLocation } from './semanticLocation'
import { poissonDiskSampling } from './samplingAlgorithms'

/**
 * Apply terrain modifications to heightmap based on zone and action
 *
 * @param {number[][]} heightmap - Current heightmap (modified in place)
 * @param {Object} modification - {zone, action, amount}
 * @returns {Array<{x, z, oldValue, newValue}>} Changes for undo
 */
export function applyTerrainModification(heightmap, modification) {
  const { zone, action, amount = 2 } = modification
  const bounds = parseSemanticLocation(zone || 'center')
  const changes = []

  // Convert world coords to grid coords
  const minGX = Math.floor(bounds.minX / TILE_SIZE)
  const maxGX = Math.ceil(bounds.maxX / TILE_SIZE)
  const minGZ = Math.floor(bounds.minZ / TILE_SIZE)
  const maxGZ = Math.ceil(bounds.maxZ / TILE_SIZE)

  for (let gz = minGZ; gz <= maxGZ && gz < GRID_SIZE; gz++) {
    for (let gx = minGX; gx <= maxGX && gx < GRID_SIZE; gx++) {
      if (gx < 0 || gz < 0) continue

      const oldValue = heightmap[gz][gx]
      let newValue = oldValue

      switch (action) {
        case 'raise':
          newValue = oldValue + amount
          break
        case 'lower':
          newValue = Math.max(0, oldValue - amount)
          break
        case 'flatten':
          newValue = 0
          break
        case 'smooth':
          // Average with neighbors
          let sum = oldValue
          let count = 1
          if (gz > 0) { sum += heightmap[gz-1][gx]; count++ }
          if (gz < GRID_SIZE - 1) { sum += heightmap[gz+1][gx]; count++ }
          if (gx > 0) { sum += heightmap[gz][gx-1]; count++ }
          if (gx < GRID_SIZE - 1) { sum += heightmap[gz][gx+1]; count++ }
          newValue = sum / count
          break
      }

      if (newValue !== oldValue) {
        changes.push({ x: gx, z: gz, oldValue, newValue })
        heightmap[gz][gx] = newValue
      }
    }
  }

  return changes
}

/**
 * Rebalance placements to ensure even distribution across the scene.
 * Moves assets from crowded cells to sparse cells using Poisson sampling.
 *
 * Uses a 3×3 grid over the scene zone:
 * - maxPerCell: Maximum assets allowed in any cell before redistribution
 * - Sparse cells (0 assets) are filled by relocating excess from crowded cells
 *
 * @param {Array<{x: number, z: number, ...}>} placements - Current placements
 * @param {number} [maxPerCell=6] - Maximum assets per cell before considered crowded
 * @param {number} [minDistance=3] - Minimum distance for relocated assets
 * @returns {{
 *   placements: Array,
 *   moved: number,
 *   cellBefore: number[],
 *   cellAfter: number[]
 * }} Rebalanced placements and diagnostics
 */
export function rebalancePlacements(placements, maxPerCell = 6, minDistance = 3) {
  if (!placements || placements.length === 0) {
    return { placements: [], moved: 0, cellBefore: [], cellAfter: [] }
  }

  const cellSize = SCENE_GENERATION.SIZE / 3  // ~127m cells for 380m zone
  const cells = []
  const cellBounds = []

  // Initialize 3×3 grid of cells
  for (let cz = 0; cz < 3; cz++) {
    for (let cx = 0; cx < 3; cx++) {
      const idx = cz * 3 + cx
      cells[idx] = []
      cellBounds[idx] = {
        minX: SCENE_GENERATION.MIN_X + cx * cellSize,
        maxX: SCENE_GENERATION.MIN_X + (cx + 1) * cellSize,
        minZ: SCENE_GENERATION.MIN_Z + cz * cellSize,
        maxZ: SCENE_GENERATION.MIN_Z + (cz + 1) * cellSize,
        center: {
          x: SCENE_GENERATION.MIN_X + (cx + 0.5) * cellSize,
          z: SCENE_GENERATION.MIN_Z + (cz + 0.5) * cellSize
        }
      }
    }
  }

  // Assign placements to cells
  const result = [...placements]
  for (let i = 0; i < result.length; i++) {
    const p = result[i]
    const cx = Math.min(2, Math.max(0, Math.floor((p.x - SCENE_GENERATION.MIN_X) / cellSize)))
    const cz = Math.min(2, Math.max(0, Math.floor((p.z - SCENE_GENERATION.MIN_Z) / cellSize)))
    cells[cz * 3 + cx].push(i)
  }

  const cellBefore = cells.map(c => c.length)

  // Find sparse and crowded cells
  const sparseCells = []
  const crowdedCells = []

  for (let i = 0; i < 9; i++) {
    if (cells[i].length === 0) {
      sparseCells.push(i)
    } else if (cells[i].length > maxPerCell) {
      crowdedCells.push(i)
    }
  }

  let moved = 0

  // Move excess assets from crowded to sparse cells
  for (const crowdedIdx of crowdedCells) {
    while (cells[crowdedIdx].length > maxPerCell && sparseCells.length > 0) {
      const targetIdx = sparseCells[0]
      const targetBounds = cellBounds[targetIdx]

      // Pick a random excess asset from crowded cell
      const excessIdx = cells[crowdedIdx].pop()
      const asset = result[excessIdx]

      // Find new position in target cell using Poisson sampling
      const newPositions = poissonDiskSampling(targetBounds, 1, minDistance, 10)

      if (newPositions.length > 0) {
        // Relocate the asset
        asset.x = newPositions[0].x
        asset.z = newPositions[0].z
        asset._relocated = true  // Mark as moved for debugging

        cells[targetIdx].push(excessIdx)
        moved++

        // Check if target cell is no longer sparse
        if (cells[targetIdx].length >= 2) {
          sparseCells.shift()
        }
      } else {
        // Could not place in target, put back in crowded
        cells[crowdedIdx].push(excessIdx)
        // Try next sparse cell
        sparseCells.shift()
      }
    }
  }

  const cellAfter = cells.map(c => c.length)

  if (moved > 0) {
    console.log(`[Rebalance] Moved ${moved} assets from crowded to sparse cells`)
    console.log(`[Rebalance] Before: [${cellBefore.join(', ')}]`)
    console.log(`[Rebalance] After:  [${cellAfter.join(', ')}]`)
  }

  return {
    placements: result,
    moved,
    cellBefore,
    cellAfter
  }
}

/**
 * Apply terrain height to placements.
 * Queries terrain heightmap and sets Y coordinate accordingly.
 *
 * @param {Array<{x: number, z: number, ...}>} placements - Placements with x/z
 * @param {Function} getTerrainHeight - Function (x, z) => y height
 * @returns {Array} Placements with Y coordinate set
 */
export function applyTerrainHeight(placements, getTerrainHeight) {
  if (!placements || !getTerrainHeight) {
    return placements
  }

  for (const p of placements) {
    if (typeof p.x === 'number' && typeof p.z === 'number') {
      const y = getTerrainHeight(p.x, p.z) || 0
      p.y = y
    }
  }

  return placements
}
