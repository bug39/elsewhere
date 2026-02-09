/**
 * Unit tests for transforms.js
 *
 * Tests transform normalization utilities including:
 * - Rotation normalization (array -> scalar)
 * - Scale normalization (array -> scalar)
 * - Instance transform normalization
 * - World transform normalization
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  normalizeRotation,
  normalizeScale,
  normalizeInstanceTransforms,
  normalizeWorldTransforms
} from '../../../src/shared/transforms'

describe('transforms', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('normalizeRotation', () => {
    it('should return number value unchanged', () => {
      expect(normalizeRotation(1.5)).toBe(1.5)
      expect(normalizeRotation(0)).toBe(0)
      expect(normalizeRotation(-0.5)).toBe(-0.5)
    })

    it('should return 0 for null', () => {
      expect(normalizeRotation(null)).toBe(0)
    })

    it('should return 0 for undefined', () => {
      expect(normalizeRotation(undefined)).toBe(0)
    })

    it('should extract Y-axis from array [x, y, z]', () => {
      expect(normalizeRotation([0, 1.5, 0])).toBe(1.5)
      expect(normalizeRotation([0, -2.0, 0])).toBe(-2.0)
    })

    it('should handle array with non-number Y value', () => {
      expect(normalizeRotation([0, 'invalid', 0])).toBe(0)
      expect(normalizeRotation([0, null, 0])).toBe(0)
    })

    it('should return 0 for non-array, non-number value', () => {
      expect(normalizeRotation('1.5')).toBe(0)
      expect(normalizeRotation({})).toBe(0)
    })

    it('should log warning for legacy array format with context', () => {
      const warnSpy = vi.spyOn(console, 'warn')

      normalizeRotation([0, 1.5, 0], 'inst_123')

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Legacy array rotation normalized')
      )
    })

    it('should only warn once per context', () => {
      const warnSpy = vi.spyOn(console, 'warn')

      normalizeRotation([0, 1.5, 0], 'inst_456')
      normalizeRotation([0, 2.0, 0], 'inst_456')

      expect(warnSpy).toHaveBeenCalledTimes(1)
    })

    it('should not warn when no context provided', () => {
      const warnSpy = vi.spyOn(console, 'warn')

      normalizeRotation([0, 1.5, 0])

      expect(warnSpy).not.toHaveBeenCalled()
    })
  })

  describe('normalizeScale', () => {
    it('should return number value unchanged', () => {
      expect(normalizeScale(2.0)).toBe(2.0)
      expect(normalizeScale(1)).toBe(1)
      expect(normalizeScale(0.5)).toBe(0.5)
    })

    it('should return 1 for null', () => {
      expect(normalizeScale(null)).toBe(1)
    })

    it('should return 1 for undefined', () => {
      expect(normalizeScale(undefined)).toBe(1)
    })

    it('should extract X component from array [x, y, z]', () => {
      expect(normalizeScale([2.0, 2.0, 2.0])).toBe(2.0)
      expect(normalizeScale([0.5, 0.5, 0.5])).toBe(0.5)
    })

    it('should handle non-uniform scale arrays by using X', () => {
      expect(normalizeScale([2.0, 3.0, 4.0])).toBe(2.0)
    })

    it('should handle array with non-number X value', () => {
      expect(normalizeScale(['invalid', 1, 1])).toBe(1)
      expect(normalizeScale([null, 1, 1])).toBe(1)
    })

    it('should return 1 for non-array, non-number value', () => {
      expect(normalizeScale('2.0')).toBe(1)
      expect(normalizeScale({})).toBe(1)
    })

    it('should log warning for legacy array format with context', () => {
      const warnSpy = vi.spyOn(console, 'warn')

      normalizeScale([2.0, 2.0, 2.0], 'inst_789')

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Legacy array scale normalized')
      )
    })
  })

  describe('normalizeInstanceTransforms', () => {
    it('should normalize both rotation and scale', () => {
      const instance = {
        instanceId: 'inst_001',
        rotation: [0, 1.5, 0],
        scale: [2.0, 2.0, 2.0],
        position: [10, 0, 10]
      }

      const result = normalizeInstanceTransforms(instance)

      expect(result.rotation).toBe(1.5)
      expect(result.scale).toBe(2.0)
      expect(result.position).toEqual([10, 0, 10]) // Unchanged
    })

    it('should return null/undefined unchanged', () => {
      expect(normalizeInstanceTransforms(null)).toBeNull()
      expect(normalizeInstanceTransforms(undefined)).toBeUndefined()
    })

    it('should preserve other instance properties', () => {
      const instance = {
        instanceId: 'inst_002',
        libraryId: 'lib_001',
        rotation: 0,
        scale: 1,
        behavior: { type: 'idle' },
        dialogue: null
      }

      const result = normalizeInstanceTransforms(instance)

      expect(result.instanceId).toBe('inst_002')
      expect(result.libraryId).toBe('lib_001')
      expect(result.behavior).toEqual({ type: 'idle' })
      expect(result.dialogue).toBeNull()
    })

    it('should handle already-normalized values', () => {
      const instance = {
        instanceId: 'inst_003',
        rotation: 1.5,
        scale: 2.0
      }

      const result = normalizeInstanceTransforms(instance)

      expect(result.rotation).toBe(1.5)
      expect(result.scale).toBe(2.0)
    })
  })

  describe('normalizeWorldTransforms', () => {
    it('should normalize all placed asset transforms', () => {
      const worldData = {
        meta: { id: 'world_001' },
        placedAssets: [
          { instanceId: 'inst_001', rotation: [0, 1.5, 0], scale: [2, 2, 2] },
          { instanceId: 'inst_002', rotation: [0, -0.5, 0], scale: [3, 3, 3] }
        ],
        library: []
      }

      const result = normalizeWorldTransforms(worldData)

      expect(result.placedAssets[0].rotation).toBe(1.5)
      expect(result.placedAssets[0].scale).toBe(2)
      expect(result.placedAssets[1].rotation).toBe(-0.5)
      expect(result.placedAssets[1].scale).toBe(3)
    })

    it('should return data unchanged if no placedAssets', () => {
      const worldData = {
        meta: { id: 'world_002' },
        library: []
      }

      const result = normalizeWorldTransforms(worldData)

      expect(result).toBe(worldData)
    })

    it('should return null/undefined unchanged', () => {
      expect(normalizeWorldTransforms(null)).toBeNull()
      expect(normalizeWorldTransforms(undefined)).toBeUndefined()
    })

    it('should preserve other world properties', () => {
      const worldData = {
        meta: { id: 'world_003', name: 'Test' },
        terrain: { biome: 'grass' },
        placedAssets: [
          { instanceId: 'inst_001', rotation: 0, scale: 1 }
        ],
        library: [{ id: 'lib_001', name: 'Dragon' }]
      }

      const result = normalizeWorldTransforms(worldData)

      expect(result.meta).toEqual({ id: 'world_003', name: 'Test' })
      expect(result.terrain).toEqual({ biome: 'grass' })
      expect(result.library).toEqual([{ id: 'lib_001', name: 'Dragon' }])
    })

    it('should handle empty placedAssets array', () => {
      const worldData = {
        meta: { id: 'world_004' },
        placedAssets: [],
        library: []
      }

      const result = normalizeWorldTransforms(worldData)

      expect(result.placedAssets).toEqual([])
    })
  })
})
