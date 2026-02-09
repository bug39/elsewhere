/**
 * Schema Modifiers - Apply modifications to v3 schemas
 *
 * Tier 1: Direct modifications (color, material, scale) - no LLM needed
 * Tier 2: LLM-assisted modifications (add/remove parts, geometry changes)
 */

import { geminiClient } from './GeminiClient.js'
import { SchemaCompiler } from './compiler/SchemaCompiler.js'

/** Darken a hex color by a factor (0-1) */
function darkenColor(hex, factor) {
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * (1 - factor))
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * (1 - factor))
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * (1 - factor))
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase()
}

/** Lighten a hex color by a factor (0-1) */
function lightenColor(hex, factor) {
  const r = Math.round(parseInt(hex.slice(1, 3), 16) + (255 - parseInt(hex.slice(1, 3), 16)) * factor)
  const g = Math.round(parseInt(hex.slice(3, 5), 16) + (255 - parseInt(hex.slice(3, 5), 16)) * factor)
  const b = Math.round(parseInt(hex.slice(5, 7), 16) + (255 - parseInt(hex.slice(5, 7), 16)) * factor)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase()
}

/** Parse a color description string to a hex color code */
function parseColor(colorDesc) {
  if (!colorDesc) return '#808080'
  if (/^#[0-9A-Fa-f]{6}$/.test(colorDesc)) return colorDesc.toUpperCase()

  const colorMap = {
    red: '#FF0000', blue: '#0000FF', green: '#00FF00', yellow: '#FFFF00',
    orange: '#FFA500', purple: '#800080', pink: '#FFC0CB', brown: '#8B4513',
    black: '#000000', white: '#FFFFFF', gray: '#808080', grey: '#808080',
    gold: '#FFD700', silver: '#C0C0C0', cyan: '#00FFFF', magenta: '#FF00FF',
    teal: '#008080', navy: '#000080', maroon: '#800000', olive: '#808000',
    beige: '#F5F5DC', tan: '#D2B48C', coral: '#FF7F50', salmon: '#FA8072',
    turquoise: '#40E0D0', violet: '#EE82EE', indigo: '#4B0082'
  }

  const lower = colorDesc.toLowerCase()
  for (const [name, hex] of Object.entries(colorMap)) {
    if (lower.includes(name)) {
      if (lower.includes('dark')) return darkenColor(hex, 0.3)
      if (lower.includes('light') || lower.includes('bright')) return lightenColor(hex, 0.3)
      return hex
    }
  }
  return '#808080'
}

/**
 * @typedef {Object} ModificationResult
 * @property {Object} schema - Modified schema (or original if not applied)
 * @property {boolean} applied - Whether modification was applied
 * @property {string} description - Human-readable description of what changed
 * @property {string[]} [warnings] - Any warnings during modification
 */

// Position bounds for validation
const POSITION_BOUNDS = { min: -10, max: 10 }
const MAX_PART_COUNT = 24

/**
 * Apply a Tier 1 modification directly to schema
 * @param {Object} schema - v3 schema (raw format with m/p arrays)
 * @param {import('./ModificationClassifier.js').ClassificationResult} classification
 * @returns {ModificationResult}
 */
export function applyTier1Modification(schema, classification) {
  const { type, targets, parameters } = classification

  switch (type) {
    case 'colorChange':
      return applyColorChange(schema, targets, parameters.color)
    case 'materialChange':
      return applyMaterialChange(schema, targets, parameters)
    case 'scaleChange':
      return applyScaleChange(schema, targets, parameters)
    default:
      return { schema, applied: false, description: 'Not a Tier 1 modification' }
  }
}

/**
 * Apply color change to schema materials
 * @param {Object} schema - v3 schema
 * @param {string[]} targets - Target parts or ['all']
 * @param {string} color - Hex color code
 * @returns {ModificationResult}
 */
function applyColorChange(schema, targets, color) {
  const modified = structuredClone(schema)
  const hexColor = typeof color === 'string' && color.startsWith('#') ? color : parseColor(color)

  if (targets.includes('all')) {
    // Change all materials
    for (const mat of modified.m) {
      mat.c = hexColor
    }
    return {
      schema: modified,
      applied: true,
      description: `Changed all colors to ${hexColor}`
    }
  }

  // Find materials used by target parts
  const targetLower = targets.map(t => t.toLowerCase())
  const affectedMaterials = new Set()

  for (const part of modified.p) {
    const partName = (part.n || '').toLowerCase()
    const matchesTarget = targetLower.some(target =>
      partName.includes(target) || target.includes(partName)
    )

    if (matchesTarget) {
      affectedMaterials.add(part.mat)
    }
  }

  if (affectedMaterials.size === 0) {
    // Fallback: change all materials if no specific targets found
    for (const mat of modified.m) {
      mat.c = hexColor
    }
    return {
      schema: modified,
      applied: true,
      description: `Changed all colors to ${hexColor} (no matching parts found for targets: ${targets.join(', ')})`,
      warnings: [`No parts matched targets: ${targets.join(', ')}. Applied to all materials.`]
    }
  }

  // Change only affected materials
  for (const matIndex of affectedMaterials) {
    if (modified.m[matIndex]) {
      modified.m[matIndex].c = hexColor
    }
  }

  return {
    schema: modified,
    applied: true,
    description: `Changed color of ${targets.join(', ')} to ${hexColor}`
  }
}

/**
 * Apply material property changes to schema
 * @param {Object} schema - v3 schema
 * @param {string[]} targets - Target parts or ['all']
 * @param {Object} parameters - Material parameters (roughness, metalness, emissive, etc.)
 * @returns {ModificationResult}
 */
function applyMaterialChange(schema, targets, parameters) {
  const modified = structuredClone(schema)
  const { roughness, metalness, emissive, emissiveIntensity } = parameters
  const changes = []

  // Determine which materials to modify
  let materialsToModify = []

  if (targets.includes('all')) {
    materialsToModify = modified.m.map((_, i) => i)
  } else {
    const targetLower = targets.map(t => t.toLowerCase())
    const materialIndices = new Set()

    for (const part of modified.p) {
      const partName = (part.n || '').toLowerCase()
      const matchesTarget = targetLower.some(target =>
        partName.includes(target) || target.includes(partName)
      )
      if (matchesTarget) {
        materialIndices.add(part.mat)
      }
    }

    materialsToModify = materialIndices.size > 0 ? [...materialIndices] : modified.m.map((_, i) => i)
  }

  // Apply material property changes
  for (const matIndex of materialsToModify) {
    const mat = modified.m[matIndex]
    if (!mat) continue

    if (roughness !== undefined) {
      mat.r = Math.max(0, Math.min(1, roughness))
      changes.push(`roughness=${mat.r.toFixed(2)}`)
    }
    if (metalness !== undefined) {
      mat.met = Math.max(0, Math.min(1, metalness))
      changes.push(`metalness=${mat.met.toFixed(2)}`)
    }
    if (emissive) {
      mat.e = typeof emissive === 'string' && emissive.startsWith('#') ? emissive : parseColor(emissive)
      changes.push(`emissive=${mat.e}`)
    }
    if (emissiveIntensity !== undefined) {
      mat.ei = Math.max(0, Math.min(1, emissiveIntensity))
      changes.push(`emissiveIntensity=${mat.ei.toFixed(2)}`)
    }
  }

  const targetDesc = targets.includes('all') ? 'all materials' : targets.join(', ')
  return {
    schema: modified,
    applied: changes.length > 0,
    description: `Modified ${targetDesc}: ${changes.join(', ') || 'no changes'}`
  }
}

/**
 * Apply scale changes to schema parts
 * @param {Object} schema - v3 schema
 * @param {string[]} targets - Target parts or ['all']
 * @param {Object} parameters - Scale parameters (scaleFactor, axis)
 * @returns {ModificationResult}
 */
function applyScaleChange(schema, targets, parameters) {
  const modified = structuredClone(schema)
  const { scaleFactor = 1.5, axis = 'all' } = parameters
  const clampedFactor = Math.max(0.1, Math.min(5, scaleFactor))

  // Determine which parts to scale
  let partsToScale = []

  if (targets.includes('all')) {
    partsToScale = modified.p
  } else {
    const targetLower = targets.map(t => t.toLowerCase())
    partsToScale = modified.p.filter(part => {
      const partName = (part.n || '').toLowerCase()
      return targetLower.some(target =>
        partName.includes(target) || target.includes(partName)
      )
    })

    // If no matches, scale all parts
    if (partsToScale.length === 0) {
      partsToScale = modified.p
    }
  }

  // Apply scale to part instances only (not geometry, to avoid double-scaling)
  // The instance scale transform is the correct place for user-requested size changes.
  // Geometry defines the base shape; modifying both causes ~factor² effect.
  let scaledCount = 0
  for (const part of partsToScale) {
    if (!part.i) continue

    for (const inst of part.i) {
      const currentScale = inst.s || [1, 1, 1]

      if (axis === 'all') {
        inst.s = [
          currentScale[0] * clampedFactor,
          currentScale[1] * clampedFactor,
          currentScale[2] * clampedFactor
        ]
      } else if (axis === 'x') {
        inst.s = [currentScale[0] * clampedFactor, currentScale[1], currentScale[2]]
      } else if (axis === 'y') {
        inst.s = [currentScale[0], currentScale[1] * clampedFactor, currentScale[2]]
      } else if (axis === 'z') {
        inst.s = [currentScale[0], currentScale[1], currentScale[2] * clampedFactor]
      }

      scaledCount++
    }
  }

  const targetDesc = targets.includes('all') ? 'entire asset' : targets.join(', ')
  return {
    schema: modified,
    applied: scaledCount > 0,
    description: `Scaled ${targetDesc} by ${clampedFactor.toFixed(2)}x${axis !== 'all' ? ` on ${axis} axis` : ''}`
  }
}

// System prompt for Tier 2 modifications
const TIER2_SYSTEM_PROMPT = `You are a 3D asset schema modifier. You receive an EXISTING v3 schema JSON and a modification request, and output the modified schema.

CRITICAL: You are MODIFYING an existing asset, not creating a new one. The base structure, materials, and parts must be PRESERVED - only add/modify/remove what the request specifically asks for.

SCHEMA FORMAT:
{
  "v": 3,
  "cat": "character|creature|building|prop|nature|vehicle",
  "floatY": 0,  // Y offset for floating assets
  "m": [  // Materials (max 5)
    { "n": "name", "c": "#RRGGBB", "r": 0.7, "met": 0, "e": "#000000", "ei": 0, "flat": true }
  ],
  "p": [  // Parts
    {
      "n": "partName",        // Name (used for animation detection)
      "par": null|"parentName", // Parent part (null for root)
      "g": "Box|Sphere|Cylinder|Cone|Torus|Lathe|Tube",
      "geom": { ... },        // Geometry params (varies by type)
      "mat": 0,               // Material index
      "pr": 1|1.5|2|3,        // Priority (1=core, 1.5=characteristic, 2=detail, 3=decorative)
      "i": [                  // Instances
        { "p": [x,y,z], "r": [rx,ry,rz], "s": [sx,sy,sz] }
      ]
    }
  ]
}

MODIFICATION RULES:

1. ADD PARTS:
   - KEEP ALL existing parts - only add new ones
   - New parts must have a valid parent (null for root, or EXISTING part name from the schema)
   - Position relative to parent, use small offsets
   - Use appropriate geometry: Box for angular, Sphere for round, Cylinder for tubes
   - Priority: 1.5 for characteristic features (ears, horns, arms), 2 for details
   - Reuse existing materials when colors match, only add new if needed

2. REMOVE PARTS:
   - Remove ONLY the specific part requested from the "p" array
   - Also remove any children that reference the removed part as parent
   - KEEP all other parts unchanged
   - Do NOT remove materials

3. GEOMETRY CHANGES:
   - Change "g" to new geometry type
   - Update "geom" params appropriately:
     - Box: { w, h, d }
     - Sphere: { r }
     - Cylinder: { rt, rb, h }
     - Cone: { r, h }
     - Torus: { r, tube } (default UPRIGHT; for flat horizontal, add rotation [1.57, 0, 0])

4. TRANSFORM PARTS:
   - Modify position in instances "p": [x, y, z]
   - Modify rotation "r": [rx, ry, rz] (in radians)
   - Keep positions within bounds: -10 to 10 on each axis

5. CONSTRAINTS:
   - PRESERVE all unmentioned parts exactly as they are
   - Max 24 parts total
   - Max 5 materials
   - Maintain parent-child relationships
   - Keep the same "v", "cat", and "floatY" values

OUTPUT ONLY the complete modified JSON schema. No explanation, no markdown, just valid JSON that includes ALL parts (original + new).`

/**
 * Apply a Tier 2 modification using LLM
 * @param {Object} schema - v3 schema
 * @param {import('./ModificationClassifier.js').ClassificationResult} classification
 * @param {string} originalPrompt - User's modification request
 * @returns {Promise<ModificationResult>}
 */
export async function applyTier2Modification(schema, classification, originalPrompt) {
  // Count existing parts and materials for reference
  const existingPartCount = schema.p?.length || 0
  const existingPartNames = (schema.p || []).map(p => p.n).join(', ')
  const existingMaterialCount = schema.m?.length || 0

  const prompt = `EXISTING SCHEMA TO MODIFY (has ${existingPartCount} parts, ${existingMaterialCount} materials):
${JSON.stringify(schema, null, 2)}

MODIFICATION REQUEST: "${originalPrompt}"

IMPORTANT:
- This asset currently has these parts: ${existingPartNames}
- You must KEEP all these existing parts and only ${classification.type === 'addParts' ? 'ADD new parts' : classification.type === 'removeParts' ? 'REMOVE the specified parts' : 'MODIFY the specified parts'}.
- Material indices must be valid (0 to ${Math.max(0, existingMaterialCount - 1)}). If you need a new color, add it to the "m" array first (max 5 materials).
- Part positions must stay within bounds [-10, 10] on each axis.

Output the COMPLETE modified schema with ALL parts (existing + any changes).`

  try {
    const response = await geminiClient.generate(prompt, TIER2_SYSTEM_PROMPT, {
      temperature: 0.5,
      maxOutputTokens: 8192,
      thinkingBudget: 0
    })

    // Extract JSON from response
    const jsonStr = extractJSON(response)
    const modifiedSchema = JSON.parse(jsonStr)

    // Validate the modified schema structure first
    const validation = SchemaCompiler.validate(modifiedSchema)
    if (!validation.valid) {
      return {
        schema,
        applied: false,
        description: `Schema validation failed: ${validation.errors.join('; ')}`,
        warnings: validation.warnings
      }
    }

    // Validate and auto-correct the schema (mutates modifiedSchema)
    const correction = validateAndCorrectSchema(schema, modifiedSchema)

    // Reject if modification is too destructive
    if (correction.reject) {
      return {
        schema,
        applied: false,
        description: correction.rejectReason,
        warnings: correction.warnings
      }
    }

    // Combine all warnings
    const allWarnings = [
      ...(validation.warnings || []),
      ...correction.warnings,
      ...correction.corrections.map(c => `Auto-corrected: ${c}`)
    ]

    return {
      schema: modifiedSchema,
      applied: true,
      description: classification.description || `Applied ${classification.type} modification`,
      warnings: allWarnings
    }
  } catch (error) {
    return {
      schema,
      applied: false,
      description: `Modification failed: ${error.message}`,
      warnings: []
    }
  }
}

/**
 * Extract JSON from a response that may contain markdown code blocks
 * @param {string} text - Response text
 * @returns {string} Cleaned JSON string
 */
function extractJSON(text) {
  // Try to find JSON in code blocks first
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim()
  }

  // Try to find raw JSON object
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    return jsonMatch[0]
  }

  return text.trim()
}

// Scale bounds for validation
const SCALE_BOUNDS = { min: 0.1, max: 5 }

/**
 * Validate and auto-correct modified schema before compilation
 * This function MUTATES the schema to fix issues that would cause broken assets.
 *
 * @param {Object} original - Original schema
 * @param {Object} modified - Modified schema (will be mutated)
 * @returns {{ warnings: string[], corrections: string[], reject: boolean, rejectReason?: string }}
 */
function validateAndCorrectSchema(original, modified) {
  const warnings = []
  const corrections = []
  let reject = false
  let rejectReason

  // Check part count - truncate if over limit
  if (modified.p?.length > MAX_PART_COUNT) {
    warnings.push(`Part count (${modified.p.length}) exceeds maximum (${MAX_PART_COUNT}) - truncating`)
    modified.p = modified.p.slice(0, MAX_PART_COUNT)
    corrections.push(`Truncated to ${MAX_PART_COUNT} parts`)
  }

  // Check material count - truncate if over limit (max 5)
  if (modified.m?.length > 5) {
    warnings.push(`Material count (${modified.m.length}) exceeds maximum (5) - truncating`)
    modified.m = modified.m.slice(0, 5)
    corrections.push(`Truncated to 5 materials`)
  }

  // Fix material references BEFORE any other validation
  const maxMatIndex = Math.max(0, (modified.m?.length || 1) - 1)
  for (const part of modified.p || []) {
    if (typeof part.mat !== 'number' || isNaN(part.mat)) {
      part.mat = 0
      corrections.push(`Part "${part.n}" had invalid material reference - set to 0`)
    } else if (part.mat < 0) {
      const oldMat = part.mat
      part.mat = 0
      corrections.push(`Part "${part.n}" had negative material index ${oldMat} - clamped to 0`)
    } else if (part.mat > maxMatIndex) {
      const oldMat = part.mat
      // Try to find closest color match if we have the intended color info
      // Otherwise, clamp to nearest valid index
      part.mat = Math.min(part.mat, maxMatIndex)
      corrections.push(`Part "${part.n}" referenced material ${oldMat} but only ${modified.m?.length || 0} exist - clamped to ${part.mat}`)
    }
  }

  // Check for orphaned parts and fix parent references
  const partNames = new Set(modified.p?.map(p => p.n) || [])
  for (const part of modified.p || []) {
    if (part.par && !partNames.has(part.par)) {
      warnings.push(`Part "${part.n}" references non-existent parent "${part.par}" - setting to null`)
      part.par = null
      corrections.push(`Fixed orphaned part "${part.n}" by removing parent reference`)
    }
  }

  // Check and clamp position bounds
  for (const part of modified.p || []) {
    for (const inst of part.i || []) {
      const pos = inst.p || [0, 0, 0]
      let clamped = false
      const clampedPos = pos.map(v => {
        if (v < POSITION_BOUNDS.min) {
          clamped = true
          return POSITION_BOUNDS.min
        }
        if (v > POSITION_BOUNDS.max) {
          clamped = true
          return POSITION_BOUNDS.max
        }
        return v
      })
      if (clamped) {
        inst.p = clampedPos
        corrections.push(`Part "${part.n}" position clamped to bounds [${POSITION_BOUNDS.min}, ${POSITION_BOUNDS.max}]`)
      }
    }
  }

  // Check and clamp scale bounds
  for (const part of modified.p || []) {
    for (const inst of part.i || []) {
      const scale = inst.s || [1, 1, 1]
      let clamped = false
      const clampedScale = scale.map(v => {
        if (v < SCALE_BOUNDS.min) {
          clamped = true
          return SCALE_BOUNDS.min
        }
        if (v > SCALE_BOUNDS.max) {
          clamped = true
          return SCALE_BOUNDS.max
        }
        return v
      })
      if (clamped) {
        inst.s = clampedScale
        corrections.push(`Part "${part.n}" scale clamped to bounds [${SCALE_BOUNDS.min}, ${SCALE_BOUNDS.max}]`)
      }
    }
  }

  // Check that original parts are preserved (detect total rewrites)
  const originalPartNames = new Set((original.p || []).map(p => p.n))
  const modifiedPartNames = new Set((modified.p || []).map(p => p.n))
  const preservedCount = [...originalPartNames].filter(n => modifiedPartNames.has(n)).length
  const preservationRatio = originalPartNames.size > 0 ? preservedCount / originalPartNames.size : 1

  // If less than 50% of original parts are preserved, REJECT the modification
  if (originalPartNames.size > 0 && preservationRatio < 0.5) {
    reject = true
    rejectReason = `Modification would remove too many parts (only ${preservedCount}/${originalPartNames.size} preserved). This appears to be a rewrite rather than a modification. Try a more specific request, or regenerate the asset instead.`
  } else if (preservationRatio < 0.7) {
    // Warn if between 50-70% preserved
    warnings.push(`Only ${preservedCount}/${originalPartNames.size} (${Math.round(preservationRatio * 100)}%) of original parts preserved - modification may be too aggressive`)
  }

  return { warnings, corrections, reject, rejectReason }
}

/**
 * Validate modified schema against original (legacy function for backwards compatibility)
 * @param {Object} original - Original schema
 * @param {Object} modified - Modified schema
 * @returns {string[]} Warnings
 */
function validateModifiedSchema(original, modified) {
  const { warnings, corrections } = validateAndCorrectSchema(original, structuredClone(modified))
  return [...warnings, ...corrections]
}

/**
 * Derive a human-readable name for a variant based on modification
 * @param {string} originalName - Original asset name
 * @param {import('./ModificationClassifier.js').ClassificationResult} classification
 * @returns {string} Derived variant name
 */
export function deriveVariantName(originalName, classification) {
  const { type, parameters, targets, description } = classification

  // Use description if short enough
  if (description && description.length < 30 && !description.toLowerCase().includes(originalName.toLowerCase())) {
    // Capitalize first letter
    const shortDesc = description.charAt(0).toUpperCase() + description.slice(1)
    if (shortDesc.length < 20) {
      return `${shortDesc} ${originalName}`
    }
  }

  switch (type) {
    case 'colorChange': {
      const color = parameters.color || ''
      const colorName = getColorName(color)
      if (colorName) {
        return `${colorName} ${originalName}`
      }
      break
    }

    case 'scaleChange': {
      const factor = parameters.scaleFactor || 1
      if (factor > 1.3) return `Large ${originalName}`
      if (factor < 0.7) return `Small ${originalName}`
      break
    }

    case 'addParts': {
      const partDesc = parameters.partDescription || ''
      if (partDesc.length < 15) {
        return `${originalName} with ${partDesc}`
      }
      break
    }

    case 'removeParts': {
      const partDesc = parameters.partDescription || ''
      if (partDesc.length < 15) {
        return `${originalName} without ${partDesc}`
      }
      break
    }

    case 'materialChange': {
      if (parameters.metalness > 0.5) return `Metallic ${originalName}`
      if (parameters.roughness < 0.3) return `Glossy ${originalName}`
      if (parameters.emissiveIntensity > 0.3) return `Glowing ${originalName}`
      break
    }
  }

  // Fallback
  return `${originalName} (variant)`
}

/**
 * Get a human-readable color name from hex
 * @param {string} hex - Hex color code
 * @returns {string|null} Color name or null
 */
function getColorName(hex) {
  if (!hex || typeof hex !== 'string') return null

  const upper = hex.toUpperCase()
  const colorNames = {
    '#FF0000': 'Red',
    '#00FF00': 'Green',
    '#0000FF': 'Blue',
    '#FFFF00': 'Yellow',
    '#FFA500': 'Orange',
    '#800080': 'Purple',
    '#FFC0CB': 'Pink',
    '#8B4513': 'Brown',
    '#000000': 'Black',
    '#FFFFFF': 'White',
    '#808080': 'Gray',
    '#FFD700': 'Gold',
    '#C0C0C0': 'Silver',
    '#00FFFF': 'Cyan',
    '#FF00FF': 'Magenta'
  }

  // Direct match
  if (colorNames[upper]) return colorNames[upper]

  // Approximate match by finding closest color
  const hexToRgb = h => ({
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16)
  })

  try {
    const inputRgb = hexToRgb(upper)
    let closestName = null
    let closestDist = Infinity

    for (const [colorHex, name] of Object.entries(colorNames)) {
      const colorRgb = hexToRgb(colorHex)
      const dist = Math.sqrt(
        Math.pow(inputRgb.r - colorRgb.r, 2) +
        Math.pow(inputRgb.g - colorRgb.g, 2) +
        Math.pow(inputRgb.b - colorRgb.b, 2)
      )
      if (dist < closestDist) {
        closestDist = dist
        closestName = name
      }
    }

    // Only return if reasonably close (distance < 100)
    if (closestDist < 100) return closestName
  } catch {
    // Parsing error, return null
  }

  return null
}

/**
 * Check variant depth to enforce max depth limit
 * @param {Object} library - Array of LibraryAssets
 * @param {string} parentId - Parent asset ID to check depth from
 * @param {number} maxDepth - Maximum allowed depth (default 3)
 * @returns {{depth: number, exceeds: boolean}}
 */
export function checkVariantDepth(library, parentId, maxDepth = 3) {
  let depth = 0
  let currentId = parentId

  while (currentId && depth < maxDepth + 1) {
    const asset = library.find(a => a.id === currentId)
    if (!asset || !asset.variantOf) break
    depth++
    currentId = asset.variantOf
  }

  return {
    depth,
    exceeds: depth >= maxDepth
  }
}

/**
 * Create a variant LibraryAsset from a parent asset with modifications
 * @param {Object} parentAsset - Parent LibraryAsset
 * @param {Object} modifiedSchema - Modified v3 schema
 * @param {string} modifiedCode - Compiled Three.js code
 * @param {import('./ModificationClassifier.js').ClassificationResult} classification - Classification result
 * @param {string} generateIdFn - ID generator function
 * @returns {Object} New LibraryAsset representing the variant
 */
export function createVariantAsset(parentAsset, modifiedSchema, modifiedCode, classification, generateIdFn) {
  const variantName = deriveVariantName(parentAsset.name, classification)
  const variantDescription = classification.description || `${classification.type} modification`

  return {
    id: generateIdFn('lib'),
    name: variantName,
    category: parentAsset.category,
    generatedCode: modifiedCode,
    thumbnail: null, // Will be generated after creation
    thumbnailVersion: null,
    tags: [...(parentAsset.tags || []), 'variant'],
    isWalkingCharacter: parentAsset.isWalkingCharacter,
    preferredScale: parentAsset.preferredScale,
    originalPrompt: parentAsset.originalPrompt,
    v3Schema: modifiedSchema,
    variantOf: parentAsset.id,
    variantDescription,
    editHistory: [{
      timestamp: new Date().toISOString(),
      type: 'text',
      prompt: classification.description || '',
      previousSchema: null // Variants don't need undo history for the parent
    }]
  }
}
