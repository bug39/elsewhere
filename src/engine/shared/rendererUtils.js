/**
 * @fileoverview Shared utilities for WorldRenderer subsystems.
 * Contains pure functions and data structures with no Three.js dependencies.
 */

/**
 * Clamp a value between min and max.
 * @param {number} value - Value to clamp
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Clamped value
 */
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

/**
 * LRU (Least Recently Used) cache with maximum size limit.
 * Evicts oldest entries when capacity is exceeded.
 */
export class LRUCache {
  constructor(maxSize = 50) {
    this.maxSize = maxSize
    this.cache = new Map()
  }

  get(key) {
    if (!this.cache.has(key)) return undefined
    // Move to end (most recently used)
    const value = this.cache.get(key)
    this.cache.delete(key)
    this.cache.set(key, value)
    return value
  }

  set(key, value) {
    // If key exists, delete it first to update position
    if (this.cache.has(key)) {
      this.cache.delete(key)
    } else if (this.cache.size >= this.maxSize) {
      // Evict oldest (first) entry
      const oldestKey = this.cache.keys().next().value
      this.cache.delete(oldestKey)
    }
    this.cache.set(key, value)
  }

  has(key) {
    return this.cache.has(key)
  }

  delete(key) {
    return this.cache.delete(key)
  }

  clear() {
    this.cache.clear()
  }

  get size() {
    return this.cache.size
  }
}

/**
 * FNV-1a hash function for terrain heightmap change detection.
 * O(n) time complexity vs O(n^2) string concatenation.
 * @param {number[][]} heightmap - 2D array of height values
 * @param {string} biome - Biome identifier
 * @returns {number} 32-bit hash value
 */
export function hashTerrain(heightmap, biome) {
  let hash = 2166136261 // FNV offset basis

  // Hash biome string
  if (biome) {
    for (let i = 0; i < biome.length; i++) {
      hash ^= biome.charCodeAt(i)
      hash = Math.imul(hash, 16777619) // FNV prime
    }
  }

  // Hash heightmap values
  for (let z = 0; z < heightmap.length; z++) {
    const row = heightmap[z]
    for (let x = 0; x < row.length; x++) {
      // Convert height to integer representation for consistent hashing
      const heightInt = (row[x] * 1000) | 0
      hash ^= heightInt & 0xff
      hash = Math.imul(hash, 16777619)
      hash ^= (heightInt >> 8) & 0xff
      hash = Math.imul(hash, 16777619)
    }
  }

  return hash >>> 0 // Convert to unsigned 32-bit
}

/**
 * Sky gradient colors for background AND reflections.
 * Used by both visible sky dome and PMREM environment map.
 */
export const SKY_COLORS = {
  light: {
    top: 0x87CEEB,      // Sky blue - clearly visible
    horizon: 0xD8E8F0,  // Blue-tinted horizon for more atmosphere
    bottom: 0xE0E0E0    // Slightly darker ground for contrast
  },
  dark: {
    top: 0x4a5568,      // Visible slate blue-gray
    horizon: 0x2d3748,  // Medium dark blue-gray
    bottom: 0x1a202c    // Dark blue-gray
  }
}

/**
 * Biome color palettes for terrain rendering.
 */
export const BIOME_COLORS = {
  grass: {
    primary: 0x90d890,    // Soft grass green
    secondary: 0xb08848,  // Soft earth brown
    tertiary: 0x989898,   // Light grey rock
    sky: [0x87ceeb, 0xf0f8ff],
    fog: 0xe8f4ff
  },
  desert: {
    primary: 0xf4dca0,    // Pale sand
    secondary: 0xd88868,  // Soft terracotta
    tertiary: 0x988070,   // Warm stone
    sky: [0xf0e4c8, 0xfaf6ee],
    fog: 0xfaf6ee
  },
  snow: {
    primary: 0xdde8f0,    // Muted snow (less blinding)
    secondary: 0xc0d8e8,  // Pale ice blue
    tertiary: 0x808898,   // Soft slate rock
    sky: [0xd8e8f4, 0xe8f0f8],
    fog: 0xe0ecf4
  },
  forest: {
    primary: 0x68b068,    // Soft forest green
    secondary: 0x7a9a60,  // Soft moss
    tertiary: 0x888878,   // Warm stone
    sky: [0xa0d0a0, 0xd0e8d0],
    fog: 0xd8ecd8
  },
  volcanic: {
    primary: 0x505050,    // Medium volcanic rock
    secondary: 0xe88060,  // Soft lava orange
    tertiary: 0x787878,   // Medium ash grey
    sky: [0x6b7b8b, 0x4a5a6a],
    fog: 0x5a6a7a
  }
}

/**
 * Resize throttle - limits resize events to ~30fps during panel drag.
 * Prevents GPU churn from 100+ resize events per second.
 */
export const RESIZE_THROTTLE_MS = 33
