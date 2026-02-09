/**
 * Transform normalization utilities for handling legacy array→scalar coercion.
 *
 * Legacy data may have stored rotation/scale as arrays (e.g., [0, 1.5, 0])
 * but the current schema expects scalars. These utilities normalize both
 * formats at load and render time to prevent Array.prototype.toString()
 * performance issues in Three.js matrix updates.
 */

const WARNED = new Set()

/**
 * Normalize rotation value to scalar (Y-axis rotation in radians)
 * @param {number|number[]|null|undefined} value
 * @param {string} ctx - Context identifier for warning deduplication
 * @returns {number}
 */
export function normalizeRotation(value, ctx = '') {
  if (value == null) return 0
  if (typeof value === 'number') return value
  if (Array.isArray(value)) {
    if (ctx && !WARNED.has(`rot:${ctx}`)) {
      console.warn(`[thinq] Legacy array rotation normalized: ${ctx}`)
      WARNED.add(`rot:${ctx}`)
    }
    return typeof value[1] === 'number' ? value[1] : 0  // Extract Y-axis
  }
  return 0
}

/**
 * Normalize scale value to scalar (uniform scale)
 * @param {number|number[]|null|undefined} value
 * @param {string} ctx - Context identifier for warning deduplication
 * @returns {number}
 */
export function normalizeScale(value, ctx = '') {
  if (value == null) return 1
  if (typeof value === 'number') return value
  if (Array.isArray(value)) {
    if (ctx && !WARNED.has(`scale:${ctx}`)) {
      console.warn(`[thinq] Legacy array scale normalized: ${ctx}`)
      WARNED.add(`scale:${ctx}`)
    }
    return typeof value[0] === 'number' ? value[0] : 1  // Use X component
  }
  return 1
}

/**
 * Normalize transform fields on a single asset instance
 * @param {Object} inst - Asset instance with position, rotation, scale
 * @returns {Object} - Instance with normalized scalar transforms
 */
export function normalizeInstanceTransforms(inst) {
  if (!inst) return inst
  return {
    ...inst,
    rotation: normalizeRotation(inst.rotation, inst.instanceId),
    scale: normalizeScale(inst.scale, inst.instanceId)
  }
}

/**
 * Normalize all placed asset transforms in world data
 * @param {Object} data - World data with placedAssets array
 * @returns {Object} - World data with normalized transforms
 */
export function normalizeWorldTransforms(data) {
  if (!data?.placedAssets) return data
  return {
    ...data,
    placedAssets: data.placedAssets.map(normalizeInstanceTransforms)
  }
}
