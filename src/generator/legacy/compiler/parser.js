/**
 * Schema Parser - Normalizes and validates v3 schema input
 */

/**
 * Normalize a hex color value to a number
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
 * Clamp segment counts to budget limits
 */
const SEGMENT_LIMITS = {
  Sphere: { ws: 10, hs: 8 },
  Cylinder: { rs: 10 },
  Cone: { rs: 10 },
  Torus: { rs: 10, ts: 12 },
  Lathe: { seg: 14 },
  Tube: { ts: 14, rs: 8 }
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
 * Parse and normalize a v3 schema
 */
export function parseSchema(schema) {
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
    normalized.materials = schema.m.slice(0, 5).map((mat, idx) => ({
      index: idx,
      name: mat.n || `mat${idx}`,
      color: normalizeColor(mat.c),
      roughness: clampFloat(mat.r, 0, 1, 0.7),
      metalness: clampFloat(mat.met, 0, 1, 0),
      emissive: normalizeColor(mat.e || 0),
      emissiveIntensity: clampFloat(mat.ei, 0, 1, 0),
      flatShading: mat.flat !== false
    }))
  }

  // Normalize parts
  if (Array.isArray(schema.p)) {
    normalized.parts = schema.p.map((part, idx) => ({
      index: idx,
      name: part.n || `part${idx}`,
      parent: part.par || null,
      geometry: part.g || 'Box',
      priority: clampPriority(part.pr),
      materialIndex: clampInt(part.mat, 0, normalized.materials.length - 1, 0),
      geomParams: clampSegments(part.g, part.geom || {}),
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
    }))
  }

  return normalized
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
