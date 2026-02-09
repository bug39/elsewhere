import { get, set, del, keys } from 'idb-keyval'
import { normalizeWorldTransforms } from '../../shared/transforms'
import { validateWorldSchema, checkStorageQuota } from '../../shared/validation'
import { GRID_SIZE, TILE_SIZE } from '../../shared/constants'

const WORLDS_PREFIX = 'thinq-world-'
const WORLDS_INDEX_KEY = 'thinq-worlds-index'

// Legacy grid size for migration detection
const LEGACY_GRID_SIZE = 20

/**
 * Migrate legacy world data from 20x20 grid to current GRID_SIZE
 * Centers the old terrain and offsets all placed assets accordingly
 * @param {Object} worldData - World data that may need migration
 * @returns {Object} Migrated world data
 */
function migrateWorldData(worldData) {
  if (!worldData?.terrain?.heightmap) return worldData

  const currentSize = worldData.terrain.heightmap.length

  // Already at current grid size, no migration needed
  if (currentSize === GRID_SIZE) return worldData

  // Not a legacy 20x20 grid, don't migrate (unknown format)
  if (currentSize !== LEGACY_GRID_SIZE) {
    console.warn(`[Migration] Unknown heightmap size ${currentSize}, skipping migration`)
    return worldData
  }

  console.log(`[Migration] Migrating world from ${LEGACY_GRID_SIZE}x${LEGACY_GRID_SIZE} to ${GRID_SIZE}x${GRID_SIZE}`)

  // Calculate offset (in tiles) to center old terrain in new grid
  const tileOffset = (GRID_SIZE - LEGACY_GRID_SIZE) / 2
  const positionOffset = tileOffset * TILE_SIZE // Convert to world units (meters)

  // Create new heightmap filled with zeros
  const newHeightmap = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0))

  // Copy old heightmap data to center of new heightmap
  for (let z = 0; z < LEGACY_GRID_SIZE; z++) {
    for (let x = 0; x < LEGACY_GRID_SIZE; x++) {
      newHeightmap[z + tileOffset][x + tileOffset] = worldData.terrain.heightmap[z][x]
    }
  }

  // Create new texturemap if it exists
  let newTexturemap = null
  if (worldData.terrain.texturemap) {
    newTexturemap = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0))
    for (let z = 0; z < LEGACY_GRID_SIZE; z++) {
      for (let x = 0; x < LEGACY_GRID_SIZE; x++) {
        newTexturemap[z + tileOffset][x + tileOffset] = worldData.terrain.texturemap[z][x]
      }
    }
  }

  // Offset all placed asset positions
  const migratedAssets = (worldData.placedAssets || []).map(asset => ({
    ...asset,
    position: [
      asset.position[0] + positionOffset,
      asset.position[1],
      asset.position[2] + positionOffset
    ]
  }))

  // Offset player spawn position
  const migratedSpawn = worldData.playerSpawn ? {
    ...worldData.playerSpawn,
    position: [
      worldData.playerSpawn.position[0] + positionOffset,
      worldData.playerSpawn.position[1],
      worldData.playerSpawn.position[2] + positionOffset
    ]
  } : worldData.playerSpawn

  return {
    ...worldData,
    terrain: {
      ...worldData.terrain,
      heightmap: newHeightmap,
      texturemap: newTexturemap || worldData.terrain.texturemap
    },
    placedAssets: migratedAssets,
    playerSpawn: migratedSpawn
  }
}

/**
 * @typedef {Object} CreationStats
 * @property {number} worlds - Total number of worlds
 * @property {number} assets - Total unique assets across all libraries
 * @property {number} instances - Total placed asset instances
 * @property {number} npcs - Total NPCs (characters/creatures with behaviors)
 */

/**
 * List all saved worlds (metadata only)
 */
export async function listWorlds() {
  try {
    const index = await get(WORLDS_INDEX_KEY) || []
    return index
  } catch (err) {
    console.error('Failed to list worlds:', err)
    return []
  }
}

/**
 * Save a world to IndexedDB
 * @returns {{ success: boolean, error?: string, warning?: string }}
 */
export async function saveWorld(worldData) {
  try {
    // D2 FIX: Check storage quota before saving
    const quotaInfo = await checkStorageQuota()
    let warning = null
    if (quotaInfo.warning) {
      warning = `Storage is ${quotaInfo.percentUsed.toFixed(0)}% full. Consider exporting worlds.`
      console.warn('[Storage]', warning)
    }

    const worldId = worldData.meta.id
    const key = WORLDS_PREFIX + worldId

    // Save the full world data
    await set(key, worldData)

    // Update the index with metadata
    const index = await get(WORLDS_INDEX_KEY) || []
    const existingIdx = index.findIndex(w => w.id === worldId)

    const metadata = {
      id: worldId,
      name: worldData.meta.name,
      created: worldData.meta.created,
      modified: new Date().toISOString(),
      thumbnail: worldData.meta.thumbnail || null
    }

    if (existingIdx >= 0) {
      index[existingIdx] = metadata
    } else {
      index.push(metadata)
    }

    await set(WORLDS_INDEX_KEY, index)
    return { success: true, warning }
  } catch (err) {
    console.error('Failed to save world:', err)
    return { success: false, error: err.message || 'Failed to save world' }
  }
}

/**
 * Load a world by ID
 * @returns {{ success: boolean, data?: object, error?: string }}
 */
export async function loadWorld(worldId) {
  try {
    const key = WORLDS_PREFIX + worldId
    const data = await get(key)
    if (!data) {
      return { success: false, error: 'World not found' }
    }

    // S4 FIX: Validate schema before returning
    const validation = validateWorldSchema(data)
    if (!validation.valid) {
      console.warn('[Storage] World schema validation failed:', validation.errors)
      // Still return the data but log warnings - don't block loading of partially valid worlds
    }

    // Track if migration occurred
    let migrationPerformed = false

    // Migrate legacy 20x20 worlds to current grid size
    const migratedData = migrateWorldData(data)
    if (migratedData !== data) {
      migrationPerformed = true
    }

    // Migrate library thumbnails to v2 (fixed camera distance formula)
    if (migratedData.library) {
      for (const asset of migratedData.library) {
        if (asset.thumbnail && !asset.thumbnailVersion) {
          asset.thumbnail = null  // Will regenerate on next library view
          asset.thumbnailVersion = 2
          migrationPerformed = true
        }
      }
    }

    // Normalize legacy array transforms to scalars
    const finalData = normalizeWorldTransforms(migratedData)

    // P2-PS03 FIX: Persist migrations so they don't re-run on every load
    if (migrationPerformed) {
      console.log('[Storage] Migration performed, persisting changes')
      // Save without waiting - fire-and-forget to not slow down load
      saveWorld(finalData).catch(err => {
        console.warn('[Storage] Failed to persist migration:', err)
      })
    }

    return { success: true, data: finalData }
  } catch (err) {
    console.error('Failed to load world:', err)
    return { success: false, error: err.message || 'Failed to load world' }
  }
}

/**
 * Delete a world by ID
 */
export async function deleteWorld(worldId) {
  try {
    const key = WORLDS_PREFIX + worldId
    await del(key)

    // Update the index
    const index = await get(WORLDS_INDEX_KEY) || []
    const filtered = index.filter(w => w.id !== worldId)
    await set(WORLDS_INDEX_KEY, filtered)

    return true
  } catch (err) {
    console.error('Failed to delete world:', err)
    return false
  }
}

/**
 * Generate a unique ID
 */
export function generateId(prefix = '') {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return prefix ? `${prefix}_${timestamp}${random}` : `${timestamp}${random}`
}

/**
 * Export world data as JSON file download
 */
export function exportWorldAsJSON(worldData) {
  const exportData = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    world: worldData
  }
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${worldData.meta.name.replace(/[^a-z0-9]/gi, '_')}.thinq.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Import world from JSON file
 */
export async function importWorldFromJSON(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result)
        if (!data.world?.meta || !data.world?.terrain) {
          throw new Error('Invalid world file format')
        }

        // S4 FIX: Validate schema of imported world
        const validation = validateWorldSchema(data.world)
        if (!validation.valid) {
          console.warn('[Storage] Imported world schema validation warnings:', validation.errors)
        }

        // Migrate legacy worlds and normalize transforms
        const migratedWorld = migrateWorldData(data.world)
        const normalizedWorld = normalizeWorldTransforms(migratedWorld)
        const newWorld = {
          ...normalizedWorld,
          meta: {
            ...normalizedWorld.meta,
            id: generateId('world'),
            name: normalizedWorld.meta.name + ' (imported)',
            created: new Date().toISOString()
          }
        }
        // C11 FIX: saveWorld returns {success, error?}, not boolean
        const result = await saveWorld(newWorld)
        if (!result.success) throw new Error(result.error || 'Failed to save imported world')
        resolve(newWorld)
      } catch (err) { reject(err) }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

/**
 * P1-005 FIX: Recover worlds that were saved but not indexed
 * This can happen if the browser closes between saving world data and updating the index.
 * Should be called during app initialization before loading the queue.
 * @returns {Promise<void>}
 */
export async function recoverOrphanedWorlds() {
  try {
    const allKeys = await keys()
    const worldKeys = allKeys.filter(k =>
      typeof k === 'string' &&
      k.startsWith(WORLDS_PREFIX) &&
      !k.endsWith('-pending')
    )

    const index = await get(WORLDS_INDEX_KEY) || []
    const indexedIds = new Set(index.map(w => w.id))
    let modified = false

    for (const key of worldKeys) {
      const worldId = key.replace(WORLDS_PREFIX, '')
      if (!indexedIds.has(worldId)) {
        const worldData = await get(key)
        if (worldData?.meta) {
          console.log('[Storage] Recovering orphaned world:', worldId, worldData.meta.name)
          index.push({
            id: worldId,
            name: worldData.meta.name || 'Recovered World',
            created: worldData.meta.created || new Date().toISOString(),
            modified: new Date().toISOString(),
            thumbnail: worldData.meta.thumbnail || null
          })
          modified = true
        }
      }
    }

    if (modified) {
      await set(WORLDS_INDEX_KEY, index)
      console.log('[Storage] World index updated with recovered worlds')
    }
  } catch (err) {
    console.error('[Storage] Recovery failed:', err)
  }
}

/**
 * Get aggregate creation statistics across all worlds
 * @returns {Promise<CreationStats>}
 */
export async function getCreationStats() {
  try {
    const index = await get(WORLDS_INDEX_KEY) || []
    const worldCount = index.length

    let totalAssets = 0
    let totalInstances = 0
    let totalNPCs = 0

    // Load all worlds in parallel (significantly faster than serial)
    const worldResults = await Promise.all(
      index.map(meta => loadWorld(meta.id))
    )

    for (const result of worldResults) {
      if (result.success && result.data) {
        totalAssets += result.data.library?.length || 0
        totalInstances += result.data.placedAssets?.length || 0

        // Count NPCs (characters/creatures that are placed)
        for (const inst of result.data.placedAssets || []) {
          const asset = result.data.library?.find(a => a.id === inst.libraryId)
          if (asset && (asset.category === 'characters' || asset.category === 'creatures')) {
            totalNPCs++
          }
        }
      }
    }

    return {
      worlds: worldCount,
      assets: totalAssets,
      instances: totalInstances,
      npcs: totalNPCs
    }
  } catch (err) {
    console.error('Failed to get creation stats:', err)
    return { worlds: 0, assets: 0, instances: 0, npcs: 0 }
  }
}
