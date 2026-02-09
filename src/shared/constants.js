// Grid and world dimensions
export const GRID_SIZE = 40
export const TILE_SIZE = 10
export const WORLD_SIZE = GRID_SIZE * TILE_SIZE // 400m

/**
 * Scene generation uses nearly the full world area.
 * 380m × 380m zone (144,400m²) - 95% of world for maximum spread.
 * Leave 10m margin on each edge to avoid assets being cut off at boundaries.
 */
export const SCENE_GENERATION = {
  // Scene zone size in meters (38 tiles × 38 tiles)
  SIZE: 380,

  // Scene center (middle of world)
  CENTER_X: WORLD_SIZE / 2,  // 200
  CENTER_Z: WORLD_SIZE / 2,  // 200

  // Derived bounds (computed for convenience)
  get MIN_X() { return this.CENTER_X - this.SIZE / 2 },  // 10 for 380m zone
  get MAX_X() { return this.CENTER_X + this.SIZE / 2 },  // 390 for 380m zone
  get MIN_Z() { return this.CENTER_Z - this.SIZE / 2 },  // 10 for 380m zone
  get MAX_Z() { return this.CENTER_Z + this.SIZE / 2 },  // 390 for 380m zone

  // Recommended spacing for this zone size
  MIN_SPACING: 5,   // 5m minimum between assets
  IDEAL_SPACING: 10, // 10m for good density with larger zone
}

// Instance scale limits (for placed assets)
export const INSTANCE_SCALE = {
  min: 1,
  max: 200
}

// Biome definitions
export const BIOMES = {
  grass: {
    id: 'grass',
    label: 'Grassland',
    colors: {
      primary: 0x4ade80,    // Green grass
      secondary: 0x92400e,  // Brown dirt
      tertiary: 0x6b7280,   // Grey rock
    },
    sky: [0x87ceeb, 0xf0f8ff],
    fog: 0xc8e6ff
  },
  desert: {
    id: 'desert',
    label: 'Desert',
    colors: {
      primary: 0xfbbf24,    // Sand
      secondary: 0xdc2626,  // Red rock
      tertiary: 0x374151,   // Dark stone
    },
    sky: [0xfde68a, 0xfef3c7],
    fog: 0xfef3c7
  },
  snow: {
    id: 'snow',
    label: 'Snow',
    colors: {
      primary: 0xf8fafc,    // White snow
      secondary: 0x93c5fd,  // Ice blue
      tertiary: 0x1f2937,   // Dark rock
    },
    sky: [0xe0f2fe, 0xf8fafc],
    fog: 0xe0f2fe
  },
  forest: {
    id: 'forest',
    label: 'Forest',
    colors: {
      primary: 0x166534,    // Dark grass
      secondary: 0x365314,  // Moss
      tertiary: 0x57534e,   // Stone
    },
    sky: [0x6b8e6b, 0xa8d5a8],
    fog: 0x8fbc8f
  },
  volcanic: {
    id: 'volcanic',
    label: 'Volcanic',
    colors: {
      primary: 0x1f2937,    // Black rock
      secondary: 0xea580c,  // Orange lava glow
      tertiary: 0x6b7280,   // Ash grey
    },
    sky: [0x4b5563, 0x1f2937],
    fog: 0x374151
  }
}

// Asset categories
export const ASSET_CATEGORIES = [
  { id: 'characters', label: 'Characters', icon: '👤', description: 'Humanoid/biped NPCs' },
  { id: 'creatures', label: 'Creatures', icon: '🐉', description: 'Non-biped animated beings' },
  { id: 'buildings', label: 'Buildings', icon: '🏠', description: 'Static structures' },
  { id: 'props', label: 'Props', icon: '📦', description: 'Small objects' },
  { id: 'nature', label: 'Nature', icon: '🌲', description: 'Trees, rocks, plants' },
  { id: 'vehicles', label: 'Vehicles', icon: '🚗', description: 'Cars, boats, etc.' }
]

/**
 * @deprecated Use UNIVERSAL_BASELINE from sizeInvariants.js instead.
 *
 * Legacy baseline sizes (in meters) for asset normalization by category.
 * These are no longer used for normalization - all assets now normalize
 * to 2 units max dimension (UNIVERSAL_BASELINE).
 *
 * MIGRATION NOTE:
 * - AssetMeshFactory now uses universal 2-unit normalization
 * - sizeInvariants.js uses UNIVERSAL_BASELINE for scale computation
 * - The judge-based evaluation system handles relative sizing visually
 *
 * This constant is kept for:
 * 1. SIZE_INVARIANTS default sizes (category-specific defaults when no size specified)
 * 2. Potential future use in category-specific heuristics
 */
export const CATEGORY_BASELINES = {
  props: 0.5,        // Small items (flowers, pots, signs)
  characters: 1.8,   // Human-sized figures
  creatures: 1.2,    // Animals (varies widely)
  nature: 3.0,       // Trees, bushes (moderate tree)
  buildings: 5.0,    // Structures (small cottage baseline)
  vehicles: 3.0      // Cars, carts, boats
}

/**
 * Size invariants for scene generation.
 * These enforce hard limits that make impossible sizes mathematically unachievable.
 *
 * The intent-based sizing system:
 * - AI specifies realWorldSize in meters (intuitive: "12m tree")
 * - System computes scale = realWorldSize / baseline (deterministic)
 * - Invariants clamp values to safe ranges (enforced)
 */
export const SIZE_INVARIANTS = {
  // Absolute limits - nothing outside this range
  MAX_ASSET_SIZE: 50,    // Nothing larger than 50m
  MIN_ASSET_SIZE: 0.1,   // Nothing smaller than 0.1m

  // Scene-wide proportion check
  MAX_SIZE_RATIO: 100,   // Largest asset ≤ 100× smallest

  // Default sizes when AI provides invalid/missing values (meters)
  DEFAULT_SIZES: {
    props: 0.8,
    characters: 1.8,
    creatures: 1.0,
    nature: 8.0,
    buildings: 8.0,
    vehicles: 3.0
  },

  // Maximum allowed size per category
  MAX_CATEGORY_SIZES: {
    props: 5,         // Props shouldn't exceed 5m
    characters: 4,    // Humanoids up to 4m (giant)
    creatures: 10,    // Creatures up to 10m (dragon)
    nature: 40,       // Trees up to 40m (redwood)
    buildings: 50,    // Buildings up to 50m (tower)
    vehicles: 20      // Vehicles up to 20m (ship)
  }
}

// Player character presets
export const PLAYER_CHARACTERS = [
  { id: 'knight', label: 'Knight', description: 'Fantasy armored warrior' },
  { id: 'wizard', label: 'Wizard', description: 'Robes and staff' },
  { id: 'explorer', label: 'Explorer', description: 'Adventurer with backpack' },
  { id: 'robot', label: 'Robot', description: 'Chunky sci-fi mechanical' },
  { id: 'fairy', label: 'Fairy', description: 'Small with wings' },
  { id: 'casual', label: 'Casual', description: 'Modern clothes' }
]

// NPC behavior types
export const NPC_BEHAVIORS = [
  { id: 'idle', label: 'Idle', description: 'Stand in place' },
  { id: 'wander', label: 'Wander', description: 'Move randomly within radius' }
]

// Editor tools
export const EDITOR_TOOLS = [
  { id: 'select', icon: '⬚', label: 'Select', shortcut: 'V' },
  { id: 'place', icon: '📍', label: 'Place', shortcut: 'P' },
  { id: 'paint', icon: '🖌️', label: 'Paint', shortcut: 'B' },
  { id: 'terrain', icon: '⛰️', label: 'Terrain', shortcut: 'T' },
  { id: 'delete', icon: '🗑️', label: 'Delete', shortcut: 'X' }
]

// Physics constants
export const PHYSICS = {
  gravity: -9.8,
  walkSpeed: 5,
  runSpeed: 10,
  jumpForce: 8
}

// Camera defaults
export const CAMERA = {
  fov: 60,
  near: 0.1,
  far: 3000,
  defaultDistance: 150,
  minDistance: 5,    // Reduced from 20 to allow close-up work in tight spaces
  maxDistance: 600
}

// Render quality presets
export const RENDER_QUALITY = {
  high: { postProcessing: true },
  low: { postProcessing: false }
}

// Lighting presets for different moods
export const LIGHTING_PRESETS = {
  standard: {
    id: 'standard',
    label: 'Standard',
    // Strong sun for highlights, high ambient + fill to keep shadows readable
    ambient: { intensity: 1.0 },
    sun: { color: 0xffffff, intensity: 2.5, offset: [80, 100, 40] },
    fill: { color: 0xaaccff, intensity: 0.8, offset: [-60, 50, -60] }
  },
  dramatic: {
    id: 'dramatic',
    label: 'Dramatic',
    ambient: { intensity: 0.6 },
    hemisphere: { skyColor: 0x445566, groundColor: 0x222222, intensity: 0.3 },
    sun: { color: 0xffeedd, intensity: 2.5, offset: [80, 100, 40] },
    fill: { color: 0x334455, intensity: 0.3, offset: [-60, 40, -60] },
    rim: { color: 0xffeedd, intensity: 0.5, offset: [0, 80, -100] }
  },
  soft: {
    id: 'soft',
    label: 'Soft',
    ambient: { intensity: 1.6 },
    hemisphere: { skyColor: 0xaaccff, groundColor: 0x778877, intensity: 0.9 },
    sun: { color: 0xffffff, intensity: 0.8, offset: [0, 200, 0] },
    fill: { color: 0xffffff, intensity: 0.6, offset: [-50, 80, 50] },
    rim: { color: 0xccddff, intensity: 0.3, offset: [0, 120, -80] }
  },
  moody: {
    id: 'moody',
    label: 'Moody',
    ambient: { intensity: 0.8 },
    hemisphere: { skyColor: 0x4466aa, groundColor: 0x334455, intensity: 0.4 },
    sun: { color: 0xccddff, intensity: 1.8, offset: [30, 80, 100] },
    fill: { color: 0x6677aa, intensity: 0.4, offset: [-70, 60, -40] },
    rim: { color: 0x8899cc, intensity: 0.4, offset: [0, 90, -100] }
  }
}

// Shadow quality settings
export const SHADOW_QUALITY = {
  low: { mapSize: 1024 },
  high: { mapSize: 2048 },
  ultra: { mapSize: 4096 }
}

/**
 * Animation archetype presets for different asset types.
 * Used by the compiler to generate appropriate animation code.
 */
export const ANIMATION_ARCHETYPES = {
  biped: {
    bodyAnim: {
      bob: { amplitude: 0.03, frequency: 2 },  // 2x walk frequency
      sway: { amplitude: 0.02 }
    },
    legAnim: { swing: { amplitude: 0.4 } },
    armAnim: { swing: { amplitude: 0.3, phaseOffset: Math.PI } }  // Opposite phase
  },

  quadruped: {
    bodyAnim: {
      bob: { amplitude: 0.02, frequency: 4 }  // 4x for faster cadence
    },
    legAnim: { swing: { amplitude: 0.35 } },
    // Diagonal gait: front-left + back-right move together
    legPhaseMap: [0, Math.PI, Math.PI, 0]  // FL, FR, BL, BR
  },

  plant: {
    bodyAnim: {
      sway: { amplitude: 0.03, frequency: 0.5 }  // Slow trunk sway
    },
    branchAnim: {
      sway: { amplitude: 0.08, frequency: 0.7 }  // Faster branch sway
    },
    leafAnim: {
      sway: { amplitude: 0.05, frequency: 1.5 }  // Fastest leaf flutter
    }
  },

  prop: {
    // Props can have simple idle animations
    styles: ['spin', 'bob', 'sway']
  },

  effect: {
    // Effects preserve LLM-generated animation code
    preserveLLMCode: true
  }
}

