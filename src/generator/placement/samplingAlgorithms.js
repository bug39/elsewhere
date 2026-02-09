/**
 * Core sampling and placement primitives
 *
 * Provides foundational algorithms for distributing assets:
 * - Poisson disk sampling for natural scattering
 * - Cluster placement for grouped objects
 * - Ring placement for surrounding structures
 * - Edge placement for boundary objects
 * - Grid placement for regular patterns
 */

import { SCENE_GENERATION } from '../../shared/constants'

/**
 * Check if two rectangular footprints overlap.
 * This is more accurate than radius-based collision for non-square assets
 * like parking lots, long buildings, or flat ponds.
 *
 * @param {Object} bounds1 - First asset bounds {width, depth}
 * @param {{x: number, z: number}} pos1 - First asset position
 * @param {Object} bounds2 - Second asset bounds {width, depth}
 * @param {{x: number, z: number}} pos2 - Second asset position
 * @param {number} buffer - Buffer factor (1.0 = exact, 1.2 = 20% margin)
 * @returns {boolean} True if footprints overlap
 */
export function checkRectangularCollision(bounds1, pos1, bounds2, pos2, buffer = 1.0) {
  const r1 = {
    minX: pos1.x - (bounds1.width / 2) * buffer,
    maxX: pos1.x + (bounds1.width / 2) * buffer,
    minZ: pos1.z - (bounds1.depth / 2) * buffer,
    maxZ: pos1.z + (bounds1.depth / 2) * buffer
  }
  const r2 = {
    minX: pos2.x - (bounds2.width / 2) * buffer,
    maxX: pos2.x + (bounds2.width / 2) * buffer,
    minZ: pos2.z - (bounds2.depth / 2) * buffer,
    maxZ: pos2.z + (bounds2.depth / 2) * buffer
  }

  // Check for non-overlap (return false if they DON'T overlap)
  return !(r1.maxX < r2.minX || r1.minX > r2.maxX ||
           r1.maxZ < r2.minZ || r1.minZ > r2.maxZ)
}

/**
 * Poisson disk sampling for natural-looking point distribution
 * Guarantees minimum distance between all points
 *
 * @param {Object} bounds - {minX, maxX, minZ, maxZ} in world coordinates
 * @param {number} count - Target number of points
 * @param {number} minDistance - Minimum distance between points
 * @param {number} [maxAttempts=30] - Attempts per active point before giving up
 * @returns {Array<{x: number, z: number}>} Array of positions
 */
export function poissonDiskSampling(bounds, count, minDistance, maxAttempts = 30) {
  const { minX, maxX, minZ, maxZ } = bounds
  const width = maxX - minX
  const depth = maxZ - minZ

  // Cell size for spatial hashing (minDistance / sqrt(2) ensures at most one point per cell)
  const cellSize = minDistance / Math.SQRT2
  const gridWidth = Math.ceil(width / cellSize)
  const gridDepth = Math.ceil(depth / cellSize)

  // Spatial hash grid (-1 means empty, otherwise index into points array)
  const grid = new Array(gridWidth * gridDepth).fill(-1)

  const points = []
  const active = [] // Indices of points that can still spawn neighbors

  // Helper: world coords to grid cell
  const toGrid = (x, z) => ({
    gx: Math.floor((x - minX) / cellSize),
    gz: Math.floor((z - minZ) / cellSize)
  })

  // Helper: check if point is valid (no neighbors within minDistance)
  const isValid = (x, z) => {
    if (x < minX || x > maxX || z < minZ || z > maxZ) return false

    const { gx, gz } = toGrid(x, z)

    // Check neighboring cells (2-cell radius)
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = gx + dx
        const nz = gz + dz
        if (nx < 0 || nx >= gridWidth || nz < 0 || nz >= gridDepth) continue

        const idx = grid[nz * gridWidth + nx]
        if (idx !== -1) {
          const p = points[idx]
          const dist = Math.sqrt((x - p.x) ** 2 + (z - p.z) ** 2)
          if (dist < minDistance) return false
        }
      }
    }
    return true
  }

  // Helper: add point to grid and points array
  const addPoint = (x, z) => {
    const { gx, gz } = toGrid(x, z)
    const idx = points.length
    points.push({ x, z })
    grid[gz * gridWidth + gx] = idx
    active.push(idx)
  }

  // Start with a random point
  const startX = minX + Math.random() * width
  const startZ = minZ + Math.random() * depth
  addPoint(startX, startZ)

  // Generate points
  while (active.length > 0 && points.length < count) {
    // Pick random active point
    const activeIdx = Math.floor(Math.random() * active.length)
    const pointIdx = active[activeIdx]
    const point = points[pointIdx]

    let found = false
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Generate random point in annulus [minDistance, 2*minDistance]
      const angle = Math.random() * Math.PI * 2
      const radius = minDistance + Math.random() * minDistance
      const newX = point.x + Math.cos(angle) * radius
      const newZ = point.z + Math.sin(angle) * radius

      if (isValid(newX, newZ)) {
        addPoint(newX, newZ)
        found = true
        if (points.length >= count) break
      }
    }

    // If no valid point found, remove from active list
    if (!found) {
      active.splice(activeIdx, 1)
    }
  }

  const result = points.slice(0, count)

  // Log warning when Poisson sampling returns fewer points than requested
  // This happens when minDistance is too large for the area
  if (result.length < count) {
    console.warn(`[Placement] Poisson disk undercount: requested ${count}, got ${result.length}. ` +
      `Consider reducing minDistance (${minDistance}m) or expanding the zone.`)
  }

  return result
}

/**
 * Cluster placement around a center point with organic distribution
 *
 * @param {Object} center - {x, z} center position
 * @param {number} count - Number of points
 * @param {number} radius - Maximum distance from center
 * @param {number} [minSpacing=5] - Minimum distance between points
 * @returns {Array<{x: number, z: number}>} Array of positions
 */
export function clusterPlacement(center, count, radius, minSpacing = 5) {
  const points = []
  const maxAttempts = count * 20
  let attempts = 0

  while (points.length < count && attempts < maxAttempts) {
    attempts++

    // Use gaussian-like distribution for more natural clustering (more points near center)
    const r = radius * Math.sqrt(Math.random()) // sqrt for uniform area distribution
    const angle = Math.random() * Math.PI * 2

    const x = center.x + Math.cos(angle) * r
    const z = center.z + Math.sin(angle) * r

    // Check minimum spacing
    let valid = true
    for (const p of points) {
      const dist = Math.sqrt((x - p.x) ** 2 + (z - p.z) ** 2)
      if (dist < minSpacing) {
        valid = false
        break
      }
    }

    if (valid) {
      points.push({ x, z })
    }
  }

  return points
}

/**
 * Ring placement for objects surrounding a center point
 * Good for structures around a plaza, stones around a campfire, etc.
 *
 * @param {Object} center - {x, z} center position
 * @param {number} count - Number of points
 * @param {number} radius - Distance from center
 * @param {number} [jitter=0] - Random offset amount (0-1 as fraction of spacing)
 * @returns {Array<{x: number, z: number, rotation: number}>} Positions with facing rotation
 */
export function ringPlacement(center, count, radius, jitter = 0) {
  const points = []
  const angleStep = (Math.PI * 2) / count

  for (let i = 0; i < count; i++) {
    const baseAngle = angleStep * i
    // Increased jitter to break algorithmic ring patterns
    const angle = baseAngle + (Math.random() - 0.5) * angleStep * 0.4 * jitter
    const r = radius + (Math.random() - 0.5) * radius * 0.4 * jitter

    points.push({
      x: center.x + Math.cos(angle) * r,
      z: center.z + Math.sin(angle) * r,
      rotation: angle + Math.PI + (Math.random() - 0.5) * 0.5 // Face center with ±15° variance
    })
  }

  return points
}

/**
 * Edge placement along SCENE boundaries (not world boundaries)
 * Good for trees at forest edge, background framing elements, etc.
 *
 * BUG FIX: Previously used WORLD_SIZE (400m), now uses SCENE_GENERATION zone (60m).
 * This prevents "line of trees at edge of world" artifacts.
 *
 * @param {'N'|'S'|'E'|'W'} edge - Which edge of the scene zone
 * @param {number} count - Number of points
 * @param {number} depth - Depth of edge band (how far from edge into scene)
 * @param {number} [margin=5] - Distance from corners (reduced for 60m zone)
 * @returns {Array<{x: number, z: number}>} Array of positions with Z-jitter
 */
export function edgePlacement(edge, count, depth, margin = 5) {
  // Use SCENE bounds (380m zone, 95% of world)
  const sceneMinX = SCENE_GENERATION.MIN_X  // 10
  const sceneMaxX = SCENE_GENERATION.MAX_X  // 390
  const sceneMinZ = SCENE_GENERATION.MIN_Z  // 10
  const sceneMaxZ = SCENE_GENERATION.MAX_Z  // 390

  let minX, maxX, minZ, maxZ

  // Edge depth clamped to reasonable range for 380m zone
  const effectiveDepth = Math.min(depth, 50)

  switch (edge) {
    case 'N':
      minX = sceneMinX + margin
      maxX = sceneMaxX - margin
      minZ = sceneMaxZ - effectiveDepth
      maxZ = sceneMaxZ - margin
      break
    case 'S':
      minX = sceneMinX + margin
      maxX = sceneMaxX - margin
      minZ = sceneMinZ + margin
      maxZ = sceneMinZ + effectiveDepth
      break
    case 'E':
      minX = sceneMaxX - effectiveDepth
      maxX = sceneMaxX - margin
      minZ = sceneMinZ + margin
      maxZ = sceneMaxZ - margin
      break
    case 'W':
      minX = sceneMinX + margin
      maxX = sceneMinX + effectiveDepth
      minZ = sceneMinZ + margin
      maxZ = sceneMaxZ - margin
      break
    default:
      throw new Error(`Invalid edge: ${edge}`)
  }

  // Use tighter minDistance for 60m zone (was depth * 0.5, now 4-8m)
  const minDistance = Math.max(4, Math.min(8, effectiveDepth * 0.4))

  // Get base positions via Poisson disk
  const positions = poissonDiskSampling({ minX, maxX, minZ, maxZ }, count, minDistance)

  // Add Z-jitter to break up line formations (±2m perpendicular to edge)
  const jitterAmount = 2
  return positions.map(pos => {
    // Jitter perpendicular to the edge direction
    if (edge === 'N' || edge === 'S') {
      return {
        x: pos.x,
        z: pos.z + (Math.random() - 0.5) * jitterAmount * 2
      }
    } else {
      return {
        x: pos.x + (Math.random() - 0.5) * jitterAmount * 2,
        z: pos.z
      }
    }
  })
}

/**
 * Grid placement with optional noise
 * Good for regular structures like market stalls, graves, etc.
 *
 * @param {Object} bounds - {minX, maxX, minZ, maxZ}
 * @param {number} rows - Number of rows
 * @param {number} cols - Number of columns
 * @param {number} [noise=0] - Position noise (0-1)
 * @returns {Array<{x: number, z: number}>} Array of positions
 */
export function gridPlacement(bounds, rows, cols, noise = 0) {
  const { minX, maxX, minZ, maxZ } = bounds
  const stepX = (maxX - minX) / (cols + 1)
  const stepZ = (maxZ - minZ) / (rows + 1)

  const points = []

  for (let row = 1; row <= rows; row++) {
    for (let col = 1; col <= cols; col++) {
      const x = minX + col * stepX + (Math.random() - 0.5) * stepX * noise
      const z = minZ + row * stepZ + (Math.random() - 0.5) * stepZ * noise
      points.push({ x, z })
    }
  }

  return points
}
