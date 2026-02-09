/**
 * Camera-aware composition placement primitives
 *
 * Provides placement functions for layered scene composition
 * that respect camera viewing angles and create visual depth.
 */

import { SCENE_GENERATION } from '../../shared/constants'
import { CATEGORY_MIN_DISTANCE, PLACEMENT_OVERREQUEST, COMPOSITION_CAMERAS } from './constants'
import {
  poissonDiskSampling,
  clusterPlacement,
  ringPlacement,
  edgePlacement,
  gridPlacement
} from './samplingAlgorithms'
import { parseSemanticLocation, executeAssetPlacement } from './semanticLocation'

/**
 * Frame placement - surround a reference point without blocking camera view
 * Places assets in a semicircle on the "far" side from cameras
 *
 * @param {{x: number, z: number}} reference - Center point to frame
 * @param {number} count - Number of points
 * @param {number} minDistance - Minimum distance from reference
 * @param {number} [maxDistance] - Maximum distance (defaults to minDistance + 10)
 * @param {boolean} [cameraAware=true] - Avoid placing in camera sightlines
 * @returns {Array<{x: number, z: number, rotation: number}>} Positions with facing rotation
 */
export function framePlacement(reference, count, minDistance, maxDistance = null, cameraAware = true) {
  const effectiveMax = maxDistance || minDistance + 10
  const points = []

  // Calculate "away from camera" direction (average of camera directions)
  const camera = COMPOSITION_CAMERAS.overview
  const toRefX = reference.x - camera.x
  const toRefZ = reference.z - camera.z
  const toRefLen = Math.sqrt(toRefX * toRefX + toRefZ * toRefZ)

  // Normalized direction from camera to reference (this is "forward")
  const forwardX = toRefX / toRefLen
  const forwardZ = toRefZ / toRefLen

  // Place in a 180° arc on the FAR side from camera
  const arcStart = Math.atan2(forwardZ, forwardX) - Math.PI / 2
  const arcEnd = arcStart + Math.PI

  for (let i = 0; i < count; i++) {
    // Distribute evenly across arc with slight randomization
    const t = (i + 0.5) / count
    const baseAngle = arcStart + t * (arcEnd - arcStart)
    const angle = baseAngle + (Math.random() - 0.5) * (Math.PI / count) * 0.5

    // Random distance in range
    const dist = minDistance + Math.random() * (effectiveMax - minDistance)

    const x = reference.x + Math.cos(angle) * dist
    const z = reference.z + Math.sin(angle) * dist

    // Clamp to scene bounds
    const clampedX = Math.max(SCENE_GENERATION.MIN_X + 3, Math.min(SCENE_GENERATION.MAX_X - 3, x))
    const clampedZ = Math.max(SCENE_GENERATION.MIN_Z + 3, Math.min(SCENE_GENERATION.MAX_Z - 3, z))

    // Face toward reference with slight variance
    const faceAngle = Math.atan2(reference.z - clampedZ, reference.x - clampedX)

    points.push({
      x: clampedX,
      z: clampedZ,
      rotation: faceAngle + (Math.random() - 0.5) * 0.3
    })
  }

  return points
}

/**
 * Behind placement - place assets further from camera than reference
 * Creates depth by ensuring these are "behind" the reference from viewing angle
 *
 * @param {{x: number, z: number}} reference - Reference point
 * @param {number} count - Number of points
 * @param {number} [behindDistance=15] - How far behind the reference
 * @param {number} [spread=20] - Horizontal spread
 * @returns {Array<{x: number, z: number}>} Positions
 */
export function behindPlacement(reference, count, behindDistance = 15, spread = 20) {
  const points = []
  const camera = COMPOSITION_CAMERAS.overview

  // Direction from camera to reference
  const dx = reference.x - camera.x
  const dz = reference.z - camera.z
  const len = Math.sqrt(dx * dx + dz * dz)
  const dirX = dx / len
  const dirZ = dz / len

  // Perpendicular direction for spread
  const perpX = -dirZ
  const perpZ = dirX

  for (let i = 0; i < count; i++) {
    // Position "behind" reference (further from camera)
    const behind = behindDistance + Math.random() * behindDistance * 0.5

    // Spread horizontally
    const spreadOffset = (Math.random() - 0.5) * spread

    const x = reference.x + dirX * behind + perpX * spreadOffset
    const z = reference.z + dirZ * behind + perpZ * spreadOffset

    // Clamp to scene bounds
    points.push({
      x: Math.max(SCENE_GENERATION.MIN_X + 3, Math.min(SCENE_GENERATION.MAX_X - 3, x)),
      z: Math.max(SCENE_GENERATION.MIN_Z + 3, Math.min(SCENE_GENERATION.MAX_Z - 3, z))
    })
  }

  return points
}

/**
 * Calculate rotation to face toward a target point
 *
 * @param {{x: number, z: number}} position - Asset position
 * @param {{x: number, z: number}} target - Point to face toward
 * @param {number} [variance=0] - Random rotation variance in radians
 * @returns {number} Rotation in radians (Y-axis)
 */
export function facingRotation(position, target, variance = 0) {
  const angle = Math.atan2(target.z - position.z, target.x - position.x)
  return angle + (Math.random() - 0.5) * variance
}

/**
 * Density gradient sampling - scatter with varying density
 * Higher density at edges, lower at center (or vice versa)
 *
 * @param {Object} bounds - {minX, maxX, minZ, maxZ}
 * @param {{center: number, edge: number}} gradient - Density weights (0-1)
 * @param {number} count - Target number of points
 * @param {number} [minDistance=5] - Minimum spacing
 * @returns {Array<{x: number, z: number}>} Positions
 */
export function densityGradientSampling(bounds, gradient, count, minDistance = 5) {
  const { minX, maxX, minZ, maxZ } = bounds
  const centerX = (minX + maxX) / 2
  const centerZ = (minZ + maxZ) / 2
  const maxDist = Math.sqrt((maxX - centerX) ** 2 + (maxZ - centerZ) ** 2)

  const points = []
  const maxAttempts = count * 50

  for (let attempt = 0; attempt < maxAttempts && points.length < count; attempt++) {
    // Random position in bounds
    const x = minX + Math.random() * (maxX - minX)
    const z = minZ + Math.random() * (maxZ - minZ)

    // Calculate distance ratio from center (0 = center, 1 = edge)
    const dist = Math.sqrt((x - centerX) ** 2 + (z - centerZ) ** 2)
    const distRatio = Math.min(1, dist / maxDist)

    // Interpolate density weight
    const densityWeight = gradient.center * (1 - distRatio) + gradient.edge * distRatio

    // Accept/reject based on density weight
    if (Math.random() > densityWeight) continue

    // Check minimum distance from existing points
    let valid = true
    for (const p of points) {
      const d = Math.sqrt((x - p.x) ** 2 + (z - p.z) ** 2)
      if (d < minDistance) {
        valid = false
        break
      }
    }

    if (valid) {
      points.push({ x, z, rotation: Math.random() * Math.PI * 2 })
    }
  }

  return points
}

/**
 * Leading line placement - create a path between two points
 * Good for creating visual flow (stone paths, fences, etc.)
 *
 * @param {{x: number, z: number}} from - Start point
 * @param {{x: number, z: number}} to - End point
 * @param {number} count - Number of points along line
 * @param {number} [jitter=2] - Perpendicular jitter amount
 * @returns {Array<{x: number, z: number, rotation: number}>} Positions with rotation along line
 */
export function leadingLinePlacement(from, to, count, jitter = 2) {
  const points = []
  const dx = to.x - from.x
  const dz = to.z - from.z
  const len = Math.sqrt(dx * dx + dz * dz)

  // Normalized direction
  const dirX = dx / len
  const dirZ = dz / len

  // Perpendicular for jitter
  const perpX = -dirZ
  const perpZ = dirX

  // Rotation to face along the line
  const lineRotation = Math.atan2(dz, dx)

  for (let i = 0; i < count; i++) {
    // Evenly spaced with slight randomization
    const t = (i + 0.5 + (Math.random() - 0.5) * 0.3) / count
    const baseDist = t * len

    // Position along line
    let x = from.x + dirX * baseDist
    let z = from.z + dirZ * baseDist

    // Add perpendicular jitter
    x += perpX * (Math.random() - 0.5) * jitter * 2
    z += perpZ * (Math.random() - 0.5) * jitter * 2

    points.push({
      x,
      z,
      rotation: lineRotation + (Math.random() - 0.5) * 0.2
    })
  }

  return points
}

/**
 * Background placement - place at scene edges for depth framing
 * Distributes assets around the perimeter of the scene zone
 *
 * @param {{x: number, z: number}} reference - Focal/center point to frame
 * @param {number} count - Number of points
 * @param {number} [minDistance=25] - Minimum distance from reference
 * @param {boolean} [cameraAware=true] - Weight placement toward camera-far edges
 * @returns {Array<{x: number, z: number, rotation: number}>} Positions
 */
export function backgroundPlacement(reference, count, minDistance = 25, cameraAware = true) {
  const points = []
  const sceneRadius = SCENE_GENERATION.SIZE / 2 - 5  // 5m margin from edge

  // If camera aware, weight toward N and E edges (away from typical camera positions)
  // Camera is typically at SW looking NE
  const weights = cameraAware
    ? { N: 0.35, E: 0.35, S: 0.15, W: 0.15 }
    : { N: 0.25, E: 0.25, S: 0.25, W: 0.25 }

  // Distribute count based on weights
  const edgeCounts = {
    N: Math.round(count * weights.N),
    E: Math.round(count * weights.E),
    S: Math.round(count * weights.S),
    W: Math.round(count * weights.W)
  }

  // Ensure total matches count
  const total = Object.values(edgeCounts).reduce((a, b) => a + b, 0)
  if (total < count) edgeCounts.N += count - total
  if (total > count) edgeCounts.N -= total - count

  // Place on each edge
  for (const [edge, edgeCount] of Object.entries(edgeCounts)) {
    if (edgeCount <= 0) continue

    const edgePoints = edgePlacement(edge, edgeCount, 12, 3)

    // Add facing rotation toward reference
    for (const p of edgePoints) {
      const faceAngle = Math.atan2(reference.z - p.z, reference.x - p.x)
      points.push({
        x: p.x,
        z: p.z,
        rotation: faceAngle + (Math.random() - 0.5) * 0.4
      })
    }
  }

  return points
}

/**
 * Execute placement for layered schema asset specification
 * Handles both old-style (zone-based) and new-style (relationship-based) placement
 *
 * @param {Object} assetSpec - Asset specification from scene plan
 * @param {{x: number, z: number}} [focalPosition] - Focal position for relative placements
 * @returns {Array<{x: number, z: number, rotation?: number}>} Placement positions
 */
export function executeLayeredPlacement(assetSpec, focalPosition = null) {
  const {
    placement,
    reference,
    location,
    count = 1,
    distance = 25,
    minDistance: explicitMinDistance,
    radius = 15,
    densityGradient,
    cameraAware = false,
    facing,
    category = 'props'
  } = assetSpec

  // Use category-aware minDistance defaults for denser scenes
  const minDistance = explicitMinDistance ?? CATEGORY_MIN_DISTANCE[category] ?? 2

  // Over-request for algorithms that filter points
  const requestCount = Math.ceil(count * PLACEMENT_OVERREQUEST)

  // Default focal position if not provided
  const focal = focalPosition || {
    x: SCENE_GENERATION.CENTER_X,
    z: SCENE_GENERATION.CENTER_Z
  }

  // Determine reference point
  const refPoint = reference === 'focal' ? focal
    : reference === 'center' ? { x: SCENE_GENERATION.CENTER_X, z: SCENE_GENERATION.CENTER_Z }
    : null

  let positions = []

  switch (placement) {
    case 'focal':
      // Single position at scene center (or specified position)
      positions = [{
        x: location === 'center' ? SCENE_GENERATION.CENTER_X : focal.x,
        z: location === 'center' ? SCENE_GENERATION.CENTER_Z : focal.z,
        rotation: 0
      }]
      break

    case 'ring':
      // Circle around reference point
      if (refPoint) {
        positions = ringPlacement(refPoint, count, distance || radius, 0.3)
      } else {
        // Fallback to zone center
        const bounds = parseSemanticLocation(location || 'center')
        positions = ringPlacement(bounds.center, count, radius, 0.3)
      }
      break

    case 'frame':
      // Surround reference without blocking camera
      if (refPoint) {
        positions = framePlacement(refPoint, count, distance, distance + 15, cameraAware)
      } else {
        // Fallback to background placement
        positions = backgroundPlacement(focal, count, distance, cameraAware)
      }
      break

    case 'background':
      // Edge placement for depth framing
      positions = backgroundPlacement(focal, count, distance || 25, cameraAware)
      break

    case 'behind':
      // Further from camera than reference
      if (refPoint) {
        positions = behindPlacement(refPoint, count, distance || 15, radius || 20)
      } else {
        positions = behindPlacement(focal, count, distance || 15, radius || 20)
      }
      break

    case 'leadingLine':
      // Path between two points
      if (assetSpec.from && assetSpec.to) {
        positions = leadingLinePlacement(assetSpec.from, assetSpec.to, count, 2)
      } else if (refPoint) {
        // Default: line from camera toward focal
        const camera = COMPOSITION_CAMERAS.groundLevel
        positions = leadingLinePlacement(
          { x: camera.x + 20, z: camera.z + 20 },
          refPoint,
          count,
          2
        )
      }
      break

    case 'cluster':
      // Grouped around reference - over-request and slice
      if (refPoint) {
        positions = clusterPlacement(refPoint, requestCount, radius, minDistance).slice(0, count)
      } else {
        const bounds = parseSemanticLocation(location || 'center')
        positions = clusterPlacement(bounds.center, requestCount, radius, minDistance).slice(0, count)
      }
      break

    case 'scatter':
    case 'poisson':
      // Natural distribution, optionally with density gradient
      if (densityGradient) {
        const bounds = {
          minX: SCENE_GENERATION.MIN_X,
          maxX: SCENE_GENERATION.MAX_X,
          minZ: SCENE_GENERATION.MIN_Z,
          maxZ: SCENE_GENERATION.MAX_Z
        }
        // Over-request and slice for density gradient
        positions = densityGradientSampling(bounds, densityGradient, requestCount, minDistance).slice(0, count)
      } else {
        // Standard scatter using existing algorithm (already handles over-request)
        positions = executeAssetPlacement({ ...assetSpec, placement: 'scatter' })
      }
      break

    default:
      // Fall back to existing executeAssetPlacement for legacy types
      positions = executeAssetPlacement(assetSpec)
  }

  // Apply facing rotation if specified
  if (facing && positions.length > 0) {
    const faceTarget = facing === 'focal' ? focal
      : facing === 'center' ? { x: SCENE_GENERATION.CENTER_X, z: SCENE_GENERATION.CENTER_Z }
      : facing === 'camera' ? COMPOSITION_CAMERAS.overview
      : null

    if (faceTarget) {
      positions = positions.map(p => ({
        ...p,
        rotation: facingRotation(p, faceTarget, 0.3)
      }))
    }
  }

  return positions
}
