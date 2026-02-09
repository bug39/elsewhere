/**
 * CollisionAnalyzer - Pre-computes structural analysis for scene verification
 *
 * The vision evaluator operates partially blind - a 45° camera can't reliably
 * detect XZ overlaps, and it has no access to structural data. This service
 * provides authoritative collision detection and distribution analysis that
 * the vision model can trust.
 *
 * Key metrics:
 * - overlappingPairs: Which assets physically intersect (with overlap distance)
 * - clusteringScore: How bunched together assets are (0=spread, 1=clustered)
 * - coveragePercent: What percentage of the zone is occupied
 * - densityMap: 10x10 grid showing where assets are concentrated
 */

import { SCENE_GENERATION } from '../shared/constants'

/**
 * Collision analysis result
 * @typedef {Object} CollisionReport
 * @property {Array<{a: string, b: string, overlapMeters: number}>} overlappingPairs
 * @property {number} clusteringScore - 0.0 (spread) to 1.0 (all clustered)
 * @property {number} coveragePercent - Percentage of zone area covered
 * @property {number[][]} densityMap - 10x10 grid of asset counts
 * @property {Array<Object>} flaggedAssets - Assets that couldn't be placed properly
 */

export class CollisionAnalyzer {
  constructor() {
    // Zone bounds for analysis
    this.zoneBounds = {
      minX: SCENE_GENERATION.MIN_X,
      maxX: SCENE_GENERATION.MAX_X,
      minZ: SCENE_GENERATION.MIN_Z,
      maxZ: SCENE_GENERATION.MAX_Z,
      width: SCENE_GENERATION.SIZE,
      depth: SCENE_GENERATION.SIZE
    }
  }

  /**
   * Analyze a scene for collisions and distribution quality.
   *
   * @param {Array<Object>} placements - Placed assets with position, scale, instanceId
   * @param {Map<string, Object>|Object} measurements - Map or object of assetId -> measurement
   * @returns {CollisionReport}
   */
  analyzeScene(placements, measurements) {
    // Normalize measurements to a lookup function
    const getMeasurement = (assetId) => {
      if (measurements instanceof Map) {
        return measurements.get(assetId)
      }
      return measurements?.[assetId]
    }

    const overlappingPairs = this.findOverlaps(placements, getMeasurement)
    const clusteringScore = this.computeClustering(placements)
    const coveragePercent = this.computeCoverage(placements, getMeasurement)
    const densityMap = this.computeDensityGrid(placements)
    const flaggedAssets = placements.filter(p => p.flagged)

    return {
      overlappingPairs,
      clusteringScore,
      coveragePercent,
      densityMap,
      flaggedAssets
    }
  }

  /**
   * Find all overlapping pairs of assets using rectangle intersection.
   *
   * @param {Array<Object>} placements - Placed assets
   * @param {Function} getMeasurement - Lookup function for measurements
   * @returns {Array<{a: string, b: string, overlapMeters: number}>}
   */
  findOverlaps(placements, getMeasurement) {
    const overlaps = []

    for (let i = 0; i < placements.length; i++) {
      for (let j = i + 1; j < placements.length; j++) {
        const p1 = placements[i]
        const p2 = placements[j]

        const m1 = getMeasurement(p1.libraryId) || this.defaultMeasurement(p1.scale)
        const m2 = getMeasurement(p2.libraryId) || this.defaultMeasurement(p2.scale)

        const overlap = this.computeFootprintOverlap(p1, m1, p2, m2)

        if (overlap > 0) {
          overlaps.push({
            a: p1.instanceId || p1.id || `placement_${i}`,
            b: p2.instanceId || p2.id || `placement_${j}`,
            overlapMeters: overlap
          })
        }
      }
    }

    return overlaps
  }

  /**
   * Compute overlap between two asset footprints.
   * Returns the overlap distance (how much they intersect), or 0 if no overlap.
   *
   * @param {Object} p1 - First placement
   * @param {Object} m1 - First measurement
   * @param {Object} p2 - Second placement
   * @param {Object} m2 - Second measurement
   * @param {number} [buffer=0.9] - Buffer factor (0.9 = allow 10% overlap before flagging)
   * @returns {number} Overlap distance in meters, 0 if no overlap
   */
  computeFootprintOverlap(p1, m1, p2, m2, buffer = 0.9) {
    const scale1 = p1.scale || 1
    const scale2 = p2.scale || 1

    // Get positions (handle both [x,y,z] array and {x,y,z} object formats)
    const x1 = Array.isArray(p1.position) ? p1.position[0] : p1.position.x
    const z1 = Array.isArray(p1.position) ? p1.position[2] : p1.position.z
    const x2 = Array.isArray(p2.position) ? p2.position[0] : p2.position.x
    const z2 = Array.isArray(p2.position) ? p2.position[2] : p2.position.z

    // Calculate footprint rectangles (scaled, with buffer)
    const halfWidth1 = (m1.width * scale1 / 2) * buffer
    const halfDepth1 = (m1.depth * scale1 / 2) * buffer
    const halfWidth2 = (m2.width * scale2 / 2) * buffer
    const halfDepth2 = (m2.depth * scale2 / 2) * buffer

    // Rectangle 1 bounds
    const r1 = {
      minX: x1 - halfWidth1,
      maxX: x1 + halfWidth1,
      minZ: z1 - halfDepth1,
      maxZ: z1 + halfDepth1
    }

    // Rectangle 2 bounds
    const r2 = {
      minX: x2 - halfWidth2,
      maxX: x2 + halfWidth2,
      minZ: z2 - halfDepth2,
      maxZ: z2 + halfDepth2
    }

    // Check for intersection
    if (r1.maxX < r2.minX || r2.maxX < r1.minX ||
        r1.maxZ < r2.minZ || r2.maxZ < r1.minZ) {
      return 0 // No overlap
    }

    // Calculate overlap dimensions
    const overlapX = Math.min(r1.maxX, r2.maxX) - Math.max(r1.minX, r2.minX)
    const overlapZ = Math.min(r1.maxZ, r2.maxZ) - Math.max(r1.minZ, r2.minZ)

    // Return the smaller overlap dimension (minimum penetration)
    return Math.min(overlapX, overlapZ)
  }

  /**
   * Compute clustering score based on asset distribution.
   * Uses standard deviation of distances from centroid, normalized.
   *
   * @param {Array<Object>} placements - Placed assets
   * @returns {number} 0.0 (evenly spread) to 1.0 (tightly clustered)
   */
  computeClustering(placements) {
    if (placements.length < 2) return 0

    // Calculate centroid
    let sumX = 0, sumZ = 0
    for (const p of placements) {
      const x = Array.isArray(p.position) ? p.position[0] : p.position.x
      const z = Array.isArray(p.position) ? p.position[2] : p.position.z
      sumX += x
      sumZ += z
    }
    const centroidX = sumX / placements.length
    const centroidZ = sumZ / placements.length

    // Calculate mean distance from centroid
    let totalDist = 0
    for (const p of placements) {
      const x = Array.isArray(p.position) ? p.position[0] : p.position.x
      const z = Array.isArray(p.position) ? p.position[2] : p.position.z
      const dist = Math.sqrt((x - centroidX) ** 2 + (z - centroidZ) ** 2)
      totalDist += dist
    }
    const meanDist = totalDist / placements.length

    // Normalize against zone size
    // If mean distance is close to 0, assets are clustered
    // If mean distance is close to zone diagonal / 4, assets are spread
    const maxExpectedDist = this.zoneBounds.width / 4 // Quarter of zone width as reference
    const normalizedSpread = Math.min(1, meanDist / maxExpectedDist)

    // Invert so 0 = spread, 1 = clustered
    return 1 - normalizedSpread
  }

  /**
   * Compute coverage percentage of the zone.
   *
   * @param {Array<Object>} placements - Placed assets
   * @param {Function} getMeasurement - Lookup function for measurements
   * @returns {number} Percentage of zone area covered (0-100)
   */
  computeCoverage(placements, getMeasurement) {
    const zoneArea = this.zoneBounds.width * this.zoneBounds.depth
    let totalFootprint = 0

    for (const p of placements) {
      const m = getMeasurement(p.libraryId) || this.defaultMeasurement(p.scale)
      const scale = p.scale || 1
      // Scale footprint area (area scales with square of linear scale)
      totalFootprint += m.footprintArea * scale * scale
    }

    // Cap at 100% (overlapping assets don't add more coverage)
    return Math.min(100, (totalFootprint / zoneArea) * 100)
  }

  /**
   * Compute a 10x10 density grid showing asset distribution.
   *
   * @param {Array<Object>} placements - Placed assets
   * @returns {number[][]} 10x10 grid of asset counts per cell
   */
  computeDensityGrid(placements) {
    const gridSize = 10
    const grid = Array(gridSize).fill(null).map(() => Array(gridSize).fill(0))

    const cellWidth = this.zoneBounds.width / gridSize
    const cellDepth = this.zoneBounds.depth / gridSize

    for (const p of placements) {
      const x = Array.isArray(p.position) ? p.position[0] : p.position.x
      const z = Array.isArray(p.position) ? p.position[2] : p.position.z

      // Map position to grid cell
      const cellX = Math.floor((x - this.zoneBounds.minX) / cellWidth)
      const cellZ = Math.floor((z - this.zoneBounds.minZ) / cellDepth)

      // Clamp to grid bounds
      const clampedX = Math.max(0, Math.min(gridSize - 1, cellX))
      const clampedZ = Math.max(0, Math.min(gridSize - 1, cellZ))

      grid[clampedZ][clampedX]++
    }

    return grid
  }

  /**
   * Generate a text summary of density distribution
   *
   * @param {number[][]} densityMap - 10x10 density grid
   * @returns {string} Human-readable summary
   */
  summarizeDensity(densityMap) {
    const total = densityMap.flat().reduce((sum, n) => sum + n, 0)
    const nonEmpty = densityMap.flat().filter(n => n > 0).length
    const max = Math.max(...densityMap.flat())

    // Find quadrant distribution
    const quadrants = {
      NW: 0, NE: 0, SW: 0, SE: 0
    }
    for (let z = 0; z < 10; z++) {
      for (let x = 0; x < 10; x++) {
        const count = densityMap[z][x]
        if (z < 5 && x < 5) quadrants.NW += count
        else if (z < 5 && x >= 5) quadrants.NE += count
        else if (z >= 5 && x < 5) quadrants.SW += count
        else quadrants.SE += count
      }
    }

    return `Total: ${total} assets, ${nonEmpty}/100 cells occupied, max ${max} per cell. ` +
      `Distribution: NW=${quadrants.NW}, NE=${quadrants.NE}, SW=${quadrants.SW}, SE=${quadrants.SE}`
  }

  /**
   * Check if a single position collides with existing placements.
   *
   * @param {{x: number, z: number}} position - Position to check
   * @param {Object} measurement - Measurement of asset being placed
   * @param {number} scale - Scale of asset being placed
   * @param {Array<Object>} existingPlacements - Already placed assets
   * @param {Function} getMeasurement - Lookup function for measurements
   * @returns {{collides: boolean, collidingWith?: string}}
   */
  checkCollision(position, measurement, scale, existingPlacements, getMeasurement) {
    const newPlacement = {
      position: [position.x, 0, position.z],
      scale
    }

    for (const existing of existingPlacements) {
      const existingMeasurement = getMeasurement(existing.libraryId) ||
        this.defaultMeasurement(existing.scale)

      const overlap = this.computeFootprintOverlap(
        newPlacement, measurement,
        existing, existingMeasurement
      )

      if (overlap > 0) {
        return {
          collides: true,
          collidingWith: existing.instanceId || existing.id
        }
      }
    }

    return { collides: false }
  }

  /**
   * Default measurement for assets without explicit measurements
   * Uses universal baseline of 2×2×2
   *
   * @param {number} scale - Asset scale
   * @returns {Object} Default measurement
   */
  defaultMeasurement(scale = 1) {
    return {
      width: 2,
      depth: 2,
      height: 2,
      footprintArea: 4
    }
  }

  /**
   * Format collision report for inclusion in evaluation prompt
   *
   * @param {CollisionReport} report - Analysis results
   * @returns {string} Formatted text for prompt
   */
  formatForPrompt(report) {
    const lines = []

    // Overlapping pairs
    if (report.overlappingPairs.length > 0) {
      lines.push('### Collision Report')
      for (const overlap of report.overlappingPairs) {
        lines.push(`- ${overlap.a} overlaps ${overlap.b} by ${overlap.overlapMeters.toFixed(1)}m`)
      }
    } else {
      lines.push('### Collision Report')
      lines.push('- No overlaps detected')
    }

    // Clustering
    lines.push('')
    lines.push(`### Clustering Score: ${(report.clusteringScore * 100).toFixed(0)}%`)
    lines.push('(0% = perfectly spread, 100% = all in one spot)')
    if (report.clusteringScore > 0.6) {
      lines.push('WARNING: Assets are too clustered')
    }

    // Coverage
    lines.push('')
    lines.push(`### Coverage: ${report.coveragePercent.toFixed(1)}% of zone occupied`)

    // Flagged assets
    if (report.flaggedAssets.length > 0) {
      lines.push('')
      lines.push('### Flagged Assets (placement issues)')
      for (const flagged of report.flaggedAssets) {
        lines.push(`- ${flagged.instanceId || flagged.id}: ${flagged.flaggedReason || 'placement failed'}`)
      }
    }

    // Density summary
    lines.push('')
    lines.push(`### Distribution: ${this.summarizeDensity(report.densityMap)}`)

    return lines.join('\n')
  }
}

// Singleton instance
let collisionAnalyzer = null

/**
 * Get the singleton CollisionAnalyzer instance
 * @returns {CollisionAnalyzer}
 */
export function getCollisionAnalyzer() {
  if (!collisionAnalyzer) {
    collisionAnalyzer = new CollisionAnalyzer()
  }
  return collisionAnalyzer
}

/**
 * Analyze a scene for collisions and distribution
 * @param {Array<Object>} placements - Placed assets
 * @param {Map<string, Object>|Object} measurements - Asset measurements
 * @returns {CollisionReport}
 */
export function analyzeScene(placements, measurements) {
  return getCollisionAnalyzer().analyzeScene(placements, measurements)
}
