/**
 * Unit tests for the relationship-aware scene generation system
 *
 * Tests:
 * 1. parseRelationshipPlan() - Parser for relationship-based scene plans
 * 2. StructureRegistry - Registry for placed structures
 * 3. resolveStructurePlacement() - Structure positioning
 * 4. resolveDecorationRelationship() - Decoration placement relative to structures
 * 5. resolveArrangement() - Arrangement patterns (cluster, grid, row, circle)
 * 6. resolveAtmosphereRelationship() - Atmosphere placement
 * 7. resolveRelationshipPlacements() - Full pipeline integration
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  parseRelationshipPlan,
  estimateBoundsFromSize
} from '../../src/generator/scenePrompts.js'
import {
  StructureRegistry,
  facingToAngle,
  resolveStructurePlacement,
  resolveDecorationRelationship,
  resolveArrangement,
  resolveAtmosphereRelationship,
  resolveNPCPlacement,
  resolveRelationshipPlacements
} from '../../src/generator/placementAlgorithms.js'
import { SCENE_GENERATION } from '../../src/shared/constants.js'

// ═══════════════════════════════════════════════════════════════════════════════
// PARSER TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseRelationshipPlan', () => {
  it('parses a valid relationship plan with structures', () => {
    const input = JSON.stringify({
      theme: '60s surf diner',
      terrain: { biome: 'sand' },
      structures: [
        {
          id: 'diner',
          asset: {
            prompt: '1960s American roadside diner',
            category: 'buildings',
            realWorldSize: 12
          },
          placement: { position: 'center', facing: 'south' }
        }
      ],
      decorations: [
        {
          asset: { prompt: 'neon OPEN sign', category: 'props', realWorldSize: 1.2 },
          relationship: { type: 'attached_to', target: 'diner', surface: 'front' }
        }
      ]
    })

    const result = parseRelationshipPlan(input)

    expect(result).not.toBeNull()
    expect(result._isRelationshipPlan).toBe(true)
    expect(result.structures).toHaveLength(1)
    expect(result.structures[0].id).toBe('diner')
    expect(result.structures[0].asset.scale).toBeGreaterThan(0)
    expect(result.structures[0]._estimatedBounds).toBeDefined()
    expect(result.decorations).toHaveLength(1)
    expect(result.decorations[0].relationship.type).toBe('attached_to')
  })

  it('rejects plans without structures', () => {
    const input = JSON.stringify({
      terrain: { biome: 'grass' },
      decorations: []
    })

    const result = parseRelationshipPlan(input)
    expect(result).toBeNull()
  })

  it('handles markdown code fences', () => {
    const input = '```json\n' + JSON.stringify({
      structures: [{
        id: 'test',
        asset: { prompt: 'test building', realWorldSize: 10 },
        placement: { position: 'center' }
      }]
    }) + '\n```'

    const result = parseRelationshipPlan(input)
    expect(result).not.toBeNull()
    expect(result.structures).toHaveLength(1)
  })

  it('sets default values for missing fields', () => {
    const input = JSON.stringify({
      structures: [{
        id: 'minimal',
        asset: { prompt: 'minimal building' }
      }]
    })

    const result = parseRelationshipPlan(input)

    expect(result.structures[0].asset.category).toBe('buildings')
    expect(result.structures[0].asset.realWorldSize).toBe(10)
    expect(result.structures[0].placement.position).toBe('center')
    expect(result.structures[0].placement.facing).toBe('south')
  })
})

describe('estimateBoundsFromSize', () => {
  it('estimates building bounds (taller than wide)', () => {
    const bounds = estimateBoundsFromSize(10, 'buildings')
    expect(bounds.height).toBe(10)
    expect(bounds.width).toBe(8)
    expect(bounds.depth).toBe(6)
  })

  it('estimates nature bounds (narrow)', () => {
    const bounds = estimateBoundsFromSize(15, 'nature')
    expect(bounds.height).toBe(15)
    expect(bounds.width).toBe(6)
    expect(bounds.depth).toBe(6)
  })

  it('estimates character bounds', () => {
    const bounds = estimateBoundsFromSize(1.8, 'characters')
    expect(bounds.height).toBe(1.8)
    expect(bounds.width).toBeCloseTo(0.72)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// STRUCTURE REGISTRY TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('StructureRegistry', () => {
  let registry

  beforeEach(() => {
    registry = new StructureRegistry()
    registry.register('diner', {
      position: { x: 200, z: 200 },
      rotation: 0,
      bounds: { width: 10, height: 8, depth: 8 },
      category: 'buildings'
    })
  })

  it('registers and retrieves structures', () => {
    const struct = registry.get('diner')
    expect(struct).not.toBeNull()
    expect(struct.position.x).toBe(200)
    expect(struct.bounds.width).toBe(10)
  })

  it('returns null for unknown structures', () => {
    expect(registry.get('unknown')).toBeNull()
  })

  describe('getSurfacePosition', () => {
    it('returns front surface position', () => {
      const pos = registry.getSurfacePosition('diner', 'front', 0.5, 0.5)
      expect(pos).not.toBeNull()
      expect(pos.z).toBeGreaterThan(200) // Front is at positive Z
      expect(pos.y).toBe(4) // 0.5 * height 8
    })

    it('returns roof surface position', () => {
      const pos = registry.getSurfacePosition('diner', 'roof', 0.5, 0.5)
      expect(pos).not.toBeNull()
      expect(pos.y).toBe(8) // Top of building
    })

    it('respects horizontal position parameter', () => {
      const left = registry.getSurfacePosition('diner', 'front', 0, 0.5)
      const right = registry.getSurfacePosition('diner', 'front', 1, 0.5)
      expect(left.x).toBeLessThan(right.x)
    })
  })

  describe('getAdjacentPosition', () => {
    it('returns position in front of structure', () => {
      const pos = registry.getAdjacentPosition('diner', 'front', 5)
      expect(pos).not.toBeNull()
      expect(pos.z).toBe(200 + 8/2 + 5) // center + half depth + distance
    })

    it('returns position behind structure', () => {
      const pos = registry.getAdjacentPosition('diner', 'back', 5)
      expect(pos.z).toBe(200 - 8/2 - 5) // center - half depth - distance
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// STRUCTURE PLACEMENT TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('resolveStructurePlacement', () => {
  it('places at center position', () => {
    const registry = new StructureRegistry()
    const pos = resolveStructurePlacement({ position: 'center', facing: 'south' }, registry)

    expect(pos.x).toBe(SCENE_GENERATION.CENTER_X)
    expect(pos.z).toBe(SCENE_GENERATION.CENTER_Z)
    expect(pos.rotation).toBe(0) // south = 0
  })

  it('places at north position', () => {
    const registry = new StructureRegistry()
    const pos = resolveStructurePlacement({ position: 'north', facing: 'south' }, registry)

    expect(pos.x).toBe(SCENE_GENERATION.CENTER_X)
    expect(pos.z).toBeLessThan(SCENE_GENERATION.CENTER_Z)
  })

  it('places relative to another structure', () => {
    const registry = new StructureRegistry()
    registry.register('main', {
      position: { x: 200, z: 200 },
      rotation: 0,
      bounds: { width: 10, height: 10, depth: 10 }
    })

    const pos = resolveStructurePlacement({
      relative_to: 'main',
      side: 'front',
      distance: 15
    }, registry)

    expect(pos.z).toBeGreaterThan(200) // In front (positive Z)
  })
})

describe('facingToAngle', () => {
  it('converts facing keywords to radians', () => {
    expect(facingToAngle('south')).toBe(0)
    expect(facingToAngle('north')).toBe(Math.PI)
    expect(facingToAngle('east')).toBe(-Math.PI / 2)
    expect(facingToAngle('west')).toBe(Math.PI / 2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// DECORATION PLACEMENT TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('resolveDecorationRelationship', () => {
  let registry

  beforeEach(() => {
    registry = new StructureRegistry()
    registry.register('building', {
      position: { x: 200, z: 200 },
      rotation: 0,
      bounds: { width: 10, height: 8, depth: 8 }
    })
  })

  it('places attached_to decoration on surface', () => {
    const decoration = {
      relationship: {
        type: 'attached_to',
        target: 'building',
        surface: 'front',
        position: { horizontal: 0.5, vertical: 0.8 }
      },
      count: 1,
      spacing: 2,
      mirror: false
    }

    const positions = resolveDecorationRelationship(decoration, registry)

    expect(positions).toHaveLength(1)
    expect(positions[0].y).toBeCloseTo(6.4) // 0.8 * 8 height
    expect(positions[0].z).toBeGreaterThan(200) // On front surface
  })

  it('places mirrored decorations symmetrically', () => {
    const decoration = {
      relationship: {
        type: 'attached_to',
        target: 'building',
        surface: 'front',
        position: { horizontal: 0.2, vertical: 0.5 }
      },
      count: 2,
      spacing: 2,
      mirror: true
    }

    const positions = resolveDecorationRelationship(decoration, registry)

    expect(positions).toHaveLength(2)
    // Left and right should be mirrored (0.2 and 0.8)
    expect(positions[0].x).not.toBe(positions[1].x)
  })

  it('places adjacent_to decoration next to structure', () => {
    const decoration = {
      relationship: {
        type: 'adjacent_to',
        target: 'building',
        side: 'right',
        distance: 2
      },
      count: 1,
      spacing: 2
    }

    const positions = resolveDecorationRelationship(decoration, registry)

    expect(positions).toHaveLength(1)
    expect(positions[0].x).toBeGreaterThan(200) // To the right
  })

  it('places leaning_against decoration at base', () => {
    const decoration = {
      relationship: {
        type: 'leaning_against',
        target: 'building',
        surface: 'left',
        angle: 15
      },
      count: 3,
      spacing: 1
    }

    const positions = resolveDecorationRelationship(decoration, registry)

    expect(positions.length).toBeGreaterThanOrEqual(1)
    expect(positions[0].y).toBe(0) // At ground level
    expect(positions[0].tilt).toBeDefined()
  })

  it('returns empty array for unknown target', () => {
    const decoration = {
      relationship: {
        type: 'attached_to',
        target: 'nonexistent',
        surface: 'front'
      },
      count: 1
    }

    const positions = resolveDecorationRelationship(decoration, registry)
    expect(positions).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// V2 ATTACHMENT TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('resolveDecorationRelationship — v2_attachment', () => {
  let registry

  beforeEach(() => {
    registry = new StructureRegistry()
    registry.register('cafe', {
      position: { x: 200, z: 200 },
      rotation: 0,  // Facing south
      bounds: { width: 10, height: 8, depth: 8 }
    })
  })

  it('places wall-mounted item at height_ratio when flush with wall', () => {
    const decoration = {
      relationship: {
        type: 'v2_attachment',
        target: 'cafe',
        anchor: 'front',
        offset: [0, 0],  // Flush with wall
        height_ratio: 0.85,
        facing: 'away'
      },
      count: 1,
      arrangement: 'single'
    }

    const positions = resolveDecorationRelationship(decoration, registry)

    expect(positions).toHaveLength(1)
    expect(positions[0].y).toBeCloseTo(6.8)  // 0.85 * 8m height
  })

  it('places ground-level item at y=0 when offset away from wall', () => {
    const decoration = {
      relationship: {
        type: 'v2_attachment',
        target: 'cafe',
        anchor: 'front',
        offset: [5, 0],  // 5m forward — ground-level item
        height_ratio: 0.5,  // LLM mistakenly set this
        facing: 'toward_parent'
      },
      count: 1,
      arrangement: 'single'
    }

    const positions = resolveDecorationRelationship(decoration, registry)

    expect(positions).toHaveLength(1)
    // Should be at ground level despite height_ratio being set
    expect(positions[0].y).toBe(0)
  })

  it('applies height_ratio when offset is small (<=1m)', () => {
    const decoration = {
      relationship: {
        type: 'v2_attachment',
        target: 'cafe',
        anchor: 'front',
        offset: [0.5, 0],  // 0.5m — close to wall (sign with slight standoff)
        height_ratio: 0.7,
        facing: 'away'
      },
      count: 1,
      arrangement: 'single'
    }

    const positions = resolveDecorationRelationship(decoration, registry)

    expect(positions).toHaveLength(1)
    expect(positions[0].y).toBeCloseTo(5.6)  // 0.7 * 8m height
  })

  it('places at ground level when no height_ratio provided', () => {
    const decoration = {
      relationship: {
        type: 'v2_attachment',
        target: 'cafe',
        anchor: 'front',
        offset: [3, 0],
        facing: 'toward_parent'
      },
      count: 1,
      arrangement: 'single'
    }

    const positions = resolveDecorationRelationship(decoration, registry)

    expect(positions).toHaveLength(1)
    expect(positions[0].y).toBe(0)
  })

  it('places row arrangement with correct count', () => {
    const decoration = {
      relationship: {
        type: 'v2_attachment',
        target: 'cafe',
        anchor: 'front',
        offset: [5, 0],
        facing: 'toward_parent'
      },
      count: 4,
      arrangement: 'row',
      spacing: 3
    }

    const positions = resolveDecorationRelationship(decoration, registry)

    expect(positions).toHaveLength(4)
    // All should be at ground level
    for (const pos of positions) {
      expect(pos.y).toBe(0)
    }
  })

  it('places on top anchor at building height', () => {
    const decoration = {
      relationship: {
        type: 'v2_attachment',
        target: 'cafe',
        anchor: 'top',
        offset: [0, 0],
        facing: 'south'
      },
      count: 1,
      arrangement: 'single'
    }

    const positions = resolveDecorationRelationship(decoration, registry)

    expect(positions).toHaveLength(1)
    expect(positions[0].y).toBe(8)  // Full building height
  })

  it('places cluster arrangement with organic spread', () => {
    const decoration = {
      relationship: {
        type: 'v2_attachment',
        target: 'cafe',
        anchor: 'front',
        offset: [6, 0],
        facing: 'random'
      },
      count: 3,
      arrangement: 'cluster',
      spacing: 4
    }

    const positions = resolveDecorationRelationship(decoration, registry)

    expect(positions).toHaveLength(3)
    // All positions should be near the base position (within spacing radius)
    for (const pos of positions) {
      expect(pos.y).toBe(0)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// ARRANGEMENT TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('resolveArrangement', () => {
  let registry
  let generatedAssets

  beforeEach(() => {
    registry = new StructureRegistry()
    registry.register('diner', {
      position: { x: 200, z: 200 },
      rotation: 0,
      bounds: { width: 10, height: 8, depth: 8 }
    })

    generatedAssets = new Map()
    generatedAssets.set('red picnic table', { id: 'table-1' })
    generatedAssets.set('striped umbrella', { id: 'umbrella-1' })
  })

  it('creates cluster arrangement', () => {
    const arrangement = {
      name: 'outdoor_seating',
      placement: { relative_to: 'diner', side: 'front', distance: 8 },
      pattern: 'cluster',
      radius: 5,
      items: [
        { asset: { prompt: 'red picnic table', scale: 4 }, count: 3 },
        { asset: { prompt: 'striped umbrella', scale: 6 }, count: 2 }
      ]
    }

    const placements = resolveArrangement(arrangement, registry, generatedAssets)

    expect(placements).toHaveLength(5) // 3 tables + 2 umbrellas
    expect(placements[0]._arrangementName).toBe('outdoor_seating')
  })

  it('creates grid arrangement', () => {
    const arrangement = {
      name: 'parking',
      placement: { relative_to: 'diner', side: 'front', distance: 15 },
      pattern: 'grid',
      gridSize: { x: 2, z: 2 },
      items: [
        { asset: { prompt: 'red picnic table', scale: 4 }, count: 4 }
      ]
    }

    const placements = resolveArrangement(arrangement, registry, generatedAssets)
    expect(placements).toHaveLength(4)
  })

  it('creates row arrangement', () => {
    const arrangement = {
      name: 'surfboard_row',
      placement: { relative_to: 'diner', side: 'left', distance: 2 },
      pattern: 'row',
      radius: 4,
      items: [
        { asset: { prompt: 'red picnic table', scale: 4 }, count: 3 }
      ]
    }

    const placements = resolveArrangement(arrangement, registry, generatedAssets)
    expect(placements).toHaveLength(3)

    // Check they're in a line (similar Z coordinates)
    const zCoords = placements.map(p => p.position[2])
    expect(zCoords[0]).toBeCloseTo(zCoords[1], 0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// ATMOSPHERE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('resolveAtmosphereRelationship', () => {
  let registry

  beforeEach(() => {
    registry = new StructureRegistry()
    registry.register('diner', {
      position: { x: 200, z: 200 },
      rotation: 0,
      bounds: { width: 10, height: 8, depth: 8 }
    })
  })

  it('creates flanking positions', () => {
    const atmo = {
      relationship: {
        type: 'flanking',
        target: 'diner',
        side: 'entrance',
        spacing: 10,
        distance: 3
      },
      count: 2
    }

    const positions = resolveAtmosphereRelationship(atmo, registry, [])

    expect(positions).toHaveLength(2)
    // Should be on opposite sides
    expect(positions[0].x).not.toBe(positions[1].x)
  })

  it('creates scattered positions avoiding structures', () => {
    const atmo = {
      relationship: {
        type: 'scattered',
        zone: 'everywhere',
        density: 'medium',
        avoid: ['structures'],
        spacing: 8
      },
      count: 10
    }

    const positions = resolveAtmosphereRelationship(atmo, registry, [])

    // Should have some positions (may be fewer than requested due to filtering)
    expect(positions.length).toBeGreaterThan(0)

    // None should be too close to the structure
    for (const pos of positions) {
      const dx = pos.x - 200
      const dz = pos.z - 200
      const dist = Math.sqrt(dx * dx + dz * dz)
      expect(dist).toBeGreaterThan(5) // At least 5m from structure center
    }
  })

  it('creates framing positions at edges', () => {
    const atmo = {
      relationship: {
        type: 'framing',
        zone: 'edges',
        cameraAware: true
      },
      count: 8
    }

    const positions = resolveAtmosphereRelationship(atmo, registry, [])

    expect(positions.length).toBeGreaterThan(0)
    // Framing positions should be far from center
    for (const pos of positions) {
      const dx = pos.x - SCENE_GENERATION.CENTER_X
      const dz = pos.z - SCENE_GENERATION.CENTER_Z
      const dist = Math.sqrt(dx * dx + dz * dz)
      expect(dist).toBeGreaterThan(20)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// NPC PLACEMENT TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('resolveNPCPlacement', () => {
  let registry

  beforeEach(() => {
    registry = new StructureRegistry()
    registry.register('diner', {
      position: { x: 200, z: 200 },
      rotation: 0,
      bounds: { width: 10, height: 8, depth: 8 }
    })
    registry.registerArrangement('seating', {
      center: { x: 200, z: 215 },
      radius: 5,
      itemPositions: [{ x: 198, z: 213 }, { x: 202, z: 217 }]
    })
  })

  it('places NPC near structure', () => {
    const pos = resolveNPCPlacement({
      relative_to: 'diner',
      position: 'near',
      distance: 5
    }, registry)

    expect(pos.x).toBeDefined()
    expect(pos.z).toBeDefined()
  })

  it('places NPC at entrance', () => {
    const pos = resolveNPCPlacement({
      relative_to: 'diner',
      position: 'at_entrance',
      distance: 3
    }, registry)

    expect(pos.z).toBeGreaterThan(200) // In front of diner
  })

  it('places NPC near arrangement', () => {
    const pos = resolveNPCPlacement({
      relative_to: 'seating',
      position: 'near'
    }, registry)

    // Should be near the seating area center
    expect(Math.abs(pos.x - 200)).toBeLessThan(10)
    expect(Math.abs(pos.z - 215)).toBeLessThan(10)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATION TEST
// ═══════════════════════════════════════════════════════════════════════════════

describe('resolveRelationshipPlacements', () => {
  it('resolves complete surf diner scene', () => {
    // Create a minimal surf diner plan
    const plan = {
      terrain: { biome: 'sand' },
      structures: [
        {
          id: 'diner',
          asset: { prompt: '1960s diner', category: 'buildings', realWorldSize: 12, scale: 24 },
          placement: { position: 'center', facing: 'south' },
          _estimatedBounds: { width: 9.6, height: 12, depth: 7.2 }
        }
      ],
      decorations: [
        {
          asset: { prompt: 'neon sign', category: 'props', realWorldSize: 1.5, scale: 3 },
          relationship: { type: 'attached_to', target: 'diner', surface: 'front', position: { horizontal: 0.5, vertical: 0.85 } },
          count: 1,
          spacing: 2,
          mirror: false,
          _estimatedBounds: { width: 1.5, height: 0.9, depth: 1.2 }
        }
      ],
      arrangements: [
        {
          name: 'seating',
          placement: { relative_to: 'diner', side: 'front', distance: 8 },
          pattern: 'cluster',
          radius: 5,
          items: [
            { asset: { prompt: 'picnic table', category: 'props', realWorldSize: 2, scale: 4 }, count: 2 }
          ]
        }
      ],
      atmosphere: [
        {
          asset: { prompt: 'palm tree', category: 'nature', realWorldSize: 10, scale: 20 },
          relationship: { type: 'flanking', target: 'diner', side: 'entrance', spacing: 10, distance: 5 },
          count: 2,
          _estimatedBounds: { width: 4, height: 10, depth: 4 }
        }
      ],
      npcs: [
        {
          asset: { prompt: 'waitress', category: 'characters', realWorldSize: 1.8, scale: 3.6 },
          placement: { context: 'working', relative_to: 'seating', position: 'near' },
          behavior: 'wander',
          wanderRadius: 8,
          _estimatedBounds: { width: 0.72, height: 1.8, depth: 0.54 }
        }
      ],
      _isRelationshipPlan: true
    }

    // Create mock generated assets
    const generatedAssets = new Map()
    generatedAssets.set('1960s diner', { id: 'diner-asset' })
    generatedAssets.set('neon sign', { id: 'sign-asset' })
    generatedAssets.set('picnic table', { id: 'table-asset' })
    generatedAssets.set('palm tree', { id: 'palm-asset' })
    generatedAssets.set('waitress', { id: 'waitress-asset' })

    const result = resolveRelationshipPlacements(plan, generatedAssets, [])

    // Check we got placements (some may be filtered by collision detection)
    // Minimum: 1 diner + at least 1 other element
    expect(result.placements.length).toBeGreaterThanOrEqual(2)

    // Check structure placement
    const structurePlacements = result.placements.filter(p => p._type === 'structure')
    expect(structurePlacements).toHaveLength(1)
    expect(structurePlacements[0].position[0]).toBe(SCENE_GENERATION.CENTER_X)

    // Check decoration placement (sign should be on building, not ground)
    const decorPlacements = result.placements.filter(p => p._type === 'decoration')
    expect(decorPlacements).toHaveLength(1)
    expect(decorPlacements[0].position[1]).toBeGreaterThan(0) // Y > 0, not on ground!

    // Check atmosphere (flanking palms - may be reduced by collision with seating)
    const atmoPlacements = result.placements.filter(p => p._type === 'atmosphere')
    expect(atmoPlacements.length).toBeGreaterThanOrEqual(1)

    // Check NPC
    const npcPlacements = result.placements.filter(p => p._type === 'npc')
    expect(npcPlacements).toHaveLength(1)
    expect(npcPlacements[0].behavior).toBe('wander')
  })
})
