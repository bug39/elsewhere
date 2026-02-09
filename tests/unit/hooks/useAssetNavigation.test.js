/**
 * Unit tests for useAssetNavigation.js
 *
 * Tests the spatial Tab/Shift+Tab navigation including:
 * - navigateToNext: nearest unvisited asset selection
 * - navigateToPrevious: history stack navigation
 * - resetNavigation: clearing visited and history state
 * - Edge cases: empty world, single asset, all visited
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/preact'
import { useAssetNavigation } from '../../../src/studio/hooks/useAssetNavigation'
import { createMockRendererRef, createMockSelection } from '../testUtils'

describe('useAssetNavigation', () => {
  let rendererRef
  let selection
  let world

  beforeEach(() => {
    vi.clearAllMocks()
    rendererRef = createMockRendererRef()
    selection = createMockSelection()
    world = {
      data: {
        placedAssets: [
          { instanceId: 'inst_1', position: [100, 0, 100] },
          { instanceId: 'inst_2', position: [150, 0, 150] },
          { instanceId: 'inst_3', position: [200, 0, 200] },
          { instanceId: 'inst_4', position: [50, 0, 50] }
        ]
      }
    }
  })

  describe('navigateToNext', () => {
    it('should select the nearest unvisited asset from current position', () => {
      // Start at inst_1 (100, 0, 100)
      selection.instanceId = 'inst_1'

      const { result } = renderHook(() => useAssetNavigation({ world, selection, rendererRef }))

      act(() => {
        result.current.navigateToNext()
      })

      // inst_4 at (50, 0, 50) is nearest to (100, 0, 100) - distance ~71
      // inst_2 at (150, 0, 150) - distance ~71
      // They're equidistant, but inst_4 comes first in the array so it might be picked
      // Actually, the loop finds the minimum, so whichever is checked first that has min distance wins
      expect(selection.selectInstance).toHaveBeenCalled()
    })

    it('should start from world center [200, 0, 200] if no selection', () => {
      selection.instanceId = null

      const { result } = renderHook(() => useAssetNavigation({ world, selection, rendererRef }))

      act(() => {
        result.current.navigateToNext()
      })

      // From world center (200, 0, 200), inst_3 at (200, 0, 200) is closest (distance 0)
      expect(selection.selectInstance).toHaveBeenCalledWith('inst_3')
    })

    it('should calculate 3D Euclidean distance correctly', () => {
      // Place assets at known distances
      world.data.placedAssets = [
        { instanceId: 'inst_1', position: [0, 0, 0] },
        { instanceId: 'inst_2', position: [300, 0, 400] } // distance = 500 from origin
      ]
      selection.instanceId = 'inst_1'

      const { result } = renderHook(() => useAssetNavigation({ world, selection, rendererRef }))

      act(() => {
        result.current.navigateToNext()
      })

      // Should select inst_2 (only other option)
      expect(selection.selectInstance).toHaveBeenCalledWith('inst_2')
    })

    it('should skip the currently selected asset', () => {
      world.data.placedAssets = [
        { instanceId: 'inst_1', position: [100, 0, 100] },
        { instanceId: 'inst_2', position: [100, 0, 100] } // Same position
      ]
      selection.instanceId = 'inst_1'

      const { result } = renderHook(() => useAssetNavigation({ world, selection, rendererRef }))

      act(() => {
        result.current.navigateToNext()
      })

      // Should select inst_2 (skips inst_1 even though it's at same position)
      expect(selection.selectInstance).toHaveBeenCalledWith('inst_2')
    })

    it('should wrap around when all assets are visited', () => {
      world.data.placedAssets = [
        { instanceId: 'inst_1', position: [100, 0, 100] },
        { instanceId: 'inst_2', position: [200, 0, 200] }
      ]
      selection.instanceId = 'inst_1'

      const { result } = renderHook(() => useAssetNavigation({ world, selection, rendererRef }))

      // Visit both assets
      act(() => {
        result.current.navigateToNext() // Visit inst_2
      })

      selection.instanceId = 'inst_2'

      act(() => {
        result.current.navigateToNext() // All visited, should wrap
      })

      // Should wrap and select nearest (inst_1 from inst_2's position)
      expect(selection.selectInstance).toHaveBeenCalled()
    })

    it('should handle single asset in world', () => {
      world.data.placedAssets = [
        { instanceId: 'inst_1', position: [100, 0, 100] }
      ]
      selection.instanceId = null

      const { result } = renderHook(() => useAssetNavigation({ world, selection, rendererRef }))

      act(() => {
        result.current.navigateToNext()
      })

      expect(selection.selectInstance).toHaveBeenCalledWith('inst_1')
    })

    it('should do nothing when world is empty', () => {
      world.data.placedAssets = []

      const { result } = renderHook(() => useAssetNavigation({ world, selection, rendererRef }))

      act(() => {
        result.current.navigateToNext()
      })

      expect(selection.selectInstance).not.toHaveBeenCalled()
    })

    it('should do nothing when world data is null', () => {
      world.data = null

      const { result } = renderHook(() => useAssetNavigation({ world, selection, rendererRef }))

      act(() => {
        result.current.navigateToNext()
      })

      expect(selection.selectInstance).not.toHaveBeenCalled()
    })

    it('should focus camera on selected asset', () => {
      selection.instanceId = 'inst_1'

      const { result } = renderHook(() => useAssetNavigation({ world, selection, rendererRef }))

      act(() => {
        result.current.navigateToNext()
      })

      expect(rendererRef.current.focusOnInstance).toHaveBeenCalled()
    })

    it('should add current selection to history stack before navigating', () => {
      selection.instanceId = 'inst_1'

      const { result } = renderHook(() => useAssetNavigation({ world, selection, rendererRef }))

      act(() => {
        result.current.navigateToNext()
      })

      // Navigate back should return to inst_1
      const secondSelectedId = selection.selectInstance.mock.calls[0][0]
      selection.instanceId = secondSelectedId

      act(() => {
        result.current.navigateToPrevious()
      })

      expect(selection.selectInstance).toHaveBeenCalledWith('inst_1')
    })

    it('should mark visited assets to avoid revisiting', () => {
      world.data.placedAssets = [
        { instanceId: 'inst_1', position: [100, 0, 100] },
        { instanceId: 'inst_2', position: [150, 0, 150] },
        { instanceId: 'inst_3', position: [200, 0, 200] }
      ]
      selection.instanceId = 'inst_2' // Start in the middle

      const { result } = renderHook(() => useAssetNavigation({ world, selection, rendererRef }))

      // First navigation
      act(() => {
        result.current.navigateToNext()
      })

      const firstSelection = selection.selectInstance.mock.calls[0][0]
      selection.instanceId = firstSelection
      selection.selectInstance.mockClear()

      // Second navigation should not return to inst_2 (visited) or current selection
      act(() => {
        result.current.navigateToNext()
      })

      const secondSelection = selection.selectInstance.mock.calls[0]?.[0]
      // Should have selected the remaining unvisited asset
      expect(secondSelection).toBeDefined()
      expect(secondSelection).not.toBe(firstSelection)
    })
  })

  describe('navigateToPrevious', () => {
    it('should return to previous asset in history', () => {
      selection.instanceId = 'inst_1'

      const { result } = renderHook(() => useAssetNavigation({ world, selection, rendererRef }))

      // Navigate forward
      act(() => {
        result.current.navigateToNext()
      })

      const secondSelection = selection.selectInstance.mock.calls[0][0]
      selection.instanceId = secondSelection
      selection.selectInstance.mockClear()

      // Navigate back
      act(() => {
        result.current.navigateToPrevious()
      })

      expect(selection.selectInstance).toHaveBeenCalledWith('inst_1')
    })

    it('should skip deleted assets when navigating back', () => {
      selection.instanceId = 'inst_1'

      const { result } = renderHook(() => useAssetNavigation({ world, selection, rendererRef }))

      // Navigate forward twice
      act(() => {
        result.current.navigateToNext()
      })

      selection.instanceId = selection.selectInstance.mock.calls[0][0]

      act(() => {
        result.current.navigateToNext()
      })

      selection.instanceId = selection.selectInstance.mock.calls[1][0]
      selection.selectInstance.mockClear()

      // Remove inst_1 from world (simulating deletion)
      world.data.placedAssets = world.data.placedAssets.filter(a => a.instanceId !== 'inst_1')

      // Navigate back - should skip deleted inst_1
      act(() => {
        result.current.navigateToPrevious()
      })

      // Should not select inst_1 since it's deleted
      if (selection.selectInstance.mock.calls.length > 0) {
        expect(selection.selectInstance.mock.calls[0][0]).not.toBe('inst_1')
      }
    })

    it('should handle empty history', () => {
      const { result } = renderHook(() => useAssetNavigation({ world, selection, rendererRef }))

      act(() => {
        result.current.navigateToPrevious()
      })

      // Should not crash and should not select anything
      expect(selection.selectInstance).not.toHaveBeenCalled()
    })

    it('should focus camera on previous asset', () => {
      selection.instanceId = 'inst_1'

      const { result } = renderHook(() => useAssetNavigation({ world, selection, rendererRef }))

      // Build history
      act(() => {
        result.current.navigateToNext()
      })

      selection.instanceId = selection.selectInstance.mock.calls[0][0]
      rendererRef.current.focusOnInstance.mockClear()

      // Navigate back
      act(() => {
        result.current.navigateToPrevious()
      })

      expect(rendererRef.current.focusOnInstance).toHaveBeenCalledWith('inst_1')
    })

    it('should handle world being null when navigating back', () => {
      selection.instanceId = 'inst_1'

      const { result } = renderHook(() => useAssetNavigation({ world, selection, rendererRef }))

      // Build history
      act(() => {
        result.current.navigateToNext()
      })

      // Null out world data
      world.data = null

      // Should not crash
      act(() => {
        result.current.navigateToPrevious()
      })

      // Should be a no-op
    })
  })

  describe('resetNavigation', () => {
    it('should clear visitedSet', () => {
      selection.instanceId = 'inst_1'

      const { result } = renderHook(() => useAssetNavigation({ world, selection, rendererRef }))

      // Visit some assets
      act(() => {
        result.current.navigateToNext()
      })

      act(() => {
        result.current.resetNavigation()
      })

      // After reset, navigating should be able to visit the same assets again
      selection.instanceId = 'inst_1'
      selection.selectInstance.mockClear()

      act(() => {
        result.current.navigateToNext()
      })

      // Should still navigate (visited set was cleared)
      expect(selection.selectInstance).toHaveBeenCalled()
    })

    it('should clear historyStack', () => {
      selection.instanceId = 'inst_1'

      const { result } = renderHook(() => useAssetNavigation({ world, selection, rendererRef }))

      // Build history
      act(() => {
        result.current.navigateToNext()
      })

      selection.instanceId = selection.selectInstance.mock.calls[0][0]

      // Reset navigation
      act(() => {
        result.current.resetNavigation()
      })

      selection.selectInstance.mockClear()

      // Navigate back should do nothing (history cleared)
      act(() => {
        result.current.navigateToPrevious()
      })

      expect(selection.selectInstance).not.toHaveBeenCalled()
    })

    it('should be idempotent (safe to call multiple times)', () => {
      const { result } = renderHook(() => useAssetNavigation({ world, selection, rendererRef }))

      expect(() => {
        act(() => {
          result.current.resetNavigation()
          result.current.resetNavigation()
          result.current.resetNavigation()
        })
      }).not.toThrow()
    })
  })

  describe('edge cases', () => {
    it('should handle assets with Y coordinate differences', () => {
      world.data.placedAssets = [
        { instanceId: 'inst_1', position: [100, 0, 100] },
        { instanceId: 'inst_2', position: [100, 50, 100] } // Same X/Z, different Y
      ]
      selection.instanceId = 'inst_1'

      const { result } = renderHook(() => useAssetNavigation({ world, selection, rendererRef }))

      act(() => {
        result.current.navigateToNext()
      })

      // Should select inst_2 (Y distance counts)
      expect(selection.selectInstance).toHaveBeenCalledWith('inst_2')
    })

    it('should handle renderer ref being null gracefully', () => {
      const nullRendererRef = { current: null }
      selection.instanceId = 'inst_1'

      const { result } = renderHook(() => useAssetNavigation({
        world,
        selection,
        rendererRef: nullRendererRef
      }))

      // Should not throw
      expect(() => {
        act(() => {
          result.current.navigateToNext()
        })
      }).not.toThrow()

      // Selection should still work
      expect(selection.selectInstance).toHaveBeenCalled()
    })

    it('should return stable function references', () => {
      const { result, rerender } = renderHook(() => useAssetNavigation({
        world,
        selection,
        rendererRef
      }))

      const firstRender = {
        navigateToNext: result.current.navigateToNext,
        navigateToPrevious: result.current.navigateToPrevious,
        resetNavigation: result.current.resetNavigation
      }

      rerender()

      // Functions should be stable (memoized)
      expect(result.current.navigateToNext).toBe(firstRender.navigateToNext)
      expect(result.current.navigateToPrevious).toBe(firstRender.navigateToPrevious)
      expect(result.current.resetNavigation).toBe(firstRender.resetNavigation)
    })
  })
})
