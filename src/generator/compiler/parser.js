/**
 * Schema Parser - Normalizes and validates v3 schema input
 */

/**
 * Minimum luminance threshold - prevents invisible dark assets
 */
const MIN_LUMINANCE = 0.15

/**
 * Calculate relative luminance of an RGB color
 */
function getLuminance(rgb) {
  const r = ((rgb >> 16) & 0xFF) / 255
  const g = ((rgb >> 8) & 0xFF) / 255
  const b = (rgb & 0xFF) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Brighten a color to meet minimum luminance threshold
 * Uses additive brightening to handle pure colors (e.g., pure blue #0000FF)
 */
function ensureMinLuminance(rgb) {
  let lum = getLuminance(rgb)
  if (lum >= MIN_LUMINANCE) return rgb

  // If color is very dark, use dark gray as fallback
  if (lum < 0.001) {
    return 0x404040 // Dark gray fallback
  }

  let r = (rgb >> 16) & 0xFF
  let g = (rgb >> 8) & 0xFF
  let b = rgb & 0xFF

  // First try scaling proportionally
  const scale = MIN_LUMINANCE / lum
  let newR = Math.min(255, Math.round(r * scale))
  let newG = Math.min(255, Math.round(g * scale))
  let newB = Math.min(255, Math.round(b * scale))

  // Check if scaling achieved the target (it won't for pure colors like #0000FF)
  let newLum = getLuminance((newR << 16) | (newG << 8) | newB)
  if (newLum >= MIN_LUMINANCE) {
    return (newR << 16) | (newG << 8) | newB
  }

  // Scaling didn't work (channels clamped at 255), so add brightness uniformly
  const lumDeficit = MIN_LUMINANCE - newLum
  const addAmount = Math.ceil(lumDeficit * 255)

  newR = Math.min(255, newR + addAmount)
  newG = Math.min(255, newG + addAmount)
  newB = Math.min(255, newB + addAmount)

  return (newR << 16) | (newG << 8) | newB
}

/**
 * Normalize a hex color value to a number (no luminance adjustment)
 * Handles: 0xFFFFFF, "0xFFFFFF", "#FFFFFF", "FFFFFF", integer
 */
export function normalizeColor(value) {
  if (typeof value === 'number') {
    return Math.max(0, Math.min(0xFFFFFF, value))
  }
  if (typeof value === 'string') {
    let hex = value.trim()
    if (hex.startsWith('#')) hex = hex.slice(1)
    if (hex.startsWith('0x') || hex.startsWith('0X')) hex = hex.slice(2)
    const parsed = parseInt(hex, 16)
    if (!isNaN(parsed)) {
      return Math.max(0, Math.min(0xFFFFFF, parsed))
    }
  }
  return 0x808080 // Default gray
}

/**
 * Normalize a main material color with minimum luminance enforcement
 */
export function normalizeMainColor(value) {
  const rgb = normalizeColor(value)
  return ensureMinLuminance(rgb)
}

/**
 * Clamp segment counts to budget limits
 */
const SEGMENT_LIMITS = {
  Sphere: { ws: 10, hs: 8 },
  Cylinder: { rs: 10 },
  Cone: { rs: 10 },
  Torus: { rs: 10, ts: 12 },
  Lathe: { seg: 14 },
  Tube: { ts: 14, rs: 8 },
  Dome: { seg: 14 }
}

export function clampSegments(geomType, params) {
  const limits = SEGMENT_LIMITS[geomType]
  if (!limits) return params

  const clamped = { ...params }
  for (const [key, max] of Object.entries(limits)) {
    if (clamped[key] !== undefined) {
      // M8 FIX: Round segment counts to integers (Three.js expects integers)
      clamped[key] = Math.round(Math.min(Math.max(1, clamped[key]), max))
    }
  }
  return clamped
}

/**
 * @typedef {Object} ParseResult
 * @property {Object} schema - Normalized schema
 * @property {string[]} warnings - Any warnings during parsing
 */

/**
 * Parse and normalize a v3 schema
 * @param {Object} schema - Raw v3 schema
 * @returns {Object} Normalized schema (for backwards compatibility)
 */
export function parseSchema(schema) {
  const result = parseSchemaWithWarnings(schema)
  return result.schema
}

/**
 * Parse and normalize a v3 schema, returning warnings
 * @param {Object} schema - Raw v3 schema
 * @returns {ParseResult} Normalized schema with warnings
 */
export function parseSchemaWithWarnings(schema) {
  const warnings = []

  if (!schema || schema.v !== 3) {
    throw new Error('Invalid schema: expected v=3')
  }

  const normalized = {
    v: 3,
    cat: schema.cat || 'prop',
    floatY: typeof schema.floatY === 'number' ? schema.floatY : 0,
    materials: [],
    parts: [],
    attachPoints: schema.ap || [],
    anim: schema.anim || { on: false, style: 'none', j: [] }
  }

  // Normalize materials
  if (Array.isArray(schema.m)) {
    if (schema.m.length > 5) {
      warnings.push(`Schema has ${schema.m.length} materials, truncating to 5`)
    }
    normalized.materials = schema.m.slice(0, 5).map((mat, idx) => ({
      index: idx,
      name: mat.n || `mat${idx}`,
      color: normalizeMainColor(mat.c),
      roughness: clampFloat(mat.r, 0, 1, 0.7),
      metalness: clampFloat(mat.met, 0, 1, 0),
      emissive: normalizeColor(mat.e || 0),
      emissiveIntensity: clampFloat(mat.ei, 0, 1, 0),
      flatShading: mat.flat !== false
    }))
  }

  // Normalize parts
  const maxMatIndex = Math.max(0, normalized.materials.length - 1)
  if (Array.isArray(schema.p)) {
    normalized.parts = schema.p.map((part, idx) => {
      const name = part.n || `part${idx}`

      // Check and warn about material index clamping
      let materialIndex = clampInt(part.mat, 0, maxMatIndex, 0)
      if (typeof part.mat === 'number' && part.mat > maxMatIndex) {
        warnings.push(`Part "${name}" references material index ${part.mat} but only ${normalized.materials.length} materials exist - clamped to ${materialIndex}`)
      } else if (typeof part.mat === 'number' && part.mat < 0) {
        warnings.push(`Part "${name}" has negative material index ${part.mat} - clamped to 0`)
      }

      return {
        index: idx,
        name,
        parent: part.par || null,
        geometry: part.g || 'Box',
        priority: clampPriority(part.pr),
        materialIndex,
        geomParams: clampSegments(part.g, part.geom || {}),
        // Infer semantic role from name for animation (NOT for auto-pivot)
        role: inferRoleFromName(name),
        joint: part.j ? {
          name: part.j.n || `joint${idx}`,
          position: normalizeVec3(part.j.pos),
          axes: part.j.axes || 'y'
        } : null,
        instances: (part.i || []).map((inst, iIdx) => ({
          index: iIdx,
          position: normalizeVec3(inst.p),
          rotation: normalizeVec3(inst.r),
          scale: normalizeVec3(inst.s, [1, 1, 1])
        }))
      }
    })
  }

  return { schema: normalized, warnings }
}

/**
 * Clamp a float to range with default
 */
function clampFloat(value, min, max, defaultVal) {
  if (typeof value !== 'number' || isNaN(value)) return defaultVal
  return Math.max(min, Math.min(max, value))
}

/**
 * Clamp an int to range with default
 */
function clampInt(value, min, max, defaultVal) {
  if (typeof value !== 'number' || isNaN(value)) return defaultVal
  return Math.max(min, Math.min(max, Math.round(value)))
}

/**
 * Clamp priority value to valid values (1, 1.5, 2, 3)
 * pr=1.5 is for characteristic features (eyes, hands, ears, horns)
 */
function clampPriority(value) {
  if (typeof value !== 'number' || isNaN(value)) return 2
  // Valid priorities: 1, 1.5, 2, 3
  if (value <= 1) return 1
  if (value <= 1.5) return 1.5
  if (value <= 2) return 2
  return 3
}

/**
 * Normalize a vec3 array
 */
function normalizeVec3(arr, defaultVal = [0, 0, 0]) {
  if (!Array.isArray(arr) || arr.length < 3) return defaultVal
  return [
    typeof arr[0] === 'number' ? arr[0] : defaultVal[0],
    typeof arr[1] === 'number' ? arr[1] : defaultVal[1],
    typeof arr[2] === 'number' ? arr[2] : defaultVal[2]
  ]
}

/**
 * Infer semantic role from part name for animation purposes.
 * @param {string} name - Part name
 * @returns {string|null} - Role: 'leg', 'arm', 'wing', 'tail', 'body', 'head', 'branch', 'leaf', or null
 */
export function inferRoleFromName(name) {
  if (!name) return null
  const lower = name.toLowerCase()

  // Limbs
  if (/leg|thigh|calf|hip|foot|shin/.test(lower)) return 'leg'
  if (/arm|shoulder|forearm|hand|elbow/.test(lower)) return 'arm'
  if (/wing/.test(lower)) return 'wing'
  if (/tail/.test(lower)) return 'tail'

  // Core body parts
  if (/body|torso|trunk|chest|abdomen/.test(lower)) return 'body'
  if (/head|face|skull/.test(lower)) return 'head'

  // Nature/plant parts
  if (/branch|stem|trunk/.test(lower)) return 'branch'
  if (/leaf|leaves|foliage/.test(lower)) return 'leaf'

  return null
}

/**
 * Infer animation archetype from schema category and parts.
 * @param {Object} schema - Parsed schema
 * @returns {string} - Archetype: 'biped', 'quadruped', 'plant', 'prop', 'effect'
 */
export function inferArchetype(schema) {
  const cat = schema.cat?.toLowerCase() || ''

  // Effects preserve LLM animation
  if (cat === 'effect' || cat === 'particle') return 'effect'

  // Check for explicit animation archetype in schema
  if (schema.anim?.archetype) return schema.anim.archetype

  // Infer from category
  if (cat === 'character' || cat === 'characters') {
    const legCount = schema.parts?.filter(p =>
      inferRoleFromName(p.name || p.n) === 'leg'
    ).length || 0
    return legCount > 2 ? 'quadruped' : 'biped'
  }

  if (cat === 'creature' || cat === 'creatures') {
    const legCount = schema.parts?.filter(p =>
      inferRoleFromName(p.name || p.n) === 'leg'
    ).length || 0
    return legCount > 2 ? 'quadruped' : 'biped'
  }

  if (cat === 'nature' || cat === 'plant' || cat === 'plants') {
    return 'plant'
  }

  // Default to prop
  return 'prop'
}
