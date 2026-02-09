/**
 * @typedef {Object} PartTweak
 * @property {string} name - Part name (from userData.parts key or object.name)
 * @property {'group' | 'mesh'} type - Part type
 * @property {[number, number, number]} [position] - Position offset
 * @property {[number, number, number]} [rotation] - Rotation in degrees
 * @property {[number, number, number]} [scale] - Scale factors
 * @property {[number, number, number]} [pivotPosition] - Override pivot position (default: computed from geometry)
 * @property {PartAnimConfig} [animConfig] - Per-part animation parameters
 */

/**
 * @typedef {Object} PartAnimConfig
 * @property {number} [amplitude] - Animation amplitude multiplier (0-2, default 1)
 * @property {number} [frequency] - Animation frequency multiplier (0.1-3, default 1)
 * @property {boolean} [enabled] - Whether animation is enabled for this part (default true)
 */

/**
 * @typedef {Object} WorldMeta
 * @property {string} id - Unique world identifier
 * @property {string} name - Display name
 * @property {string} created - ISO timestamp
 * @property {number} version - Schema version
 * @property {string} [thumbnail] - Base64 encoded thumbnail
 */

/**
 * @typedef {'grass' | 'desert' | 'snow' | 'forest' | 'volcanic'} BiomeType
 */

/**
 * @typedef {Object} TerrainData
 * @property {BiomeType} biome - Current biome
 * @property {number[][]} heightmap - GRID_SIZE x GRID_SIZE grid of elevation values
 * @property {number[][]} texturemap - GRID_SIZE x GRID_SIZE grid of texture indices (overrides)
 */

/**
 * @typedef {Object} PlayerSpawn
 * @property {[number, number, number]} position - [x, y, z] spawn location
 * @property {string} character - Character preset ID
 */

/**
 * @typedef {'idle' | 'wander'} BehaviorType
 */

/**
 * @typedef {Object} NPCBehavior
 * @property {BehaviorType} type - Behavior mode
 * @property {number} [radius] - Wander radius (for 'wander' type)
 */

/**
 * @typedef {Object} DialogueChoice
 * @property {string} text - Choice text shown to player
 * @property {string} next - Node ID to jump to (null = end)
 */

/**
 * @typedef {Object} DialogueNode
 * @property {'npc'} type - Node type
 * @property {string} text - NPC dialogue text
 * @property {DialogueChoice[]} [choices] - Player response options
 * @property {string} [next] - Next node ID (for linear progression)
 */

/**
 * @typedef {Object} DialogueData
 * @property {Object.<string, DialogueNode>} nodes - Node ID -> Node data
 * @property {string} startNode - ID of starting node
 */

/**
 * @typedef {Object} AssetInstance
 * @property {string} instanceId - Unique instance ID
 * @property {string} libraryId - Reference to library asset
 * @property {[number, number, number]} position - [x, y, z]
 * @property {number} rotation - Y-axis rotation in radians
 * @property {number} scale - Uniform scale
 * @property {NPCBehavior} [behavior] - NPC behavior config (NPCs only)
 * @property {DialogueData} [dialogue] - Dialogue tree (NPCs only)
 */

/**
 * @typedef {'characters' | 'creatures' | 'buildings' | 'props' | 'nature' | 'vehicles'} AssetCategory
 */

/**
 * @typedef {Object} EditHistoryEntry
 * @property {string} timestamp - ISO 8601 timestamp
 * @property {'text'|'sketch'} type - Type of edit
 * @property {string} prompt - User's modification prompt
 * @property {Object} previousSchema - Full schema before this edit (for rollback)
 */

/**
 * @typedef {Object} LibraryAsset
 * @property {string} id - Unique asset ID
 * @property {string} name - Display name
 * @property {AssetCategory} category - Asset category
 * @property {string} generatedCode - Three.js code that creates the asset
 * @property {string} [thumbnail] - Base64 encoded thumbnail
 * @property {number} [thumbnailVersion] - Thumbnail generation method version
 * @property {string[]} [tags] - Searchable tags
 * @property {boolean} [isWalkingCharacter] - Whether this is a biped with walk animation
 * @property {number} [preferredScale] - Suggested placement scale factor
 * @property {string} [originalPrompt] - Original user prompt that generated this asset
 * @property {Object} [v3Schema] - v3 schema used to compile generatedCode (for editing)
 * @property {string} [variantOf] - ID of parent library asset (if this is a variant)
 * @property {string} [variantDescription] - Human-readable description of variant changes
 * @property {EditHistoryEntry[]} [editHistory] - Edit history for undo support (max 10 entries)
 */

/**
 * @typedef {Object} WorldData
 * @property {WorldMeta} meta - World metadata
 * @property {TerrainData} terrain - Terrain configuration
 * @property {PlayerSpawn} playerSpawn - Player spawn point
 * @property {AssetInstance[]} placedAssets - Placed asset instances
 * @property {LibraryAsset[]} library - Asset library
 */

// Re-export from constants for backward compatibility
export { GRID_SIZE, TILE_SIZE, WORLD_SIZE } from './constants'

export const BIOMES = ['grass', 'desert', 'snow', 'forest', 'volcanic']

export const ASSET_CATEGORIES = [
  'characters',
  'creatures',
  'buildings',
  'props',
  'nature',
  'vehicles'
]

export const PLAYER_CHARACTERS = [
  'knight',
  'wizard',
  'explorer',
  'robot',
  'fairy',
  'casual'
]
