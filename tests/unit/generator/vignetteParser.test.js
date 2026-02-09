/**
 * Unit tests for vignette plan parsing
 */

import { describe, it, expect } from 'vitest'
import { parseScenePlan, parseVignettePlan } from '../../../src/generator/scenePrompts.js'

// Minimal vignette plan for testing
const minimalVignettePlan = {
  theme: '1980s arcade',
  terrain: { biome: 'grass' },
  zones: [
    {
      id: 'arcade_frontage',
      anchor: '1980s arcade building with neon sign',
      position: 'south side',
      vignettes: [
        {
          name: 'teens_gaming',
          story: 'teenagers playing arcade games',
          elements: [
            { type: 'prop', asset: 'Pac-Man arcade cabinet', realWorldSize: 1.8 }
          ],
          spatial: 'cabinet against building wall'
        }
      ]
    }
  ]
}

// Full vignette plan with multiple zones
const fullVignettePlan = {
  theme: '1980s arcade strip mall',
  terrain: { biome: 'grass' },
  zones: [
    {
      id: 'arcade_frontage',
      anchor: '1980s arcade building with neon ARCADE sign',
      position: 'south side of anchor',
      surface: 'concrete sidewalk',
      vignettes: [
        {
          name: 'teens_at_cabinets',
          story: 'teenagers gathered around outdoor arcade machines',
          elements: [
            { type: 'prop', asset: 'Pac-Man arcade cabinet', state: 'operational', realWorldSize: 1.8 },
            { type: 'prop', asset: 'Galaga arcade cabinet', realWorldSize: 1.8 },
            { type: 'npc', asset: 'teenage boy in letterman jacket', action: 'playing Pac-Man', realWorldSize: 1.7 },
            { type: 'npc', asset: 'teenage girl with big hair', action: 'watching and cheering', realWorldSize: 1.65 }
          ],
          spatial: 'cabinets side-by-side against building wall'
        }
      ]
    },
    {
      id: 'diner_patio',
      anchor: 'retro chrome diner with red accents',
      position: 'east',
      vignettes: [
        {
          name: 'couple_at_table',
          story: 'couple sharing milkshake',
          elements: [
            { type: 'prop', asset: 'chrome cafe table', realWorldSize: 0.9 },
            { type: 'npc', asset: 'young man in polo shirt', action: 'seated, laughing', realWorldSize: 1.75 }
          ],
          spatial: 'table under awning'
        }
      ]
    }
  ],
  atmosphere: [
    { asset: 'vintage street lamp', zone: 'sidewalk', count: 4, placement: 'evenly spaced', realWorldSize: 4.5 },
    { asset: 'metal trash can', zone: 'arcade_frontage', count: 2, realWorldSize: 1.1 }
  ]
}

describe('parseVignettePlan', () => {
  describe('format detection', () => {
    it('detects vignette format via parseScenePlan', () => {
      const result = parseScenePlan(JSON.stringify(minimalVignettePlan))
      expect(result).not.toBeNull()
      expect(result._isRelationshipPlan).toBe(true)
      expect(result._convertedFromVignette).toBe(true)
    })

    it('rejects plans without zones array', () => {
      const invalidPlan = { theme: 'test', terrain: { biome: 'grass' } }
      const result = parseVignettePlan(invalidPlan)
      expect(result).toBeNull()
    })

    it('rejects plans with empty zones', () => {
      const invalidPlan = { ...minimalVignettePlan, zones: [] }
      const result = parseVignettePlan(invalidPlan)
      expect(result).toBeNull()
    })
  })

  describe('structure conversion', () => {
    it('converts zone anchors to structures', () => {
      const result = parseVignettePlan(fullVignettePlan)
      expect(result.structures).toHaveLength(2)
      expect(result.structures[0].id).toBe('arcade_frontage')
      expect(result.structures[0].asset.prompt).toContain('arcade building')
      expect(result.structures[1].id).toBe('diner_patio')
    })

    it('estimates building sizes correctly', () => {
      const result = parseVignettePlan(fullVignettePlan)
      // Buildings should get reasonable size estimates (8-20m range)
      expect(result.structures[0].asset.realWorldSize).toBeGreaterThanOrEqual(8)
      expect(result.structures[0].asset.realWorldSize).toBeLessThanOrEqual(20)
    })

    it('maps zone position to placement position', () => {
      const result = parseVignettePlan(fullVignettePlan)
      // First structure uses position keyword
      expect(result.structures[0].placement.position).toBe('south')
      // Subsequent structures use relative_to for spreading
      expect(result.structures[1].placement.relative_to).toBe('arcade_frontage')
      expect(result.structures[1].placement.side).toBeDefined()
      expect(result.structures[1].placement.distance).toBeGreaterThan(0)
    })
  })

  describe('decoration conversion', () => {
    it('converts prop elements to decorations', () => {
      const result = parseVignettePlan(fullVignettePlan)
      // 2 cabinets + 1 table = 3 props
      expect(result.decorations).toHaveLength(3)
    })

    it('includes state in decoration prompt', () => {
      const result = parseVignettePlan(fullVignettePlan)
      const pacman = result.decorations.find(d => d.asset.prompt.includes('Pac-Man'))
      expect(pacman.asset.prompt).toContain('operational')
    })

    it('sets correct target structure for decorations', () => {
      const result = parseVignettePlan(fullVignettePlan)
      const arcadeDecorations = result.decorations.filter(
        d => d.relationship.target === 'arcade_frontage'
      )
      expect(arcadeDecorations).toHaveLength(2) // Both cabinets
    })

    it('parses spatial descriptions into relationships', () => {
      const result = parseVignettePlan(minimalVignettePlan)
      const cabinet = result.decorations[0]
      // "against building wall" should parse to adjacent_to/front
      expect(cabinet.relationship.type).toBe('adjacent_to')
      expect(cabinet.relationship.side).toBe('front')
      expect(cabinet.relationship.distance).toBeLessThanOrEqual(1) // Close to wall
    })
  })

  describe('NPC conversion', () => {
    it('converts npc elements to npcs array', () => {
      const result = parseVignettePlan(fullVignettePlan)
      // 2 teens at arcade + 1 at diner = 3 NPCs
      expect(result.npcs).toHaveLength(3)
    })

    it('includes action in NPC prompt', () => {
      const result = parseVignettePlan(fullVignettePlan)
      const teen = result.npcs.find(n => n.asset.prompt.includes('letterman'))
      expect(teen.asset.prompt).toContain('playing Pac-Man')
    })

    it('maps playing action to idle behavior', () => {
      const result = parseVignettePlan(fullVignettePlan)
      const teen = result.npcs.find(n => n.asset.prompt.includes('letterman'))
      expect(teen.behavior).toBe('idle')
    })

    it('maps watching action to idle behavior', () => {
      const result = parseVignettePlan(fullVignettePlan)
      const girl = result.npcs.find(n => n.asset.prompt.includes('big hair'))
      expect(girl.behavior).toBe('idle')
    })

    it('sets NPC placement relative to zone structure', () => {
      const result = parseVignettePlan(fullVignettePlan)
      const teen = result.npcs.find(n => n.asset.prompt.includes('letterman'))
      expect(teen.placement.relative_to).toBe('arcade_frontage')
    })
  })

  describe('atmosphere conversion', () => {
    it('converts atmosphere items', () => {
      const result = parseVignettePlan(fullVignettePlan)
      expect(result.atmosphere).toHaveLength(2)
    })

    it('preserves atmosphere count', () => {
      const result = parseVignettePlan(fullVignettePlan)
      const lamps = result.atmosphere.find(a => a.asset.prompt.includes('lamp'))
      expect(lamps.count).toBe(4)
    })

    it('maps zone references to relationship targets', () => {
      const result = parseVignettePlan(fullVignettePlan)
      // arcade_frontage zone should map to structure reference
      const trashCans = result.atmosphere.find(a => a.asset.prompt.includes('trash'))
      expect(trashCans.relationship.zone.around).toBe('arcade_frontage')
    })

    it('maps placement style to relationship type', () => {
      const result = parseVignettePlan(fullVignettePlan)
      const lamps = result.atmosphere.find(a => a.asset.prompt.includes('lamp'))
      // "evenly spaced" should map to "along"
      expect(lamps.relationship.type).toBe('along')
    })
  })

  describe('element spreading', () => {
    it('spreads multiple props horizontally within a vignette', () => {
      const result = parseVignettePlan(fullVignettePlan)
      // Two cabinets in arcade_frontage vignette should have different horizontal positions
      const arcadeDecorations = result.decorations.filter(
        d => d._fromVignette === 'teens_at_cabinets'
      )
      expect(arcadeDecorations).toHaveLength(2)

      const h0 = arcadeDecorations[0].relationship.position.horizontal
      const h1 = arcadeDecorations[1].relationship.position.horizontal
      expect(h0).not.toBe(h1)  // Should be different
      expect(h0).toBeGreaterThanOrEqual(0.2)
      expect(h0).toBeLessThanOrEqual(0.8)
      expect(h1).toBeGreaterThanOrEqual(0.2)
      expect(h1).toBeLessThanOrEqual(0.8)
    })

    it('spreads multiple NPCs with lateral offset within a vignette', () => {
      const result = parseVignettePlan(fullVignettePlan)
      // Two NPCs in arcade_frontage vignette should have lateral offsets
      const arcadeNpcs = result.npcs.filter(
        n => n._fromVignette === 'teens_at_cabinets'
      )
      expect(arcadeNpcs).toHaveLength(2)

      const offset0 = arcadeNpcs[0].placement.lateralOffset
      const offset1 = arcadeNpcs[1].placement.lateralOffset
      // With 2 NPCs: offsets should be -1 and +1 (spread 2m apart, centered)
      expect(offset0).not.toBe(offset1)
      expect(offset0 + offset1).toBeCloseTo(0, 5)  // Should be centered
    })

    it('subsequent structures are positioned relative to first', () => {
      const result = parseVignettePlan(fullVignettePlan)
      // First structure uses position keyword
      expect(result.structures[0].placement.relative_to).toBeUndefined()
      // Second structure uses relative_to
      expect(result.structures[1].placement.relative_to).toBe('arcade_frontage')
      expect(result.structures[1].placement.distance).toBeGreaterThan(30)
    })
  })

  describe('size estimation', () => {
    it('estimates character sizes correctly', () => {
      const result = parseVignettePlan(fullVignettePlan)
      const npc = result.npcs[0]
      // Should use provided realWorldSize
      expect(npc.asset.realWorldSize).toBeCloseTo(1.7, 1)
    })

    it('estimates prop sizes when not provided', () => {
      const planWithoutSizes = {
        ...minimalVignettePlan,
        zones: [{
          ...minimalVignettePlan.zones[0],
          vignettes: [{
            ...minimalVignettePlan.zones[0].vignettes[0],
            elements: [
              { type: 'prop', asset: 'wooden bench' } // No realWorldSize
            ]
          }]
        }]
      }
      const result = parseVignettePlan(planWithoutSizes)
      const bench = result.decorations[0]
      // "bench" should estimate around 1.8m
      expect(bench.asset.realWorldSize).toBeCloseTo(1.8, 0.5)
    })
  })
})
