/**
 * Unit tests for the size invariants system
 *
 * These tests verify that the intent-based sizing system:
 * 1. Correctly converts real-world sizes to scale values using UNIVERSAL_BASELINE
 * 2. Applies GAME_SCALE_FACTOR (8x) to convert realistic sizes to game-visible scales
 * 3. Enforces hard limits that make impossible sizes unachievable
 * 4. Handles edge cases and invalid input gracefully
 *
 * UNIVERSAL_BASELINE = 2.0: All assets normalize to 2 units max dimension
 * GAME_SCALE_FACTOR = 8: Multiplies realistic scale for game visibility
 * scale = (realWorldSize / 2.0) × 8
 */

import { describe, it, expect } from 'vitest'
import {
  computeScaleFromSize,
  enforceInvariants,
  validateProportions,
  processScenePlan,
  computeRescale,
  SIZE_INVARIANTS,
  UNIVERSAL_BASELINE,
  GAME_SCALE_FACTOR,
  MAX_SCALE,
  MAX_SCALE_BY_CATEGORY,
  getMaxScaleForCategory
} from '../../../src/generator/sizeInvariants'

describe('computeScaleFromSize', () => {
  it('converts real-world size to scale using universal baseline and game factor', () => {
    // 12m tree / 2m baseline × 8 = scale 48
    expect(computeScaleFromSize(12, 'nature')).toBeCloseTo(48.0)
  })

  it('converts real-world size to scale for characters', () => {
    // 2m human / 2m baseline × 8 = scale 8
    expect(computeScaleFromSize(2, 'characters')).toBeCloseTo(8.0)
  })

  it('converts real-world size to scale for props', () => {
    // 1m prop / 2m baseline × 8 = scale 4
    expect(computeScaleFromSize(1, 'props')).toBeCloseTo(4.0)
  })

  it('converts real-world size to scale for buildings', () => {
    // 10m building / 2m baseline × 8 = scale 40
    expect(computeScaleFromSize(10, 'buildings')).toBeCloseTo(40.0)
  })

  it('clamps excessively large sizes before computing scale', () => {
    // 100m tree should clamp to 60m max (nature allows mountains)
    // Then 60m / 2m × 8 = 240, which equals MAX_SCALE_BY_CATEGORY.nature
    expect(computeScaleFromSize(100, 'nature')).toBe(MAX_SCALE_BY_CATEGORY.nature)
  })

  it('uses universal baseline for unknown category', () => {
    // 4m / 2m baseline × 8 = scale 16
    expect(computeScaleFromSize(4, 'unknown')).toBeCloseTo(16.0)
  })
})

describe('enforceInvariants', () => {
  it('returns unchanged size within valid range', () => {
    const result = enforceInvariants(12, 'nature')
    expect(result.size).toBe(12)
    expect(result.clamped).toBe(false)
    expect(result.reason).toBeNull()
  })

  it('clamps size below minimum', () => {
    const result = enforceInvariants(0.05, 'props')
    expect(result.size).toBe(SIZE_INVARIANTS.MIN_ASSET_SIZE)
    expect(result.clamped).toBe(true)
    expect(result.reason).toContain('below minimum')
  })

  it('clamps size above absolute maximum', () => {
    // Use nature category which has max = 60m = MAX_ASSET_SIZE
    const result = enforceInvariants(100, 'nature')
    expect(result.size).toBe(SIZE_INVARIANTS.MAX_ASSET_SIZE)
    expect(result.clamped).toBe(true)
    expect(result.reason).toContain('above maximum')
  })

  it('clamps size above category maximum', () => {
    // Props max is 5m
    const result = enforceInvariants(10, 'props')
    expect(result.size).toBe(SIZE_INVARIANTS.MAX_CATEGORY_SIZES.props)
    expect(result.clamped).toBe(true)
    expect(result.reason).toContain('props max')
  })

  it('uses default for invalid input (negative)', () => {
    const result = enforceInvariants(-5, 'nature')
    expect(result.size).toBe(SIZE_INVARIANTS.DEFAULT_SIZES.nature)
    expect(result.clamped).toBe(true)
    expect(result.reason).toContain('Invalid size')
  })

  it('uses default for invalid input (NaN)', () => {
    const result = enforceInvariants(NaN, 'characters')
    expect(result.size).toBe(SIZE_INVARIANTS.DEFAULT_SIZES.characters)
    expect(result.clamped).toBe(true)
  })

  it('uses default for invalid input (undefined)', () => {
    const result = enforceInvariants(undefined, 'props')
    expect(result.size).toBe(SIZE_INVARIANTS.DEFAULT_SIZES.props)
    expect(result.clamped).toBe(true)
  })

  it('uses default for zero size', () => {
    const result = enforceInvariants(0, 'buildings')
    expect(result.size).toBe(SIZE_INVARIANTS.DEFAULT_SIZES.buildings)
    expect(result.clamped).toBe(true)
  })
})

describe('validateProportions', () => {
  it('returns valid for empty array', () => {
    const result = validateProportions([])
    expect(result.valid).toBe(true)
  })

  it('returns valid for single asset', () => {
    const result = validateProportions([{ size: 10 }])
    expect(result.valid).toBe(true)
  })

  it('returns valid for reasonable proportions', () => {
    const assets = [
      { size: 0.5 },  // Small prop
      { size: 1.8 },  // Human
      { size: 12 },   // Tree
      { size: 20 }    // Building
    ]
    const result = validateProportions(assets)
    expect(result.valid).toBe(true)
    expect(result.ratio).toBeCloseTo(40) // 20 / 0.5
  })

  it('returns invalid for extreme proportions', () => {
    const assets = [
      { size: 0.1 },  // Tiny
      { size: 50 }    // Huge (500x ratio)
    ]
    const result = validateProportions(assets)
    expect(result.valid).toBe(false)
    expect(result.ratio).toBe(500)
    expect(result.warning).toContain('exceeds limit')
  })

  it('handles realWorldSize field', () => {
    const assets = [
      { realWorldSize: 1 },
      { realWorldSize: 10 }
    ]
    const result = validateProportions(assets)
    expect(result.valid).toBe(true)
    expect(result.ratio).toBe(10)
  })
})

describe('processScenePlan', () => {
  it('converts realWorldSize to scale for all assets using universal baseline and game factor', () => {
    const plan = {
      assets: [
        { prompt: 'oak tree', category: 'nature', realWorldSize: 12 },
        { prompt: 'stone well', category: 'props', realWorldSize: 1.5 }
      ],
      npcs: [
        { prompt: 'villager', category: 'characters', realWorldSize: 2 }
      ]
    }

    const processed = processScenePlan(plan)

    // Tree: 12m / 2m baseline × 8 = scale 48
    expect(processed.assets[0].scale).toBeCloseTo(48.0)
    // Well: 1.5m / 2m baseline × 8 = scale 6
    expect(processed.assets[1].scale).toBeCloseTo(6.0)
    // Villager: 2m / 2m baseline × 8 = scale 8
    expect(processed.npcs[0].scale).toBeCloseTo(8.0)
  })

  it('converts legacy scale to realWorldSize then back to scale', () => {
    const plan = {
      assets: [
        { prompt: 'old tree', category: 'nature', scale: 5 }
        // Legacy: scale 5 × 2m universal baseline = 10m, which is valid
        // Result: scale = (10m / 2m) × 8 = 40
      ]
    }

    const processed = processScenePlan(plan)
    expect(processed.assets[0].realWorldSize).toBe(10)
    expect(processed.assets[0].scale).toBeCloseTo(40.0)
  })

  it('clamps legacy scale that would exceed limits', () => {
    const plan = {
      assets: [
        { prompt: 'giant tree', category: 'nature', scale: 150 }
        // Legacy: scale 150 × 2m baseline = 300m!
        // Should clamp to 60m (nature max, includes mountains), then scale = (60/2) × 8 = 240
        // Nature has higher MAX_SCALE (240) to allow dramatic mountains/backdrops
      ]
    }

    const processed = processScenePlan(plan)
    expect(processed.assets[0].realWorldSize).toBe(60) // Clamped to nature max (60m for mountains)
    expect(processed.assets[0].scale).toBe(MAX_SCALE_BY_CATEGORY.nature) // Nature max scale = 240
    expect(processed._sizeWarnings).toBeDefined()
    expect(processed._sizeWarnings.length).toBeGreaterThan(0)
  })

  it('uses category defaults when no size specified', () => {
    const plan = {
      assets: [
        { prompt: 'flower', category: 'props' }
        // No size → default 1.5m for props (increased for visibility)
        // scale = (1.5m / 2m baseline) × 8 = 6
      ]
    }

    const processed = processScenePlan(plan)
    expect(processed.assets[0].realWorldSize).toBe(SIZE_INVARIANTS.DEFAULT_SIZES.props)
    expect(processed.assets[0].scale).toBeCloseTo((SIZE_INVARIANTS.DEFAULT_SIZES.props / UNIVERSAL_BASELINE) * GAME_SCALE_FACTOR)
  })

  it('adds warnings for clamped values', () => {
    const plan = {
      assets: [
        { prompt: 'impossibly large flower', category: 'props', realWorldSize: 100 }
      ]
    }

    const processed = processScenePlan(plan)
    expect(processed._sizeWarnings).toBeDefined()
    expect(processed._sizeWarnings.length).toBeGreaterThan(0)
    expect(processed._sizeWarnings[0]).toContain('props max')
  })

  it('returns null for null input', () => {
    expect(processScenePlan(null)).toBeNull()
  })

  it('handles empty plan gracefully', () => {
    const plan = {}
    const processed = processScenePlan(plan)
    expect(processed).toEqual({})
  })
})

describe('computeRescale', () => {
  it('computes rescale for valid size using universal baseline and game factor', () => {
    const result = computeRescale(12, 'nature')
    // (12m / 2m) × 8 = 48
    expect(result.scale).toBeCloseTo(48.0)
    expect(result.realWorldSize).toBe(12)
    expect(result.clamped).toBe(false)
  })

  it('clamps and reports clamped size', () => {
    const result = computeRescale(100, 'props')
    expect(result.realWorldSize).toBe(5) // Props max
    expect(result.scale).toBeCloseTo((5 / UNIVERSAL_BASELINE) * GAME_SCALE_FACTOR) // (5/2) × 4 = 10
    expect(result.clamped).toBe(true)
  })
})

describe('SIZE_INVARIANTS constants', () => {
  it('has sensible absolute limits', () => {
    expect(SIZE_INVARIANTS.MIN_ASSET_SIZE).toBe(0.1)
    expect(SIZE_INVARIANTS.MAX_ASSET_SIZE).toBe(60) // Allows dramatic mountains/terrain
    expect(SIZE_INVARIANTS.MAX_SIZE_RATIO).toBe(100)
  })

  it('has defaults for all categories', () => {
    const categories = ['props', 'characters', 'creatures', 'nature', 'buildings', 'vehicles']
    for (const cat of categories) {
      expect(SIZE_INVARIANTS.DEFAULT_SIZES[cat]).toBeDefined()
      expect(SIZE_INVARIANTS.MAX_CATEGORY_SIZES[cat]).toBeDefined()
    }
  })

  it('category max sizes are within absolute max', () => {
    for (const [cat, max] of Object.entries(SIZE_INVARIANTS.MAX_CATEGORY_SIZES)) {
      expect(max).toBeLessThanOrEqual(SIZE_INVARIANTS.MAX_ASSET_SIZE)
    }
  })

  it('default sizes are within category limits', () => {
    for (const [cat, defaultSize] of Object.entries(SIZE_INVARIANTS.DEFAULT_SIZES)) {
      const max = SIZE_INVARIANTS.MAX_CATEGORY_SIZES[cat]
      expect(defaultSize).toBeLessThanOrEqual(max)
    }
  })
})

describe('UNIVERSAL_BASELINE constant', () => {
  it('is set to 2.0 for universal normalization', () => {
    expect(UNIVERSAL_BASELINE).toBe(2.0)
  })
})

describe('GAME_SCALE_FACTOR constant', () => {
  it('is set to 8 for game-visible scaling', () => {
    expect(GAME_SCALE_FACTOR).toBe(8)
  })
})

describe('MAX_SCALE constant', () => {
  it('is set to 80 as default fallback', () => {
    expect(MAX_SCALE).toBe(80)
  })

  it('has category-specific max scales for size hierarchy', () => {
    // Different categories can have different max scales
    expect(MAX_SCALE_BY_CATEGORY.props).toBe(40)
    expect(MAX_SCALE_BY_CATEGORY.buildings).toBe(200) // Tall landmarks (rockets, towers)
    expect(MAX_SCALE_BY_CATEGORY.nature).toBe(240) // Mountains can dominate as backdrop
  })

  it('caps scale output by category-specific limit', () => {
    // 25m building / 2m × 8 = 100, buildings max is 200, so no cap
    const buildingScale = computeScaleFromSize(25, 'buildings')
    expect(buildingScale).toBe(100)

    // 45m building / 2m × 8 = 180, below buildings max (200), so no cap
    const medBuildingScale = computeScaleFromSize(45, 'buildings')
    expect(medBuildingScale).toBe(180)

    // 55m building → clamped to 50m by category max → 50/2 × 8 = 200, capped to buildings max (200)
    const largeBuildingScale = computeScaleFromSize(55, 'buildings')
    expect(largeBuildingScale).toBe(MAX_SCALE_BY_CATEGORY.buildings)
  })
})

describe('integration: 450m tree prevention', () => {
  it('makes 450m trees mathematically impossible', () => {
    // The original bug: AI outputs scale 150 for nature
    // Old system: 150 × 3m baseline = 450m tree (disaster!)
    // New system with universal baseline: 150 × 2m = 300m, clamped to 60m max
    // Final scale: (60/2) × 8 = 240, which is nature's category max

    const legacyPlan = {
      assets: [
        { prompt: 'massive ancient tree', category: 'nature', scale: 150 }
      ]
    }

    const processed = processScenePlan(legacyPlan)

    // The size should be clamped to nature max (60m, allows mountains)
    expect(processed.assets[0].realWorldSize).toBe(60)

    // Scale = (60m / 2m baseline) × 8 = 240 (nature's max scale for dramatic backdrops)
    expect(processed.assets[0].scale).toBe(MAX_SCALE_BY_CATEGORY.nature)

    // realWorldSize is what matters for "actual height" in meters
    expect(processed.assets[0].realWorldSize).toBe(60)
    expect(processed.assets[0].realWorldSize).toBeLessThanOrEqual(60) // Within nature max
  })

  it('correctly sizes standing stones for mystical forest', () => {
    // Common scene: "mystical forest with ancient standing stones"
    const plan = {
      assets: [
        { prompt: 'ancient standing stone megalith', category: 'props', realWorldSize: 5 },
        { prompt: 'oak tree', category: 'nature', realWorldSize: 8 },
        { prompt: 'glowing mushroom', category: 'props', realWorldSize: 0.3 }
      ]
    }

    const processed = processScenePlan(plan)

    // Standing stone: (5m / 2m) × 8 = scale 20
    expect(processed.assets[0].realWorldSize).toBe(5) // At props max
    expect(processed.assets[0].scale).toBeCloseTo(20.0)

    // Tree: (8m / 2m) × 8 = scale 32
    expect(processed.assets[1].scale).toBeCloseTo(32.0)

    // Mushroom: (0.3m / 2m) × 8 = scale 1.2
    expect(processed.assets[2].scale).toBeCloseTo(1.2)

    // Verify proportions are reasonable
    const proportionCheck = validateProportions([
      { size: processed.assets[0].realWorldSize },
      { size: processed.assets[1].realWorldSize },
      { size: processed.assets[2].realWorldSize }
    ])
    expect(proportionCheck.valid).toBe(true)
  })
})
