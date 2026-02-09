/**
 * Semantic location parsing and asset placement execution
 *
 * Provides zone parsing for semantic location strings and
 * the main executeAssetPlacement function for scene generation.
 */

import { WORLD_SIZE, SCENE_GENERATION } from '../../shared/constants'
import { UNIVERSAL_BASELINE } from '../sizeInvariants'
import { CATEGORY_MIN_DISTANCE, PLACEMENT_OVERREQUEST } from './constants'
import {
  poissonDiskSampling,
  clusterPlacement,
  ringPlacement,
  edgePlacement,
  gridPlacement
} from './samplingAlgorithms'

/**
 * Parse semantic location string into SCENE bounds (60m × 60m zone).
 * All locations are relative to the constrained scene zone, NOT the full 400m world.
 *
 * @param {string} location - Semantic location like "NE quadrant", "center", "N edge"
 * @returns {Object} {minX, maxX, minZ, maxZ, center: {x, z}}
 */
export function parseSemanticLocation(location) {
  const loc = location.toLowerCase().trim()

  // Scene bounds (380m × 380m centered in world, 95% coverage)
  const sceneMinX = SCENE_GENERATION.MIN_X  // 10
  const sceneMaxX = SCENE_GENERATION.MAX_X  // 390
  const sceneMinZ = SCENE_GENERATION.MIN_Z  // 10
  const sceneMaxZ = SCENE_GENERATION.MAX_Z  // 390
  const sceneSize = SCENE_GENERATION.SIZE   // 380

  const sceneCenterX = SCENE_GENERATION.CENTER_X  // 200
  const sceneCenterZ = SCENE_GENERATION.CENTER_Z  // 200
  const center = { x: sceneCenterX, z: sceneCenterZ }

  const half = sceneSize / 2      // 190m
  const quarter = sceneSize / 4   // 95m

  // Quadrants are relative to the scene zone (each quadrant is ~190m × 190m)
  if (loc.includes('ne') || (loc.includes('north') && loc.includes('east'))) {
    return {
      minX: sceneCenterX,
      maxX: sceneMaxX,
      minZ: sceneCenterZ,
      maxZ: sceneMaxZ,
      center: { x: sceneCenterX + quarter, z: sceneCenterZ + quarter }
    }
  }

  if (loc.includes('nw') || (loc.includes('north') && loc.includes('west'))) {
    return {
      minX: sceneMinX,
      maxX: sceneCenterX,
      minZ: sceneCenterZ,
      maxZ: sceneMaxZ,
      center: { x: sceneCenterX - quarter, z: sceneCenterZ + quarter }
    }
  }

  if (loc.includes('se') || (loc.includes('south') && loc.includes('east'))) {
    return {
      minX: sceneCenterX,
      maxX: sceneMaxX,
      minZ: sceneMinZ,
      maxZ: sceneCenterZ,
      center: { x: sceneCenterX + quarter, z: sceneCenterZ - quarter }
    }
  }

  if (loc.includes('sw') || (loc.includes('south') && loc.includes('west'))) {
    return {
      minX: sceneMinX,
      maxX: sceneCenterX,
      minZ: sceneMinZ,
      maxZ: sceneCenterZ,
      center: { x: sceneCenterX - quarter, z: sceneCenterZ - quarter }
    }
  }

  // Edge zones (10m strip along scene boundary)
  const edgeDepth = 10

  if (loc.includes('north') || loc.includes('n edge')) {
    return {
      minX: sceneMinX,
      maxX: sceneMaxX,
      minZ: sceneMaxZ - edgeDepth,
      maxZ: sceneMaxZ,
      center: { x: sceneCenterX, z: sceneMaxZ - edgeDepth / 2 }
    }
  }

  if (loc.includes('south') || loc.includes('s edge')) {
    return {
      minX: sceneMinX,
      maxX: sceneMaxX,
      minZ: sceneMinZ,
      maxZ: sceneMinZ + edgeDepth,
      center: { x: sceneCenterX, z: sceneMinZ + edgeDepth / 2 }
    }
  }

  if (loc.includes('east') || loc.includes('e edge')) {
    return {
      minX: sceneMaxX - edgeDepth,
      maxX: sceneMaxX,
      minZ: sceneMinZ,
      maxZ: sceneMaxZ,
      center: { x: sceneMaxX - edgeDepth / 2, z: sceneCenterZ }
    }
  }

  if (loc.includes('west') || loc.includes('w edge')) {
    return {
      minX: sceneMinX,
      maxX: sceneMinX + edgeDepth,
      minZ: sceneMinZ,
      maxZ: sceneMaxZ,
      center: { x: sceneMinX + edgeDepth / 2, z: sceneCenterZ }
    }
  }

  // "center", "middle", "around center" - inner 40m × 40m of scene
  if (loc.includes('center') || loc.includes('middle') || loc.includes('around')) {
    const innerMargin = 10  // 10m from scene edge
    return {
      minX: sceneMinX + innerMargin,
      maxX: sceneMaxX - innerMargin,
      minZ: sceneMinZ + innerMargin,
      maxZ: sceneMaxZ - innerMargin,
      center
    }
  }

  // "throughout", "scattered", or default - full scene zone (60m × 60m)
  return {
    minX: sceneMinX,
    maxX: sceneMaxX,
    minZ: sceneMinZ,
    maxZ: sceneMaxZ,
    center
  }
}

/**
 * Place assets according to scene plan placement strategy
 *
 * @param {Object} assetPlan - Asset placement specification from scene plan
 * @returns {Array<{x: number, z: number, rotation?: number}>} Placement positions
 */
export function executeAssetPlacement(assetPlan) {
  const {
    placement,
    location,
    count = 1,
    radius = 15,      // Smaller default for 60m scene zone
    minDistance: explicitMinDistance,  // Allow explicit override
    scale = 10,
    category = 'props'
  } = assetPlan

  // Use category-aware minDistance defaults for denser scenes
  // Previous default of 5m was too large, limiting scene to ~80 assets max
  const minDistance = explicitMinDistance ?? CATEGORY_MIN_DISTANCE[category] ?? 2

  // Apply over-request factor to compensate for Poisson undercount + collision filtering
  const requestCount = Math.ceil(count * PLACEMENT_OVERREQUEST)

  const zoneBounds = parseSemanticLocation(location || 'center')

  switch (placement) {
    case 'focal':
      // Single point at zone center - focal placement is for unique centerpieces
      if (count > 1) {
        console.warn(`[Placement] Focal placement used with count=${count}, using count=1 (focal is for single centerpiece)`)
      }
      return [{ x: zoneBounds.center.x, z: zoneBounds.center.z, rotation: 0 }]

    case 'scatter':
    case 'poisson': {
      // Request more points than needed, Poisson will filter some
      const positions = poissonDiskSampling(zoneBounds, requestCount, minDistance)
      // BUG FIX: Removed center-pull bias that was causing clustering in scene center
      // Previous code pulled positions 10% toward center, compounding with other clustering effects
      // Slice back to requested count (over-request compensates for filtering)
      return positions.slice(0, count).map(pos => ({
        x: pos.x,
        z: pos.z,
        rotation: Math.random() * Math.PI * 2
      }))
    }

    case 'cluster': {
      // Request more points than needed, cluster may reject some
      const positions = clusterPlacement(zoneBounds.center, requestCount, radius, minDistance)
      // Add facing-center rotation with variance for organic look
      return positions.slice(0, count).map(pos => {
        const angleToCenter = Math.atan2(zoneBounds.center.z - pos.z, zoneBounds.center.x - pos.x)
        return {
          ...pos,
          rotation: angleToCenter + (Math.random() - 0.5) * 0.5 // ±15° variance
        }
      })
    }

    case 'ring':
      // Ring is precise - don't over-request
      return ringPlacement(zoneBounds.center, count, radius, 0.3) // Increased from 0.2

    case 'edge': {
      // Determine which edge from location
      let edge = 'N'
      if (location?.toLowerCase().includes('south')) edge = 'S'
      else if (location?.toLowerCase().includes('east')) edge = 'E'
      else if (location?.toLowerCase().includes('west')) edge = 'W'
      // Over-request and slice for edge placement
      return edgePlacement(edge, requestCount, radius).slice(0, count)
    }

    case 'grid': {
      // Grid is precise - use exact count
      const gridSize = Math.ceil(Math.sqrt(count))
      return gridPlacement(zoneBounds, gridSize, gridSize, 0.1).slice(0, count)
    }

    case 'random':
    default: {
      // Simple random placement within bounds - use exact count
      const points = []
      for (let i = 0; i < count; i++) {
        points.push({
          x: zoneBounds.minX + Math.random() * (zoneBounds.maxX - zoneBounds.minX),
          z: zoneBounds.minZ + Math.random() * (zoneBounds.maxZ - zoneBounds.minZ),
          rotation: Math.random() * Math.PI * 2
        })
      }
      return points
    }
  }
}

/**
 * Calculate minimum distance based on asset scale.
 * With universal normalization, all assets have the same baseline (2 units).
 *
 * @param {number} scale1 - Scale of first asset
 * @param {string} category1 - Category of first asset (unused with universal baseline)
 * @param {number} scale2 - Scale of second asset
 * @param {string} category2 - Category of second asset (unused with universal baseline)
 * @param {number} [buffer=1.2] - Buffer multiplier to prevent touching
 * @returns {number} Minimum distance between asset centers
 */
export function calculateMinDistance(scale1, category1, scale2, category2, buffer = 1.2) {
  // With universal normalization, all assets have the same baseline
  // Approximate radius as half the scaled baseline
  const radius1 = (UNIVERSAL_BASELINE * scale1) / 2
  const radius2 = (UNIVERSAL_BASELINE * scale2) / 2

  return (radius1 + radius2) * buffer
}

/**
 * Compute footprint overlap between two rectangular assets.
 * Returns the overlap area (> 0 means collision).
 *
 * @param {{x: number, z: number}} pos1 - Position of first asset
 * @param {{width: number, depth: number}} bounds1 - Bounds of first asset (in world units)
 * @param {{x: number, z: number}} pos2 - Position of second asset
 * @param {{width: number, depth: number}} bounds2 - Bounds of second asset (in world units)
 * @param {number} [buffer=1.0] - Extra spacing buffer (meters)
 * @returns {number} Overlap area (0 if no collision)
 */
export function computeFootprintOverlap(pos1, bounds1, pos2, bounds2, buffer = 1.0) {
  // Compute half-extents including buffer
  const halfW1 = (bounds1.width / 2) + buffer / 2
  const halfD1 = (bounds1.depth / 2) + buffer / 2
  const halfW2 = (bounds2.width / 2) + buffer / 2
  const halfD2 = (bounds2.depth / 2) + buffer / 2

  // Compute overlap on each axis
  const overlapX = Math.max(0, Math.min(pos1.x + halfW1, pos2.x + halfW2) - Math.max(pos1.x - halfW1, pos2.x - halfW2))
  const overlapZ = Math.max(0, Math.min(pos1.z + halfD1, pos2.z + halfD2) - Math.max(pos1.z - halfD1, pos2.z - halfD2))

  return overlapX * overlapZ
}

/**
 * Validate placement positions considering scale and category.
 * Filters out positions that would overlap with existing instances.
 *
 * Now supports measurement-aware collision detection using actual asset footprints
 * instead of just center-to-center distance.
 *
 * @param {Array<{x: number, z: number}>} newPositions - Proposed positions
 * @param {Array<{position: number[], scale?: number, libraryId?: string}>} existingInstances - Current world instances
 * @param {number} newScale - Scale of asset being placed
 * @param {string} newCategory - Category of asset being placed
 * @param {Function} [getCategoryForInstance] - Lookup function for existing instance categories
 * @param {number} [minDistanceOverride] - Optional explicit minDistance (bypasses calculation)
 * @param {Map} [measurements] - Map of libraryId -> measured bounds from AssetMeasurementService
 * @param {{width: number, depth: number}} [newAssetBounds] - Measured bounds of the new asset being placed
 * @returns {Array<{x: number, z: number}>} Valid positions (filtered)
 */
export function validatePlacements(
  newPositions,
  existingInstances,
  newScale = 1,
  newCategory = 'props',
  getCategoryForInstance = null,
  minDistanceOverride = null,
  measurements = null,
  newAssetBounds = null
) {
  // Support legacy 3-argument calls: validatePlacements(positions, instances, minDistance)
  if (typeof newScale === 'number' && typeof newCategory !== 'string') {
    // Legacy call pattern: newScale is actually minDistance
    minDistanceOverride = newScale
    newScale = 1
    newCategory = 'props'
  }

  // Estimate new asset bounds if not provided
  // Scale bounds by newScale to get world-space dimensions
  const estimatedNewBounds = newAssetBounds
    ? { width: newAssetBounds.width * newScale, depth: newAssetBounds.depth * newScale }
    : { width: UNIVERSAL_BASELINE * newScale, depth: UNIVERSAL_BASELINE * newScale }

  return newPositions.filter(pos => {
    // Check against existing instances
    for (const inst of existingInstances) {
      const existingScale = inst.scale || 1
      const existingCategory = getCategoryForInstance?.(inst) || 'props'

      // Try to get actual measured bounds for existing instance
      let existingBounds = null
      if (measurements && inst.libraryId) {
        const measured = measurements.get(inst.libraryId)
        if (measured) {
          // Scale measured bounds by instance scale
          existingBounds = {
            width: measured.width * existingScale,
            depth: measured.depth * existingScale
          }
        }
      }

      // If we have measurements for both assets, use footprint overlap
      if (existingBounds) {
        const existingPos = { x: inst.position[0], z: inst.position[2] }
        const overlap = computeFootprintOverlap(pos, estimatedNewBounds, existingPos, existingBounds, 1.0)
        if (overlap > 0) {
          return false
        }
      } else {
        // Fallback to center-to-center distance check
        // CRITICAL FIX: minDistanceOverride is a FLOOR, not a replacement
        // Scale-based collision must always be considered for large assets
        const scaleBasedDistance = calculateMinDistance(newScale, newCategory, existingScale, existingCategory)
        const requiredDistance = Math.max(minDistanceOverride ?? 0, scaleBasedDistance)

        const dx = pos.x - inst.position[0]
        const dz = pos.z - inst.position[2]
        const dist = Math.sqrt(dx * dx + dz * dz)

        if (dist < requiredDistance) return false
      }
    }

    // Check world bounds (5m margin)
    if (pos.x < 5 || pos.x > WORLD_SIZE - 5) return false
    if (pos.z < 5 || pos.z > WORLD_SIZE - 5) return false

    return true
  })
}
