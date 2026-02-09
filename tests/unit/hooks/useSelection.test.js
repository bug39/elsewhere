/**
 * Unit tests for useSelection.js
 *
 * Tests the editor selection state management including:
 * - Initial state
 * - Library asset selection
 * - Instance selection
 * - Part selection
 * - Clearing selections
 * - Batched state updates (single render per action)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/preact'
import { useSelection } from '../../../src/studio/hooks/useSelection'

describe('useSelection', () => {
  describe('initial state', () => {
    it('should initialize with null values', () => {
      const { result } = renderHook(() => useSelection())

      expect(result.current.libraryAssetId).toBeNull()
      expect(result.current.instanceId).toBeNull()
      expect(result.current.partName).toBeNull()
      expect(result.current.selectionType).toBeNull()
    })

    it('should provide all selection methods', () => {
      const { result } = renderHook(() => useSelection())

      expect(typeof result.current.selectLibraryAsset).toBe('function')
      expect(typeof result.current.selectInstance).toBe('function')
      expect(typeof result.current.selectPart).toBe('function')
      expect(typeof result.current.clearPartSelection).toBe('function')
      expect(typeof result.current.clear).toBe('function')
    })
  })

  describe('selectLibraryAsset', () => {
    it('should set libraryAssetId', () => {
      const { result } = renderHook(() => useSelection())

      act(() => {
        result.current.selectLibraryAsset('lib_123')
      })

      expect(result.current.libraryAssetId).toBe('lib_123')
    })

    it('should clear instanceId when selecting library asset', () => {
      const { result } = renderHook(() => useSelection())

      // First select an instance
      act(() => {
        result.current.selectInstance('inst_456')
      })
      expect(result.current.instanceId).toBe('inst_456')

      // Then select a library asset
      act(() => {
        result.current.selectLibraryAsset('lib_123')
      })

      expect(result.current.libraryAssetId).toBe('lib_123')
      expect(result.current.instanceId).toBeNull()
    })

    it('should clear partName when selecting library asset', () => {
      const { result } = renderHook(() => useSelection())

      // First select a part
      act(() => {
        result.current.selectPart('inst_456', 'head')
      })
      expect(result.current.partName).toBe('head')

      // Then select a library asset
      act(() => {
        result.current.selectLibraryAsset('lib_123')
      })

      expect(result.current.partName).toBeNull()
    })

    it('should set selectionType to library', () => {
      const { result } = renderHook(() => useSelection())

      act(() => {
        result.current.selectLibraryAsset('lib_123')
      })

      expect(result.current.selectionType).toBe('library')
    })
  })

  describe('selectInstance', () => {
    it('should set instanceId', () => {
      const { result } = renderHook(() => useSelection())

      act(() => {
        result.current.selectInstance('inst_456')
      })

      expect(result.current.instanceId).toBe('inst_456')
    })

    it('should clear libraryAssetId when selecting instance', () => {
      const { result } = renderHook(() => useSelection())

      // First select a library asset
      act(() => {
        result.current.selectLibraryAsset('lib_123')
      })
      expect(result.current.libraryAssetId).toBe('lib_123')

      // Then select an instance
      act(() => {
        result.current.selectInstance('inst_456')
      })

      expect(result.current.instanceId).toBe('inst_456')
      expect(result.current.libraryAssetId).toBeNull()
    })

    it('should clear partName when selecting instance', () => {
      const { result } = renderHook(() => useSelection())

      // First select a part
      act(() => {
        result.current.selectPart('inst_123', 'tail')
      })

      // Then select a different instance
      act(() => {
        result.current.selectInstance('inst_456')
      })

      expect(result.current.partName).toBeNull()
    })

    it('should set selectionType to instance', () => {
      const { result } = renderHook(() => useSelection())

      act(() => {
        result.current.selectInstance('inst_456')
      })

      expect(result.current.selectionType).toBe('instance')
    })
  })

  describe('selectPart', () => {
    it('should set both instanceId and partName', () => {
      const { result } = renderHook(() => useSelection())

      act(() => {
        result.current.selectPart('inst_456', 'head')
      })

      expect(result.current.instanceId).toBe('inst_456')
      expect(result.current.partName).toBe('head')
    })

    it('should clear libraryAssetId when selecting part', () => {
      const { result } = renderHook(() => useSelection())

      // First select a library asset
      act(() => {
        result.current.selectLibraryAsset('lib_123')
      })

      // Then select a part
      act(() => {
        result.current.selectPart('inst_456', 'arm')
      })

      expect(result.current.libraryAssetId).toBeNull()
    })

    it('should set selectionType to part', () => {
      const { result } = renderHook(() => useSelection())

      act(() => {
        result.current.selectPart('inst_456', 'leg')
      })

      expect(result.current.selectionType).toBe('part')
    })

    it('should allow selecting different parts on same instance', () => {
      const { result } = renderHook(() => useSelection())

      act(() => {
        result.current.selectPart('inst_456', 'head')
      })

      expect(result.current.partName).toBe('head')

      act(() => {
        result.current.selectPart('inst_456', 'tail')
      })

      expect(result.current.instanceId).toBe('inst_456')
      expect(result.current.partName).toBe('tail')
    })
  })

  describe('clearPartSelection', () => {
    it('should clear partName while keeping instanceId', () => {
      const { result } = renderHook(() => useSelection())

      act(() => {
        result.current.selectPart('inst_456', 'head')
      })

      expect(result.current.instanceId).toBe('inst_456')
      expect(result.current.partName).toBe('head')

      act(() => {
        result.current.clearPartSelection()
      })

      expect(result.current.instanceId).toBe('inst_456')
      expect(result.current.partName).toBeNull()
    })

    it('should change selectionType from part to instance', () => {
      const { result } = renderHook(() => useSelection())

      act(() => {
        result.current.selectPart('inst_456', 'head')
      })

      expect(result.current.selectionType).toBe('part')

      act(() => {
        result.current.clearPartSelection()
      })

      expect(result.current.selectionType).toBe('instance')
    })

    it('should be no-op if no part is selected', () => {
      const { result } = renderHook(() => useSelection())

      act(() => {
        result.current.selectInstance('inst_456')
      })

      const stateBefore = {
        instanceId: result.current.instanceId,
        selectionType: result.current.selectionType
      }

      act(() => {
        result.current.clearPartSelection()
      })

      expect(result.current.instanceId).toBe(stateBefore.instanceId)
      expect(result.current.selectionType).toBe(stateBefore.selectionType)
    })

    it('should set selectionType to null if no instanceId', () => {
      const { result } = renderHook(() => useSelection())

      // This is an edge case - partName without instanceId shouldn't happen in practice
      // but the code handles it gracefully
      act(() => {
        result.current.selectPart(null, 'head')
      })

      act(() => {
        result.current.clearPartSelection()
      })

      expect(result.current.selectionType).toBeNull()
    })
  })

  describe('clear', () => {
    it('should reset all state to null', () => {
      const { result } = renderHook(() => useSelection())

      // Set up some state
      act(() => {
        result.current.selectPart('inst_456', 'head')
      })

      // Clear everything
      act(() => {
        result.current.clear()
      })

      expect(result.current.libraryAssetId).toBeNull()
      expect(result.current.instanceId).toBeNull()
      expect(result.current.partName).toBeNull()
      expect(result.current.selectionType).toBeNull()
    })

    it('should work when called multiple times', () => {
      const { result } = renderHook(() => useSelection())

      act(() => {
        result.current.clear()
        result.current.clear()
        result.current.clear()
      })

      expect(result.current.libraryAssetId).toBeNull()
      expect(result.current.instanceId).toBeNull()
      expect(result.current.partName).toBeNull()
      expect(result.current.selectionType).toBeNull()
    })

    it('should clear library selection', () => {
      const { result } = renderHook(() => useSelection())

      act(() => {
        result.current.selectLibraryAsset('lib_123')
      })

      act(() => {
        result.current.clear()
      })

      expect(result.current.libraryAssetId).toBeNull()
      expect(result.current.selectionType).toBeNull()
    })
  })

  describe('batching behavior', () => {
    it('should update all fields in a single render (selectLibraryAsset)', () => {
      let renderCount = 0
      const { result } = renderHook(() => {
        renderCount++
        return useSelection()
      })

      const initialRenderCount = renderCount

      act(() => {
        result.current.selectLibraryAsset('lib_123')
      })

      // Should only add one render, not multiple (for each field)
      expect(renderCount).toBe(initialRenderCount + 1)
    })

    it('should update all fields in a single render (selectInstance)', () => {
      let renderCount = 0
      const { result } = renderHook(() => {
        renderCount++
        return useSelection()
      })

      const initialRenderCount = renderCount

      act(() => {
        result.current.selectInstance('inst_456')
      })

      expect(renderCount).toBe(initialRenderCount + 1)
    })

    it('should update all fields in a single render (selectPart)', () => {
      let renderCount = 0
      const { result } = renderHook(() => {
        renderCount++
        return useSelection()
      })

      const initialRenderCount = renderCount

      act(() => {
        result.current.selectPart('inst_456', 'head')
      })

      expect(renderCount).toBe(initialRenderCount + 1)
    })

    it('should update all fields in a single render (clear)', () => {
      let renderCount = 0
      const { result } = renderHook(() => {
        renderCount++
        return useSelection()
      })

      // Set up some state first
      act(() => {
        result.current.selectPart('inst_456', 'head')
      })

      const preCloseRenderCount = renderCount

      act(() => {
        result.current.clear()
      })

      expect(renderCount).toBe(preCloseRenderCount + 1)
    })

    it('should maintain stable function references', () => {
      const { result, rerender } = renderHook(() => useSelection())

      const firstRender = {
        selectLibraryAsset: result.current.selectLibraryAsset,
        selectInstance: result.current.selectInstance,
        selectPart: result.current.selectPart,
        clearPartSelection: result.current.clearPartSelection,
        clear: result.current.clear
      }

      rerender()

      expect(result.current.selectLibraryAsset).toBe(firstRender.selectLibraryAsset)
      expect(result.current.selectInstance).toBe(firstRender.selectInstance)
      expect(result.current.selectPart).toBe(firstRender.selectPart)
      expect(result.current.clearPartSelection).toBe(firstRender.clearPartSelection)
      expect(result.current.clear).toBe(firstRender.clear)
    })
  })
})
