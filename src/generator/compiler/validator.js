/**
 * Schema Validator - Validates parsed schema for correctness
 */

/**
 * Validate a parsed schema
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateSchema(schema) {
  const errors = []
  const warnings = []

  // Check materials
  if (!schema.materials || schema.materials.length === 0) {
    errors.push('Schema has no materials defined')
  } else if (schema.materials.length > 5) {
    warnings.push(`Schema has ${schema.materials.length} materials (max 5), will be truncated`)
  }

  // Check parts
  if (!schema.parts || schema.parts.length === 0) {
    errors.push('Schema has no parts defined')
  } else if (schema.parts.length < 3) {
    warnings.push(`Schema has only ${schema.parts.length} parts (recommended 3+)`)
  } else if (schema.parts.length > 24) {
    warnings.push(`Schema has ${schema.parts.length} parts (max 24), lower priority parts may be dropped`)
  }

  // Count total mesh instances
  const totalMeshes = schema.parts.reduce((sum, part) => sum + (part.instances?.length || 0), 0)
  if (totalMeshes === 0) {
    errors.push('Schema produces no mesh instances')
  } else if (totalMeshes > 24) {
    warnings.push(`Schema produces ${totalMeshes} meshes (max 24), some may be dropped`)
  }

  // Validate material references
  const matCount = schema.materials.length
  for (const part of schema.parts) {
    if (part.materialIndex >= matCount) {
      errors.push(`Part "${part.name}" references material index ${part.materialIndex} but only ${matCount} materials exist`)
    }
  }

  // Validate parent references (build parent map)
  const partNames = new Set(schema.parts.map(p => p.name))
  for (const part of schema.parts) {
    if (part.parent !== null && !partNames.has(part.parent)) {
      errors.push(`Part "${part.name}" references parent "${part.parent}" which doesn't exist`)
    }
  }

  // Check for cycles in parent hierarchy
  const cycleCheck = detectCycles(schema.parts)
  if (cycleCheck) {
    errors.push(`Cycle detected in part hierarchy: ${cycleCheck}`)
  }

  // Validate geometry types
  const validGeometries = ['Box', 'Sphere', 'Cylinder', 'Cone', 'Torus', 'Lathe', 'Tube', 'Dome']
  for (const part of schema.parts) {
    if (!validGeometries.includes(part.geometry)) {
      errors.push(`Part "${part.name}" has invalid geometry type "${part.geometry}"`)
    }
  }

  // Validate colors for visibility and contrast
  const colorValidation = validateColors(schema.materials)
  errors.push(...colorValidation.errors)
  warnings.push(...colorValidation.warnings)

  return {
    valid: errors.length === 0,
    errors,
    warnings
  }
}

/**
 * Validate material colors for visibility and contrast
 * @param {Object[]} materials - Array of material objects with 'color' property
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateColors(materials) {
  const errors = []
  const warnings = []

  if (!materials || materials.length === 0) {
    return { valid: true, errors, warnings }
  }

  // Calculate luminance for each material
  const luminances = materials.map((mat, idx) => {
    const rgb = mat.color
    const r = ((rgb >> 16) & 0xFF) / 255
    const g = ((rgb >> 8) & 0xFF) / 255
    const b = (rgb & 0xFF) / 255
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return { idx, lum, color: rgb }
  })

  const minLum = Math.min(...luminances.map(l => l.lum))
  const maxLum = Math.max(...luminances.map(l => l.lum))
  const avgLum = luminances.reduce((a, l) => a + l.lum, 0) / luminances.length

  // HARD RULE: No very dark materials (luminance < 0.15)
  // Threshold aligned with post-processing color correction to ensure consistent behavior
  for (const { idx, lum, color } of luminances) {
    if (lum < 0.15) {
      errors.push(`Material ${idx} (0x${color.toString(16).padStart(6, '0')}) has luminance ${lum.toFixed(3)} - too dark (min 0.15). Use dark gray (0x404040) or brighter.`)
    }
  }

  // HARD RULE: Material contrast required for multi-material assets
  if (materials.length > 1) {
    const spread = maxLum - minLum
    if (spread < 0.25) {
      errors.push(`Material luminance spread ${spread.toFixed(2)} - insufficient contrast (min 0.25). Brighten or diversify colors.`)
    }
  }

  // WARNING: Dark overall palette (not an error, but notable)
  if (avgLum < 0.3 && errors.length === 0) {
    warnings.push(`Average luminance ${avgLum.toFixed(2)} - consider lighter colors for visibility`)
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  }
}

/**
 * Detect cycles in parent hierarchy
 * @returns {string | null} - Cycle description or null if no cycle
 */
function detectCycles(parts) {
  const partMap = new Map(parts.map(p => [p.name, p]))

  for (const part of parts) {
    const visited = new Set()
    let current = part

    while (current && current.parent !== null) {
      if (visited.has(current.name)) {
        return `${current.name} -> ... -> ${current.name}`
      }
      visited.add(current.name)
      current = partMap.get(current.parent)
    }
  }

  return null
}

/**
 * Build topological order for parts (parents before children)
 * @returns {Object[]} - Parts sorted in dependency order
 */
export function topologicalSort(parts) {
  const partMap = new Map(parts.map(p => [p.name, p]))
  const sorted = []
  const visited = new Set()

  function visit(part) {
    if (visited.has(part.name)) return
    visited.add(part.name)

    // Visit parent first
    if (part.parent !== null && partMap.has(part.parent)) {
      visit(partMap.get(part.parent))
    }

    sorted.push(part)
  }

  for (const part of parts) {
    visit(part)
  }

  return sorted
}
