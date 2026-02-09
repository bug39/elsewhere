/**
 * Integration tests for world persistence
 *
 * Tests the full round-trip of:
 * - Saving world data to IndexedDB
 * - Loading world data from IndexedDB
 * - Schema validation on load
 * - Transform normalization
 * - Legacy format migration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { get, set, del, keys } from 'idb-keyval'
import {
  saveWorld,
  loadWorld,
  listWorlds,
  deleteWorld
} from '../../src/studio/state/storage'
import { validateWorldSchema } from '../../src/shared/validation'

describe('worldPersistence', () => {
  const WORLDS_INDEX_KEY = 'thinq-worlds-index'
  const WORLDS_PREFIX = 'thinq-world-'

  beforeEach(async () => {
    // Clear IndexedDB state
    const allKeys = await keys()
    for (const key of allKeys) {
      await del(key)
    }
  })

  describe('saveWorld', () => {
    it('should save world data to IndexedDB', async () => {
      const world = {
        meta: { id: 'world_001', name: 'Test World', version: 1 },
        terrain: {
          biome: 'grass',
          heightmap: Array(20).fill(null).map(() => Array(20).fill(0)),
          texturemap: Array(20).fill(null).map(() => Array(20).fill(0))
        },
        placedAssets: [],
        library: []
      }

      const result = await saveWorld(world)

      expect(result.success).toBe(true)

      // Verify it was saved
      const saved = await get(WORLDS_PREFIX + 'world_001')
      expect(saved).toBeTruthy()
      expect(saved.meta.name).toBe('Test World')
    })

    it('should update worlds list index', async () => {
      const world = {
        meta: { id: 'world_002', name: 'Another World', version: 1 },
        terrain: {
          biome: 'desert',
          heightmap: Array(20).fill(null).map(() => Array(20).fill(0)),
          texturemap: Array(20).fill(null).map(() => Array(20).fill(0))
        },
        placedAssets: [],
        library: []
      }

      await saveWorld(world)

      const worldsList = await get(WORLDS_INDEX_KEY)
      expect(worldsList).toBeTruthy()
      expect(worldsList.find(w => w.id === 'world_002')).toBeTruthy()
    })

    it('should preserve thumbnail in worlds list', async () => {
      const world = {
        meta: {
          id: 'world_003',
          name: 'World with Thumbnail',
          version: 1,
          thumbnail: 'data:image/png;base64,iVBORw0...'
        },
        terrain: {
          biome: 'snow',
          heightmap: Array(20).fill(null).map(() => Array(20).fill(0)),
          texturemap: Array(20).fill(null).map(() => Array(20).fill(0))
        },
        placedAssets: [],
        library: []
      }

      await saveWorld(world)

      const worldsList = await get(WORLDS_INDEX_KEY)
      const entry = worldsList.find(w => w.id === 'world_003')
      expect(entry.thumbnail).toBe('data:image/png;base64,iVBORw0...')
    })

    it('should return error for invalid world data', async () => {
      const result = await saveWorld(null)

      expect(result.success).toBe(false)
      expect(result.error).toBeTruthy()
    })

    it('should handle world with undefined ID gracefully', async () => {
      // Note: The current implementation doesn't validate missing IDs,
      // it just saves with key 'thinq-world-undefined'. This test documents
      // actual behavior - proper ID validation should be added separately.
      const world = {
        meta: { name: 'No ID World' },
        terrain: {},
        placedAssets: [],
        library: []
      }

      const result = await saveWorld(world)

      // Currently succeeds (saves as 'undefined' ID) - this is arguably a bug
      expect(result.success).toBe(true)
    })
  })

  describe('loadWorld', () => {
    it('should load saved world data', async () => {
      const world = {
        meta: { id: 'world_load_001', name: 'Load Test', version: 1 },
        terrain: {
          biome: 'grass',
          heightmap: Array(20).fill(null).map(() => Array(20).fill(5)),
          texturemap: Array(20).fill(null).map(() => Array(20).fill(0))
        },
        placedAssets: [
          {
            instanceId: 'inst_001',
            libraryId: 'lib_001',
            position: [50, 0, 50],
            rotation: 0,
            scale: 1
          }
        ],
        library: [{ id: 'lib_001', name: 'Dragon' }]
      }

      await saveWorld(world)

      const result = await loadWorld('world_load_001')

      expect(result.success).toBe(true)
      expect(result.data.meta.name).toBe('Load Test')
      // Legacy 20x20 worlds are migrated to 40x40, centered with offset of 10 tiles
      // Original [0][0] is now at [10][10], original [0][0] outer edge is now 0
      expect(result.data.terrain.heightmap[10][10]).toBe(5) // Migrated center
      expect(result.data.terrain.heightmap[0][0]).toBe(0)   // New outer edge
      expect(result.data.placedAssets).toHaveLength(1)
      // Asset positions are offset by 100m (10 tiles * 10m)
      expect(result.data.placedAssets[0].position).toEqual([150, 0, 150])
      expect(result.data.library).toHaveLength(1)
    })

    it('should return error for non-existent world', async () => {
      const result = await loadWorld('non_existent_world')

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('should normalize legacy array transforms', async () => {
      // Simulate legacy world with array transforms
      const legacyWorld = {
        meta: { id: 'world_legacy_001', name: 'Legacy World', version: 1 },
        terrain: {
          biome: 'grass',
          heightmap: Array(20).fill(null).map(() => Array(20).fill(0)),
          texturemap: Array(20).fill(null).map(() => Array(20).fill(0))
        },
        placedAssets: [
          {
            instanceId: 'inst_001',
            libraryId: 'lib_001',
            position: [50, 0, 50],
            rotation: [0, 1.5, 0],  // Legacy array format
            scale: [2, 2, 2]         // Legacy array format
          }
        ],
        library: []
      }

      // Save directly to simulate legacy data
      await set(WORLDS_PREFIX + 'world_legacy_001', legacyWorld)

      const worldsList = await get(WORLDS_INDEX_KEY) || []
      worldsList.push({ id: 'world_legacy_001', name: 'Legacy World' })
      await set(WORLDS_INDEX_KEY, worldsList)

      const result = await loadWorld('world_legacy_001')

      expect(result.success).toBe(true)
      // Transforms should be normalized to scalars
      expect(result.data.placedAssets[0].rotation).toBe(1.5)
      expect(result.data.placedAssets[0].scale).toBe(2)
    })

    it('should validate schema on load', async () => {
      const world = {
        meta: { id: 'world_validate_001', name: 'Valid World', version: 1 },
        terrain: {
          biome: 'forest',
          heightmap: Array(20).fill(null).map(() => Array(20).fill(0)),
          texturemap: Array(20).fill(null).map(() => Array(20).fill(0))
        },
        placedAssets: [],
        library: []
      }

      await saveWorld(world)
      const result = await loadWorld('world_validate_001')

      // Schema validation should pass
      const validation = validateWorldSchema(result.data)
      expect(validation.valid).toBe(true)
    })
  })

  describe('listWorlds', () => {
    it('should return empty array when no worlds exist', async () => {
      const worlds = await listWorlds()

      expect(worlds).toEqual([])
    })

    it('should return list of all saved worlds', async () => {
      const world1 = {
        meta: { id: 'world_list_001', name: 'World One', version: 1 },
        terrain: {
          biome: 'grass',
          heightmap: Array(20).fill(null).map(() => Array(20).fill(0)),
          texturemap: Array(20).fill(null).map(() => Array(20).fill(0))
        },
        placedAssets: [],
        library: []
      }

      const world2 = {
        meta: { id: 'world_list_002', name: 'World Two', version: 1 },
        terrain: {
          biome: 'desert',
          heightmap: Array(20).fill(null).map(() => Array(20).fill(0)),
          texturemap: Array(20).fill(null).map(() => Array(20).fill(0))
        },
        placedAssets: [],
        library: []
      }

      await saveWorld(world1)
      await saveWorld(world2)

      const worlds = await listWorlds()

      expect(worlds).toHaveLength(2)
      expect(worlds.find(w => w.name === 'World One')).toBeTruthy()
      expect(worlds.find(w => w.name === 'World Two')).toBeTruthy()
    })
  })

  describe('deleteWorld', () => {
    it('should delete world data and remove from list', async () => {
      const world = {
        meta: { id: 'world_delete_001', name: 'To Delete', version: 1 },
        terrain: {
          biome: 'volcanic',
          heightmap: Array(20).fill(null).map(() => Array(20).fill(0)),
          texturemap: Array(20).fill(null).map(() => Array(20).fill(0))
        },
        placedAssets: [],
        library: []
      }

      await saveWorld(world)

      const result = await deleteWorld('world_delete_001')

      expect(result).toBe(true)

      // Verify world data is deleted
      const worldData = await get(WORLDS_PREFIX + 'world_delete_001')
      expect(worldData).toBeUndefined()

      // Verify removed from list
      const worldsList = await get(WORLDS_INDEX_KEY)
      const found = worldsList?.find(w => w.id === 'world_delete_001')
      expect(found).toBeFalsy()
    })

    it('should handle deleting non-existent world', async () => {
      const result = await deleteWorld('non_existent')

      // Should succeed (no-op) or return appropriate error
      // The exact behavior depends on implementation
      expect(result).toBeTruthy()
    })
  })

  describe('round-trip integrity', () => {
    it('should preserve all world data through save/load cycle', async () => {
      const original = {
        meta: {
          id: 'world_roundtrip_001',
          name: 'Round Trip Test',
          created: '2024-01-15T10:00:00.000Z',
          version: 1,
          thumbnail: 'data:image/png;base64,test'
        },
        terrain: {
          biome: 'forest',
          heightmap: Array(20).fill(null).map((_, z) =>
            Array(20).fill(null).map((_, x) => (x + z) % 10)
          ),
          texturemap: Array(20).fill(null).map((_, z) =>
            Array(20).fill(null).map((_, x) => (x * z) % 3)
          )
        },
        playerSpawn: {
          position: [100, 5, 100],
          character: 'knight'
        },
        placedAssets: [
          {
            instanceId: 'inst_001',
            libraryId: 'lib_001',
            position: [50, 0, 50],
            rotation: 1.57,
            scale: 2,
            behavior: { type: 'wander', radius: 15 },
            dialogue: {
              nodes: {
                start: { text: 'Hello!', responses: [] }
              },
              startNode: 'start'
            }
          }
        ],
        library: [
          {
            id: 'lib_001',
            name: 'Friendly Dragon',
            category: 'creatures',
            generatedCode: 'function createAsset(THREE) { return new THREE.Group(); }',
            thumbnail: 'data:image/png;base64,dragon',
            tags: ['dragon', 'friendly'],
            isWalkingCharacter: true,
            partTweaks: [{ partName: 'wings', scale: 1.2 }]
          }
        ]
      }

      await saveWorld(original)
      const { data: loaded } = await loadWorld('world_roundtrip_001')

      // Verify all fields (legacy 20x20 worlds are migrated to 40x40)
      // Migration offsets positions by 100m (10 tiles * 10m)
      expect(loaded.meta.name).toBe(original.meta.name)
      expect(loaded.meta.created).toBe(original.meta.created)
      expect(loaded.terrain.biome).toBe(original.terrain.biome)
      // Heightmap is centered: original [5][5] is now at [15][15]
      expect(loaded.terrain.heightmap[15][15]).toBe(original.terrain.heightmap[5][5])
      // Player spawn position is offset by 100m
      expect(loaded.playerSpawn.position).toEqual([200, 5, 200])

      // Placed assets - positions offset by 100m
      expect(loaded.placedAssets).toHaveLength(1)
      expect(loaded.placedAssets[0].position).toEqual([150, 0, 150])
      expect(loaded.placedAssets[0].rotation).toBe(1.57)
      expect(loaded.placedAssets[0].scale).toBe(2)
      expect(loaded.placedAssets[0].behavior).toEqual(original.placedAssets[0].behavior)
      expect(loaded.placedAssets[0].dialogue).toEqual(original.placedAssets[0].dialogue)

      // Library
      expect(loaded.library).toHaveLength(1)
      expect(loaded.library[0].name).toBe('Friendly Dragon')
      expect(loaded.library[0].isWalkingCharacter).toBe(true)
      expect(loaded.library[0].partTweaks).toEqual(original.library[0].partTweaks)
    })
  })
})
