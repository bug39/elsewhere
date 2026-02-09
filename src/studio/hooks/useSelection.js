import { useState, useCallback } from 'preact/hooks'

/**
 * Hook for managing selection state in the editor
 * Uses single state object to reduce render passes (1 vs 3)
 */
export function useSelection() {
  // Batched state: single object instead of 3 separate useState calls
  const [selection, setSelection] = useState({
    libraryAssetId: null,
    instanceId: null,
    partName: null,
    selectionType: null // 'library' | 'instance' | 'part'
  })

  const selectLibraryAsset = useCallback((assetId) => {
    setSelection({
      libraryAssetId: assetId,
      instanceId: null,
      partName: null,
      selectionType: 'library'
    })
  }, [])

  const selectInstance = useCallback((instId) => {
    setSelection({
      libraryAssetId: null,
      instanceId: instId,
      partName: null,
      selectionType: 'instance'
    })
  }, [])

  const selectPart = useCallback((instId, partName) => {
    setSelection({
      libraryAssetId: null,
      instanceId: instId,
      partName: partName,
      selectionType: 'part'
    })
  }, [])

  const clearPartSelection = useCallback(() => {
    setSelection(prev => {
      if (prev.partName) {
        return {
          ...prev,
          partName: null,
          selectionType: prev.instanceId ? 'instance' : null
        }
      }
      return prev
    })
  }, [])

  const clear = useCallback(() => {
    setSelection({
      libraryAssetId: null,
      instanceId: null,
      partName: null,
      selectionType: null
    })
  }, [])

  return {
    libraryAssetId: selection.libraryAssetId,
    instanceId: selection.instanceId,
    partName: selection.partName,
    selectionType: selection.selectionType,
    selectLibraryAsset,
    selectInstance,
    selectPart,
    clearPartSelection,
    clear
  }
}
