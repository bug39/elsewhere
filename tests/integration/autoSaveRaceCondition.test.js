/**
 * Integration tests for auto-save race condition fix (C4)
 *
 * Tests the editVersion pattern that prevents the dirty flag from being
 * incorrectly cleared when edits occur during an in-flight save operation.
 *
 * Key scenarios:
 * - Edit during save should keep dirty flag true
 * - Multiple edits during save are preserved
 * - editVersion tracks across undo/redo
 * - Save failure doesn't corrupt state
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/preact'

// Mock storage to control timing
vi.mock('../../src/studio/state/storage', () => ({
  saveWorld: vi.fn(),
  loadWorld: vi.fn(),
  generateId: vi.fn((prefix) => `${prefix}_${Date.now()}`)
}))

// Mock toast
vi.mock('../../src/studio/components/Toast', () => ({
  showToast: vi.fn()
}))

import { saveWorld, loadWorld } from '../../src/studio/state/storage'
import { useWorld } from '../../src/studio/hooks/useWorld'

describe('autoSaveRaceCondition', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock implementations
    saveWorld.mockResolvedValue({ success: true })
    loadWorld.mockResolvedValue({
      success: true,
      data: {
        meta: { id: 'test-world', name: 'Test World' },
        terrain: {
          biome: 'grass',
          heightmap: Array(40).fill(null).map(() => Array(40).fill(0)),
          texturemap: Array(40).fill(null).map(() => Array(40).fill(0))
        },
        placedAssets: [],
        library: []
      }
    })
  })

  describe('edit during save', () => {
    it('should remain dirty if edit occurs during save', async () => {
      let saveResolve
      saveWorld.mockImplementationOnce(() => new Promise(resolve => {
        saveResolve = () => resolve({ success: true })
      }))

      const { result } = renderHook(() => useWorld())

      // Create world
      act(() => {
        result.current.create('Test', 'grass')
      })

      // Make an edit to become dirty
      act(() => {
        result.current.setTerrainHeight(5, 5, 10)
      })

      expect(result.current.isDirty).toBe(true)

      // Start save (don't await)
      let savePromise
      act(() => {
        savePromise = result.current.save()
      })

      // Make another edit while save is in flight
      act(() => {
        result.current.setTerrainHeight(6, 6, 20)
      })

      // Complete the save
      await act(async () => {
        saveResolve()
        await savePromise
      })

      // Should STILL be dirty because of the edit during save
      expect(result.current.isDirty).toBe(true)
    })

    it('should handle multiple edits during single save', async () => {
      let saveResolve
      saveWorld.mockImplementationOnce(() => new Promise(resolve => {
        saveResolve = () => resolve({ success: true })
      }))

      const { result } = renderHook(() => useWorld())

      act(() => {
        result.current.create('Test', 'grass')
      })

      // Initial edit
      act(() => {
        result.current.setTerrainHeight(1, 1, 5)
      })

      // Start save
      let savePromise
      act(() => {
        savePromise = result.current.save()
      })

      // Multiple edits during save
      act(() => {
        result.current.setTerrainHeight(2, 2, 10)
        result.current.setTerrainHeight(3, 3, 15)
        result.current.setTerrainHeight(4, 4, 20)
      })

      // Complete save
      await act(async () => {
        saveResolve()
        await savePromise
      })

      // Should still be dirty
      expect(result.current.isDirty).toBe(true)

      // The world data should have all edits
      expect(result.current.data.terrain.heightmap[1][1]).toBe(5)
      expect(result.current.data.terrain.heightmap[2][2]).toBe(10)
      expect(result.current.data.terrain.heightmap[3][3]).toBe(15)
      expect(result.current.data.terrain.heightmap[4][4]).toBe(20)
    })

    it('should preserve all edits made during save', async () => {
      let saveResolve
      saveWorld.mockImplementationOnce(() => new Promise(resolve => {
        saveResolve = () => resolve({ success: true })
      }))

      const { result } = renderHook(() => useWorld())

      act(() => {
        result.current.create('Test', 'grass')
      })

      // Initial edit
      act(() => {
        result.current.setTerrainHeight(0, 0, 100)
      })

      // Start save
      let savePromise
      act(() => {
        savePromise = result.current.save()
      })

      // Edit during save
      act(() => {
        result.current.setTerrainHeight(1, 0, 200)
      })

      // Complete save
      await act(async () => {
        saveResolve()
        await savePromise
      })

      // Both edits should be in data (heightmap is accessed as [z][x])
      expect(result.current.data.terrain.heightmap[0][0]).toBe(100)
      expect(result.current.data.terrain.heightmap[0][1]).toBe(200)

      // Now save again and verify second edit is included
      saveWorld.mockResolvedValueOnce({ success: true })
      await act(async () => {
        await result.current.save()
      })

      // The save should have been called with data including both edits
      const savedData = saveWorld.mock.calls[saveWorld.mock.calls.length - 1][0]
      expect(savedData.terrain.heightmap[0][0]).toBe(100)
      expect(savedData.terrain.heightmap[0][1]).toBe(200)
    })
  })

  describe('editVersion tracking', () => {
    it('should track editVersion across undo/redo', async () => {
      const { result } = renderHook(() => useWorld())

      act(() => {
        result.current.create('Test', 'grass')
      })

      // Make edits
      act(() => {
        result.current.setTerrainHeight(5, 5, 10)
      })

      act(() => {
        result.current.setTerrainHeight(6, 6, 20)
      })

      expect(result.current.isDirty).toBe(true)
      expect(result.current.canUndo).toBe(true)

      // Undo
      act(() => {
        result.current.undo()
      })

      // Should still be dirty (undo is also an edit)
      expect(result.current.isDirty).toBe(true)
      expect(result.current.data.terrain.heightmap[6][6]).toBe(0)

      // Redo
      act(() => {
        result.current.redo()
      })

      expect(result.current.isDirty).toBe(true)
      expect(result.current.data.terrain.heightmap[6][6]).toBe(20)
    })
  })

  describe('save failure handling', () => {
    it('should handle save failure without corrupting state', async () => {
      const { result } = renderHook(() => useWorld())

      act(() => {
        result.current.create('Test', 'grass')
      })

      // Make edit
      act(() => {
        result.current.setTerrainHeight(10, 10, 50)
      })

      expect(result.current.isDirty).toBe(true)

      // Fail the save
      saveWorld.mockResolvedValueOnce({ success: false, error: 'Test error' })

      await act(async () => {
        await result.current.save()
      })

      // Should still be dirty after failed save
      expect(result.current.isDirty).toBe(true)

      // Data should be intact
      expect(result.current.data.terrain.heightmap[10][10]).toBe(50)

      // Can still save successfully
      saveWorld.mockResolvedValueOnce({ success: true })

      await act(async () => {
        await result.current.save()
      })

      // Now should be clean
      expect(result.current.isDirty).toBe(false)
    })

    it('should handle save exception without corrupting state', async () => {
      const { result } = renderHook(() => useWorld())

      act(() => {
        result.current.create('Test', 'grass')
      })

      act(() => {
        result.current.setTerrainHeight(15, 15, 75)
      })

      // Throw during save
      saveWorld.mockRejectedValueOnce(new Error('Network error'))

      await act(async () => {
        try {
          await result.current.save()
        } catch (e) {
          // Expected
        }
      })

      // Should still be dirty
      expect(result.current.isDirty).toBe(true)

      // Data intact
      expect(result.current.data.terrain.heightmap[15][15]).toBe(75)
    })
  })
})
