/**
 * Unit tests for the instance matching module
 *
 * Tests the fuzzy matching algorithm used by refinement operations
 * (rescale, remove) to find placed instances by description or ID.
 *
 * The matching system has 4 stages:
 * 1. Exact instanceId match (confidence 1.0)
 * 2. Exact structureId match (confidence 1.0)
 * 3. Description→structureId bridge (confidence 0.9)
 * 4. Fuzzy text matching with location boost
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getCategoryForInstance,
  findMatchingInstances,
  STOP_WORDS
} from '../../../src/generator/instanceMatcher'

// Mock parseSemanticLocation to control location parsing behavior
vi.mock('../../../src/generator/placementAlgorithms', () => ({
  parseSemanticLocation: vi.fn((location) => {
    // Return predictable bounds for test locations
    if (location === 'north') {
      return { minX: -200, maxX: 200, minZ: -200, maxZ: 0 }
    }
    if (location === 'center') {
      return { minX: -50, maxX: 50, minZ: -50, maxZ: 50 }
    }
    if (location === 'invalid') {
      throw new Error('Invalid location')
    }
    return { minX: -100, maxX: 100, minZ: -100, maxZ: 100 }
  })
}))

describe('getCategoryForInstance', () => {
  it('returns category from library asset', () => {
    const instance = { libraryId: 'asset-1' }
    const data = {
      library: [
        { id: 'asset-1', category: 'buildings' }
      ]
    }

    expect(getCategoryForInstance(instance, data)).toBe('buildings')
  })

  it('returns "props" when library asset not found', () => {
    const instance = { libraryId: 'missing-asset' }
    const data = {
      library: [
        { id: 'asset-1', category: 'buildings' }
      ]
    }

    expect(getCategoryForInstance(instance, data)).toBe('props')
  })

  it('returns "props" when asset has no category', () => {
    const instance = { libraryId: 'asset-1' }
    const data = {
      library: [
        { id: 'asset-1', name: 'Some Asset' }  // No category field
      ]
    }

    expect(getCategoryForInstance(instance, data)).toBe('props')
  })
})

describe('findMatchingInstances - exact ID matching', () => {
  // Note: Production instances use .instanceId property, not .id
  const baseData = {
    placedAssets: [
      { instanceId: 'inst-001', libraryId: 'lib-1', position: [0, 0, 0], scale: 1 },
      { instanceId: 'inst-002', libraryId: 'lib-2', position: [10, 0, 10], scale: 2 }
    ],
    library: [
      { id: 'lib-1', name: 'red barn', category: 'buildings' },
      { id: 'lib-2', name: 'oak tree', category: 'nature' }
    ]
  }

  it('matches by instanceId with confidence 1.0', () => {
    const target = { instanceId: 'inst-001' }
    const matches = findMatchingInstances(target, baseData)

    expect(matches).toHaveLength(1)
    expect(matches[0].instanceId).toBe('inst-001')
    expect(matches[0]._matchScore).toBe(1.0)
  })

  it('falls back to description when instanceId not found', () => {
    const target = { instanceId: 'missing-id', description: 'barn' }
    const matches = findMatchingInstances(target, baseData)

    // Should fall back to fuzzy matching on "barn"
    expect(matches.length).toBeGreaterThan(0)
    expect(matches[0].libraryId).toBe('lib-1')  // Matches "red barn"
  })

  it('matches by structureId with confidence 1.0', () => {
    const dataWithStructure = {
      ...baseData,
      placedAssets: [
        { instanceId: 'inst-001', libraryId: 'lib-1', position: [0, 0, 0], scale: 1, _structureId: 'main_barn' }
      ]
    }
    const target = { structureId: 'main_barn' }
    const matches = findMatchingInstances(target, dataWithStructure)

    expect(matches).toHaveLength(1)
    expect(matches[0]._structureId).toBe('main_barn')
    expect(matches[0]._matchScore).toBe(1.0)
  })
})

describe('findMatchingInstances - description bridge', () => {
  it('converts "surf diner" to "surf_diner" for structureId matching', () => {
    const data = {
      placedAssets: [
        { instanceId: 'inst-001', libraryId: 'lib-1', position: [0, 0, 0], scale: 1, _structureId: 'surf_diner' }
      ],
      library: [
        { id: 'lib-1', name: 'diner building', category: 'buildings' }
      ]
    }
    const target = { description: 'surf diner' }
    const matches = findMatchingInstances(target, data)

    expect(matches).toHaveLength(1)
    expect(matches[0]._structureId).toBe('surf_diner')
    expect(matches[0]._matchScore).toBe(0.9)
  })

  it('handles special characters in description', () => {
    const data = {
      placedAssets: [
        { instanceId: 'inst-001', libraryId: 'lib-1', position: [0, 0, 0], scale: 1, _structureId: 'old_mill' }
      ],
      library: [
        { id: 'lib-1', name: 'old mill', category: 'buildings' }
      ]
    }
    const target = { description: 'old-mill!' }  // Dashes and punctuation
    const matches = findMatchingInstances(target, data)

    expect(matches).toHaveLength(1)
    expect(matches[0]._structureId).toBe('old_mill')
  })
})

describe('findMatchingInstances - fuzzy matching', () => {
  const data = {
    placedAssets: [
      { instanceId: 'inst-001', libraryId: 'lib-1', position: [0, 0, 0], scale: 1 },
      { instanceId: 'inst-002', libraryId: 'lib-2', position: [10, 0, 10], scale: 2 },
      { instanceId: 'inst-003', libraryId: 'lib-3', position: [20, 0, 20], scale: 1 }
    ],
    library: [
      { id: 'lib-1', name: 'red wooden barn', category: 'buildings' },
      { id: 'lib-2', name: 'tall oak tree', category: 'nature' },
      { id: 'lib-3', name: 'red sports car', category: 'vehicles' }
    ]
  }

  it('matches exact terms with higher confidence than partial', () => {
    const target = { description: 'red barn' }
    const matches = findMatchingInstances(target, data)

    // "red barn" should match "red wooden barn" better than "red sports car"
    expect(matches.length).toBeGreaterThan(0)
    expect(matches[0].libraryId).toBe('lib-1')  // barn
  })

  it('matches partial/substring terms with lower confidence', () => {
    const target = { description: 'wooden' }
    const matches = findMatchingInstances(target, data)

    // "wooden" appears in "red wooden barn"
    expect(matches.length).toBeGreaterThan(0)
    expect(matches[0].libraryId).toBe('lib-1')
  })

  it('filters stop words from search terms', () => {
    // Verify stop words are filtered
    expect(STOP_WORDS.has('the')).toBe(true)
    expect(STOP_WORDS.has('in')).toBe(true)
    expect(STOP_WORDS.has('a')).toBe(true)

    const target = { description: 'the barn in the field' }
    const matches = findMatchingInstances(target, data)

    // Should only match on "barn" and "field", not on stop words
    expect(matches.length).toBeGreaterThan(0)
    expect(matches[0].libraryId).toBe('lib-1')  // matches "barn"
  })

  it('returns empty array when no search terms after filtering', () => {
    const target = { description: 'a the in' }  // All stop words
    const matches = findMatchingInstances(target, data)

    expect(matches).toHaveLength(0)
  })

  it('sorts by confidence score descending', () => {
    const target = { description: 'red' }  // Matches both barn and car
    const matches = findMatchingInstances(target, data)

    // Both should match, verify they're sorted by score
    expect(matches.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1]._matchScore).toBeGreaterThanOrEqual(matches[i]._matchScore)
    }
  })
})

describe('findMatchingInstances - location boost', () => {
  const data = {
    placedAssets: [
      { id: 'inst-north', libraryId: 'lib-1', position: [0, 0, -100], scale: 1 },  // In north zone
      { id: 'inst-south', libraryId: 'lib-2', position: [0, 0, 100], scale: 1 }    // In south zone
    ],
    library: [
      { id: 'lib-1', name: 'pine tree', category: 'nature' },
      { id: 'lib-2', name: 'palm tree', category: 'nature' }
    ]
  }

  it('boosts confidence for instances in target zone', () => {
    const target = { description: 'tree', location: 'north' }
    const matches = findMatchingInstances(target, data)

    // Both are trees, but north one should rank higher due to location
    expect(matches.length).toBeGreaterThanOrEqual(1)
    expect(matches[0].id).toBe('inst-north')
    expect(matches[0]._inTargetZone).toBe(true)
  })

  it('includes instances in zone even with low text match', () => {
    const target = { description: 'pine', location: 'north' }  // Specific tree type
    const matches = findMatchingInstances(target, data)

    // Pine tree in north should match
    expect(matches.some(m => m.id === 'inst-north')).toBe(true)
  })

  it('handles invalid location gracefully', () => {
    const target = { description: 'tree', location: 'invalid' }
    const matches = findMatchingInstances(target, data)

    // Should still return matches based on text
    expect(matches.length).toBeGreaterThan(0)
  })
})

describe('findMatchingInstances - edge cases', () => {
  it('handles empty placedAssets', () => {
    const data = {
      placedAssets: [],
      library: [{ id: 'lib-1', name: 'tree', category: 'nature' }]
    }
    const target = { description: 'tree' }
    const matches = findMatchingInstances(target, data)

    expect(matches).toHaveLength(0)
  })

  it('handles missing library gracefully', () => {
    const data = {
      placedAssets: [
        { instanceId: 'inst-001', libraryId: 'lib-1', position: [0, 0, 0], scale: 1 }
      ],
      library: []  // Empty library
    }
    const target = { description: 'tree' }
    const matches = findMatchingInstances(target, data)

    // Should not crash, just return empty
    expect(matches).toHaveLength(0)
  })

  it('attaches instanceId property to matches', () => {
    const data = {
      placedAssets: [
        { instanceId: 'inst-001', libraryId: 'lib-1', position: [0, 0, 0], scale: 1 }
      ],
      library: [
        { id: 'lib-1', name: 'tree', category: 'nature' }
      ]
    }
    const target = { description: 'tree' }
    const matches = findMatchingInstances(target, data)

    expect(matches).toHaveLength(1)
    expect(matches[0].instanceId).toBe('inst-001')
  })

  it('preserves original instance properties', () => {
    const data = {
      placedAssets: [
        {
          id: 'inst-001',
          libraryId: 'lib-1',
          position: [5, 0, 10],
          scale: 2.5,
          rotation: 1.5,
          customProp: 'preserved'
        }
      ],
      library: [
        { id: 'lib-1', name: 'tree', category: 'nature' }
      ]
    }
    const target = { description: 'tree' }
    const matches = findMatchingInstances(target, data)

    expect(matches[0].position).toEqual([5, 0, 10])
    expect(matches[0].scale).toBe(2.5)
    expect(matches[0].rotation).toBe(1.5)
    expect(matches[0].customProp).toBe('preserved')
  })
})
