/**
 * System prompts for asset code generation
 *
 * Main prompts (loaded from ./prompts/ to reduce source file size):
 * - ASSET_SYSTEM_PROMPT - v3 code generation
 * - PLANNING_SYSTEM_PROMPT - v3 planning
 * - ASSET_SYSTEM_PROMPT_V4 - v4 schema-driven code
 * - PLANNING_SYSTEM_PROMPT_V4 - v4 schema-driven planning
 * - ASSET_SYSTEM_PROMPT_V4_BRIGHT - v4 with color guidance
 */

// Import prompts from external files (reduces source token count by ~3,000)
import {
  ASSET_SYSTEM_PROMPT,
  PLANNING_SYSTEM_PROMPT,
  ASSET_SYSTEM_PROMPT_V4,
  PLANNING_SYSTEM_PROMPT_V4,
  ASSET_SYSTEM_PROMPT_V4_BRIGHT
} from './prompts/index.js'

// Re-export prompts for backward compatibility
export {
  ASSET_SYSTEM_PROMPT,
  PLANNING_SYSTEM_PROMPT,
  ASSET_SYSTEM_PROMPT_V4,
  PLANNING_SYSTEM_PROMPT_V4,
  ASSET_SYSTEM_PROMPT_V4_BRIGHT
}

// Category-specific material palettes for vibrant, consistent colors
export const CATEGORY_PALETTES = {
  character: {
    skin: ['0xFFDBAC', '0xE8BEAC', '0xC68642', '0x8D5524'],
    hair: ['0x2C1810', '0x4A3728', '0x8B4513', '0xDAA520', '0xF5DEB3'],
    fabric: ['0x4169E1', '0xDC143C', '0x228B22', '0x9932CC', '0xFF8C00'],
    metal: ['0xB8B8B8', '0xD4AF37', '0xCD7F32', '0x708090'],
    leather: ['0x8B4513', '0xA0522D', '0x6B4423', '0x3D2314']
  },
  creature: {
    scales: ['0x228B22', '0x2E8B57', '0x006400', '0x4B0082', '0x800080'],
    fur: ['0x8B4513', '0xD2691E', '0xF5F5DC', '0x2F4F4F', '0xFF6347'],
    eyes: ['0xFFD700', '0xFF4500', '0x00FF00', '0xFF0000', '0x00FFFF'],
    claws: ['0x1C1C1C', '0x696969', '0xFFFFF0'],
    wings: ['0x4B0082', '0x8B0000', '0x2F4F4F', '0xDAA520']
  },
  building: {
    stone: ['0x808080', '0xA9A9A9', '0xBEBEBE', '0x696969'],
    wood: ['0x8B6914', '0xA0522D', '0xCD853F', '0xDEB887'],
    roof: ['0x8B0000', '0x2F4F4F', '0x8B4513', '0x4A4A4A'],
    trim: ['0xF5F5DC', '0xFFFFE0', '0xFAF0E6'],
    door: ['0x654321', '0x8B4513', '0x4169E1']
  },
  nature: {
    bark: ['0x5D4E37', '0x6B4423', '0x8B4513', '0x3D2314'],
    leaves: ['0x228B22', '0x32CD32', '0x006400', '0x9ACD32', '0x6B8E23'],
    flowers: ['0xFF69B4', '0xFF1493', '0xFFD700', '0xFF4500', '0x9370DB'],
    rock: ['0x696969', '0x808080', '0xA9A9A9', '0x556B2F'],
    crystal: ['0x00CED1', '0x9370DB', '0xFF69B4', '0x00FF7F', '0xFFD700']
  },
  prop: {
    metal: ['0x708090', '0x778899', '0xB8B8B8', '0xD4AF37', '0xCD7F32'],
    wood: ['0x8B6914', '0xA0522D', '0xCD853F', '0xDEB887'],
    fabric: ['0xDC143C', '0x4169E1', '0x228B22', '0xFFD700', '0x9932CC'],
    glass: ['0x87CEEB', '0xADD8E6', '0xB0E0E6'],
    ceramic: ['0xFFFFF0', '0xF5F5DC', '0x4169E1', '0x228B22']
  },
  vehicle: {
    body: ['0xDC143C', '0x4169E1', '0x228B22', '0xFFD700', '0x2F4F4F'],
    metal: ['0x708090', '0x778899', '0xB8B8B8', '0xC0C0C0'],
    wheel: ['0x1C1C1C', '0x2F2F2F', '0x696969'],
    window: ['0x87CEEB', '0xADD8E6'],
    accent: ['0xFFFFFF', '0xFF4500', '0xFFD700']
  }
}

// Proportion guidelines per category
export const CATEGORY_PROPORTIONS = {
  character: {
    height: 1.6,
    headRatio: 0.2,      // Head is ~20% of total height
    shoulderWidth: 0.4,
    legRatio: 0.5,       // Legs are ~50% of height
    armLength: 0.6,      // Arms reach mid-thigh
    notes: 'Stylized proportions. Head slightly larger than realistic.'
  },
  creature: {
    height: 1.0,
    bodyRatio: 0.6,
    headRatio: 0.25,
    limbScale: 'varies by type',
    notes: 'Exaggerate defining features (wings, claws, horns). Keep silhouette readable.'
  },
  building: {
    height: 2.0,
    wallThickness: 0.1,
    doorHeight: 0.8,
    windowRatio: 0.3,
    roofOverhang: 0.1,
    notes: 'Slightly cartoonish proportions. Chunky walls, exaggerated roof.'
  },
  nature: {
    treeHeight: 1.8,
    trunkRatio: 0.15,    // Trunk width vs height
    canopyRatio: 0.6,    // Canopy is 60% of height
    rockMaxDim: 1.0,
    notes: 'Organic shapes. Use LatheGeometry for trunks, spheres for foliage.'
  },
  prop: {
    maxDimension: 1.0,
    handleRatio: 0.3,
    notes: 'Consistent scale. Props should feel hand-holdable or furniture-sized.'
  },
  vehicle: {
    wheelRadius: 0.15,
    bodyHeight: 0.5,
    length: 1.5,
    notes: 'Low-poly, chunky wheels. Simplified cabin/cockpit.'
  }
}
