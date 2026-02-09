/**
 * Input validation utilities for thinq
 * S3 FIX: Add input validation to prevent invalid data
 */

import { GRID_SIZE, INSTANCE_SCALE } from './constants'

// Limits
const MAX_WORLD_NAME_LENGTH = 100
const MAX_ASSET_NAME_LENGTH = 100
const MIN_TERRAIN_HEIGHT = 0
const MAX_TERRAIN_HEIGHT = 25
const MIN_WANDER_RADIUS = 1
const MAX_WANDER_RADIUS = 100

/**
 * Sanitize and validate a world name
 * @param {string} name - Raw input
 * @returns {string} Sanitized name
 */
export function sanitizeWorldName(name) {
  if (!name || typeof name !== 'string') {
    return 'Untitled World'
  }
  // Trim whitespace and limit length
  const trimmed = name.trim().slice(0, MAX_WORLD_NAME_LENGTH)
  return trimmed || 'Untitled World'
}

/**
 * Sanitize and validate an asset name
 * @param {string} name - Raw input
 * @returns {string} Sanitized name
 */
export function sanitizeAssetName(name) {
  if (!name || typeof name !== 'string') {
    return 'Unnamed Asset'
  }
  // Trim whitespace and limit length
  const trimmed = name.trim().slice(0, MAX_ASSET_NAME_LENGTH)
  return trimmed || 'Unnamed Asset'
}

/**
 * Validate and clamp terrain height
 * @param {number} height - Raw height value
 * @returns {number} Clamped height
 */
export function clampTerrainHeight(height) {
  if (typeof height !== 'number' || isNaN(height)) {
    return 0
  }
  return Math.max(MIN_TERRAIN_HEIGHT, Math.min(MAX_TERRAIN_HEIGHT, Math.round(height)))
}

/**
 * Validate and clamp instance scale
 * @param {number} scale - Raw scale value
 * @returns {number} Clamped scale
 */
export function clampInstanceScale(scale) {
  if (typeof scale !== 'number' || isNaN(scale) || scale <= 0) {
    return 1
  }
  return Math.max(INSTANCE_SCALE.min, Math.min(INSTANCE_SCALE.max, scale))
}

/**
 * Validate and clamp wander radius
 * @param {number} radius - Raw radius value
 * @returns {number} Clamped radius
 */
export function clampWanderRadius(radius) {
  if (typeof radius !== 'number' || isNaN(radius)) {
    return 10
  }
  return Math.max(MIN_WANDER_RADIUS, Math.min(MAX_WANDER_RADIUS, radius))
}

/**
 * Validate a position array [x, y, z]
 * @param {any} position - Raw position value
 * @returns {number[]} Valid [x, y, z] array
 */
export function validatePosition(position) {
  if (!Array.isArray(position) || position.length !== 3) {
    return [0, 0, 0]
  }
  return position.map(v => {
    if (typeof v !== 'number' || isNaN(v)) return 0
    return v
  })
}

/**
 * S4 FIX: Validate world data schema on load
 * @param {Object} worldData - World data from IndexedDB
 * @returns {{ valid: boolean, errors: string[], data: Object }} Validation result with normalized data
 */
export function validateWorldSchema(worldData) {
  const errors = []

  if (!worldData || typeof worldData !== 'object') {
    return { valid: false, errors: ['World data is not an object'], data: null }
  }

  // Check required meta fields
  if (!worldData.meta) {
    errors.push('Missing meta object')
  } else {
    if (!worldData.meta.id) errors.push('Missing meta.id')
    if (!worldData.meta.name) errors.push('Missing meta.name')
  }

  // Check required terrain fields
  if (!worldData.terrain) {
    errors.push('Missing terrain object')
  } else {
    if (!worldData.terrain.biome) errors.push('Missing terrain.biome')
    if (!Array.isArray(worldData.terrain.heightmap)) {
      errors.push('Missing or invalid terrain.heightmap')
    } else if (worldData.terrain.heightmap.length !== GRID_SIZE && worldData.terrain.heightmap.length !== 20) {
      // Accept both current grid size and legacy 20x20 (migration will handle conversion)
      errors.push(`terrain.heightmap must have ${GRID_SIZE} rows (or 20 for legacy worlds)`)
    }
  }

  // Validate placedAssets if present
  if (worldData.placedAssets && !Array.isArray(worldData.placedAssets)) {
    errors.push('placedAssets must be an array')
  }

  // Validate library if present
  if (worldData.library && !Array.isArray(worldData.library)) {
    errors.push('library must be an array')
  }

  // Return validation result
  if (errors.length > 0) {
    console.warn('[Validation] World schema errors:', errors)
  }

  return {
    valid: errors.length === 0,
    errors,
    data: worldData
  }
}

/**
 * D2 FIX: Check storage quota and return warning if nearly full
 * @returns {Promise<{ usage: number, quota: number, percentUsed: number, warning: boolean }>}
 */
export async function checkStorageQuota() {
  if (!navigator.storage?.estimate) {
    return { usage: 0, quota: 0, percentUsed: 0, warning: false }
  }

  try {
    const { usage, quota } = await navigator.storage.estimate()
    const percentUsed = quota > 0 ? (usage / quota) * 100 : 0
    return {
      usage: usage || 0,
      quota: quota || 0,
      percentUsed,
      warning: percentUsed > 80
    }
  } catch (err) {
    console.warn('[Validation] Failed to check storage quota:', err)
    return { usage: 0, quota: 0, percentUsed: 0, warning: false }
  }
}
