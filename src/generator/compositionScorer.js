/**
 * Composition Scorer - Camera-aware validation for scene layouts
 *
 * Evaluates how well a scene follows composition principles:
 * - Depth layers (foreground/midground/background separation)
 * - Focal visibility (hero element not occluded)
 * - Density distribution (not too sparse or cluttered)
 * - Spatial balance (even distribution, no dead zones)
 *
 * Used by SceneGenerationAgent to validate layered placements before proceeding.
 */

import { SCENE_GENERATION } from '../shared/constants'

/**
 * Default camera positions for composition evaluation
 * These match the capture service presets
 */
export const EVALUATION_CAMERAS = {
  overview: {
    position: { x: 215, y: 70, z: 240 },
    target: { x: 200, y: 0, z: 200 }
  },
  groundLevel: {
    position: { x: 160, y: 8, z: 160 },
    target: { x: 215, y: 5, z: 215 }
  }
}

/**
 * Depth layer boundaries (distance from camera)
 * Used to classify placements into foreground/midground/background
 */
const DEPTH_THRESHOLDS = {
  foreground: 25,   // 0-25m from scene center
  midground: 45,    // 25-45m from scene center
  background: 60    // 45m+ from scene center (edges)
}

/**
 * Score composition quality of placed assets
 *
 * @param {Array<{x: number, z: number, scale?: number, layer?: string}>} placements - Asset positions
 * @param {{x: number, z: number}} focalPosition - Position of focal element
 * @param {Object} [cameras=EVALUATION_CAMERAS] - Camera positions for occlusion checks
 * @returns {Object} Composition scores and diagnostics
 */
export function scoreComposition(placements, focalPosition, cameras = EVALUATION_CAMERAS) {
  if (!placements || placements.length === 0) {
    return {
      depthLayers: { score: 0, layers: { foreground: 0, midground: 0, background: 0 } },
      focalVisible: { score: 100, occluders: [] },
      density: { score: 50, sparse: [], crowded: [] },
      balance: { score: 50, quadrantCounts: { NE: 0, NW: 0, SE: 0, SW: 0 } },
      overall: 25,
      warnings: ['No placements to evaluate']
    }
  }

  const sceneCenter = {
    x: SCENE_GENERATION.CENTER_X,
    z: SCENE_GENERATION.CENTER_Z
  }

  // Calculate individual scores
  const depthLayers = checkDepthLayers(placements, sceneCenter)
  const focalVisible = focalPosition
    ? checkFocalVisibility(placements, focalPosition, cameras)
    : { score: 100, occluders: [], message: 'No focal position specified' }
  const density = checkDensityDistribution(placements, sceneCenter)
  const balance = checkSpatialBalance(placements, sceneCenter)
  const overlap = checkOverlap(placements)

  // Compute overall score (weighted average)
  // Overlap is heavily weighted because it's a critical failure
  const weights = {
    depthLayers: 0.15,
    focalVisible: 0.20,
    density: 0.15,
    balance: 0.15,
    overlap: 0.35  // Overlap is the most important factor!
  }

  const overall = Math.round(
    depthLayers.score * weights.depthLayers +
    focalVisible.score * weights.focalVisible +
    density.score * weights.density +
    balance.score * weights.balance +
    overlap.score * weights.overlap
  )

  // Collect warnings
  const warnings = []
  if (depthLayers.score < 50) warnings.push('Poor depth layer distribution')
  if (focalVisible.score < 70) warnings.push('Focal point may be occluded')
  if (density.score < 50) warnings.push('Uneven density distribution')
  if (balance.score < 50) warnings.push('Spatial imbalance detected')
  if (overlap.score < 50) warnings.push(`Severe overlap detected: ${overlap.count} collision pairs`)
  if (overlap.score < 80) warnings.push(`Some overlap detected: ${overlap.count} collision pairs`)

  return {
    depthLayers,
    focalVisible,
    density,
    balance,
    overlap,
    overall,
    warnings,
    passed: overall >= 70 && overlap.score >= 50  // Fail if severe overlap
  }
}

/**
 * Check depth layer distribution using CAMERA DISTANCE (not scene center)
 * Good scenes have assets in all three depth layers from the camera's perspective
 *
 * FIX: Previously used distance from scene center, which doesn't reflect
 * actual visual depth. Now uses distance from primary camera position.
 *
 * @param {Array} placements - Asset positions
 * @param {{x: number, z: number}} center - Scene center (used for reference only)
 * @returns {Object} Score and layer counts
 */
function checkDepthLayers(placements, center) {
  const layers = { foreground: 0, midground: 0, background: 0 }

  // Use overview camera position for depth calculation
  // Camera is at (215, 70, 240) looking toward center (200, 0, 200)
  const camera = EVALUATION_CAMERAS.overview.position

  // Calculate depth thresholds based on camera distance to scene center
  // Scene is 380m, so depth ranges are relative to camera position
  const CAMERA_DEPTH_THRESHOLDS = {
    foreground: 60,   // 0-60m from camera (closer)
    midground: 100,   // 60-100m from camera (middle)
    background: 150   // 100m+ from camera (far)
  }

  for (const p of placements) {
    // Calculate 3D distance from camera to asset
    const dist = Math.sqrt(
      (p.x - camera.x) ** 2 +
      (p.z - camera.z) ** 2
    )

    if (dist <= CAMERA_DEPTH_THRESHOLDS.foreground) {
      layers.foreground++
    } else if (dist <= CAMERA_DEPTH_THRESHOLDS.midground) {
      layers.midground++
    } else {
      layers.background++
    }
  }

  // Score based on having assets in multiple layers
  const occupiedLayers = Object.values(layers).filter(c => c > 0).length
  let score = 0

  if (occupiedLayers === 3) {
    score = 100  // Perfect: all layers have assets
  } else if (occupiedLayers === 2) {
    score = 70   // Good: two layers
  } else if (occupiedLayers === 1) {
    score = 40   // Poor: only one layer
  }

  // Bonus for balanced distribution (no single layer > 60% of total)
  const total = placements.length
  const maxLayerRatio = Math.max(...Object.values(layers)) / total
  if (maxLayerRatio <= 0.6 && occupiedLayers >= 2) {
    score = Math.min(100, score + 10)
  }

  return { score, layers }
}

/**
 * Check if focal point is visible from evaluation cameras
 *
 * Uses simple cylinder-based occlusion estimation:
 * - For each camera, cast ray to focal point
 * - Check if any asset is within blocking radius of that ray
 *
 * @param {Array} placements - Asset positions with scale
 * @param {{x: number, z: number}} focal - Focal position
 * @param {Object} cameras - Camera positions
 * @returns {Object} Score and list of potential occluders
 */
function checkFocalVisibility(placements, focal, cameras) {
  const occluders = []

  for (const [cameraName, camera] of Object.entries(cameras)) {
    // Direction from camera to focal (2D for simplicity)
    const dx = focal.x - camera.position.x
    const dz = focal.z - camera.position.z
    const distToFocal = Math.sqrt(dx * dx + dz * dz)

    if (distToFocal < 1) continue // Camera is at focal

    const dirX = dx / distToFocal
    const dirZ = dz / distToFocal

    // Check each placement for potential occlusion
    for (const p of placements) {
      // Skip the focal itself
      if (Math.abs(p.x - focal.x) < 1 && Math.abs(p.z - focal.z) < 1) continue

      // Distance from camera to this asset
      const toDx = p.x - camera.position.x
      const toDz = p.z - camera.position.z
      const toAssetDist = Math.sqrt(toDx * toDx + toDz * toDz)

      // Only check assets between camera and focal
      if (toAssetDist >= distToFocal) continue

      // Project asset onto camera-to-focal line
      const projection = toDx * dirX + toDz * dirZ
      if (projection < 0) continue // Behind camera

      // Perpendicular distance from asset to line
      const perpDist = Math.abs(toDx * dirZ - toDz * dirX)

      // Blocking radius based on asset scale (approximate)
      const blockingRadius = (p.scale || 5) * 0.3 + 2

      if (perpDist < blockingRadius) {
        occluders.push({
          camera: cameraName,
          position: { x: p.x, z: p.z },
          distance: perpDist
        })
      }
    }
  }

  // Score based on occluder count
  let score = 100
  if (occluders.length > 0) {
    score = Math.max(30, 100 - occluders.length * 15)
  }

  return { score, occluders }
}

/**
 * Check density distribution across the scene
 * Good scenes have appropriate density without extremes
 *
 * @param {Array} placements - Asset positions
 * @param {{x: number, z: number}} center - Scene center
 * @returns {Object} Score and problem areas
 */
function checkDensityDistribution(placements, center) {
  const sceneRadius = SCENE_GENERATION.SIZE / 2
  const sparse = []
  const crowded = []

  // Divide scene into 9 cells (3x3 grid)
  const cellSize = SCENE_GENERATION.SIZE / 3
  const cells = Array(9).fill(0)

  for (const p of placements) {
    // Convert to cell coordinates
    const cellX = Math.floor((p.x - SCENE_GENERATION.MIN_X) / cellSize)
    const cellZ = Math.floor((p.z - SCENE_GENERATION.MIN_Z) / cellSize)

    if (cellX >= 0 && cellX < 3 && cellZ >= 0 && cellZ < 3) {
      cells[cellZ * 3 + cellX]++
    }
  }

  // Calculate ideal density per cell
  const idealPerCell = Math.max(1, placements.length / 9)

  // Identify sparse and crowded cells
  const cellNames = ['SW', 'S', 'SE', 'W', 'C', 'E', 'NW', 'N', 'NE']
  for (let i = 0; i < 9; i++) {
    if (cells[i] === 0 && idealPerCell >= 1) {
      sparse.push(cellNames[i])
    } else if (cells[i] > idealPerCell * 2.5) {
      crowded.push(cellNames[i])
    }
  }

  // Score based on distribution evenness
  const nonEmptyCells = cells.filter(c => c > 0).length
  let score = Math.round((nonEmptyCells / 9) * 100)

  // Penalty for very crowded cells
  score = Math.max(0, score - crowded.length * 10)

  // Bonus for center cell being occupied (focal area)
  if (cells[4] > 0) {
    score = Math.min(100, score + 10)
  }

  return { score, sparse, crowded, cellDensities: cells }
}

/**
 * Check spatial balance across quadrants
 *
 * @param {Array} placements - Asset positions
 * @param {{x: number, z: number}} center - Scene center
 * @returns {Object} Score and quadrant counts
 */
function checkSpatialBalance(placements, center) {
  const quadrantCounts = { NE: 0, NW: 0, SE: 0, SW: 0 }

  for (const p of placements) {
    if (p.x >= center.x) {
      if (p.z >= center.z) {
        quadrantCounts.NE++
      } else {
        quadrantCounts.SE++
      }
    } else {
      if (p.z >= center.z) {
        quadrantCounts.NW++
      } else {
        quadrantCounts.SW++
      }
    }
  }

  // Calculate balance score based on variance
  const counts = Object.values(quadrantCounts)
  const mean = counts.reduce((a, b) => a + b, 0) / 4
  const variance = counts.reduce((sum, c) => sum + (c - mean) ** 2, 0) / 4

  // Lower variance = better balance
  // Max acceptable variance scales with total count
  const maxVariance = Math.max(4, placements.length / 2)
  let score = Math.round(100 * (1 - Math.min(1, variance / maxVariance)))

  // Bonus if all quadrants have at least one asset
  const emptyQuadrants = counts.filter(c => c === 0).length
  if (emptyQuadrants === 0) {
    score = Math.min(100, score + 15)
  } else {
    score = Math.max(0, score - emptyQuadrants * 10)
  }

  return { score, quadrantCounts, emptyQuadrants }
}

/**
 * Check for overlapping assets
 * This is the most critical check - overlapping assets look terrible
 *
 * @param {Array} placements - Asset positions with scale
 * @returns {Object} Score, count of overlaps, and overlap pairs
 */
function checkOverlap(placements) {
  const overlaps = []
  const OVERLAP_THRESHOLD = 3  // Assets within 3m center-to-center are overlapping

  for (let i = 0; i < placements.length; i++) {
    const a = placements[i]
    const aScale = a.scale || 1
    const aRadius = aScale * 0.5  // Approximate radius from scale

    for (let j = i + 1; j < placements.length; j++) {
      const b = placements[j]
      const bScale = b.scale || 1
      const bRadius = bScale * 0.5

      const dx = a.x - b.x
      const dz = a.z - b.z
      const dist = Math.sqrt(dx * dx + dz * dz)

      // Assets overlap if their centers are closer than the sum of their radii
      const minSafeDistance = Math.max(OVERLAP_THRESHOLD, aRadius + bRadius)

      if (dist < minSafeDistance) {
        overlaps.push({
          asset1: { x: a.x, z: a.z, scale: aScale },
          asset2: { x: b.x, z: b.z, scale: bScale },
          distance: dist,
          minSafe: minSafeDistance
        })
      }
    }
  }

  // Score calculation:
  // - 0 overlaps = 100
  // - 1-2 overlaps = 70-90 (minor issue)
  // - 3-5 overlaps = 40-70 (moderate issue)
  // - 6-10 overlaps = 10-40 (severe issue)
  // - 10+ overlaps = 0-10 (catastrophic)
  const count = overlaps.length
  let score
  if (count === 0) {
    score = 100
  } else if (count <= 2) {
    score = 90 - count * 10  // 80-70
  } else if (count <= 5) {
    score = 70 - (count - 2) * 10  // 60-40
  } else if (count <= 10) {
    score = 40 - (count - 5) * 6  // 34-10
  } else {
    score = Math.max(0, 10 - count)  // 0 for 10+ overlaps
  }

  return {
    score,
    count,
    overlaps: overlaps.slice(0, 10),  // Return first 10 for debugging
    message: count === 0 ? 'No overlaps detected' :
      count <= 2 ? 'Minor overlap issues' :
        count <= 5 ? 'Moderate overlap - scene quality affected' :
          'Severe overlap - scene is unusable'
  }
}

/**
 * Quick validation for layer-by-layer placement
 * Checks if adding new placements would create problems
 *
 * @param {Array} existing - Already placed assets
 * @param {Array} proposed - New placements to add
 * @param {{x: number, z: number}} [focalPosition] - Focal position if known
 * @returns {Object} Validation result with warnings
 */
export function validateLayerPlacement(existing, proposed, focalPosition = null) {
  const combined = [...existing, ...proposed]
  const warnings = []

  // Check for overcrowding (more than 50 assets in 60m zone)
  if (combined.length > 50) {
    warnings.push(`High asset count (${combined.length}) may cause performance issues`)
  }

  // Check proposed positions for collisions with existing
  const collisions = []
  for (const newPos of proposed) {
    for (const existingPos of existing) {
      const dist = Math.sqrt(
        (newPos.x - existingPos.x) ** 2 +
        (newPos.z - existingPos.z) ** 2
      )
      // Very close placement (within 2m) is probably a collision
      if (dist < 2) {
        collisions.push({ new: newPos, existing: existingPos, distance: dist })
      }
    }
  }

  if (collisions.length > 0) {
    warnings.push(`${collisions.length} potential collision(s) detected`)
  }

  // If we have a focal position, check visibility won't be blocked
  if (focalPosition) {
    const occlusionCheck = checkFocalVisibility(proposed, focalPosition, EVALUATION_CAMERAS)
    if (occlusionCheck.occluders.length > 0) {
      warnings.push(`${occlusionCheck.occluders.length} asset(s) may occlude focal point`)
    }
  }

  return {
    valid: warnings.length === 0,
    warnings,
    collisions,
    totalAssets: combined.length
  }
}

/**
 * Calculate optimal position for focal element
 * Slightly off-center for more dynamic composition (rule of thirds)
 *
 * @param {string} [style='centered'] - 'centered' | 'thirds-left' | 'thirds-right'
 * @returns {{x: number, z: number}} Optimal focal position
 */
export function calculateFocalPosition(style = 'centered') {
  const center = {
    x: SCENE_GENERATION.CENTER_X,
    z: SCENE_GENERATION.CENTER_Z
  }

  const offset = SCENE_GENERATION.SIZE / 6  // ~10m offset for rule of thirds

  switch (style) {
    case 'thirds-left':
      return { x: center.x - offset, z: center.z }
    case 'thirds-right':
      return { x: center.x + offset, z: center.z }
    case 'thirds-back':
      return { x: center.x, z: center.z + offset }
    case 'centered':
    default:
      // Slight offset toward camera for better visibility
      return { x: center.x + 2, z: center.z - 2 }
  }
}

/**
 * Suggest improvements based on composition score
 *
 * @param {Object} scoreResult - Result from scoreComposition()
 * @returns {Array<{priority: number, action: string, details: string}>}
 */
export function suggestImprovements(scoreResult) {
  const suggestions = []

  // Depth layer suggestions
  if (scoreResult.depthLayers.score < 70) {
    const layers = scoreResult.depthLayers.layers
    if (layers.background === 0) {
      suggestions.push({
        priority: 1,
        action: 'add_background',
        details: 'Add framing elements (trees, rocks) at scene edges'
      })
    }
    if (layers.foreground === 0) {
      suggestions.push({
        priority: 2,
        action: 'add_foreground',
        details: 'Add detail props near scene center'
      })
    }
  }

  // Focal visibility suggestions
  if (scoreResult.focalVisible.score < 70) {
    suggestions.push({
      priority: 1,
      action: 'clear_sightlines',
      details: `Move ${scoreResult.focalVisible.occluders.length} blocking asset(s) away from camera-focal line`
    })
  }

  // Density suggestions
  if (scoreResult.density.sparse.length > 2) {
    suggestions.push({
      priority: 2,
      action: 'fill_sparse',
      details: `Add assets to sparse areas: ${scoreResult.density.sparse.join(', ')}`
    })
  }

  // Balance suggestions
  if (scoreResult.balance.emptyQuadrants > 1) {
    suggestions.push({
      priority: 2,
      action: 'improve_balance',
      details: 'Distribute assets more evenly across quadrants'
    })
  }

  return suggestions.sort((a, b) => a.priority - b.priority)
}
