/**
 * Scale Validation Tests
 *
 * Validates that the asset scale pipeline produces correct game-visible sizes.
 * Tests the full chain: realWorldSize → computeScaleFromSize → normalization → final size
 *
 * With universal normalization, ALL assets normalize to 2 units (UNIVERSAL_BASELINE).
 * With GAME_SCALE_FACTOR (8x), AI's real-world sizes are scaled up for game visibility.
 * scale = (realWorldSize / 2.0) × 8
 *
 * Final game size = realWorldSize × GAME_SCALE_FACTOR
 * e.g., AI says "8m cottage" → final dimension ~64m in game units
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as THREE from 'three'
import { computeScaleFromSize, enforceInvariants, SIZE_INVARIANTS, UNIVERSAL_BASELINE, GAME_SCALE_FACTOR } from '../../../src/generator/sizeInvariants'
import { AssetMeshFactory } from '../../../src/engine/systems/AssetMeshFactory'

/**
 * Create a mock asset with specific geometry dimensions (before normalization)
 * @param {number} width - X dimension
 * @param {number} height - Y dimension
 * @param {number} depth - Z dimension
 * @returns {THREE.Group} Mock asset group
 */
function createMockAsset(width, height, depth) {
  const group = new THREE.Group()
  const geometry = new THREE.BoxGeometry(width, height, depth)
  const material = new THREE.MeshStandardMaterial({ color: 0x888888 })
  const mesh = new THREE.Mesh(geometry, material)
  // Position so center is at origin, bottom at y = height/2
  mesh.position.y = height / 2
  group.add(mesh)
  return group
}

/**
 * Measure the actual bounding box of an object after all transformations
 * @param {THREE.Object3D} object
 * @returns {{ width: number, height: number, depth: number }}
 */
function measureBoundingBox(object) {
  const box = new THREE.Box3().setFromObject(object)
  const size = box.getSize(new THREE.Vector3())
  return {
    width: size.x,
    height: size.y,
    depth: size.z,
    maxDimension: Math.max(size.x, size.y, size.z)
  }
}

describe('Size Invariants', () => {
  describe('enforceInvariants', () => {
    it('clamps oversized nature to 60m (allows mountains)', () => {
      const result = enforceInvariants(200, 'nature')
      expect(result.size).toBe(60)
      expect(result.clamped).toBe(true)
    })

    it('allows normal sizes through', () => {
      const result = enforceInvariants(12, 'nature')
      expect(result.size).toBe(12)
      expect(result.clamped).toBe(false)
    })

    it('clamps props to 5m max', () => {
      const result = enforceInvariants(10, 'props')
      expect(result.size).toBe(5)
      expect(result.clamped).toBe(true)
    })
  })

  describe('computeScaleFromSize', () => {
    it('computes scale using universal baseline and game factor', () => {
      // 12m tree / 2m baseline × 8 = 48
      const scale = computeScaleFromSize(12, 'nature')
      expect(scale).toBeCloseTo(48, 2)
    })

    it('computes 2m asset as scale 8', () => {
      // 2m / 2m baseline × 8 = 8
      const scale = computeScaleFromSize(2, 'characters')
      expect(scale).toBeCloseTo(8, 2)
    })

    it('clamps then computes scale with category-specific cap', () => {
      // 200m nature → clamped to 60m (nature max) → (60/2) × 8 = 240
      // Nature has higher max scale (240) to allow dramatic mountains/backdrops
      const scale = computeScaleFromSize(200, 'nature')
      expect(scale).toBe(240) // Nature's category-specific max scale
    })
  })
})

describe('AssetMeshFactory Normalization', () => {
  let factory

  beforeEach(() => {
    factory = new AssetMeshFactory()
  })

  describe('normalizeAssetSize - universal normalization', () => {
    it('normalizes all assets to 2 units max dimension', () => {
      // A tree-like asset: 2w × 5h × 2d
      const asset = createMockAsset(2, 5, 2)
      factory.normalizeAssetSize(asset, 'nature')

      const { maxDimension } = measureBoundingBox(asset)
      // Should normalize to universal baseline (2.0)
      expect(maxDimension).toBeCloseTo(UNIVERSAL_BASELINE, 1)
    })

    it('normalizes a character to 2 units', () => {
      // Human-like: 0.5w × 2h × 0.3d
      const asset = createMockAsset(0.5, 2, 0.3)
      factory.normalizeAssetSize(asset, 'characters')

      const { maxDimension } = measureBoundingBox(asset)
      expect(maxDimension).toBeCloseTo(UNIVERSAL_BASELINE, 1)
    })
  })

  describe('normalizeAssetSize - wide assets', () => {
    it('normalizes a wide/flat asset (cloud) to 2 units max dimension', () => {
      // Cloud-like: 100w × 10h × 80d
      const asset = createMockAsset(100, 10, 80)
      factory.normalizeAssetSize(asset, 'nature')

      const { maxDimension, width, height } = measureBoundingBox(asset)

      // All assets normalize to 2 units max dimension
      expect(maxDimension).toBeCloseTo(UNIVERSAL_BASELINE, 1)

      // Width should be 2 (max dimension), not 30 like the old bug
      expect(width).toBeCloseTo(2, 1)
    })

    it('normalizes a platform to 2 units', () => {
      // Platform: 20w × 1h × 20d
      const asset = createMockAsset(20, 1, 20)
      factory.normalizeAssetSize(asset, 'props')

      const { maxDimension } = measureBoundingBox(asset)
      expect(maxDimension).toBeCloseTo(UNIVERSAL_BASELINE, 1)
    })
  })

  describe('normalizeAssetSize - edge cases', () => {
    it('handles cube-shaped assets', () => {
      // Cube: 3w × 3h × 3d
      const asset = createMockAsset(3, 3, 3)
      factory.normalizeAssetSize(asset, 'props')

      const { maxDimension } = measureBoundingBox(asset)
      expect(maxDimension).toBeCloseTo(UNIVERSAL_BASELINE, 1)
    })

    it('handles very flat assets (ground cover)', () => {
      // Ground cover: 10w × 0.1h × 10d
      const asset = createMockAsset(10, 0.1, 10)
      factory.normalizeAssetSize(asset, 'props')

      const { maxDimension } = measureBoundingBox(asset)
      expect(maxDimension).toBeCloseTo(UNIVERSAL_BASELINE, 1)
    })
  })
})

describe('Full Scale Pipeline', () => {
  let factory

  beforeEach(() => {
    factory = new AssetMeshFactory()
  })

  /**
   * Simulate the full scale pipeline:
   * 1. AI specifies realWorldSize (in AI's mental model, e.g., "12m tree")
   * 2. System computes scale via computeScaleFromSize (applies GAME_SCALE_FACTOR)
   * 3. Asset is generated with some geometry
   * 4. normalizeAssetSize is applied (to 2 units)
   * 5. Instance scale is applied
   * 6. Final size = realWorldSize × GAME_SCALE_FACTOR (for game visibility)
   */
  function simulateFullPipeline(realWorldSize, category, geometryDimensions) {
    const [geoW, geoH, geoD] = geometryDimensions

    // Step 1-2: Compute instance scale from realWorldSize
    const instanceScale = computeScaleFromSize(realWorldSize, category)

    // Step 3: Create asset with given geometry
    const asset = createMockAsset(geoW, geoH, geoD)

    // Step 4: Normalize to universal baseline (2 units)
    factory.normalizeAssetSize(asset, category)

    // Step 5: Apply instance scale (what WorldRenderer does)
    asset.scale.multiplyScalar(instanceScale)

    // Step 6: Measure final size
    return measureBoundingBox(asset)
  }

  // Expected game size = realWorldSize × GAME_SCALE_FACTOR
  // AI says "12m" → game shows 96m (8x for visibility)

  it('12m tree produces ~96m game dimension (12m × 8)', () => {
    // Tree: 2w × 10h × 2d geometry (height dominant)
    // 12m / 2m × 8 = 48 (under MAX_SCALE 80)
    const result = simulateFullPipeline(12, 'nature', [2, 10, 2])
    const expectedGameSize = 12 * GAME_SCALE_FACTOR // 96

    expect(result.maxDimension).toBeGreaterThan(expectedGameSize * 0.8)
    expect(result.maxDimension).toBeLessThan(expectedGameSize * 1.2)
  })

  it('2m human produces ~16m game dimension (2m × 8)', () => {
    // Human: 0.5w × 2h × 0.3d geometry
    const result = simulateFullPipeline(2, 'characters', [0.5, 2, 0.3])
    const expectedGameSize = 2 * GAME_SCALE_FACTOR // 16

    expect(result.maxDimension).toBeGreaterThan(expectedGameSize * 0.8)
    expect(result.maxDimension).toBeLessThan(expectedGameSize * 1.2)
  })

  it('40m cloud with wide geometry is NOT capped for nature (backdrop support)', () => {
    // Nature category has higher max scale (240) to support mountains/backdrops
    // Cloud: 100w × 10h × 80d geometry (wide/flat)
    // 40m / 2m × 8 = scale 160 (below nature's 240 cap, so NOT capped)
    // Expected game size: 160 × 2 = 320m

    const result = simulateFullPipeline(40, 'nature', [100, 10, 80])
    const expectedGameSize = 40 * GAME_SCALE_FACTOR // 320m (not capped for nature)

    // The max dimension should be roughly 320m (40m × 8)
    expect(result.maxDimension).toBeLessThan(expectedGameSize * 1.5) // Allow tolerance
    expect(result.maxDimension).toBeGreaterThan(expectedGameSize * 0.5) // But not too small

    // Width should scale proportionally
    expect(result.width).toBeLessThan(expectedGameSize * 1.5)
  })

  it('8m cottage produces ~64m game dimension (8m × 8)', () => {
    // Cottage: 6w × 5h × 6d geometry
    // 8m / 2m × 8 = 32 (under MAX_SCALE 80)
    const result = simulateFullPipeline(8, 'buildings', [6, 5, 6])
    const expectedGameSize = 8 * GAME_SCALE_FACTOR // 64

    expect(result.maxDimension).toBeGreaterThan(expectedGameSize * 0.7)
    expect(result.maxDimension).toBeLessThan(expectedGameSize * 1.3)
  })

  it('1m barrel produces ~8m game dimension (1m × 8)', () => {
    // Barrel: 0.5w × 1h × 0.5d geometry
    const result = simulateFullPipeline(1, 'props', [0.5, 1, 0.5])
    const expectedGameSize = 1 * GAME_SCALE_FACTOR // 8

    expect(result.maxDimension).toBeGreaterThan(expectedGameSize * 0.7)
    expect(result.maxDimension).toBeLessThan(expectedGameSize * 1.3)
  })
})

describe('Diagnostic Output', () => {
  let factory

  beforeEach(() => {
    factory = new AssetMeshFactory()
  })

  it('stores normalization metadata on asset', () => {
    const asset = createMockAsset(100, 10, 80)
    factory.normalizeAssetSize(asset, 'nature')

    // Should have metadata about what happened
    expect(asset.userData.originalSize).toBeDefined()
    expect(asset.userData.normalizedTo).toBe(UNIVERSAL_BASELINE) // Universal baseline
    expect(asset.userData.category).toBe('nature')

    // With universal normalization, always uses maxDimension strategy
    expect(asset.userData.normalizedBy).toBe('maxDimension')
  })

  it('always uses maxDimension strategy with universal normalization', () => {
    const wideAsset = createMockAsset(100, 10, 80) // wide
    factory.normalizeAssetSize(wideAsset, 'nature')
    expect(wideAsset.userData.normalizedBy).toBe('maxDimension')

    const tallAsset = createMockAsset(2, 10, 2) // tall
    factory.normalizeAssetSize(tallAsset, 'nature')
    expect(tallAsset.userData.normalizedBy).toBe('maxDimension')

    const cubeAsset = createMockAsset(5, 5, 5) // cube
    factory.normalizeAssetSize(cubeAsset, 'props')
    expect(cubeAsset.userData.normalizedBy).toBe('maxDimension')
  })
})
