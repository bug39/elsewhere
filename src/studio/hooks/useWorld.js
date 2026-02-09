import { useState, useCallback, useRef, useEffect, useMemo } from 'preact/hooks'
import { saveWorld, loadWorld, generateId } from '../state/storage'
import { showToast } from '../components/Toast'
import { GRID_SIZE, TILE_SIZE, WORLD_SIZE } from '../../shared/constants'

const MAX_UNDO_LEVELS = 50

/**
 * Operation types for delta-based undo/redo
 */
const OP_TYPE = {
  TERRAIN_HEIGHT: 'terrain_height',
  TERRAIN_HEIGHT_BATCH: 'terrain_height_batch', // Coalesced terrain operations
  TERRAIN_TEXTURE: 'terrain_texture',
  TERRAIN_TEXTURE_BATCH: 'terrain_texture_batch', // Coalesced texture operations
  TERRAIN_BIOME: 'terrain_biome',
  INSTANCE_ADD: 'instance_add',
  INSTANCE_UPDATE: 'instance_update',
  INSTANCE_DELETE: 'instance_delete',
  LIBRARY_ADD: 'library_add',
  LIBRARY_REMOVE: 'library_remove',
  LIBRARY_UPDATE: 'library_update', // Update library asset fields (schema, code, etc.)
  // Scene generation batch operations
  SCENE_BATCH: 'scene_batch', // Combined terrain + assets as single undo unit
  INSTANCE_ADD_BATCH: 'instance_add_batch', // Multiple instances at once
  LIBRARY_ADD_BATCH: 'library_add_batch' // Multiple library assets at once
}

// Time window for coalescing terrain operations (ms)
const TERRAIN_COALESCE_WINDOW = 500

/**
 * Check if an asset is an NPC (character or creature)
 * @param {Object} asset - Library asset
 * @returns {boolean}
 */
const isNPCAsset = (asset) =>
  asset?.category === 'characters' || asset?.category === 'creatures'

/**
 * Create a standard instance object with NPC fields populated appropriately
 * @param {string} instanceId - Unique instance ID
 * @param {string} libraryId - Library asset ID
 * @param {Array} position - [x, y, z] position
 * @param {number} rotation - Y-axis rotation in radians
 * @param {number} scale - Scale factor
 * @param {Object} asset - Library asset (to check if NPC)
 * @param {Object} [behaviorOverride] - Optional behavior config for NPCs
 * @returns {Object} Instance object
 */
const createInstanceObject = (instanceId, libraryId, position, rotation, scale, asset, behaviorOverride = null, customProps = {}) => ({
  instanceId,
  libraryId,
  position,
  rotation,
  scale,
  behavior: isNPCAsset(asset) ? (behaviorOverride || { type: 'idle' }) : null,
  dialogue: isNPCAsset(asset) ? { nodes: {}, startNode: null } : null,
  // Preserve custom properties from scene generation (e.g., _structureId for refinement matching)
  ...customProps
})

/**
 * Get human-readable description for an operation
 */
function getOperationDescription(op, data) {
  switch (op.type) {
    case OP_TYPE.INSTANCE_ADD:
      return op.instance?.assetName || 'Added asset'
    case OP_TYPE.INSTANCE_UPDATE:
      if (op.newValues?.position) return 'Moved asset'
      if (op.newValues?.rotation) return 'Rotated asset'
      if (op.newValues?.scale) return 'Scaled asset'
      return 'Updated asset'
    case OP_TYPE.INSTANCE_DELETE:
      return op.instance?.assetName ? `Deleted ${op.instance.assetName}` : 'Deleted asset'
    case OP_TYPE.TERRAIN_HEIGHT:
    case OP_TYPE.TERRAIN_HEIGHT_BATCH:
      return 'Painted terrain height'
    case OP_TYPE.TERRAIN_TEXTURE:
    case OP_TYPE.TERRAIN_TEXTURE_BATCH:
      return 'Painted terrain texture'
    case OP_TYPE.TERRAIN_BIOME:
      return 'Changed biome'
    case OP_TYPE.LIBRARY_ADD:
      return `Added ${op.asset?.name || 'asset'} to library`
    case OP_TYPE.LIBRARY_REMOVE:
      return `Removed ${op.asset?.name || 'asset'} from library`
    case OP_TYPE.LIBRARY_UPDATE:
      return `Modified ${op.assetName || 'asset'}`
    case OP_TYPE.SCENE_BATCH:
      return 'Generated scene'
    case OP_TYPE.INSTANCE_ADD_BATCH:
      return `Placed ${op.instances?.length || 0} assets`
    case OP_TYPE.LIBRARY_ADD_BATCH:
      return `Added ${op.assets?.length || 0} assets to library`
    default:
      return 'Edit'
  }
}

/**
 * Create empty terrain data
 */
function createEmptyTerrain(biome) {
  return {
    biome,
    heightmap: Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0)),
    texturemap: Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0))
  }
}

/**
 * Create a new world with default data
 */
function createNewWorld(name, biome) {
  const id = generateId('world')
  return {
    meta: {
      id,
      name,
      created: new Date().toISOString(),
      version: 1
    },
    terrain: createEmptyTerrain(biome),
    playerSpawn: {
      position: [WORLD_SIZE / 2, 0, WORLD_SIZE / 2], // Center of world
      character: 'explorer'
    },
    placedAssets: [],
    library: []
  }
}

/**
 * Apply an operation to world data (forward direction)
 */
function applyOperation(data, op) {
  switch (op.type) {
    case OP_TYPE.TERRAIN_HEIGHT: {
      const newHeightmap = data.terrain.heightmap.map((row, z) =>
        z === op.z ? row.map((h, x) => x === op.x ? op.newValue : h) : row
      )
      return { ...data, terrain: { ...data.terrain, heightmap: newHeightmap } }
    }

    case OP_TYPE.TERRAIN_HEIGHT_BATCH: {
      // Apply all height changes in the batch
      let newHeightmap = data.terrain.heightmap.map(row => [...row])
      for (const change of op.changes) {
        newHeightmap[change.z][change.x] = change.newValue
      }
      return { ...data, terrain: { ...data.terrain, heightmap: newHeightmap } }
    }

    case OP_TYPE.TERRAIN_TEXTURE_BATCH: {
      // Apply all texture changes in the batch
      let newTexturemap = data.terrain.texturemap.map(row => [...row])
      for (const change of op.changes) {
        newTexturemap[change.z][change.x] = change.newValue
      }
      return { ...data, terrain: { ...data.terrain, texturemap: newTexturemap } }
    }

    case OP_TYPE.TERRAIN_TEXTURE: {
      const newTexturemap = data.terrain.texturemap.map((row, z) =>
        z === op.z ? row.map((t, x) => x === op.x ? op.newValue : t) : row
      )
      return { ...data, terrain: { ...data.terrain, texturemap: newTexturemap } }
    }

    case OP_TYPE.TERRAIN_BIOME:
      return { ...data, terrain: { ...data.terrain, biome: op.newValue } }

    case OP_TYPE.INSTANCE_ADD:
      return { ...data, placedAssets: [...data.placedAssets, op.instance] }

    case OP_TYPE.INSTANCE_UPDATE:
      return {
        ...data,
        placedAssets: data.placedAssets.map(inst =>
          inst.instanceId === op.instanceId ? { ...inst, ...op.newValues } : inst
        )
      }

    case OP_TYPE.INSTANCE_DELETE:
      return { ...data, placedAssets: data.placedAssets.filter(inst => inst.instanceId !== op.instanceId) }

    case OP_TYPE.LIBRARY_ADD:
      return { ...data, library: [...data.library, op.asset] }

    case OP_TYPE.LIBRARY_REMOVE:
      return {
        ...data,
        library: data.library.filter(a => a.id !== op.assetId),
        placedAssets: data.placedAssets.filter(a => a.libraryId !== op.assetId)
      }

    case OP_TYPE.LIBRARY_UPDATE:
      return {
        ...data,
        library: data.library.map(asset =>
          asset.id === op.assetId ? { ...asset, ...op.newValues } : asset
        )
      }

    case OP_TYPE.INSTANCE_ADD_BATCH:
      return { ...data, placedAssets: [...data.placedAssets, ...op.instances] }

    case OP_TYPE.LIBRARY_ADD_BATCH:
      return { ...data, library: [...data.library, ...op.assets] }

    case OP_TYPE.SCENE_BATCH: {
      // Apply all scene changes: terrain modifications, library assets, and instances
      let result = { ...data }

      // Apply terrain biome change if present
      if (op.terrain?.biome) {
        result = { ...result, terrain: { ...result.terrain, biome: op.terrain.biome } }
      }

      // Apply terrain height changes
      if (op.terrain?.heightChanges?.length > 0) {
        let newHeightmap = result.terrain.heightmap.map(row => [...row])
        for (const change of op.terrain.heightChanges) {
          newHeightmap[change.z][change.x] = change.newValue
        }
        result = { ...result, terrain: { ...result.terrain, heightmap: newHeightmap } }
      }

      // Add library assets
      if (op.libraryAssets?.length > 0) {
        result = { ...result, library: [...result.library, ...op.libraryAssets] }
      }

      // Add instances
      if (op.instances?.length > 0) {
        result = { ...result, placedAssets: [...result.placedAssets, ...op.instances] }
      }

      return result
    }

    default:
      return data
  }
}

/**
 * Apply an operation in reverse (for undo)
 */
function reverseOperation(data, op) {
  switch (op.type) {
    case OP_TYPE.TERRAIN_HEIGHT: {
      const newHeightmap = data.terrain.heightmap.map((row, z) =>
        z === op.z ? row.map((h, x) => x === op.x ? op.oldValue : h) : row
      )
      return { ...data, terrain: { ...data.terrain, heightmap: newHeightmap } }
    }

    case OP_TYPE.TERRAIN_HEIGHT_BATCH: {
      // Reverse all height changes in the batch
      let newHeightmap = data.terrain.heightmap.map(row => [...row])
      for (const change of op.changes) {
        newHeightmap[change.z][change.x] = change.oldValue
      }
      return { ...data, terrain: { ...data.terrain, heightmap: newHeightmap } }
    }

    case OP_TYPE.TERRAIN_TEXTURE: {
      const newTexturemap = data.terrain.texturemap.map((row, z) =>
        z === op.z ? row.map((t, x) => x === op.x ? op.oldValue : t) : row
      )
      return { ...data, terrain: { ...data.terrain, texturemap: newTexturemap } }
    }

    case OP_TYPE.TERRAIN_TEXTURE_BATCH: {
      // Reverse all texture changes in the batch
      let newTexturemap = data.terrain.texturemap.map(row => [...row])
      for (const change of op.changes) {
        newTexturemap[change.z][change.x] = change.oldValue
      }
      return { ...data, terrain: { ...data.terrain, texturemap: newTexturemap } }
    }

    case OP_TYPE.TERRAIN_BIOME:
      return { ...data, terrain: { ...data.terrain, biome: op.oldValue } }

    case OP_TYPE.INSTANCE_ADD:
      return { ...data, placedAssets: data.placedAssets.filter(inst => inst.instanceId !== op.instance.instanceId) }

    case OP_TYPE.INSTANCE_UPDATE:
      return {
        ...data,
        placedAssets: data.placedAssets.map(inst =>
          inst.instanceId === op.instanceId ? { ...inst, ...op.oldValues } : inst
        )
      }

    case OP_TYPE.INSTANCE_DELETE:
      return { ...data, placedAssets: [...data.placedAssets, op.instance] }

    case OP_TYPE.LIBRARY_ADD:
      return { ...data, library: data.library.filter(a => a.id !== op.asset.id) }

    case OP_TYPE.LIBRARY_REMOVE:
      return {
        ...data,
        library: [...data.library, op.asset],
        placedAssets: [...data.placedAssets, ...op.removedInstances]
      }

    case OP_TYPE.LIBRARY_UPDATE:
      return {
        ...data,
        library: data.library.map(asset =>
          asset.id === op.assetId ? { ...asset, ...op.oldValues } : asset
        )
      }

    case OP_TYPE.INSTANCE_ADD_BATCH: {
      const instanceIds = new Set(op.instances.map(i => i.instanceId))
      return { ...data, placedAssets: data.placedAssets.filter(i => !instanceIds.has(i.instanceId)) }
    }

    case OP_TYPE.LIBRARY_ADD_BATCH: {
      const assetIds = new Set(op.assets.map(a => a.id))
      return { ...data, library: data.library.filter(a => !assetIds.has(a.id)) }
    }

    case OP_TYPE.SCENE_BATCH: {
      // Reverse all scene changes
      let result = { ...data }

      // Remove instances
      if (op.instances?.length > 0) {
        const instanceIds = new Set(op.instances.map(i => i.instanceId))
        result = { ...result, placedAssets: result.placedAssets.filter(i => !instanceIds.has(i.instanceId)) }
      }

      // Remove library assets
      if (op.libraryAssets?.length > 0) {
        const assetIds = new Set(op.libraryAssets.map(a => a.id))
        result = { ...result, library: result.library.filter(a => !assetIds.has(a.id)) }
      }

      // Reverse terrain height changes
      if (op.terrain?.heightChanges?.length > 0) {
        let newHeightmap = result.terrain.heightmap.map(row => [...row])
        for (const change of op.terrain.heightChanges) {
          newHeightmap[change.z][change.x] = change.oldValue
        }
        result = { ...result, terrain: { ...result.terrain, heightmap: newHeightmap } }
      }

      // Restore original biome
      if (op.terrain?.oldBiome) {
        result = { ...result, terrain: { ...result.terrain, biome: op.terrain.oldBiome } }
      }

      return result
    }

    default:
      return data
  }
}

/**
 * Hook for managing world state with delta-based undo/redo
 */
export function useWorld() {
  const [data, setData] = useState(null)
  const [isDirty, setIsDirty] = useState(false)
  const [undoCount, setUndoCount] = useState(0)
  const [redoCount, setRedoCount] = useState(0)
  const undoStack = useRef([]) // Array of operations
  const redoStack = useRef([]) // Array of operations
  const autoSaveTimer = useRef(null)
  const editVersion = useRef(0) // Tracks edit version for save race condition fix
  const lastTerrainOpTime = useRef(0) // For coalescing terrain operations

  const pushOperation = useCallback((op) => {
    undoStack.current.push(op)
    if (undoStack.current.length > MAX_UNDO_LEVELS) {
      undoStack.current.shift()
    }
    redoStack.current = []
    setUndoCount(undoStack.current.length)
    setRedoCount(0)
  }, [])

  const create = useCallback((name, biome) => {
    const newWorld = createNewWorld(name, biome)
    setData(newWorld)
    editVersion.current++
    setIsDirty(true)
    undoStack.current = []
    redoStack.current = []
    setUndoCount(0)
    setRedoCount(0)
    return newWorld.meta.id
  }, [])

  const load = useCallback(async (worldId) => {
    const result = await loadWorld(worldId)
    if (result.success) {
      setData(result.data)
      setIsDirty(false)
      undoStack.current = []
      redoStack.current = []
      setUndoCount(0)
      setRedoCount(0)
      return result.data
    } else {
      showToast(result.error || 'Failed to load world', 'error', 5000)
      return null
    }
  }, [])

  const save = useCallback(async () => {
    if (!data) return { success: false, error: 'No world data to save' }
    // Capture version at save start to detect mid-save edits
    const versionAtSaveStart = editVersion.current
    const result = await saveWorld(data)
    if (result.success && versionAtSaveStart === editVersion.current) {
      // Only clear dirty flag if no edits occurred during save
      setIsDirty(false)
    }
    // P2-PS02 FIX: Surface storage quota warning to user
    if (result.warning) {
      showToast(result.warning, 'error', 8000)
    }
    return result
  }, [data])

  // C4 FIX: Use ref to avoid restarting timer when save function changes
  // The save function identity changes on every render due to its dependency on data,
  // which was causing the timer to restart on every edit
  const saveRef = useRef(save)
  const dirtyRef = useRef(isDirty)
  useEffect(() => {
    saveRef.current = save
  }, [save])
  useEffect(() => {
    dirtyRef.current = isDirty
  }, [isDirty])

  // Auto-save every 60 seconds when dirty
  useEffect(() => {
    if (!isDirty || !data) return
    autoSaveTimer.current = setInterval(async () => {
      if (!dirtyRef.current) return
      const result = await saveRef.current()
      if (!result.success) {
        showToast('Auto-save failed. Please save manually.', 'error', 5000)
      }
    }, 60000)
    return () => {
      if (autoSaveTimer.current) {
        clearInterval(autoSaveTimer.current)
        autoSaveTimer.current = null
      }
    }
  }, [isDirty])  // C4 FIX: Removed save/data from dependencies

  const updateTerrain = useCallback((updates) => {
    setData(prev => {
      if (!prev) return prev
      // For bulk terrain updates, just apply directly (no undo)
      const newData = {
        ...prev,
        terrain: { ...prev.terrain, ...updates }
      }
      editVersion.current++
      setIsDirty(true)
      return newData
    })
  }, [])

  const updateWorldName = useCallback((name) => {
    setData(prev => {
      if (!prev) return prev
      const newData = {
        ...prev,
        meta: { ...prev.meta, name }
      }
      editVersion.current++
      setIsDirty(true)
      return newData
    })
  }, [])

  // Factory for terrain modification functions (height and texture use identical coalescing logic)
  const createTerrainModifier = useCallback((mapKey, batchOpType, singleOpType) => {
    return (x, z, newValue) => {
      setData(prev => {
        if (!prev) return prev
        const oldValue = prev.terrain[mapKey][z]?.[x] ?? 0
        if (oldValue === newValue) return prev

        const now = Date.now()
        const lastOp = undoStack.current[undoStack.current.length - 1]
        const timeSinceLastOp = now - lastTerrainOpTime.current

        // Check if we should coalesce with the previous operation
        if (timeSinceLastOp < TERRAIN_COALESCE_WINDOW && lastOp?.type === batchOpType) {
          // P1-004 FIX: Clone operation before modifying to prevent undo history corruption
          const clonedOp = {
            ...lastOp,
            changes: lastOp.changes.map(c => ({ ...c }))
          }

          const existingChangeIdx = clonedOp.changes.findIndex(c => c.x === x && c.z === z)
          if (existingChangeIdx >= 0) {
            clonedOp.changes[existingChangeIdx] = {
              ...clonedOp.changes[existingChangeIdx],
              newValue
            }
          } else {
            clonedOp.changes.push({ x, z, oldValue, newValue })
          }

          // Replace the last operation with cloned version
          undoStack.current[undoStack.current.length - 1] = clonedOp

          lastTerrainOpTime.current = now
          editVersion.current++
          setIsDirty(true)
          redoStack.current = []
          setRedoCount(0)
          return applyOperation(prev, { type: singleOpType, x, z, newValue })
        }

        // Start a new batch operation
        const op = { type: batchOpType, changes: [{ x, z, oldValue, newValue }] }
        lastTerrainOpTime.current = now
        pushOperation(op)
        editVersion.current++
        setIsDirty(true)
        return applyOperation(prev, { type: singleOpType, x, z, newValue })
      })
    }
  }, [pushOperation])

  const setTerrainHeight = useMemo(
    () => createTerrainModifier('heightmap', OP_TYPE.TERRAIN_HEIGHT_BATCH, OP_TYPE.TERRAIN_HEIGHT),
    [createTerrainModifier]
  )
  const setTerrainTexture = useMemo(
    () => createTerrainModifier('texturemap', OP_TYPE.TERRAIN_TEXTURE_BATCH, OP_TYPE.TERRAIN_TEXTURE),
    [createTerrainModifier]
  )

  const addLibraryAsset = useCallback((asset) => {
    setData(prev => {
      if (!prev) return prev
      const op = {
        type: OP_TYPE.LIBRARY_ADD,
        asset
      }
      pushOperation(op)
      editVersion.current++
      setIsDirty(true)
      return applyOperation(prev, op)
    })
  }, [pushOperation])

  const removeLibraryAsset = useCallback((assetId) => {
    setData(prev => {
      if (!prev) return prev
      const asset = prev.library.find(a => a.id === assetId)
      const removedInstances = prev.placedAssets.filter(a => a.libraryId === assetId)

      const op = {
        type: OP_TYPE.LIBRARY_REMOVE,
        assetId,
        asset, // Store for undo
        removedInstances // Store removed instances for undo
      }
      pushOperation(op)
      editVersion.current++
      setIsDirty(true)
      return applyOperation(prev, op)
    })
  }, [pushOperation])

  const placeInstance = useCallback((libraryId, position, rotation = 0, scale = 10) => {
    setData(prev => {
      if (!prev) return prev
      const instanceId = generateId('inst')
      const libraryAsset = prev.library.find(a => a.id === libraryId)
      const instance = createInstanceObject(instanceId, libraryId, position, rotation, scale, libraryAsset)

      const op = {
        type: OP_TYPE.INSTANCE_ADD,
        instance
      }
      pushOperation(op)
      editVersion.current++
      setIsDirty(true)
      return applyOperation(prev, op)
    })
  }, [pushOperation])

  const updateInstance = useCallback((instanceId, updates) => {
    setData(prev => {
      if (!prev) return prev
      const currentInstance = prev.placedAssets.find(inst => inst.instanceId === instanceId)
      if (!currentInstance) return prev

      // Compute old values for the fields being updated
      const oldValues = {}
      for (const key of Object.keys(updates)) {
        oldValues[key] = currentInstance[key]
      }

      const op = {
        type: OP_TYPE.INSTANCE_UPDATE,
        instanceId,
        oldValues,
        newValues: updates
      }
      pushOperation(op)
      editVersion.current++
      setIsDirty(true)
      return applyOperation(prev, op)
    })
  }, [pushOperation])

  const deleteInstance = useCallback((instanceId) => {
    setData(prev => {
      if (!prev) return prev
      const instance = prev.placedAssets.find(inst => inst.instanceId === instanceId)
      if (!instance) return prev

      const op = {
        type: OP_TYPE.INSTANCE_DELETE,
        instanceId,
        instance // Store for undo
      }
      pushOperation(op)
      editVersion.current++
      setIsDirty(true)
      return applyOperation(prev, op)
    })
  }, [pushOperation])

  /**
   * Update a library asset with new field values (v3Schema, generatedCode, thumbnail, etc.)
   * Used by text and sketch editing to save modifications.
   */
  const updateLibraryAsset = useCallback((assetId, updates) => {
    setData(prev => {
      if (!prev) return prev
      const asset = prev.library.find(a => a.id === assetId)
      if (!asset) return prev

      // Build old values for undo - only include fields being updated
      const oldValues = {}
      for (const key of Object.keys(updates)) {
        oldValues[key] = asset[key] !== undefined ? structuredClone(asset[key]) : undefined
      }

      const op = {
        type: OP_TYPE.LIBRARY_UPDATE,
        assetId,
        assetName: asset.name,
        oldValues,
        newValues: structuredClone(updates)
      }
      pushOperation(op)
      editVersion.current++
      setIsDirty(true)
      return applyOperation(prev, op)
    })
  }, [pushOperation])

  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return

    setData(prev => {
      if (!prev) return prev
      const op = undoStack.current.pop()
      redoStack.current.push(op)
      setUndoCount(undoStack.current.length)
      setRedoCount(redoStack.current.length)
      editVersion.current++
      setIsDirty(true)
      return reverseOperation(prev, op)
    })
  }, [])

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return

    setData(prev => {
      if (!prev) return prev
      const op = redoStack.current.pop()
      undoStack.current.push(op)
      setUndoCount(undoStack.current.length)
      setRedoCount(redoStack.current.length)
      editVersion.current++
      setIsDirty(true)
      return applyOperation(prev, op)
    })
  }, [])

  /**
   * Place multiple instances at once (single undo operation)
   * @param {Array} placements - Array of {libraryId, position, rotation, scale}
   * @returns {Array} Array of created instance IDs
   */
  const batchPlaceInstances = useCallback((placements) => {
    const instanceIds = []

    setData(prev => {
      if (!prev) return prev

      const instances = placements.map(p => {
        const instanceId = generateId('inst')
        instanceIds.push(instanceId)
        const libraryAsset = prev.library.find(a => a.id === p.libraryId)
        const behaviorOverride = { type: p.behavior || 'idle', wanderRadius: p.wanderRadius }
        return createInstanceObject(instanceId, p.libraryId, p.position, p.rotation || 0, p.scale || 10, libraryAsset, behaviorOverride)
      })

      const op = {
        type: OP_TYPE.INSTANCE_ADD_BATCH,
        instances
      }
      pushOperation(op)
      editVersion.current++
      setIsDirty(true)
      return applyOperation(prev, op)
    })

    return instanceIds
  }, [pushOperation])

  /**
   * Add multiple library assets at once (single undo operation)
   * @param {Array} assets - Array of library asset objects
   */
  const batchAddLibraryAssets = useCallback((assets) => {
    setData(prev => {
      if (!prev) return prev

      const op = {
        type: OP_TYPE.LIBRARY_ADD_BATCH,
        assets
      }
      pushOperation(op)
      editVersion.current++
      setIsDirty(true)
      return applyOperation(prev, op)
    })
  }, [pushOperation])

  /**
   * Execute a complete scene plan as a single undoable operation
   * This includes terrain changes, library assets, and instance placements
   *
   * @param {Object} plan - Scene plan with terrain, libraryAssets, and instances
   * @returns {Object} Result with created instanceIds
   */
  const executeScenePlan = useCallback((plan) => {
    const result = { instanceIds: [] }

    setData(prev => {
      if (!prev) return prev

      // Build the scene batch operation
      const op = {
        type: OP_TYPE.SCENE_BATCH,
        terrain: null,
        libraryAssets: plan.libraryAssets || [],
        instances: []
      }

      // Handle terrain changes
      if (plan.terrain) {
        op.terrain = {
          oldBiome: prev.terrain.biome,
          biome: plan.terrain.biome || prev.terrain.biome,
          heightChanges: []
        }

        // Apply terrain modifications and record changes
        if (plan.terrain.heightChanges) {
          op.terrain.heightChanges = plan.terrain.heightChanges.map(change => ({
            x: change.x,
            z: change.z,
            oldValue: prev.terrain.heightmap[change.z]?.[change.x] ?? 0,
            newValue: change.newValue
          }))
        }
      }

      // Create instances from placements
      if (plan.placements) {
        op.instances = plan.placements.map(p => {
          const instanceId = generateId('inst')
          result.instanceIds.push(instanceId)
          const libraryAsset = [...prev.library, ...(plan.libraryAssets || [])].find(a => a.id === p.libraryId)
          const behaviorOverride = { type: p.behavior || 'idle', wanderRadius: p.wanderRadius }
          // Extract custom properties (e.g., _structureId, _type) for scene generation refinement
          const { libraryId, position, rotation, scale, behavior, wanderRadius, ...customProps } = p
          return createInstanceObject(instanceId, p.libraryId, p.position, p.rotation || 0, p.scale || 10, libraryAsset, behaviorOverride, customProps)
        })
      }

      pushOperation(op)
      editVersion.current++
      setIsDirty(true)
      return applyOperation(prev, op)
    })

    return result
  }, [pushOperation])

  /**
   * Modify terrain heights in batch (single undo operation)
   * @param {Array} changes - Array of {x, z, height} changes
   */
  const batchTerrainModify = useCallback((changes) => {
    setData(prev => {
      if (!prev) return prev

      const op = {
        type: OP_TYPE.TERRAIN_HEIGHT_BATCH,
        changes: changes.map(c => ({
          x: c.x,
          z: c.z,
          oldValue: prev.terrain.heightmap[c.z]?.[c.x] ?? 0,
          newValue: c.height
        }))
      }

      pushOperation(op)
      editVersion.current++
      setIsDirty(true)
      return applyOperation(prev, op)
    })
  }, [pushOperation])

  /**
   * Set the terrain biome (single undo operation)
   * @param {string} biome - New biome identifier
   */
  const setTerrainBiome = useCallback((biome) => {
    setData(prev => {
      if (!prev) return prev
      if (prev.terrain.biome === biome) return prev

      const op = {
        type: OP_TYPE.TERRAIN_BIOME,
        oldValue: prev.terrain.biome,
        newValue: biome
      }

      pushOperation(op)
      editVersion.current++
      setIsDirty(true)
      return applyOperation(prev, op)
    })
  }, [pushOperation])

  /**
   * Get the last N undo operations with descriptions
   * @param {number} count - Number of items to return (default 5)
   * @returns {Array} Array of { index, description, timestamp }
   */
  const getUndoHistory = useCallback((count = 5) => {
    return undoStack.current.slice(-count).reverse().map((op, i) => ({
      index: undoStack.current.length - 1 - i,
      description: getOperationDescription(op, data),
      timestamp: op.timestamp || Date.now()
    }))
  }, [data])

  return {
    data,
    isDirty,
    create,
    load,
    save,
    updateWorldName,
    updateTerrain,
    setTerrainHeight,
    setTerrainTexture,
    setTerrainBiome,
    addLibraryAsset,
    removeLibraryAsset,
    updateLibraryAsset,
    placeInstance,
    updateInstance,
    deleteInstance,
    // Batch operations for scene generation
    batchPlaceInstances,
    batchAddLibraryAssets,
    batchTerrainModify,
    executeScenePlan,
    undo,
    redo,
    canUndo: undoCount > 0,
    canRedo: redoCount > 0,
    undoCount,
    maxUndoLevels: MAX_UNDO_LEVELS,
    getUndoHistory
  }
}
