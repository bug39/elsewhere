/**
 * Spatial Reasoning Test Utilities
 *
 * Helper functions for validating AI spatial reasoning capabilities.
 * Used by spatial-reasoning.test.js to evaluate Gemini's ability to
 * reason about 3D positions, relationships, and layouts.
 */

/**
 * Calculate Euclidean distance between two 2D points
 * @param {{x: number, z: number}} a
 * @param {{x: number, z: number}} b
 * @returns {number}
 */
export function distance2D(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2)
}

/**
 * Check if positions form a ring pattern around a center point
 * A ring means all positions are roughly equidistant from the center
 *
 * @param {Array<{x: number, z: number}>} positions - Positions to check
 * @param {{x: number, z: number}} center - Center point
 * @param {number} expectedRadius - Expected distance from center
 * @param {number} tolerance - Allowed deviation from average distance
 * @returns {{isRing: boolean, distances: number[], avgDistance: number, maxDeviation: number}}
 */
export function analyzeRingPattern(positions, center, expectedRadius, tolerance = 1.5) {
  if (positions.length < 3) {
    return { isRing: false, distances: [], avgDistance: 0, maxDeviation: Infinity, reason: 'Need at least 3 points for a ring' }
  }

  const distances = positions.map(p => distance2D(p, center))
  const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length
  const maxDeviation = Math.max(...distances.map(d => Math.abs(d - avgDistance)))

  // Check if all points are roughly equidistant from center
  const isRing = maxDeviation < tolerance

  // Also check angular distribution - points shouldn't all be on one side
  const angles = positions.map(p => Math.atan2(p.z - center.z, p.x - center.x))
  const sortedAngles = [...angles].sort((a, b) => a - b)
  const maxGap = sortedAngles.reduce((max, angle, i) => {
    const nextAngle = sortedAngles[(i + 1) % sortedAngles.length]
    let gap = nextAngle - angle
    if (gap < 0) gap += 2 * Math.PI
    return Math.max(max, gap)
  }, 0)

  // If there's a gap larger than 180 degrees, points are clustered on one side
  const hasGoodDistribution = maxGap < Math.PI + 0.5

  return {
    isRing: isRing && hasGoodDistribution,
    distances,
    avgDistance,
    maxDeviation,
    maxAngularGap: maxGap * (180 / Math.PI),
    hasGoodDistribution
  }
}

/**
 * Check if positions form a line pattern
 * @param {Array<{x: number, z: number}>} positions
 * @param {number} tolerance - Max perpendicular distance from best-fit line
 * @returns {{isLine: boolean, direction: string}}
 */
export function analyzeLinePattern(positions, tolerance = 1) {
  if (positions.length < 2) {
    return { isLine: false, direction: 'none' }
  }

  // Check variance in X vs Z
  const xValues = positions.map(p => p.x)
  const zValues = positions.map(p => p.z)

  const xMin = Math.min(...xValues)
  const xMax = Math.max(...xValues)
  const zMin = Math.min(...zValues)
  const zMax = Math.max(...zValues)

  const xSpread = xMax - xMin
  const zSpread = zMax - zMin

  // Horizontal line: high X spread, low Z spread
  if (xSpread > 2 && zSpread < tolerance) {
    return { isLine: true, direction: 'horizontal' }
  }

  // Vertical line: low X spread, high Z spread
  if (zSpread > 2 && xSpread < tolerance) {
    return { isLine: true, direction: 'vertical' }
  }

  // Check for diagonal line using linear regression
  if (xSpread > 2 && zSpread > 2) {
    const n = positions.length
    const sumX = xValues.reduce((a, b) => a + b, 0)
    const sumZ = zValues.reduce((a, b) => a + b, 0)
    const sumXZ = positions.reduce((acc, p) => acc + p.x * p.z, 0)
    const sumX2 = xValues.reduce((acc, x) => acc + x * x, 0)

    const slope = (n * sumXZ - sumX * sumZ) / (n * sumX2 - sumX * sumX)
    const intercept = (sumZ - slope * sumX) / n

    // Calculate residuals
    const residuals = positions.map(p => Math.abs(p.z - (slope * p.x + intercept)))
    const maxResidual = Math.max(...residuals)

    if (maxResidual < tolerance * 2) {
      return { isLine: true, direction: 'diagonal', slope }
    }
  }

  return { isLine: false, direction: 'none' }
}

/**
 * Classify direction from one point to another
 * @param {{x: number, z: number}} from
 * @param {{x: number, z: number}} to
 * @returns {string} Direction: 'north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest'
 */
export function classifyDirection(from, to) {
  const dx = to.x - from.x
  const dz = to.z - from.z

  // +Z is north, +X is east (standard game coordinates)
  const angle = Math.atan2(dz, dx) * (180 / Math.PI)

  // Normalize to 0-360
  const normalizedAngle = ((angle % 360) + 360) % 360

  // Map angle to direction (22.5 degree sectors)
  if (normalizedAngle >= 337.5 || normalizedAngle < 22.5) return 'east'
  if (normalizedAngle >= 22.5 && normalizedAngle < 67.5) return 'northeast'
  if (normalizedAngle >= 67.5 && normalizedAngle < 112.5) return 'north'
  if (normalizedAngle >= 112.5 && normalizedAngle < 157.5) return 'northwest'
  if (normalizedAngle >= 157.5 && normalizedAngle < 202.5) return 'west'
  if (normalizedAngle >= 202.5 && normalizedAngle < 247.5) return 'southwest'
  if (normalizedAngle >= 247.5 && normalizedAngle < 292.5) return 'south'
  if (normalizedAngle >= 292.5 && normalizedAngle < 337.5) return 'southeast'

  return 'unknown'
}

/**
 * Check if a direction is reasonably close to expected
 * @param {string} actual
 * @param {string} expected
 * @returns {boolean}
 */
export function isDirectionClose(actual, expected) {
  const directionOrder = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']
  const actualIdx = directionOrder.indexOf(actual.toLowerCase())
  const expectedIdx = directionOrder.indexOf(expected.toLowerCase())

  if (actualIdx === -1 || expectedIdx === -1) return actual.toLowerCase() === expected.toLowerCase()

  // Allow ±1 direction (e.g., 'north' matches 'northeast' or 'northwest')
  const diff = Math.abs(actualIdx - expectedIdx)
  return diff <= 1 || diff >= 7 // Handle wrap-around (north <-> northwest)
}

/**
 * Score a spatial critique response against expected problems
 * @param {Array<{issue: string}>} response - AI's identified problems
 * @param {Array<{keyword: string, description: string}>} expectedProblems - Problems we expect to be identified
 * @returns {{score: number, total: number, found: string[], missed: string[]}}
 */
export function scoreSpatialCritique(response, expectedProblems) {
  const found = []
  const missed = []

  for (const expected of expectedProblems) {
    // Check if any response issue contains the expected keyword
    const wasFound = response.some(r =>
      r.issue.toLowerCase().includes(expected.keyword.toLowerCase())
    )

    if (wasFound) {
      found.push(expected.description)
    } else {
      missed.push(expected.description)
    }
  }

  return {
    score: found.length,
    total: expectedProblems.length,
    found,
    missed
  }
}

/**
 * Check if positions have any overlaps (collisions)
 * @param {Array<{x: number, z: number}>} positions
 * @param {number} minDistance - Minimum allowed distance between any two points
 * @returns {{hasOverlaps: boolean, overlaps: Array<{i: number, j: number, distance: number}>}}
 */
export function checkOverlaps(positions, minDistance = 0.5) {
  const overlaps = []

  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const dist = distance2D(positions[i], positions[j])
      if (dist < minDistance) {
        overlaps.push({ i, j, distance: dist })
      }
    }
  }

  return {
    hasOverlaps: overlaps.length > 0,
    overlaps
  }
}

/**
 * Check if a position is within expected bounds
 * @param {{x: number, z: number}} pos
 * @param {number} gridSize
 * @returns {boolean}
 */
export function isInBounds(pos, gridSize) {
  return pos.x >= 0 && pos.x < gridSize && pos.z >= 0 && pos.z < gridSize
}

/**
 * Check if all positions are on or near a specific edge
 * @param {Array<{x: number, z: number}>} positions
 * @param {'north'|'south'|'east'|'west'} edge
 * @param {number} gridSize
 * @param {number} tolerance
 * @returns {{onEdge: boolean, percentage: number}}
 */
export function checkEdgePlacement(positions, edge, gridSize, tolerance = 1) {
  const edgeChecks = {
    north: p => p.z >= gridSize - 1 - tolerance,
    south: p => p.z <= tolerance,
    east: p => p.x >= gridSize - 1 - tolerance,
    west: p => p.x <= tolerance
  }

  const check = edgeChecks[edge]
  if (!check) return { onEdge: false, percentage: 0 }

  const onEdge = positions.filter(check)
  return {
    onEdge: onEdge.length === positions.length,
    percentage: (onEdge.length / positions.length) * 100
  }
}

/**
 * Validate that "behind" relationship is satisfied
 * Objects should be further from a reference point than foreground objects
 * @param {Array<{x: number, z: number}>} behindObjects
 * @param {Array<{x: number, z: number}>} frontObjects
 * @param {{x: number, z: number}} reference - The perspective point (e.g., fountain center)
 * @returns {{isValid: boolean, behindDistances: number[], frontDistances: number[]}}
 */
export function validateBehindRelationship(behindObjects, frontObjects, reference) {
  const behindDistances = behindObjects.map(p => distance2D(p, reference))
  const frontDistances = frontObjects.map(p => distance2D(p, reference))

  const minBehindDistance = Math.min(...behindDistances)
  const maxFrontDistance = Math.max(...frontDistances)

  return {
    isValid: minBehindDistance > maxFrontDistance,
    behindDistances,
    frontDistances,
    minBehindDistance,
    maxFrontDistance
  }
}

/**
 * Check if positions are symmetric around an axis
 * @param {Array<{x: number, z: number}>} positions
 * @param {'x'|'z'} axis - Axis of symmetry
 * @param {number} axisValue - The coordinate value of the axis
 * @param {number} tolerance
 * @returns {{isSymmetric: boolean, pairs: Array}}
 */
export function checkSymmetry(positions, axis, axisValue, tolerance = 1) {
  if (positions.length < 2) return { isSymmetric: false, reason: 'Need at least 2 positions' }

  const pairs = []
  const used = new Set()

  for (let i = 0; i < positions.length; i++) {
    if (used.has(i)) continue

    const pos = positions[i]
    const mirrorCoord = axis === 'x'
      ? 2 * axisValue - pos.x
      : 2 * axisValue - pos.z

    // Find matching mirrored position
    for (let j = 0; j < positions.length; j++) {
      if (i === j || used.has(j)) continue

      const other = positions[j]
      const otherMirrorCoord = axis === 'x' ? other.x : other.z
      const samePrimaryCoord = axis === 'x'
        ? Math.abs(pos.z - other.z) < tolerance
        : Math.abs(pos.x - other.x) < tolerance

      if (Math.abs(otherMirrorCoord - mirrorCoord) < tolerance && samePrimaryCoord) {
        pairs.push({ i, j })
        used.add(i)
        used.add(j)
        break
      }
    }
  }

  return {
    isSymmetric: pairs.length * 2 === positions.length,
    pairs,
    unpairedCount: positions.length - pairs.length * 2
  }
}

/**
 * Extract JSON from a Gemini response that may contain markdown fences
 * @param {string} text
 * @returns {object|null}
 */
export function extractJSON(text) {
  if (!text || typeof text !== 'string') {
    return null
  }

  // Clean up the text - remove any leading/trailing whitespace and BOM
  let cleaned = text.trim().replace(/^\uFEFF/, '')

  // Try direct parse first
  try {
    return JSON.parse(cleaned)
  } catch (e) {
    // Continue to extraction
  }

  // Try to extract from markdown code fence
  const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1].trim())
    } catch (e) {
      // Continue
    }
  }

  // Try to find a complete JSON object - use greedy match and find balanced braces
  const startIdx = cleaned.indexOf('{')
  if (startIdx !== -1) {
    let depth = 0
    let inString = false
    let escape = false

    for (let i = startIdx; i < cleaned.length; i++) {
      const char = cleaned[i]

      if (escape) {
        escape = false
        continue
      }

      if (char === '\\' && inString) {
        escape = true
        continue
      }

      if (char === '"') {
        inString = !inString
        continue
      }

      if (!inString) {
        if (char === '{') depth++
        if (char === '}') {
          depth--
          if (depth === 0) {
            const jsonStr = cleaned.slice(startIdx, i + 1)
            try {
              return JSON.parse(jsonStr)
            } catch (e) {
              // Continue searching
            }
            break
          }
        }
      }
    }
  }

  // Last resort: try to find JSON array
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/)
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0])
    } catch (e) {
      // Continue
    }
  }

  return null
}

/**
 * Validate that spacing values are reasonable for real-world scale
 * @param {object} spacing - Object with spacing values
 * @param {object} sizes - Object with asset sizes
 * @returns {{isReasonable: boolean, issues: string[]}}
 */
export function validateSpacingReasonableness(spacing, sizes) {
  const issues = []

  // Cottages should be at least their width + some path space apart
  if (spacing.cottageToCollage < 10) {
    issues.push('Cottage spacing too small (< 10m for 8m wide buildings)')
  }
  if (spacing.cottageToCollage > 60) {
    issues.push('Cottage spacing too large (> 60m, would look empty)')
  }

  // Trees shouldn't overlap canopies
  if (spacing.treeToTree < 4) {
    issues.push('Tree spacing too small (< 4m, canopies would overlap)')
  }
  if (spacing.treeToTree > 30) {
    issues.push('Tree spacing too large (> 30m for a cohesive look)')
  }

  // Well to cottage needs access path
  if (spacing.cottageToWell < 8) {
    issues.push('Cottage to well spacing too small (< 8m, no room for paths)')
  }

  return {
    isReasonable: issues.length === 0,
    issues
  }
}

/**
 * Format test results for console output
 * @param {object} results - Test results object
 * @returns {string}
 */
export function formatTestResults(results) {
  const lines = [
    '',
    '=== SPATIAL REASONING TEST RESULTS ===',
    ''
  ]

  let totalScore = 0
  let totalPossible = 0

  for (const [testName, result] of Object.entries(results)) {
    lines.push(`TEST ${testName}: ${result.title}`)

    for (const [checkName, check] of Object.entries(result.checks || {})) {
      const status = check.passed ? 'PASS' : 'FAIL'
      const detail = check.detail ? ` (${check.detail})` : ''
      lines.push(`  - ${checkName}: ${status}${detail}`)
    }

    const score = result.score || 0
    const possible = result.possible || 0
    totalScore += score
    totalPossible += possible
    lines.push(`  Score: ${score}/${possible}`)
    lines.push('')
  }

  const percentage = totalPossible > 0 ? Math.round((totalScore / totalPossible) * 100) : 0
  lines.push(`=== OVERALL: ${totalScore}/${totalPossible} (${percentage}%) ===`)
  lines.push('')

  // Interpretation
  if (percentage < 50) {
    lines.push('INTERPRETATION: Gemini cannot reason spatially adequately')
    lines.push('RECOMMENDATION: Move ALL placement to deterministic algorithms')
  } else if (percentage < 75) {
    lines.push('INTERPRETATION: Partial spatial reasoning capability')
    lines.push('RECOMMENDATION: Hybrid approach - AI for some tasks, algorithms for others')
  } else {
    lines.push('INTERPRETATION: Good spatial reasoning capability')
    lines.push('RECOMMENDATION: Our implementation is the problem, not the approach')
  }

  return lines.join('\n')
}
