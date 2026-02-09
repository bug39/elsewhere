/**
 * SchemaCompiler - Deterministic compiler from v3 schema to Three.js code
 *
 * Eliminates LLM code generation failures by:
 * 1. Taking valid v3 schema JSON from planning phase
 * 2. Outputting guaranteed-correct Three.js code
 * 3. Enforcing connectivity through parent-child hierarchy
 * 4. Auto-snapping disconnected parts to their parents
 */

import { parseSchema } from './parser.js'
import { validateSchema, topologicalSort } from './validator.js'
import { emitModule } from './emitter.js'
import { estimateBounds } from './geometry.js'

// Distance threshold for auto-snap (in normalized units)
const SNAP_THRESHOLD = 2.0

/**
 * Main compiler class
 */
export class SchemaCompiler {
  /**
   * Compile a v3 schema to Three.js code
   * @param {Object} schema - Raw v3 schema from planning
   * @param {Object} options - Compilation options
   * @returns {{ code: string, warnings: string[] }}
   */
  static compile(schema, options = {}) {
    const { autoSnap = true, maxMeshes = 24, maxMaterials = 5 } = options

    // Step 1: Parse and normalize
    let parsed
    try {
      parsed = parseSchema(schema)
    } catch (err) {
      throw new Error(`Schema parse error: ${err.message}`)
    }

    // Step 2: Validate
    const validation = validateSchema(parsed)
    if (!validation.valid) {
      throw new Error(`Schema validation failed: ${validation.errors.join('; ')}`)
    }

    // Step 3: Apply budget constraints (remove low-priority parts if over budget)
    parsed = applyBudgetConstraints(parsed, maxMeshes, maxMaterials)

    // Step 4: Auto-snap connectivity if enabled
    if (autoSnap) {
      parsed = enforceConnectivity(parsed)
    }

    // Step 5: Emit code
    const code = emitModule(parsed)

    // Log success for telemetry
    console.log('[SchemaCompiler] Compilation successful:', {
      category: parsed.cat,
      parts: parsed.parts.length,
      materials: parsed.materials.length,
      totalMeshes: parsed.parts.reduce((sum, p) => sum + p.instances.length, 0),
      warnings: validation.warnings.length
    })

    return {
      code,
      warnings: validation.warnings
    }
  }

  /**
   * Check if a schema is valid and compilable
   * @param {Object} schema - Raw v3 schema
   * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
   */
  static validate(schema) {
    try {
      const parsed = parseSchema(schema)
      return validateSchema(parsed)
    } catch (err) {
      return {
        valid: false,
        errors: [err.message],
        warnings: []
      }
    }
  }
}

/**
 * Apply budget constraints by removing low-priority parts
 */
function applyBudgetConstraints(schema, maxMeshes, maxMaterials) {
  let totalMeshes = schema.parts.reduce((sum, p) => sum + p.instances.length, 0)

  // If within budget, return as-is
  if (totalMeshes <= maxMeshes && schema.materials.length <= maxMaterials) {
    return schema
  }

  const result = { ...schema }

  // Remove pr=3 parts first
  if (totalMeshes > maxMeshes) {
    result.parts = result.parts.filter(p => {
      if (p.priority === 3 && totalMeshes > maxMeshes) {
        totalMeshes -= p.instances.length
        return false
      }
      return true
    })
  }

  // Remove pr=2 parts if still over
  if (totalMeshes > maxMeshes) {
    result.parts = result.parts.filter(p => {
      if (p.priority === 2 && totalMeshes > maxMeshes) {
        totalMeshes -= p.instances.length
        return false
      }
      return true
    })
  }

  // Remove pr=1.5 (characteristic features) only as LAST resort after pr=2
  // These are important for recognizability but can be removed if truly necessary
  if (totalMeshes > maxMeshes) {
    result.parts = result.parts.filter(p => {
      if (p.priority === 1.5 && totalMeshes > maxMeshes) {
        console.warn(`[SchemaCompiler] Removing characteristic feature '${p.name}' to meet budget`)
        totalMeshes -= p.instances.length
        return false
      }
      return true
    })
  }

  // Reduce instance counts if still over (preserve symmetry by taking floor/2 * 2)
  if (totalMeshes > maxMeshes) {
    const excess = totalMeshes - maxMeshes
    let removed = 0

    for (const part of result.parts) {
      if (removed >= excess) break
      if (part.instances.length > 2) {
        const toRemove = Math.min(
          Math.floor((part.instances.length - 1) / 2) * 2,
          excess - removed
        )
        part.instances = part.instances.slice(0, part.instances.length - toRemove)
        removed += toRemove
      }
    }
  }

  // Truncate materials if over limit
  if (result.materials.length > maxMaterials) {
    result.materials = result.materials.slice(0, maxMaterials)
    // Clamp material indices
    for (const part of result.parts) {
      if (part.materialIndex >= maxMaterials) {
        part.materialIndex = 0
      }
    }
  }

  return result
}

/**
 * Enforce connectivity by auto-snapping disconnected parts to parents
 */
function enforceConnectivity(schema) {
  const result = { ...schema, parts: schema.parts.map(p => ({ ...p })) }

  // Build part bounds map
  const partBounds = new Map()
  const sortedParts = topologicalSort(result.parts)

  for (const part of sortedParts) {
    // Compute aggregate bounds for this part from all instances
    let partMin = [Infinity, Infinity, Infinity]
    let partMax = [-Infinity, -Infinity, -Infinity]

    for (const inst of part.instances) {
      const bounds = estimateBounds(
        part.geometry,
        part.geomParams,
        inst.position,
        inst.scale
      )

      for (let i = 0; i < 3; i++) {
        partMin[i] = Math.min(partMin[i], bounds.min[i])
        partMax[i] = Math.max(partMax[i], bounds.max[i])
      }
    }

    // If this part has a parent, check connectivity
    if (part.parent !== null && partBounds.has(part.parent)) {
      const parentBounds = partBounds.get(part.parent)

      // Check if any instance is too far from parent
      for (const inst of part.instances) {
        const distance = distanceToBox(inst.position, parentBounds)

        if (distance > SNAP_THRESHOLD) {
          // Snap to closest point on parent, preserving direction
          const snapped = snapToParent(inst.position, parentBounds)
          inst.position = snapped
        }
      }
    }

    partBounds.set(part.name, { min: partMin, max: partMax })
  }

  return result
}

/**
 * Calculate distance from a point to a bounding box
 */
function distanceToBox(point, bounds) {
  let distance = 0

  for (let i = 0; i < 3; i++) {
    if (point[i] < bounds.min[i]) {
      distance += (bounds.min[i] - point[i]) ** 2
    } else if (point[i] > bounds.max[i]) {
      distance += (point[i] - bounds.max[i]) ** 2
    }
  }

  return Math.sqrt(distance)
}

/**
 * Snap a point to the closest surface of a bounding box,
 * preserving the general direction (left stays left, etc.)
 */
function snapToParent(point, parentBounds) {
  const center = [
    (parentBounds.min[0] + parentBounds.max[0]) / 2,
    (parentBounds.min[1] + parentBounds.max[1]) / 2,
    (parentBounds.min[2] + parentBounds.max[2]) / 2
  ]

  // Direction from parent center to child
  const dir = [
    point[0] - center[0],
    point[1] - center[1],
    point[2] - center[2]
  ]

  const length = Math.sqrt(dir[0] ** 2 + dir[1] ** 2 + dir[2] ** 2)
  if (length === 0) {
    // Point is at center, place at top
    return [center[0], parentBounds.max[1], center[2]]
  }

  // Normalize direction
  const normDir = [dir[0] / length, dir[1] / length, dir[2] / length]

  // Find intersection with parent box surface along this direction
  const halfSize = [
    (parentBounds.max[0] - parentBounds.min[0]) / 2,
    (parentBounds.max[1] - parentBounds.min[1]) / 2,
    (parentBounds.max[2] - parentBounds.min[2]) / 2
  ]

  // Find the scale factor to reach the box surface
  let t = Infinity
  for (let i = 0; i < 3; i++) {
    if (Math.abs(normDir[i]) > 0.001) {
      const ti = halfSize[i] / Math.abs(normDir[i])
      if (ti < t) t = ti
    }
  }

  // Small offset outside the surface (10% of the half-size in that direction)
  const offset = 0.1 * Math.min(halfSize[0], halfSize[1], halfSize[2])
  t += offset

  return [
    center[0] + normDir[0] * t,
    center[1] + normDir[1] * t,
    center[2] + normDir[2] * t
  ]
}

export default SchemaCompiler
