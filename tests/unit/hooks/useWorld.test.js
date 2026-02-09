/**
 * Unit tests for useWorld.js
 *
 * Tests the world state management hook including:
 * - World creation
 * - Undo/redo operations
 * - Operation coalescing
 * - Library and instance management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/preact'
import { useWorld } from '../../../src/studio/hooks/useWorld'
import { saveWorld } from '../../../src/studio/state/storage'
import { showToast } from '../../../src/studio/components/Toast'
import { advanceTimers } from '../testUtils'

// Mock storage functions
vi.mock('../../../src/studio/state/storage', () => ({
  saveWorld: vi.fn().mockResolvedValue({ success: true }),
  loadWorld: vi.fn().mockResolvedValue({
    success: true,
    data: {
      meta: { id: 'world_123', name: 'Test World' },
      terrain: {
        biome: 'grass',
        heightmap: Array(20).fill(null).map(() => Array(20).fill(0)),
        texturemap: Array(20).fill(null).map(() => Array(20).fill(0))
      },
      placedAssets: [],
      library: []
    }
  }),
  generateId: vi.fn((prefix) => `${prefix}_${Date.now()}`)
}))

// Mock toast
vi.mock('../../../src/studio/components/Toast', () => ({
  showToast: vi.fn()
}))

describe('useWorld', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('create', () => {
    it('should create a new world with default data', () => {
      const { result } = renderHook(() => useWorld())

      act(() => {
        result.current.create('My World', 'grass')
      })

      expect(result.current.data).toBeTruthy()
      expect(result.current.data.meta.name).toBe('My World')
      expect(result.current.data.terrain.biome).toBe('grass')
      expect(result.current.isDirty).toBe(true)
    })

    it('should reset undo/redo stacks on create', () => {
      const { result } = renderHook(() => useWorld())

      act(() => {
        result.current.create('World 1', 'grass')
      })

      expect(result.current.canUndo).toBe(false)
      expect(result.current.canRedo).toBe(false)
    })

    it('should initialize empty library and placedAssets', () => {
      const { result } = renderHook(() => useWorld())

      act(() => {
        result.current.create('My World', 'desert')
      })

      expect(result.current.data.library).toEqual([])
      expect(result.current.data.placedAssets).toEqual([])
    })
  })

  describe('undo/redo', () => {
    it('should undo library add operation', () => {
      const { result } = renderHook(() => useWorld())

      act(() => {
        result.current.create('Test', 'grass')
      })

      const asset = { id: 'lib_1', name: 'Dragon', generatedCode: 'code' }

      act(() => {
        result.current.addLibraryAsset(asset)
      })

      expect(result.current.data.library).toHaveLength(1)
      expect(result.current.canUndo).toBe(true)

      act(() => {
        result.current.undo()
      })

      expect(result.current.data.library).toHaveLength(0)
      expect(result.current.canRedo).toBe(true)
    })

    it('should redo library add operation', () => {
      const { result } = renderHook(() => useWorld())

      act(() => {
        result.current.create('Test', 'grass')
      })

      const asset = { id: 'lib_1', name: 'Dragon', generatedCode: 'code' }

      act(() => {
        result.current.addLibraryAsset(asset)
      })

      act(() => {
        result.current.undo()
      })

      act(() => {
        result.current.redo()
      })

      expect(result.current.data.library).toHaveLength(1)
      expect(result.current.data.library[0].name).toBe('Dragon')
    })

    it('should undo instance placement', () => {
      const { result } = renderHook(() => useWorld())

      act(() => {
        result.current.create('Test', 'grass')
      })

      act(() => {
        result.current.addLibraryAsset({ id: 'lib_1', name: 'Dragon' })
      })

      act(() => {
        result.current.placeInstance('lib_1', [50, 0, 50])
      })

      expect(result.current.data.placedAssets).toHaveLength(1)

      act(() => {
        result.current.undo()
      })

      expect(result.current.data.placedAssets).toHaveLength(0)
    })

    it('should respect MAX_UNDO_LEVELS limit', () => {
      const { result } = renderHook(() => useWorld())

      act(() => {
        result.current.create('Test', 'grass')
      })

      // Add more than 50 operations
      for (let i = 0; i < 60; i++) {
        act(() => {
          result.current.addLibraryAsset({ id: `lib_${i}`, name: `Asset ${i}` })
        })
      }

      // Should be capped at MAX_UNDO_LEVELS (50)
      expect(result.current.undoCount).toBeLessThanOrEqual(50)
    })

    it('should clear redo stack when new operation is performed', () => {
      const { result } = renderHook(() => useWorld())

      act(() => {
        result.current.create('Test', 'grass')
      })

      act(() => {
        result.current.addLibraryAsset({ id: 'lib_1', name: 'Asset 1' })
      })

      act(() => {
        result.current.undo()
      })

      expect(result.current.canRedo).toBe(true)

      // New operation should clear redo stack
      act(() => {
        result.current.addLibraryAsset({ id: 'lib_2', name: 'Asset 2' })
      })

      expect(result.current.canRedo).toBe(false)
    })
  })

  describe('removeLibraryAsset', () => {
    it('should remove library asset and associated instances', () => {
      const { result } = renderHook(() => useWorld())

      act(() => {
        result.current.create('Test', 'grass')
      })

      act(() => {
        result.current.addLibraryAsset({ id: 'lib_1', name: 'Dragon' })
      })

      act(() => {
        result.current.placeInstance('lib_1', [50, 0, 50])
        result.current.placeInstance('lib_1', [60, 0, 60])
      })

      expect(result.current.data.placedAssets).toHaveLength(2)

      act(() => {
        result.current.removeLibraryAsset('lib_1')
      })

      expect(result.current.data.library).toHaveLength(0)
      expect(result.current.data.placedAssets).toHaveLength(0)
    })

    it('should restore instances on undo of library removal', () => {
      const { result } = renderHook(() => useWorld())

      act(() => {
        result.current.create('Test', 'grass')
      })

      act(() => {
        result.current.addLibraryAsset({ id: 'lib_1', name: 'Dragon' })
      })

      act(() => {
        result.current.placeInstance('lib_1', [50, 0, 50])
      })

      act(() => {
        result.current.removeLibraryAsset('lib_1')
      })

      act(() => {
        result.current.undo()
      })

      expect(result.current.data.library).toHaveLength(1)
      expect(result.current.data.placedAssets).toHaveLength(1)
    })
  })

  describe('updateInstance', () => {
    it('should update instance properties', () => {
      const { result } = renderHook(() => useWorld())

      act(() => {
        result.current.create('Test', 'grass')
      })

      act(() => {
        result.current.addLibraryAsset({ id: 'lib_1', name: 'Dragon' })
      })

      act(() => {
        result.current.placeInstance('lib_1', [50, 0, 50])
      })

      // Get instanceId after state update
      const instanceId = result.current.data.placedAssets[0].instanceId

      act(() => {
        result.current.updateInstance(instanceId, { position: [100, 0, 100] })
      })

      expect(result.current.data.placedAssets[0].position).toEqual([100, 0, 100])
    })

    it('should support undoing instance updates', () => {
      const { result } = renderHook(() => useWorld())

      act(() => {
        result.current.create('Test', 'grass')
      })

      act(() => {
        result.current.addLibraryAsset({ id: 'lib_1', name: 'Dragon' })
      })

      act(() => {
        result.current.placeInstance('lib_1', [50, 0, 50])
      })

      // Get instanceId after state update
      const instanceId = result.current.data.placedAssets[0].instanceId

      act(() => {
        result.current.updateInstance(instanceId, { rotation: 1.5 })
      })

      act(() => {
        result.current.undo()
      })

      expect(result.current.data.placedAssets[0].rotation).toBe(0)
    })
  })

  describe('deleteInstance', () => {
    it('should remove instance from placedAssets', () => {
      const { result } = renderHook(() => useWorld())

      act(() => {
        result.current.create('Test', 'grass')
      })

      act(() => {
        result.current.addLibraryAsset({ id: 'lib_1', name: 'Dragon' })
      })

      act(() => {
        result.current.placeInstance('lib_1', [50, 0, 50])
      })

      // Get instanceId after state update
      const instanceId = result.current.data.placedAssets[0].instanceId

      act(() => {
        result.current.deleteInstance(instanceId)
      })

      expect(result.current.data.placedAssets).toHaveLength(0)
    })

    it('should restore instance on undo', () => {
      const { result } = renderHook(() => useWorld())

      act(() => {
        result.current.create('Test', 'grass')
      })

      act(() => {
        result.current.addLibraryAsset({ id: 'lib_1', name: 'Dragon' })
      })

      act(() => {
        result.current.placeInstance('lib_1', [50, 0, 50])
      })

      // Get instanceId after state update
      const instanceId = result.current.data.placedAssets[0].instanceId

      act(() => {
        result.current.deleteInstance(instanceId)
      })

      act(() => {
        result.current.undo()
      })

      expect(result.current.data.placedAssets).toHaveLength(1)
      expect(result.current.data.placedAssets[0].instanceId).toBe(instanceId)
    })
  })

  describe('terrain operations', () => {
    it('should update terrain height', () => {
      const { result } = renderHook(() => useWorld())

      act(() => {
        result.current.create('Test', 'grass')
      })

      act(() => {
        result.current.setTerrainHeight(5, 5, 10)
      })

      expect(result.current.data.terrain.heightmap[5][5]).toBe(10)
    })

    it('should coalesce rapid terrain changes into single undo operation', async () => {
      const { result } = renderHook(() => useWorld())

      act(() => {
        result.current.create('Test', 'grass')
      })

      // Simulate rapid terrain painting
      act(() => {
        result.current.setTerrainHeight(5, 5, 1)
        result.current.setTerrainHeight(5, 6, 2)
        result.current.setTerrainHeight(5, 7, 3)
      })

      // Should be coalesced into one undo operation
      expect(result.current.undoCount).toBe(1)

      act(() => {
        result.current.undo()
      })

      // All changes should be undone
      expect(result.current.data.terrain.heightmap[5][5]).toBe(0)
      expect(result.current.data.terrain.heightmap[5][6]).toBe(0)
      expect(result.current.data.terrain.heightmap[5][7]).toBe(0)
    })
  })

  describe('dirty state', () => {
    it('should mark world as dirty after modifications', () => {
      const { result } = renderHook(() => useWorld())

      act(() => {
        result.current.create('Test', 'grass')
      })

      // Already dirty after create
      expect(result.current.isDirty).toBe(true)
    })

    it('should remain dirty after undo/redo', () => {
      const { result } = renderHook(() => useWorld())

      act(() => {
        result.current.create('Test', 'grass')
      })

      act(() => {
        result.current.addLibraryAsset({ id: 'lib_1', name: 'Dragon' })
      })

      act(() => {
        result.current.undo()
      })

      expect(result.current.isDirty).toBe(true)
    })
  })

  // ================================
  // Phase 1: Critical Data Integrity Tests
  // ================================

  describe('editVersion race condition (C4 Fix)', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should increment editVersion on every edit', () => {
      const { result } = renderHook(() => useWorld())

      act(() => {
        result.current.create('Test', 'grass')
      })

      // Get baseline dirty state
      expect(result.current.isDirty).toBe(true)

      // Each edit should increment version (tracked internally)
      act(() => {
        result.current.addLibraryAsset({ id: 'lib_1', name: 'Dragon' })
      })

      act(() => {
        result.current.addLibraryAsset({ id: 'lib_2', name: 'Tree' })
      })

      // After multiple edits, still dirty
      expect(result.current.isDirty).toBe(true)
    })

    it('should not clear dirty flag if edits occur during save', async () => {
      // This test validates the C4 fix by simulating concurrent edits during save
      const { result } = renderHook(() => useWorld())

      // Create a slow save that allows us to insert edits
      let saveResolve
      saveWorld.mockImplementationOnce(() => new Promise(resolve => {
        saveResolve = () => resolve({ success: true })
      }))

      act(() => {
        result.current.create('Test', 'grass')
      })

      // Start save (don't await)
      let savePromise
      act(() => {
        savePromise = result.current.save()
      })

      // Make an edit during save
      act(() => {
        result.current.addLibraryAsset({ id: 'lib_1', name: 'Dragon' })
      })

      // Complete the save
      await act(async () => {
        saveResolve()
        await savePromise
      })

      // Should still be dirty because edit happened during save
      expect(result.current.isDirty).toBe(true)
    })

    it('should clear dirty flag only if no edits during save', async () => {
      const { result } = renderHook(() => useWorld())

      // Fast save that completes immediately
      saveWorld.mockResolvedValueOnce({ success: true })

      act(() => {
        result.current.create('Test', 'grass')
      })

      expect(result.current.isDirty).toBe(true)

      // Save without any concurrent edits
      await act(async () => {
        await result.current.save()
      })

      // Should clear dirty flag
      expect(result.current.isDirty).toBe(false)
    })

    it('should handle concurrent saves correctly', async () => {
      const { result } = renderHook(() => useWorld())

      act(() => {
        result.current.create('Test', 'grass')
      })

      // First save
      await act(async () => {
        await result.current.save()
      })

      expect(result.current.isDirty).toBe(false)

      // Make edit, then save
      act(() => {
        result.current.addLibraryAsset({ id: 'lib_1', name: 'Dragon' })
      })

      expect(result.current.isDirty).toBe(true)

      await act(async () => {
        await result.current.save()
      })

      expect(result.current.isDirty).toBe(false)
    })
  })

  describe('saveRef pattern (timer stability)', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should not restart auto-save timer when save function changes', async () => {
      const { result } = renderHook(() => useWorld())

      act(() => {
        result.current.create('Test', 'grass')
      })

      // isDirty is true, timer should start
      expect(result.current.isDirty).toBe(true)

      // Make multiple edits (which would change save function identity)
      for (let i = 0; i < 5; i++) {
        act(() => {
          result.current.addLibraryAsset({ id: `lib_${i}`, name: `Asset ${i}` })
        })
      }

      // Advance time but not to 60s yet
      await act(async () => {
        await advanceTimers(30000)
      })

      // Save should not have been called yet (only 30s elapsed)
      expect(saveWorld).not.toHaveBeenCalled()

      // Advance to 60s total
      await act(async () => {
        await advanceTimers(30000)
      })

      // Now auto-save should trigger
      expect(saveWorld).toHaveBeenCalled()
    })

    it('should use ref to access current save function', async () => {
      const { result } = renderHook(() => useWorld())

      act(() => {
        result.current.create('Test', 'grass')
      })

      // Make edit
      act(() => {
        result.current.addLibraryAsset({ id: 'lib_1', name: 'Dragon' })
      })

      // Advance to trigger auto-save
      await act(async () => {
        await advanceTimers(60000)
      })

      // saveWorld should be called with current data (including the new asset)
      expect(saveWorld).toHaveBeenCalled()
      const savedData = saveWorld.mock.calls[0][0]
      expect(savedData.library).toHaveLength(1)
      expect(savedData.library[0].name).toBe('Dragon')
    })
  })

  describe('auto-save timer', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should trigger save after 60 seconds when dirty', async () => {
      const { result } = renderHook(() => useWorld())

      act(() => {
        result.current.create('Test', 'grass')
      })

      expect(result.current.isDirty).toBe(true)
      expect(saveWorld).not.toHaveBeenCalled()

      // Advance time to 60 seconds
      await act(async () => {
        await advanceTimers(60000)
      })

      expect(saveWorld).toHaveBeenCalled()
    })

    it('should not save when not dirty', async () => {
      const { result } = renderHook(() => useWorld())

      act(() => {
        result.current.create('Test', 'grass')
      })

      // Clear dirty flag via save
      await act(async () => {
        await result.current.save()
      })

      vi.clearAllMocks()
      expect(result.current.isDirty).toBe(false)

      // Advance time - should not trigger save
      await act(async () => {
        await advanceTimers(60000)
      })

      expect(saveWorld).not.toHaveBeenCalled()
    })

    it('should clear timer on unmount', async () => {
      const { result, unmount } = renderHook(() => useWorld())

      act(() => {
        result.current.create('Test', 'grass')
      })

      // Unmount before timer fires
      unmount()

      // Advance time
      await act(async () => {
        await advanceTimers(60000)
      })

      // Save should not have been called (timer was cleared)
      expect(saveWorld).not.toHaveBeenCalled()
    })

    it('should show toast on failed auto-save', async () => {
      const { result } = renderHook(() => useWorld())

      // Make save fail
      saveWorld.mockResolvedValueOnce({ success: false, error: 'Network error' })

      act(() => {
        result.current.create('Test', 'grass')
      })

      // Advance to trigger auto-save
      await act(async () => {
        await advanceTimers(60000)
      })

      expect(showToast).toHaveBeenCalledWith(
        'Auto-save failed. Please save manually.',
        'error',
        5000
      )
    })
  })

  describe('editVersion tracking across undo/redo', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should increment editVersion on undo', async () => {
      const { result } = renderHook(() => useWorld())

      act(() => {
        result.current.create('Test', 'grass')
      })

      act(() => {
        result.current.addLibraryAsset({ id: 'lib_1', name: 'Dragon' })
      })

      // Save to clear dirty
      await act(async () => {
        await result.current.save()
      })

      expect(result.current.isDirty).toBe(false)

      // Undo should mark dirty again
      act(() => {
        result.current.undo()
      })

      expect(result.current.isDirty).toBe(true)
    })

    it('should increment editVersion on redo', async () => {
      const { result } = renderHook(() => useWorld())

      act(() => {
        result.current.create('Test', 'grass')
      })

      act(() => {
        result.current.addLibraryAsset({ id: 'lib_1', name: 'Dragon' })
      })

      act(() => {
        result.current.undo()
      })

      // Save to clear dirty
      await act(async () => {
        await result.current.save()
      })

      expect(result.current.isDirty).toBe(false)

      // Redo should mark dirty again
      act(() => {
        result.current.redo()
      })

      expect(result.current.isDirty).toBe(true)
    })
  })
})
