/**
 * Unit tests for placement algorithms
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  poissonDiskSampling,
  clusterPlacement,
  ringPlacement,
  edgePlacement,
  gridPlacement,
  parseSemanticLocation,
  executeAssetPlacement,
  validatePlacements,
  applyTerrainModification,
  rebalancePlacements,
  applyTerrainHeight,
  resolveRelationshipPlacements,
  resolveAtmosphereRelationship,
  StructureRegistry
} from '../../../src/generator/placementAlgorithms'
import { WORLD_SIZE, GRID_SIZE, SCENE_GENERATION } from '../../../src/shared/constants'

describe('poissonDiskSampling', () => {
  it('generates the requested number of points', () => {
    const bounds = { minX: 0, maxX: 100, minZ: 0, maxZ: 100 }
    const points = poissonDiskSampling(bounds, 10, 15)

    // May generate fewer if space is constrained
    expect(points.length).toBeGreaterThan(0)
    expect(points.length).toBeLessThanOrEqual(10)
  })

  it('maintains minimum distance between points', () => {
    const bounds = { minX: 0, maxX: 200, minZ: 0, maxZ: 200 }
    const minDistance = 20
    const points = poissonDiskSampling(bounds, 15, minDistance)

    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const dx = points[i].x - points[j].x
        const dz = points[i].z - points[j].z
        const dist = Math.sqrt(dx * dx + dz * dz)
        expect(dist).toBeGreaterThanOrEqual(minDistance - 0.001) // Small tolerance for floating point
      }
    }
  })

  it('keeps points within bounds', () => {
    const bounds = { minX: 50, maxX: 150, minZ: 100, maxZ: 200 }
    const points = poissonDiskSampling(bounds, 20, 10)

    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(bounds.minX)
      expect(point.x).toBeLessThanOrEqual(bounds.maxX)
      expect(point.z).toBeGreaterThanOrEqual(bounds.minZ)
      expect(point.z).toBeLessThanOrEqual(bounds.maxZ)
    }
  })
})

describe('clusterPlacement', () => {
  it('generates points around center', () => {
    const center = { x: 100, z: 100 }
    const radius = 30
    const points = clusterPlacement(center, 10, radius)

    for (const point of points) {
      const dx = point.x - center.x
      const dz = point.z - center.z
      const dist = Math.sqrt(dx * dx + dz * dz)
      expect(dist).toBeLessThanOrEqual(radius)
    }
  })

  it('respects minimum spacing', () => {
    const center = { x: 100, z: 100 }
    const minSpacing = 10
    const points = clusterPlacement(center, 5, 50, minSpacing)

    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const dx = points[i].x - points[j].x
        const dz = points[i].z - points[j].z
        const dist = Math.sqrt(dx * dx + dz * dz)
        expect(dist).toBeGreaterThanOrEqual(minSpacing - 0.001)
      }
    }
  })
})

describe('ringPlacement', () => {
  it('places points in a circle', () => {
    const center = { x: 100, z: 100 }
    const radius = 50
    const count = 8
    const points = ringPlacement(center, count, radius, 0)

    expect(points.length).toBe(count)

    for (const point of points) {
      const dx = point.x - center.x
      const dz = point.z - center.z
      const dist = Math.sqrt(dx * dx + dz * dz)
      // Should be close to the specified radius
      expect(dist).toBeCloseTo(radius, 0)
    }
  })

  it('provides rotation facing center', () => {
    const center = { x: 100, z: 100 }
    const points = ringPlacement(center, 4, 50)

    for (const point of points) {
      expect(typeof point.rotation).toBe('number')
    }
  })
})

describe('edgePlacement', () => {
  // Note: edgePlacement now uses SCENE bounds (60m zone: 170-230) not WORLD bounds (400m)
  // This fixes the "line of trees at world edge" bug

  it('places points along north edge (within scene zone)', () => {
    const points = edgePlacement('N', 5, 15)

    // North edge should be near SCENE_GENERATION.MAX_Z (230)
    for (const point of points) {
      expect(point.z).toBeGreaterThan(SCENE_GENERATION.MAX_Z - 20)  // > 210
      expect(point.z).toBeLessThanOrEqual(SCENE_GENERATION.MAX_Z)  // <= 230
    }
  })

  it('places points along south edge (within scene zone)', () => {
    const points = edgePlacement('S', 5, 15)

    // South edge should be near SCENE_GENERATION.MIN_Z (170)
    for (const point of points) {
      expect(point.z).toBeLessThan(SCENE_GENERATION.MIN_Z + 20)  // < 190
      expect(point.z).toBeGreaterThanOrEqual(SCENE_GENERATION.MIN_Z)  // >= 170
    }
  })

  it('places points along east edge (within scene zone)', () => {
    const points = edgePlacement('E', 5, 15)

    // East edge should be near SCENE_GENERATION.MAX_X (230)
    for (const point of points) {
      expect(point.x).toBeGreaterThan(SCENE_GENERATION.MAX_X - 20)  // > 210
      expect(point.x).toBeLessThanOrEqual(SCENE_GENERATION.MAX_X)  // <= 230
    }
  })

  it('places points along west edge (within scene zone)', () => {
    const points = edgePlacement('W', 5, 15)

    // West edge should be near SCENE_GENERATION.MIN_X (170)
    for (const point of points) {
      expect(point.x).toBeLessThan(SCENE_GENERATION.MIN_X + 20)  // < 190
      expect(point.x).toBeGreaterThanOrEqual(SCENE_GENERATION.MIN_X)  // >= 170
    }
  })

  it('throws for invalid edge', () => {
    expect(() => edgePlacement('X', 5, 50)).toThrow()
  })
})

describe('gridPlacement', () => {
  it('creates grid of points', () => {
    const bounds = { minX: 0, maxX: 100, minZ: 0, maxZ: 100 }
    const points = gridPlacement(bounds, 3, 3)

    expect(points.length).toBe(9)
  })

  it('respects bounds', () => {
    const bounds = { minX: 50, maxX: 150, minZ: 50, maxZ: 150 }
    const points = gridPlacement(bounds, 2, 2)

    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(bounds.minX)
      expect(point.x).toBeLessThanOrEqual(bounds.maxX)
      expect(point.z).toBeGreaterThanOrEqual(bounds.minZ)
      expect(point.z).toBeLessThanOrEqual(bounds.maxZ)
    }
  })
})

describe('parseSemanticLocation', () => {
  // parseSemanticLocation now uses the SCENE zone (60m × 60m centered in world)
  const sceneCenterX = SCENE_GENERATION.CENTER_X  // 200
  const sceneCenterZ = SCENE_GENERATION.CENTER_Z  // 200
  const sceneSize = SCENE_GENERATION.SIZE         // 60
  const sceneMinX = SCENE_GENERATION.MIN_X        // 170
  const sceneMaxX = SCENE_GENERATION.MAX_X        // 230
  const sceneMinZ = SCENE_GENERATION.MIN_Z        // 170
  const sceneMaxZ = SCENE_GENERATION.MAX_Z        // 230

  it('parses NE quadrant within scene zone', () => {
    const result = parseSemanticLocation('NE quadrant')

    // NE quadrant is upper-right portion of scene zone
    expect(result.minX).toBe(sceneCenterX)  // 200
    expect(result.maxX).toBe(sceneMaxX)     // 230
    expect(result.minZ).toBe(sceneCenterZ)  // 200
    expect(result.maxZ).toBe(sceneMaxZ)     // 230
  })

  it('parses center as inner 40m of scene zone', () => {
    const result = parseSemanticLocation('center')
    // Center is inner zone with 10m margin from scene edges
    const innerMargin = 10

    expect(result.minX).toBe(sceneMinX + innerMargin)  // 180
    expect(result.maxX).toBe(sceneMaxX - innerMargin)  // 220
    expect(result.minZ).toBe(sceneMinZ + innerMargin)  // 180
    expect(result.maxZ).toBe(sceneMaxZ - innerMargin)  // 220
  })

  it('parses north edge as 10m strip', () => {
    const result = parseSemanticLocation('N edge')
    const edgeDepth = 10

    expect(result.minZ).toBe(sceneMaxZ - edgeDepth)  // 220
    expect(result.maxZ).toBe(sceneMaxZ)              // 230
  })

  it('provides center point at scene center', () => {
    const result = parseSemanticLocation('SW quadrant')
    const quarter = sceneSize / 4  // 15

    expect(result.center).toBeDefined()
    // SW quadrant center is offset from scene center
    expect(result.center.x).toBe(sceneCenterX - quarter)  // 185
    expect(result.center.z).toBe(sceneCenterZ - quarter)  // 185
  })

  it('returns full scene zone for unknown location', () => {
    const result = parseSemanticLocation('somewhere random')

    // Should return the full scene zone, not the full world
    expect(result.minX).toBe(sceneMinX)  // 170
    expect(result.maxX).toBe(sceneMaxX)  // 230
    expect(result.minZ).toBe(sceneMinZ)  // 170
    expect(result.maxZ).toBe(sceneMaxZ)  // 230
  })
})

describe('executeAssetPlacement', () => {
  it('handles focal placement', () => {
    const spec = {
      placement: 'focal',
      location: 'center',
      count: 1
    }
    const points = executeAssetPlacement(spec)

    expect(points.length).toBe(1)
    expect(points[0].x).toBeCloseTo(WORLD_SIZE / 2, 0)
    expect(points[0].z).toBeCloseTo(WORLD_SIZE / 2, 0)
  })

  it('handles scatter placement', () => {
    const spec = {
      placement: 'scatter',
      location: 'NE quadrant',
      count: 5,
      minDistance: 20
    }
    const points = executeAssetPlacement(spec)

    expect(points.length).toBeGreaterThan(0)
    expect(points.length).toBeLessThanOrEqual(5)
  })

  it('handles ring placement', () => {
    const spec = {
      placement: 'ring',
      location: 'center',
      count: 6,
      radius: 50
    }
    const points = executeAssetPlacement(spec)

    expect(points.length).toBe(6)
  })
})

describe('validatePlacements', () => {
  it('uses scale-based distance even when minDistanceOverride is small', () => {
    // CRITICAL TEST: Ensures large scaled assets can't overlap despite small minDistance
    // This was a major bug - explicit minDistance was OVERRIDING scale-based collision

    const existingInstances = [
      { position: [200, 0, 200], scale: 10 }  // Large asset (scale 10 = ~20m radius)
    ]

    // Try to place a large asset close to existing
    const newPositions = [
      { x: 205, z: 200 }  // Only 5m away from existing
    ]

    // With scale 10 for both assets, required distance should be ~24m (10 + 10) * 1.2
    // Even with minDistanceOverride=2, scale-based collision should reject this
    const result = validatePlacements(
      newPositions,
      existingInstances,
      10,       // newScale
      'props',  // category
      null,     // getCategoryForInstance
      2         // minDistanceOverride (small, should be floor not override)
    )

    // Should be rejected because scale-based distance is ~24m, not 2m
    expect(result.length).toBe(0)
  })

  it('allows placement when outside scale-based distance', () => {
    const existingInstances = [
      { position: [200, 0, 200], scale: 10 }
    ]

    // Place far enough away (30m should be safe for scale 10 + 10)
    const newPositions = [
      { x: 230, z: 200 }  // 30m away
    ]

    const result = validatePlacements(
      newPositions,
      existingInstances,
      10,
      'props',
      null,
      2  // minDistance floor doesn't matter since we're far enough
    )

    expect(result.length).toBe(1)
  })

  it('filters out positions too close to existing instances', () => {
    const newPositions = [
      { x: 100, z: 100 },
      { x: 200, z: 200 },
      { x: 102, z: 102 } // Too close to first existing
    ]

    const existingInstances = [
      { position: [100, 0, 100] }
    ]

    const valid = validatePlacements(newPositions, existingInstances, 10)

    expect(valid.length).toBe(1)
    expect(valid[0].x).toBe(200)
  })

  it('filters out positions outside world bounds', () => {
    const newPositions = [
      { x: 2, z: 100 }, // Too close to edge
      { x: WORLD_SIZE - 2, z: 100 }, // Too close to edge
      { x: 100, z: 100 } // Valid
    ]

    const valid = validatePlacements(newPositions, [], 5)

    expect(valid.length).toBe(1)
    expect(valid[0].x).toBe(100)
  })
})

describe('applyTerrainModification', () => {
  let heightmap

  beforeEach(() => {
    // Create a flat heightmap
    heightmap = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0))
  })

  it('raises terrain in zone', () => {
    const changes = applyTerrainModification(heightmap, {
      zone: 'center',
      action: 'raise',
      amount: 3
    })

    expect(changes.length).toBeGreaterThan(0)
    // All changes should increase height by 3
    for (const change of changes) {
      expect(change.newValue).toBe(3)
      expect(change.oldValue).toBe(0)
    }
  })

  it('lowers terrain in zone', () => {
    // First raise some terrain
    for (let z = 10; z < 20; z++) {
      for (let x = 10; x < 20; x++) {
        heightmap[z][x] = 5
      }
    }

    const changes = applyTerrainModification(heightmap, {
      zone: 'center',
      action: 'lower',
      amount: 2
    })

    // Should have lowered from 5 to 3
    const centerChange = changes.find(c => c.oldValue === 5)
    if (centerChange) {
      expect(centerChange.newValue).toBe(3)
    }
  })

  it('flattens terrain in zone', () => {
    // Set varying heights
    for (let z = 0; z < GRID_SIZE; z++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        heightmap[z][x] = Math.random() * 10
      }
    }

    const changes = applyTerrainModification(heightmap, {
      zone: 'center',
      action: 'flatten'
    })

    // All new values should be 0
    for (const change of changes) {
      expect(change.newValue).toBe(0)
    }
  })

  it('returns changes for undo', () => {
    const changes = applyTerrainModification(heightmap, {
      zone: 'NE quadrant',
      action: 'raise',
      amount: 2
    })

    for (const change of changes) {
      expect(change).toHaveProperty('x')
      expect(change).toHaveProperty('z')
      expect(change).toHaveProperty('oldValue')
      expect(change).toHaveProperty('newValue')
    }
  })
})

describe('rebalancePlacements', () => {
  it('returns empty result for empty input', () => {
    const result = rebalancePlacements([])
    expect(result.placements).toEqual([])
    expect(result.moved).toBe(0)
  })

  it('does not move assets when distribution is balanced', () => {
    // Create placements spread across different cells
    const placements = [
      { x: SCENE_GENERATION.MIN_X + 20, z: SCENE_GENERATION.MIN_Z + 20 },  // SW
      { x: SCENE_GENERATION.CENTER_X, z: SCENE_GENERATION.CENTER_Z },      // Center
      { x: SCENE_GENERATION.MAX_X - 20, z: SCENE_GENERATION.MAX_Z - 20 },  // NE
    ]

    const result = rebalancePlacements(placements, 6, 3)
    expect(result.moved).toBe(0)
  })

  it('moves assets from crowded cells to sparse cells', () => {
    // Create 10 assets all in center cell (crowded)
    const placements = []
    for (let i = 0; i < 10; i++) {
      placements.push({
        x: SCENE_GENERATION.CENTER_X + (Math.random() - 0.5) * 20,
        z: SCENE_GENERATION.CENTER_Z + (Math.random() - 0.5) * 20,
        index: i
      })
    }

    // With maxPerCell=6, we have 4 excess
    const result = rebalancePlacements(placements, 6, 3)

    // Should move some assets to sparse cells
    expect(result.moved).toBeGreaterThan(0)
  })

  it('marks relocated assets with _relocated flag', () => {
    // Create 10 assets all in center cell
    const placements = []
    for (let i = 0; i < 10; i++) {
      placements.push({
        x: SCENE_GENERATION.CENTER_X + (Math.random() - 0.5) * 10,
        z: SCENE_GENERATION.CENTER_Z + (Math.random() - 0.5) * 10,
        index: i
      })
    }

    const result = rebalancePlacements(placements, 6, 3)

    const relocatedCount = result.placements.filter(p => p._relocated).length
    expect(relocatedCount).toBe(result.moved)
  })
})

describe('applyTerrainHeight', () => {
  it('returns placements unchanged if no height function provided', () => {
    const placements = [{ x: 100, z: 100 }]
    const result = applyTerrainHeight(placements, null)
    expect(result).toEqual(placements)
  })

  it('sets y coordinate from terrain height function', () => {
    const placements = [
      { x: 100, z: 100 },
      { x: 150, z: 150 }
    ]

    const getHeight = (x, z) => (x + z) / 100  // Simple height function

    const result = applyTerrainHeight(placements, getHeight)

    expect(result[0].y).toBeCloseTo(2.0)
    expect(result[1].y).toBeCloseTo(3.0)
  })

  it('uses 0 for undefined height', () => {
    const placements = [{ x: 100, z: 100 }]
    const getHeight = () => undefined

    const result = applyTerrainHeight(placements, getHeight)
    expect(result[0].y).toBe(0)
  })
})

describe('resolveRelationshipPlacements - structure collision', () => {
  it('separates structures with same position keyword', () => {
    const plan = {
      structures: [
        { id: 'a', asset: { prompt: 'building A', scale: 10, category: 'buildings' }, placement: { position: 'center' }, _estimatedBounds: { width: 10, depth: 10 } },
        { id: 'b', asset: { prompt: 'building B', scale: 10, category: 'buildings' }, placement: { position: 'center' }, _estimatedBounds: { width: 10, depth: 10 } },
        { id: 'c', asset: { prompt: 'building C', scale: 10, category: 'buildings' }, placement: { position: 'center' }, _estimatedBounds: { width: 10, depth: 10 } }
      ],
      decorations: [],
      arrangements: [],
      atmosphere: [],
      npcs: []
    }

    const generatedAssets = new Map([
      ['building A', { id: 'asset_a' }],
      ['building B', { id: 'asset_b' }],
      ['building C', { id: 'asset_c' }]
    ])

    const { placements } = resolveRelationshipPlacements(plan, generatedAssets, [])

    // All 3 structures should be placed
    const structs = placements.filter(p => p._type === 'structure')
    expect(structs.length).toBe(3)

    // No two should overlap (min distance = radius1 + radius2 + 2 = ~12m)
    for (let i = 0; i < structs.length; i++) {
      for (let j = i + 1; j < structs.length; j++) {
        const dx = structs[i].position[0] - structs[j].position[0]
        const dz = structs[i].position[2] - structs[j].position[2]
        const dist = Math.sqrt(dx * dx + dz * dz)
        expect(dist).toBeGreaterThan(10) // Should not overlap
      }
    }
  })
})

describe('resolveAtmosphereRelationship', () => {
  it('handles adjacent_to type', () => {
    const registry = new StructureRegistry()
    registry.register('diner', {
      position: { x: 200, z: 200 },
      rotation: 0,
      bounds: { width: 12, height: 8, depth: 10 }
    })

    const atmo = {
      relationship: { type: 'adjacent_to', target: 'diner', side: 'front', spacing: 3 },
      count: 4
    }

    const positions = resolveAtmosphereRelationship(atmo, registry, [])
    expect(positions.length).toBeGreaterThan(0)
    expect(positions.length).toBeLessThanOrEqual(4)
  })

  it('handles along with string path format', () => {
    const registry = new StructureRegistry()
    registry.register('parking', {
      position: { x: 200, z: 215 },
      rotation: 0,
      bounds: { width: 18, height: 0.5, depth: 12 }
    })

    const atmo = {
      relationship: { type: 'along', path: 'parking.front', spacing: 6 },
      count: 3
    }

    const positions = resolveAtmosphereRelationship(atmo, registry, [])
    expect(positions.length).toBeGreaterThan(0)
  })

  it('handles along with object path format', () => {
    const registry = new StructureRegistry()
    registry.register('start', {
      position: { x: 180, z: 200 },
      rotation: 0,
      bounds: { width: 5, height: 5, depth: 5 }
    })
    registry.register('end', {
      position: { x: 220, z: 200 },
      rotation: 0,
      bounds: { width: 5, height: 5, depth: 5 }
    })

    const atmo = {
      relationship: { type: 'along', path: { from: 'start', to: 'end' }, spacing: 10 },
      count: 4
    }

    const positions = resolveAtmosphereRelationship(atmo, registry, [])
    expect(positions.length).toBeGreaterThan(0)
  })
})
