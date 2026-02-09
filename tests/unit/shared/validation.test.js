/**
 * Unit tests for validation.js
 *
 * Tests input validation utilities including:
 * - World name sanitization
 * - Asset name sanitization
 * - Terrain height clamping
 * - Instance scale clamping
 * - Position validation
 * - World schema validation
 */

import { describe, it, expect, vi } from 'vitest'
import {
  sanitizeWorldName,
  sanitizeAssetName,
  clampTerrainHeight,
  clampInstanceScale,
  clampWanderRadius,
  validatePosition,
  validateWorldSchema,
  checkStorageQuota
} from '../../../src/shared/validation'

describe('validation', () => {
  describe('sanitizeWorldName', () => {
    it('should return trimmed name for valid input', () => {
      expect(sanitizeWorldName('  My World  ')).toBe('My World')
    })

    it('should return default for null input', () => {
      expect(sanitizeWorldName(null)).toBe('Untitled World')
    })

    it('should return default for undefined input', () => {
      expect(sanitizeWorldName(undefined)).toBe('Untitled World')
    })

    it('should return default for empty string', () => {
      expect(sanitizeWorldName('')).toBe('Untitled World')
    })

    it('should return default for whitespace-only string', () => {
      expect(sanitizeWorldName('   ')).toBe('Untitled World')
    })

    it('should truncate names longer than 100 characters', () => {
      const longName = 'A'.repeat(150)
      const result = sanitizeWorldName(longName)
      expect(result.length).toBe(100)
    })

    it('should handle non-string input', () => {
      expect(sanitizeWorldName(123)).toBe('Untitled World')
      expect(sanitizeWorldName({})).toBe('Untitled World')
    })

    it('should preserve unicode characters', () => {
      expect(sanitizeWorldName('日本語世界')).toBe('日本語世界')
    })

    it('should preserve emoji', () => {
      expect(sanitizeWorldName('My World 🌍')).toBe('My World 🌍')
    })
  })

  describe('sanitizeAssetName', () => {
    it('should return trimmed name for valid input', () => {
      expect(sanitizeAssetName('  Dragon  ')).toBe('Dragon')
    })

    it('should return default for null input', () => {
      expect(sanitizeAssetName(null)).toBe('Unnamed Asset')
    })

    it('should return default for empty string', () => {
      expect(sanitizeAssetName('')).toBe('Unnamed Asset')
    })

    it('should truncate names longer than 100 characters', () => {
      const longName = 'B'.repeat(150)
      const result = sanitizeAssetName(longName)
      expect(result.length).toBe(100)
    })
  })

  describe('clampTerrainHeight', () => {
    it('should return value within valid range', () => {
      expect(clampTerrainHeight(10)).toBe(10)
    })

    it('should clamp values below minimum to 0', () => {
      expect(clampTerrainHeight(-5)).toBe(0)
    })

    it('should clamp values above maximum to 25', () => {
      expect(clampTerrainHeight(100)).toBe(25)
    })

    it('should round decimal values', () => {
      expect(clampTerrainHeight(10.7)).toBe(11)
      expect(clampTerrainHeight(10.3)).toBe(10)
    })

    it('should return 0 for NaN', () => {
      expect(clampTerrainHeight(NaN)).toBe(0)
    })

    it('should return 0 for non-number input', () => {
      expect(clampTerrainHeight('ten')).toBe(0)
      expect(clampTerrainHeight(null)).toBe(0)
    })
  })

  describe('clampInstanceScale', () => {
    it('should return value within valid range', () => {
      expect(clampInstanceScale(5)).toBe(5)
      expect(clampInstanceScale(100)).toBe(100) // Larger scales now supported
    })

    it('should clamp values below minimum to 1', () => {
      expect(clampInstanceScale(0.5)).toBe(1)
    })

    it('should clamp values above maximum to 200', () => {
      expect(clampInstanceScale(500)).toBe(200)
    })

    it('should return 1 for zero', () => {
      expect(clampInstanceScale(0)).toBe(1)
    })

    it('should return 1 for negative values', () => {
      expect(clampInstanceScale(-5)).toBe(1)
    })

    it('should return 1 for NaN', () => {
      expect(clampInstanceScale(NaN)).toBe(1)
    })

    it('should return 1 for non-number input', () => {
      expect(clampInstanceScale('big')).toBe(1)
    })
  })

  describe('clampWanderRadius', () => {
    it('should return value within valid range', () => {
      expect(clampWanderRadius(50)).toBe(50)
    })

    it('should clamp values below minimum to 1', () => {
      expect(clampWanderRadius(0)).toBe(1)
    })

    it('should clamp values above maximum to 100', () => {
      expect(clampWanderRadius(200)).toBe(100)
    })

    it('should return 10 for NaN', () => {
      expect(clampWanderRadius(NaN)).toBe(10)
    })
  })

  describe('validatePosition', () => {
    it('should return valid position array unchanged', () => {
      expect(validatePosition([10, 20, 30])).toEqual([10, 20, 30])
    })

    it('should return default for non-array', () => {
      expect(validatePosition(null)).toEqual([0, 0, 0])
      expect(validatePosition('10,20,30')).toEqual([0, 0, 0])
    })

    it('should return default for wrong length array', () => {
      expect(validatePosition([10, 20])).toEqual([0, 0, 0])
      expect(validatePosition([10, 20, 30, 40])).toEqual([0, 0, 0])
    })

    it('should replace NaN values with 0', () => {
      expect(validatePosition([10, NaN, 30])).toEqual([10, 0, 30])
    })

    it('should replace non-number values with 0', () => {
      expect(validatePosition([10, 'twenty', 30])).toEqual([10, 0, 30])
    })

    it('should handle floating point values', () => {
      expect(validatePosition([10.5, -20.3, 30.7])).toEqual([10.5, -20.3, 30.7])
    })
  })

  describe('validateWorldSchema', () => {
    const validWorld = {
      meta: { id: 'world_123', name: 'Test World' },
      terrain: {
        biome: 'grass',
        heightmap: Array(20).fill(null).map(() => Array(20).fill(0))
      },
      placedAssets: [],
      library: []
    }

    it('should validate a correct world schema', () => {
      const result = validateWorldSchema(validWorld)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.data).toBe(validWorld)
    })

    it('should reject null input', () => {
      const result = validateWorldSchema(null)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('World data is not an object')
    })

    it('should reject missing meta', () => {
      const world = { ...validWorld, meta: undefined }
      const result = validateWorldSchema(world)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Missing meta object')
    })

    it('should reject missing meta.id', () => {
      const world = { ...validWorld, meta: { name: 'Test' } }
      const result = validateWorldSchema(world)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Missing meta.id')
    })

    it('should reject missing meta.name', () => {
      const world = { ...validWorld, meta: { id: 'world_123' } }
      const result = validateWorldSchema(world)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Missing meta.name')
    })

    it('should reject missing terrain', () => {
      const world = { ...validWorld, terrain: undefined }
      const result = validateWorldSchema(world)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Missing terrain object')
    })

    it('should reject missing terrain.biome', () => {
      const world = {
        ...validWorld,
        terrain: { heightmap: validWorld.terrain.heightmap }
      }
      const result = validateWorldSchema(world)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Missing terrain.biome')
    })

    it('should reject invalid heightmap', () => {
      const world = {
        ...validWorld,
        terrain: { biome: 'grass', heightmap: 'not an array' }
      }
      const result = validateWorldSchema(world)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Missing or invalid terrain.heightmap')
    })

    it('should reject wrong heightmap size', () => {
      const world = {
        ...validWorld,
        terrain: {
          biome: 'grass',
          heightmap: Array(10).fill(null).map(() => Array(10).fill(0))
        }
      }
      const result = validateWorldSchema(world)

      expect(result.valid).toBe(false)
      // Accepts both 40 (current) and 20 (legacy), rejects other sizes
      expect(result.errors[0]).toContain('terrain.heightmap must have')
    })

    it('should accept current grid size (40x40)', () => {
      const world = {
        ...validWorld,
        terrain: {
          biome: 'grass',
          heightmap: Array(40).fill(null).map(() => Array(40).fill(0))
        }
      }
      const result = validateWorldSchema(world)

      expect(result.valid).toBe(true)
    })

    it('should accept legacy grid size (20x20) for migration', () => {
      const world = {
        ...validWorld,
        terrain: {
          biome: 'grass',
          heightmap: Array(20).fill(null).map(() => Array(20).fill(0))
        }
      }
      const result = validateWorldSchema(world)

      expect(result.valid).toBe(true)
    })

    it('should reject non-array placedAssets', () => {
      const world = { ...validWorld, placedAssets: 'not an array' }
      const result = validateWorldSchema(world)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('placedAssets must be an array')
    })

    it('should reject non-array library', () => {
      const world = { ...validWorld, library: 'not an array' }
      const result = validateWorldSchema(world)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('library must be an array')
    })

    it('should collect multiple errors', () => {
      const world = {
        meta: {},
        terrain: {},
        placedAssets: 'invalid',
        library: 'invalid'
      }
      const result = validateWorldSchema(world)

      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(2)
    })
  })

  describe('checkStorageQuota', () => {
    it('should return quota information', async () => {
      const result = await checkStorageQuota()

      expect(result).toHaveProperty('usage')
      expect(result).toHaveProperty('quota')
      expect(result).toHaveProperty('percentUsed')
      expect(result).toHaveProperty('warning')
    })

    it('should set warning when usage exceeds 80%', async () => {
      // Mock high usage
      vi.spyOn(navigator.storage, 'estimate').mockResolvedValueOnce({
        usage: 90000000,
        quota: 100000000
      })

      const result = await checkStorageQuota()

      expect(result.warning).toBe(true)
      expect(result.percentUsed).toBe(90)
    })

    it('should handle missing navigator.storage', async () => {
      const originalStorage = navigator.storage
      // @ts-ignore - Temporarily remove storage
      delete navigator.storage

      const result = await checkStorageQuota()

      expect(result.usage).toBe(0)
      expect(result.quota).toBe(0)
      expect(result.warning).toBe(false)

      // Restore
      Object.defineProperty(navigator, 'storage', {
        value: originalStorage,
        writable: true
      })
    })
  })
})
