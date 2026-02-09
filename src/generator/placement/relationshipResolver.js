/**
 * Relationship-aware placement system
 *
 * Resolves spatial relationships between scene elements:
 * - Structures positioned relative to each other
 * - Decorations attached to/adjacent to structures
 * - Arrangements of grouped objects
 * - Atmosphere elements scattered with constraints
 * - NPCs positioned near structures/arrangements
 */

import { SCENE_GENERATION } from '../../shared/constants'
import {
  checkRectangularCollision,
  poissonDiskSampling,
  clusterPlacement,
  ringPlacement,
  gridPlacement
} from './samplingAlgorithms'
import { backgroundPlacement, leadingLinePlacement } from './compositionPlacement'
import { GAME_SCALE_FACTOR } from '../sizeInvariants'

/**
 * Calculate collision radius from asset specification.
 * Uses realWorldSize if available, otherwise derives from scale.
 * Returns half the footprint size (radius, not diameter).
 *
 * @param {Object} asset - Asset with realWorldSize or scale
 * @returns {number} Collision radius in meters
 */
function getCollisionRadius(asset) {
  if (asset.realWorldSize && asset.realWorldSize > 0) {
    // realWorldSize is the max dimension in meters - use half as radius
    return asset.realWorldSize / 2
  }
  if (asset.scale && asset.scale > 0) {
    // scale = (realWorldSize / 2) * GAME_SCALE_FACTOR
    // So realWorldSize = (scale / GAME_SCALE_FACTOR) * 2
    // And radius = realWorldSize / 2 = scale / GAME_SCALE_FACTOR
    return asset.scale / GAME_SCALE_FACTOR
  }
  // Fallback: assume 1m radius
  return 1
}

/**
 * Convert facing keyword to angle in radians
 * @param {string} facing - Facing direction keyword
 * @returns {number} Rotation angle in radians
 */
export function facingToAngle(facing) {
  const FACING_MAP = {
    north: Math.PI,
    south: 0,
    east: -Math.PI / 2,
    west: Math.PI / 2,
    toward_camera: Math.PI * 0.15
  }
  return FACING_MAP[facing] || FACING_MAP.south
}

/**
 * StructureRegistry - Stores placed structures with positions and bounds for relationship resolution
 */
export class StructureRegistry {
  constructor() {
    this.structures = new Map()
    this.arrangements = new Map()
  }

  /**
   * Register a structure with its world position and bounds
   * @param {string} id - Structure ID
   * @param {Object} info - Structure information
   */
  register(id, info) {
    this.structures.set(id, {
      id,
      position: info.position,
      rotation: info.rotation || 0,
      bounds: info.bounds || { width: 10, height: 10, depth: 10 },
      category: info.category || 'buildings'
    })
  }

  /**
   * Get a structure by ID
   * @param {string} id - Structure ID
   * @returns {Object|null} Structure info or null
   */
  get(id) {
    return this.structures.get(id) || null
  }

  /**
   * Get surface position on a structure
   * @param {string} targetId - Target structure ID
   * @param {string} surface - Surface name (front, back, left, right, roof)
   * @param {number} horizontal - 0-1 position across surface width (0=left, 1=right when facing surface)
   * @param {number} vertical - 0-1 position up surface height
   * @returns {Object|null} Position {x, y, z, rotation} or null
   */
  getSurfacePosition(targetId, surface, horizontal = 0.5, vertical = 0.5) {
    const struct = this.structures.get(targetId)
    if (!struct) return null

    const { position, rotation, bounds } = struct
    const { width, height, depth } = bounds

    // For a structure facing south (rotation=0):
    // - front surface is at +Z, lateral is along X
    // - back surface is at -Z, lateral is along X
    // - left surface is at -X, lateral is along Z
    // - right surface is at +X, lateral is along Z

    const cosR = Math.cos(rotation)
    const sinR = Math.sin(rotation)

    let normalAngle = rotation
    let surfaceOffsetX = 0
    let surfaceOffsetZ = 0
    let lateralOffsetX = 0
    let lateralOffsetZ = 0

    // Calculate lateral offset in local space (before rotation)
    const h = horizontal - 0.5 // -0.5 to 0.5

    switch (surface) {
      case 'front':
        normalAngle = rotation
        // Surface center is at front (+Z in local), lateral along X
        surfaceOffsetZ = depth / 2
        lateralOffsetX = h * width
        break
      case 'back':
        normalAngle = rotation + Math.PI
        surfaceOffsetZ = -depth / 2
        lateralOffsetX = -h * width // Flip for back
        break
      case 'left':
        normalAngle = rotation - Math.PI / 2
        surfaceOffsetX = -width / 2
        lateralOffsetZ = h * depth
        break
      case 'right':
        normalAngle = rotation + Math.PI / 2
        surfaceOffsetX = width / 2
        lateralOffsetZ = -h * depth // Flip for right
        break
      case 'roof':
      case 'top':
        return {
          x: position.x + (horizontal - 0.5) * width * cosR,
          y: height,
          z: position.z + (horizontal - 0.5) * width * sinR,
          rotation: rotation
        }
      default:
        normalAngle = rotation
        surfaceOffsetZ = depth / 2
        lateralOffsetX = h * width
    }

    // Rotate all offsets by structure rotation
    const totalLocalX = surfaceOffsetX + lateralOffsetX
    const totalLocalZ = surfaceOffsetZ + lateralOffsetZ

    const worldX = position.x + totalLocalX * cosR - totalLocalZ * sinR
    const worldZ = position.z + totalLocalX * sinR + totalLocalZ * cosR

    return {
      x: worldX,
      y: vertical * height,
      z: worldZ,
      rotation: normalAngle
    }
  }

  /**
   * Get position adjacent to a structure
   * @param {string} targetId - Target structure ID
   * @param {string} side - Side (front, back, left, right)
   * @param {number} distance - Distance from structure edge
   * @returns {Object|null} Position {x, z, rotation} or null
   */
  getAdjacentPosition(targetId, side, distance = 5) {
    const struct = this.structures.get(targetId)
    if (!struct) return null

    const { position, rotation, bounds } = struct
    const { width, depth } = bounds

    let offsetX = 0
    let offsetZ = 0
    let faceAngle = rotation

    switch (side) {
      case 'front':
        offsetZ = depth / 2 + distance
        faceAngle = rotation + Math.PI
        break
      case 'back':
        offsetZ = -(depth / 2 + distance)
        faceAngle = rotation
        break
      case 'left':
        offsetX = -(width / 2 + distance)
        faceAngle = rotation + Math.PI / 2
        break
      case 'right':
        offsetX = width / 2 + distance
        faceAngle = rotation - Math.PI / 2
        break
      case 'entrance':
        offsetZ = depth / 2 + distance
        faceAngle = rotation + Math.PI
        break
      default:
        offsetZ = depth / 2 + distance
        faceAngle = rotation + Math.PI
    }

    // Rotate offset by structure rotation
    const cosR = Math.cos(rotation)
    const sinR = Math.sin(rotation)
    const worldX = position.x + offsetX * cosR - offsetZ * sinR
    const worldZ = position.z + offsetX * sinR + offsetZ * cosR

    return { x: worldX, z: worldZ, rotation: faceAngle }
  }

  /**
   * Register an arrangement for NPC references
   */
  registerArrangement(name, info) {
    this.arrangements.set(name, info)
  }

  /**
   * Get an arrangement by name
   */
  getArrangement(name) {
    return this.arrangements.get(name) || null
  }
}

/**
 * Convert structure placement to world coordinates
 * @param {Object} placement - Placement specification
 * @param {StructureRegistry} registry - Registry of placed structures
 * @returns {Object} Position {x, y, z, rotation}
 */
export function resolveStructurePlacement(placement, registry) {
  const CENTER = { x: SCENE_GENERATION.CENTER_X, z: SCENE_GENERATION.CENTER_Z }
  const ZONE_SIZE = SCENE_GENERATION.SIZE
  const ZONE_MIN = SCENE_GENERATION.MIN_X + 10  // 10m inset from zone edge
  const ZONE_MAX = SCENE_GENERATION.MAX_X - 10  // 10m inset from zone edge

  // V2 explicit coordinates: placement.position = { explicit: [x, z] }
  if (placement.position?.explicit) {
    const [px, pz] = placement.position.explicit
    // Clamp to zone bounds for safety
    const x = Math.max(ZONE_MIN, Math.min(ZONE_MAX, px))
    const z = Math.max(ZONE_MIN, Math.min(ZONE_MAX, pz))
    const rotation = facingToAngle(placement.facing || 'south')
    console.log(`[Resolver] V2 explicit position: [${px}, ${pz}] → clamped (${x.toFixed(0)}, ${z.toFixed(0)})`)
    return { x, y: 0, z, rotation }
  }

  // Position keywords to coordinates - spread across full zone (±45% = ±171m with 380m zone)
  const POSITION_MAP = {
    center: { x: CENTER.x, z: CENTER.z },
    north:  { x: CENTER.x, z: CENTER.z - ZONE_SIZE * 0.45 },
    south:  { x: CENTER.x, z: CENTER.z + ZONE_SIZE * 0.45 },
    east:   { x: CENTER.x + ZONE_SIZE * 0.45, z: CENTER.z },
    west:   { x: CENTER.x - ZONE_SIZE * 0.45, z: CENTER.z },
    NE:     { x: CENTER.x + ZONE_SIZE * 0.4, z: CENTER.z - ZONE_SIZE * 0.4 },
    NW:     { x: CENTER.x - ZONE_SIZE * 0.4, z: CENTER.z - ZONE_SIZE * 0.4 },
    SE:     { x: CENTER.x + ZONE_SIZE * 0.4, z: CENTER.z + ZONE_SIZE * 0.4 },
    SW:     { x: CENTER.x - ZONE_SIZE * 0.4, z: CENTER.z + ZONE_SIZE * 0.4 }
  }

  let x, z

  if (placement.relative_to) {
    // Position relative to another structure
    const target = registry.get(placement.relative_to)
    if (target) {
      const side = placement.side || 'front'
      const distance = placement.distance || 15
      const adjacent = registry.getAdjacentPosition(placement.relative_to, side, distance)
      x = adjacent.x
      z = adjacent.z
    } else {
      x = CENTER.x
      z = CENTER.z
    }
  } else {
    // Position by keyword
    const posKey = (placement.position || 'center').toUpperCase === 'center' ? 'center' : placement.position
    const pos = POSITION_MAP[posKey] || POSITION_MAP.center
    x = pos.x
    z = pos.z
  }

  const rotation = facingToAngle(placement.facing || 'south')

  return { x, y: 0, z, rotation }
}

/**
 * Resolve decoration relationship to world positions
 * @param {Object} decoration - Decoration specification
 * @param {StructureRegistry} registry - Registry of placed structures
 * @returns {Array<Object>} Array of positions {x, y, z, rotation}
 */
export function resolveDecorationRelationship(decoration, registry) {
  const { relationship, count, spacing, mirror, _estimatedBounds } = decoration
  const { type, target, surface, position, offset, side, distance, angle } = relationship
  const positions = []

  const struct = registry.get(target)
  if (!struct) {
    console.warn(`[Resolver] Decoration target "${target}" not found`)
    return positions
  }

  switch (type) {
    case 'attached_to': {
      const horizontal = position?.horizontal ?? 0.5
      const vertical = position?.vertical ?? 0.5
      // Scale default offset by structure size (5% of depth, min 0.1m)
      const baseOffset = 0.1
      const structBasedOffset = Math.max(baseOffset, struct.bounds.depth * 0.05)
      const outOffset = offset?.out ?? structBasedOffset

      if (count === 1 && !mirror) {
        const surfacePos = registry.getSurfacePosition(target, surface || 'front', horizontal, vertical)
        if (surfacePos) {
          positions.push({
            x: surfacePos.x + Math.sin(surfacePos.rotation) * outOffset,
            y: surfacePos.y,
            z: surfacePos.z + Math.cos(surfacePos.rotation) * outOffset,
            rotation: surfacePos.rotation
          })
        }
      } else if (mirror && count === 2) {
        // Symmetric placement
        for (const h of [horizontal, 1 - horizontal]) {
          const surfacePos = registry.getSurfacePosition(target, surface || 'front', h, vertical)
          if (surfacePos) {
            positions.push({
              x: surfacePos.x + Math.sin(surfacePos.rotation) * outOffset,
              y: surfacePos.y,
              z: surfacePos.z + Math.cos(surfacePos.rotation) * outOffset,
              rotation: surfacePos.rotation
            })
          }
        }
      } else {
        // Multiple items with spacing
        const surfaceWidth = (surface === 'front' || surface === 'back')
          ? struct.bounds.width
          : struct.bounds.depth
        const totalWidth = (count - 1) * spacing
        const startH = horizontal - (totalWidth / surfaceWidth) / 2

        for (let i = 0; i < count; i++) {
          const h = startH + (i * spacing / surfaceWidth)
          if (h >= 0 && h <= 1) {
            const surfacePos = registry.getSurfacePosition(target, surface || 'front', h, vertical)
            if (surfacePos) {
              positions.push({
                x: surfacePos.x + Math.sin(surfacePos.rotation) * outOffset,
                y: surfacePos.y,
                z: surfacePos.z + Math.cos(surfacePos.rotation) * outOffset,
                rotation: surfacePos.rotation
              })
            }
          }
        }
      }
      break
    }

    case 'adjacent_to': {
      // Check if horizontal position is specified (from vignette spreading)
      const horizontal = position?.horizontal
      if (horizontal !== undefined && horizontal !== null) {
        // Use surface position with horizontal spread
        const surfacePos = registry.getSurfacePosition(target, side || 'front', horizontal, 0)
        if (surfacePos) {
          const dist = distance || 1
          positions.push({
            x: surfacePos.x + Math.sin(surfacePos.rotation) * dist,
            y: 0,
            z: surfacePos.z + Math.cos(surfacePos.rotation) * dist,
            rotation: surfacePos.rotation + Math.PI  // Face away from building
          })
        }
      } else {
        // Default behavior: adjacent position at side center
        const adjPos = registry.getAdjacentPosition(target, side || 'front', distance || 1)
        if (adjPos) {
          if (count === 1) {
            positions.push({ x: adjPos.x, y: 0, z: adjPos.z, rotation: adjPos.rotation })
          } else {
            // Multiple adjacent items with spacing
            const perpAngle = adjPos.rotation + Math.PI / 2
            const totalWidth = (count - 1) * spacing
            const startOffset = -totalWidth / 2

            for (let i = 0; i < count; i++) {
              const lateralOffset = startOffset + i * spacing
              positions.push({
                x: adjPos.x + Math.cos(perpAngle) * lateralOffset,
                y: 0,
                z: adjPos.z + Math.sin(perpAngle) * lateralOffset,
                rotation: adjPos.rotation
              })
            }
          }
        }
      }
      break
    }

    case 'leaning_against': {
      // Place at base of surface, tilted at angle
      const leanAngle = (angle || 15) * Math.PI / 180
      const surfacePos = registry.getSurfacePosition(target, surface || 'front', position?.horizontal ?? 0.5, 0)

      if (surfacePos) {
        if (count === 1) {
          positions.push({
            x: surfacePos.x + Math.sin(surfacePos.rotation) * 0.3,
            y: 0,
            z: surfacePos.z + Math.cos(surfacePos.rotation) * 0.3,
            rotation: surfacePos.rotation,
            tilt: leanAngle
          })
        } else {
          const surfaceWidth = (surface === 'front' || surface === 'back')
            ? struct.bounds.width
            : struct.bounds.depth
          const totalWidth = (count - 1) * spacing
          const startH = (position?.horizontal ?? 0.5) - (totalWidth / surfaceWidth) / 2

          for (let i = 0; i < count; i++) {
            const h = startH + (i * spacing / surfaceWidth)
            if (h >= 0 && h <= 1) {
              const sp = registry.getSurfacePosition(target, surface || 'front', h, 0)
              if (sp) {
                positions.push({
                  x: sp.x + Math.sin(sp.rotation) * 0.3,
                  y: 0,
                  z: sp.z + Math.cos(sp.rotation) * 0.3,
                  rotation: sp.rotation + (Math.random() - 0.5) * 0.2,
                  tilt: leanAngle
                })
              }
            }
          }
        }
      }
      break
    }

    case 'hanging_from': {
      // Suspended from ceiling/beam
      const drop = offset?.drop || 1
      const surfacePos = registry.getSurfacePosition(target, surface || 'roof', position?.horizontal ?? 0.5, position?.vertical ?? 0.5)
      if (surfacePos) {
        positions.push({
          x: surfacePos.x,
          y: surfacePos.y - drop,
          z: surfacePos.z,
          rotation: surfacePos.rotation
        })
      }
      break
    }

    case 'v2_attachment': {
      // V2 attachment system: anchor + offset + facing
      // anchor: front|back|left|right|top|center|perimeter
      // offset: [forward, sideways] in meters
      // height_ratio: 0-1 for vertical position on walls
      // facing: toward_parent|away|inherit|north|south|east|west|random

      const { anchor, offset: v2Offset, height_ratio, facing: v2Facing } = relationship
      const [forward, sideways] = v2Offset || [0, 0]
      const arrangement = decoration.arrangement || 'single'
      const arrangementSpacing = decoration.spacing || 3

      // Get structure orientation
      const structRotation = struct.rotation || 0

      // height_ratio only applies to wall-mounted items (signs, lights, banners).
      // If the item has a significant forward offset (>1m), it's a ground-level item
      // (tables, benches, planters) and should stay at y=0 regardless of height_ratio.
      const isWallMounted = height_ratio != null && height_ratio > 0 && Math.abs(forward) <= 1
      const effectiveHeight = isWallMounted ? height_ratio * struct.bounds.height : 0

      // Calculate base position based on anchor
      let baseX = struct.position.x
      let baseZ = struct.position.z
      let baseY = 0
      let faceAngle = structRotation

      const halfWidth = struct.bounds.width / 2
      const halfDepth = struct.bounds.depth / 2

      switch (anchor) {
        case 'front':
          baseX += Math.sin(structRotation) * halfDepth
          baseZ += Math.cos(structRotation) * halfDepth
          baseY = effectiveHeight
          faceAngle = structRotation
          break
        case 'back':
          baseX -= Math.sin(structRotation) * halfDepth
          baseZ -= Math.cos(structRotation) * halfDepth
          baseY = effectiveHeight
          faceAngle = structRotation + Math.PI
          break
        case 'left':
          baseX -= Math.cos(structRotation) * halfWidth
          baseZ += Math.sin(structRotation) * halfWidth
          baseY = effectiveHeight
          faceAngle = structRotation - Math.PI / 2
          break
        case 'right':
          baseX += Math.cos(structRotation) * halfWidth
          baseZ -= Math.sin(structRotation) * halfWidth
          baseY = effectiveHeight
          faceAngle = structRotation + Math.PI / 2
          break
        case 'top':
          baseY = struct.bounds.height
          faceAngle = structRotation
          break
        case 'center':
          baseY = struct.bounds.height / 2
          break
        case 'perimeter':
          // Random point on perimeter
          const perimAngle = Math.random() * Math.PI * 2
          baseX += Math.cos(perimAngle) * halfWidth
          baseZ += Math.sin(perimAngle) * halfDepth
          faceAngle = perimAngle
          break
      }

      // Apply offset (forward = along facing direction, sideways = perpendicular)
      const offsetX = Math.sin(faceAngle) * forward + Math.cos(faceAngle) * sideways
      const offsetZ = Math.cos(faceAngle) * forward - Math.sin(faceAngle) * sideways
      baseX += offsetX
      baseZ += offsetZ

      // Calculate final rotation based on facing
      let finalRotation = faceAngle
      switch (v2Facing) {
        case 'toward_parent':
          finalRotation = faceAngle + Math.PI
          break
        case 'away':
          finalRotation = faceAngle
          break
        case 'inherit':
          finalRotation = structRotation
          break
        case 'north':
          finalRotation = 0
          break
        case 'south':
          finalRotation = Math.PI
          break
        case 'east':
          finalRotation = Math.PI / 2
          break
        case 'west':
          finalRotation = -Math.PI / 2
          break
        case 'random':
          finalRotation = Math.random() * Math.PI * 2
          break
      }

      // Generate positions based on arrangement
      if (arrangement === 'single' || count === 1) {
        positions.push({ x: baseX, y: baseY, z: baseZ, rotation: finalRotation })
      } else if (arrangement === 'row') {
        // Spread sideways (perpendicular to forward direction)
        const totalWidth = (count - 1) * arrangementSpacing
        const startOffset = -totalWidth / 2
        for (let i = 0; i < count; i++) {
          const lateralOffset = startOffset + i * arrangementSpacing
          positions.push({
            x: baseX + Math.cos(faceAngle) * lateralOffset,
            y: baseY,
            z: baseZ - Math.sin(faceAngle) * lateralOffset,
            rotation: finalRotation
          })
        }
      } else if (arrangement === 'column') {
        // Spread forward (along forward direction)
        for (let i = 0; i < count; i++) {
          const forwardOffset = i * arrangementSpacing
          positions.push({
            x: baseX + Math.sin(faceAngle) * forwardOffset,
            y: baseY,
            z: baseZ + Math.cos(faceAngle) * forwardOffset,
            rotation: finalRotation
          })
        }
      } else if (arrangement === 'cluster') {
        // Random positions within spacing radius
        for (let i = 0; i < count; i++) {
          const angle = Math.random() * Math.PI * 2
          const dist = Math.random() * arrangementSpacing
          positions.push({
            x: baseX + Math.cos(angle) * dist,
            y: baseY,
            z: baseZ + Math.sin(angle) * dist,
            rotation: v2Facing === 'random' ? Math.random() * Math.PI * 2 : finalRotation
          })
        }
      } else if (arrangement === 'grid') {
        const [cols, rows] = decoration.gridSize || [2, 2]
        const gridWidth = (cols - 1) * arrangementSpacing
        const gridDepth = (rows - 1) * arrangementSpacing
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const localX = (col - (cols - 1) / 2) * arrangementSpacing
            const localZ = (row - (rows - 1) / 2) * arrangementSpacing
            // Rotate local position by face angle
            const worldX = baseX + Math.cos(faceAngle) * localX + Math.sin(faceAngle) * localZ
            const worldZ = baseZ - Math.sin(faceAngle) * localX + Math.cos(faceAngle) * localZ
            positions.push({ x: worldX, y: baseY, z: worldZ, rotation: finalRotation })
          }
        }
      }
      break
    }

    case 'on_top_of': {
      // Stacked on roof/top
      const topPos = registry.getSurfacePosition(target, 'roof', position?.horizontal ?? 0.5, position?.vertical ?? 0.5)
      if (topPos) {
        for (let i = 0; i < count; i++) {
          const jitterX = (Math.random() - 0.5) * 2
          const jitterZ = (Math.random() - 0.5) * 2
          positions.push({
            x: topPos.x + jitterX,
            y: topPos.y + (_estimatedBounds?.height || 1) / 2,
            z: topPos.z + jitterZ,
            rotation: Math.random() * Math.PI * 2
          })
        }
      }
      break
    }

    default:
      console.warn(`[Resolver] Unknown decoration relationship type: ${type}`)
  }

  return positions
}

/**
 * Resolve arrangement to world positions
 * @param {Object} arrangement - Arrangement specification
 * @param {StructureRegistry} registry - Registry of placed structures
 * @param {Map} generatedAssets - Map of prompt -> libraryAsset
 * @returns {Array<Object>} Array of placements
 */
export function resolveArrangement(arrangement, registry, generatedAssets) {
  const { name, placement, pattern, radius, gridSize, items } = arrangement
  const placements = []

  // Calculate group center relative to structure
  let center = { x: SCENE_GENERATION.CENTER_X, z: SCENE_GENERATION.CENTER_Z }

  if (placement.relative_to) {
    const adjPos = registry.getAdjacentPosition(
      placement.relative_to,
      placement.side || 'front',
      placement.distance || 8
    )
    if (adjPos) {
      center = { x: adjPos.x, z: adjPos.z }
    }
  }

  // Collect all items with their counts
  const allItems = []
  for (const item of items) {
    const asset = generatedAssets.get(item.asset.prompt)
    if (!asset) continue
    for (let i = 0; i < (item.count || 1); i++) {
      allItems.push({ item, asset })
    }
  }

  // Generate positions based on pattern
  let positions = []
  const effectiveRadius = radius || 5
  const itemCount = allItems.length

  switch (pattern) {
    case 'cluster':
      positions = clusterPlacement(center, itemCount, effectiveRadius, 2)
      break

    case 'grid': {
      const gSize = gridSize || { x: Math.ceil(Math.sqrt(itemCount)), z: Math.ceil(Math.sqrt(itemCount)) }
      const bounds = {
        minX: center.x - effectiveRadius,
        maxX: center.x + effectiveRadius,
        minZ: center.z - effectiveRadius,
        maxZ: center.z + effectiveRadius
      }
      positions = gridPlacement(bounds, gSize.z, gSize.x, 0.2)
      break
    }

    case 'row': {
      const spacing = effectiveRadius * 2 / (itemCount - 1 || 1)
      for (let i = 0; i < itemCount; i++) {
        positions.push({
          x: center.x - effectiveRadius + i * spacing,
          z: center.z,
          rotation: 0
        })
      }
      break
    }

    case 'circle':
      positions = ringPlacement(center, itemCount, effectiveRadius, 0.2)
      break

    default:
      positions = clusterPlacement(center, itemCount, effectiveRadius, 2)
  }

  // Assign items to positions
  for (let i = 0; i < Math.min(allItems.length, positions.length); i++) {
    const { item, asset } = allItems[i]
    const pos = positions[i]

    placements.push({
      libraryId: asset.id,
      position: [pos.x, 0, pos.z],
      rotation: pos.rotation ?? Math.random() * Math.PI * 2,
      scale: item.asset.scale,
      _type: 'arrangement',
      _arrangementName: name
    })
  }

  return placements
}

/**
 * Resolve atmosphere relationship to world positions
 * @param {Object} atmo - Atmosphere specification
 * @param {StructureRegistry} registry - Registry of placed structures
 * @param {Array} collisionList - List of existing placements to avoid
 * @returns {Array<Object>} Array of positions {x, y, z, rotation}
 */
export function resolveAtmosphereRelationship(atmo, registry, collisionList) {
  const { relationship, count } = atmo
  const { type, target, side, spacing, distance, zone, density, avoid, cameraAware, path } = relationship
  const positions = []

  // Density to count multiplier
  const densityMultiplier = { sparse: 0.5, medium: 1, high: 1.5 }
  const effectiveCount = Math.round(count * (densityMultiplier[density] || 1))

  switch (type) {
    case 'flanking': {
      // Symmetric pair on sides of structure entrance
      // For a south-facing structure (rotation=0), flanking should spread along X axis
      const struct = registry.get(target)
      if (struct) {
        const flankSpacing = spacing || 8
        const flankDistance = distance || 3

        // Get front center position
        const frontPos = registry.getAdjacentPosition(target, side || 'entrance', flankDistance)
        if (frontPos) {
          // Use structure rotation to determine perpendicular direction
          // cosR/sinR gives the local X axis direction in world space
          // For rotation=0 (south): cosR=1, sinR=0 => perpendicular along world X
          const structRotation = struct.rotation || 0
          const cosR = Math.cos(structRotation)
          const sinR = Math.sin(structRotation)

          positions.push({
            x: frontPos.x + cosR * flankSpacing / 2,
            y: 0,
            z: frontPos.z + sinR * flankSpacing / 2,
            rotation: frontPos.rotation + (Math.random() - 0.5) * 0.3
          })
          positions.push({
            x: frontPos.x - cosR * flankSpacing / 2,
            y: 0,
            z: frontPos.z - sinR * flankSpacing / 2,
            rotation: frontPos.rotation + (Math.random() - 0.5) * 0.3
          })
        }
      }
      break
    }

    case 'along': {
      // Following an edge/path
      if (path && typeof path === 'object' && path.from && path.to) {
        // Path between two points
        const from = registry.get(path.from)?.position || { x: SCENE_GENERATION.CENTER_X - 30, z: SCENE_GENERATION.CENTER_Z }
        const to = registry.get(path.to)?.position || { x: SCENE_GENERATION.CENTER_X + 30, z: SCENE_GENERATION.CENTER_Z }
        const linePositions = leadingLinePlacement(from, to, effectiveCount, spacing || 3)
        positions.push(...linePositions)
      } else if (typeof path === 'string') {
        // String format like "parking.front" or "diner.left"
        const parts = path.split('.')
        const structId = parts[0]
        const edgeSide = parts[1] || 'front'
        const struct = registry.get(structId)

        if (struct) {
          // Get two ends of the specified edge
          const lineStart = registry.getSurfacePosition(structId, edgeSide, 0, 0)
          const lineEnd = registry.getSurfacePosition(structId, edgeSide, 1, 0)
          if (lineStart && lineEnd) {
            const linePositions = leadingLinePlacement(lineStart, lineEnd, effectiveCount, spacing || 3)
            positions.push(...linePositions)
          }
        }
      } else if (target) {
        // Along structure edge
        const struct = registry.get(target)
        if (struct) {
          const edgeSide = side || 'front'
          const edgeSpacing = spacing || 8
          const edgeOffset = distance || 2

          // Calculate edge length
          const edgeLength = (edgeSide === 'front' || edgeSide === 'back')
            ? struct.bounds.width
            : struct.bounds.depth

          const numPositions = Math.min(effectiveCount, Math.floor(edgeLength / edgeSpacing) + 1)

          for (let i = 0; i < numPositions; i++) {
            const h = (i + 0.5) / numPositions
            const surfacePos = registry.getSurfacePosition(target, edgeSide, h, 0)
            if (surfacePos) {
              positions.push({
                x: surfacePos.x + Math.sin(surfacePos.rotation) * edgeOffset,
                y: 0,
                z: surfacePos.z + Math.cos(surfacePos.rotation) * edgeOffset,
                rotation: surfacePos.rotation + Math.PI
              })
            }
          }
        }
      }
      break
    }

    case 'scattered': {
      // Natural distribution in zone
      let bounds

      if (zone === 'edges') {
        // Place around scene edges
        const edgePositions = backgroundPlacement(
          { x: SCENE_GENERATION.CENTER_X, z: SCENE_GENERATION.CENTER_Z },
          effectiveCount,
          30,
          cameraAware
        )
        positions.push(...edgePositions)
      } else if (zone === 'everywhere' || zone === 'scene') {
        bounds = {
          minX: SCENE_GENERATION.MIN_X + 10,
          maxX: SCENE_GENERATION.MAX_X - 10,
          minZ: SCENE_GENERATION.MIN_Z + 10,
          maxZ: SCENE_GENERATION.MAX_Z - 10
        }
        const scatterPositions = poissonDiskSampling(bounds, effectiveCount * 2, spacing || 5)

        // Filter positions based on avoid list
        const shouldAvoid = avoid || ['structures']
        for (const pos of scatterPositions) {
          if (positions.length >= effectiveCount) break

          let valid = true

          // Check collision with existing placements
          // BUG FIX: Previous code used (scale || 5) which made minimum 7.5m even for small items
          // Now uses actual scale with reasonable default of 1, and spacing default of 2
          for (const existing of collisionList) {
            const dx = pos.x - existing.position.x
            const dz = pos.z - existing.position.z
            const dist = Math.sqrt(dx * dx + dz * dz)
            // Use actual scale (default 1), multiply by 0.3 for approximate radius, plus spacing
            const minDist = (existing.scale || 1) * 0.3 + (spacing || 2)
            if (dist < minDist) {
              valid = false
              break
            }
          }

          // Check avoid structures - only avoid the actual structure footprint, not extra buffer
          if (valid && shouldAvoid.includes('structures')) {
            for (const [, struct] of registry.structures) {
              const dx = pos.x - struct.position.x
              const dz = pos.z - struct.position.z
              const dist = Math.sqrt(dx * dx + dz * dz)
              // BUG FIX: Reduced buffer from +5 to +2 to allow atmosphere near structures
              const minDist = Math.max(struct.bounds.width, struct.bounds.depth) / 2 + 2
              if (dist < minDist) {
                valid = false
                break
              }
            }
          }

          if (valid) {
            positions.push({
              x: pos.x,
              y: 0,
              z: pos.z,
              rotation: Math.random() * Math.PI * 2
            })
          }
        }
      } else if (typeof zone === 'object' && zone.around) {
        // Around a specific structure
        const struct = registry.get(zone.around)
        if (struct) {
          const aroundRadius = zone.radius || 15
          const aroundPositions = ringPlacement(struct.position, effectiveCount, aroundRadius, 0.5)
          positions.push(...aroundPositions)
        }
      }
      break
    }

    case 'framing': {
      // Background depth elements at scene edges
      const framePositions = backgroundPlacement(
        { x: SCENE_GENERATION.CENTER_X, z: SCENE_GENERATION.CENTER_Z },
        effectiveCount,
        40,
        cameraAware
      )
      positions.push(...framePositions)
      break
    }

    case 'adjacent_to': {
      // Multiple items adjacent to a structure edge
      const struct = registry.get(target)
      if (struct) {
        const adjPos = registry.getAdjacentPosition(target, side || 'front', distance || 2)
        if (adjPos) {
          // Spread items along the adjacent edge
          const edgeLength = (side === 'front' || side === 'back')
            ? struct.bounds.width
            : struct.bounds.depth
          const itemSpacing = spacing || 3
          const numItems = Math.min(effectiveCount, Math.floor(edgeLength / itemSpacing) + 1)

          for (let i = 0; i < numItems; i++) {
            const offset = (i - (numItems - 1) / 2) * itemSpacing
            // Perpendicular direction for spreading along edge
            const perpAngle = struct.rotation + (side === 'left' || side === 'right' ? 0 : Math.PI / 2)
            positions.push({
              x: adjPos.x + Math.cos(perpAngle) * offset,
              y: 0,
              z: adjPos.z + Math.sin(perpAngle) * offset,
              rotation: struct.rotation + Math.PI  // Face away from structure
            })
          }
        }
      }
      break
    }

    default:
      console.warn(`[Resolver] Unknown atmosphere relationship type: ${type}`)
  }

  return positions
}

/**
 * Resolve NPC placement to world position
 * @param {Object} npcPlacement - NPC placement specification
 * @param {StructureRegistry} registry - Registry of placed structures
 * @returns {Object} Position {x, y, z, rotation}
 */
export function resolveNPCPlacement(npcPlacement, registry) {
  const { relative_to, position, surface, distance, lateralOffset } = npcPlacement

  // Check if relative_to is a structure or arrangement
  let refPos = null

  const struct = registry.get(relative_to)
  if (struct) {
    if (position === 'at_entrance') {
      refPos = registry.getAdjacentPosition(relative_to, 'entrance', distance || 3)
    } else if (position === 'near') {
      refPos = registry.getAdjacentPosition(relative_to, surface || 'front', distance || 5)
    } else if (position === 'within') {
      // Random position near structure
      const jitterRange = Math.max(struct.bounds.width, struct.bounds.depth) / 2
      refPos = {
        x: struct.position.x + (Math.random() - 0.5) * jitterRange,
        z: struct.position.z + (Math.random() - 0.5) * jitterRange,
        rotation: Math.random() * Math.PI * 2
      }
    }
  }

  // Check arrangements
  const arr = registry.getArrangement(relative_to)
  if (arr && !refPos) {
    if (position === 'near') {
      refPos = {
        x: arr.center.x + (Math.random() - 0.5) * (arr.radius || 5),
        z: arr.center.z + (Math.random() - 0.5) * (arr.radius || 5),
        rotation: Math.random() * Math.PI * 2
      }
    } else if (position === 'within') {
      // Pick a random item position
      if (arr.itemPositions && arr.itemPositions.length > 0) {
        const itemPos = arr.itemPositions[Math.floor(Math.random() * arr.itemPositions.length)]
        refPos = {
          x: itemPos.x + (Math.random() - 0.5) * 2,
          z: itemPos.z + (Math.random() - 0.5) * 2,
          rotation: Math.random() * Math.PI * 2
        }
      }
    }
  }

  // Fallback to center
  if (!refPos) {
    refPos = {
      x: SCENE_GENERATION.CENTER_X + (Math.random() - 0.5) * 20,
      z: SCENE_GENERATION.CENTER_Z + (Math.random() - 0.5) * 20,
      rotation: Math.random() * Math.PI * 2
    }
  }

  // Apply lateral offset if specified (for spreading multiple NPCs in same vignette)
  let finalX = refPos.x
  let finalZ = refPos.z
  if (lateralOffset && lateralOffset !== 0) {
    // Spread perpendicular to facing direction
    const perpAngle = (refPos.rotation || 0) + Math.PI / 2
    finalX += Math.cos(perpAngle) * lateralOffset
    finalZ += Math.sin(perpAngle) * lateralOffset
  }

  return {
    x: finalX,
    y: 0,
    z: finalZ,
    rotation: refPos.rotation || 0
  }
}

/**
 * Main orchestrator for relationship-based placement
 * Processes plan in order: structures → decorations → arrangements → atmosphere → npcs
 *
 * @param {Object} plan - Normalized relationship plan from parseRelationshipPlan
 * @param {Map} generatedAssets - Map of prompt -> libraryAsset
 * @param {Array} existingPlacements - Existing placements for collision avoidance
 * @param {Map} measurements - Map of libraryId -> measured bounds from AssetMeasurementService
 * @returns {Object} { placements: Array, libraryAssets: Array }
 */
export function resolveRelationshipPlacements(plan, generatedAssets, existingPlacements = [], measurements = new Map()) {
  const placements = []
  const libraryAssets = Array.from(generatedAssets.values())
  const registry = new StructureRegistry()

  console.log('[Resolver] ═══════════════════════════════════════════════════════════')
  console.log('[Resolver] RELATIONSHIP PLACEMENT RESOLVER')
  console.log('[Resolver] ═══════════════════════════════════════════════════════════')

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 1: Place STRUCTURES
  // ═══════════════════════════════════════════════════════════════════════
  console.log('[Resolver] STEP 1: Placing structures')

  for (const structure of plan.structures) {
    if (!structure.asset?.prompt) {
      console.warn('[Resolver] Structure missing asset.prompt, skipping')
      continue
    }
    const asset = generatedAssets.get(structure.asset.prompt)
    if (!asset) {
      console.warn(`[Resolver] Asset not found for structure: "${structure.asset.prompt.slice(0, 30)}..."`)
      continue
    }

    const pos = resolveStructurePlacement(structure.placement, registry)
    const isV2Explicit = Boolean(structure.placement?.position?.explicit)

    // Get actual measurements if available, otherwise fall back to estimates
    // NOTE: _estimatedBounds are already in real-world meters (from estimateBoundsFromSize)
    // Measured bounds from actual assets are in normalized units and need scaling
    const measuredBounds = measurements.get(asset.id)
    const scale = structure.asset.scale || 1
    let actualBounds

    if (measuredBounds) {
      // Measured bounds are in normalized units - scale to world space
      actualBounds = {
        width: (measuredBounds.width || 10) * scale,
        depth: (measuredBounds.depth || 10) * scale,
        height: (measuredBounds.height || 10) * scale
      }
    } else if (structure._estimatedBounds) {
      // Estimated bounds are already in meters - use directly
      actualBounds = {
        width: structure._estimatedBounds.width || 10,
        depth: structure._estimatedBounds.depth || 10,
        height: structure._estimatedBounds.height || 10
      }
    } else {
      // Fallback default (assume 10m typical building)
      actualBounds = { width: 10, depth: 10, height: 10 }
    }
    const myRadius = Math.max(actualBounds.width, actualBounds.depth) / 2

    // CRITICAL: Save original position before collision resolution
    const baseX = pos.x
    const baseZ = pos.z

    let attempts = 0
    // V2 explicit: trust LLM placement but still resolve collisions
    const maxAttempts = isV2Explicit ? 16 : 32
    const angleStep = Math.PI / 4  // 45° increments
    // V2 explicit: use 1.3× buffer to ensure clear visual separation between structures
    const collisionBuffer = isV2Explicit ? 1.3 : 1.2

    while (attempts < maxAttempts) {
      let collision = false

      for (const [, existing] of registry.structures) {
        // Use rectangular collision for accurate footprint detection
        const collides = checkRectangularCollision(
          actualBounds,
          { x: pos.x, z: pos.z },
          existing.bounds || { width: 10, depth: 10 },
          existing.position,
          collisionBuffer
        )

        if (collides) {
          collision = true
          break
        }
      }

      if (!collision) break

      // Offset from ORIGINAL position (not cumulative!)
      // V2 explicit: nudge by structure radius + 20m for clear visual separation
      // Legacy: larger offset for spreading across zone
      const baseOffset = isV2Explicit ? (myRadius + 20) : (myRadius + 10)
      const growthRate = isV2Explicit ? 0.6 : 0.8
      const offsetDist = baseOffset * (1 + Math.floor(attempts / 8) * growthRate)
      const angle = attempts * angleStep
      pos.x = baseX + Math.cos(angle) * offsetDist
      pos.z = baseZ + Math.sin(angle) * offsetDist
      attempts++
    }

    if (attempts > 0) {
      console.log(`[Resolver]   Collision resolved: moved ${structure.id} by ${isV2Explicit ? 'small nudge' : 'spiral'} after ${attempts} attempts`)
    }

    // Register structure for later reference (use actual measurements if available)
    registry.register(structure.id, {
      position: { x: pos.x, z: pos.z },
      rotation: pos.rotation,
      bounds: actualBounds,
      category: structure.asset.category
    })

    placements.push({
      libraryId: asset.id,
      position: [pos.x, pos.y, pos.z],
      rotation: pos.rotation,
      scale: structure.asset.scale,
      _type: 'structure',
      _structureId: structure.id
    })

    console.log(`[Resolver]   ${structure.id}: (${pos.x.toFixed(0)}, ${pos.z.toFixed(0)}) facing ${(pos.rotation * 180 / Math.PI).toFixed(0)}°`)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 2: Place DECORATIONS (with collision prevention)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('[Resolver] ───────────────────────────────────────────────────────────')
  console.log('[Resolver] STEP 2: Placing decorations')

  // Build collision list from existing placements only
  // For decorations, we skip collision checks against their target structure
  // since decorations are meant to be on/adjacent to structures
  const decorCollisionList = [
    ...existingPlacements.map(p => ({
      position: { x: p.position[0], z: p.position[2] },
      radius: getCollisionRadius(p)  // Use real-world size, not inflated scale
    }))
    // NOTE: Don't include structure placements - decorations attach to structures
    // and would otherwise be rejected for being "too close"
  ]

  for (const decor of plan.decorations) {
    const asset = generatedAssets.get(decor.asset.prompt)
    if (!asset) continue

    const positions = resolveDecorationRelationship(decor, registry)
    const decorRadius = getCollisionRadius(decor.asset)  // Use real-world size
    const targetStructureId = decor.relationship?.target  // Track which structure this attaches to

    let placed = 0
    let rejected = 0

    for (const pos of positions) {
      // Check collision against all existing placements
      // Skip collision check with other decorations on the SAME structure
      let collision = false
      for (const existing of decorCollisionList) {
        // Skip collision check if both decorations are on the same structure
        if (targetStructureId && existing.targetStructureId === targetStructureId) {
          continue
        }

        const dx = pos.x - existing.position.x
        const dz = pos.z - existing.position.z
        const dist = Math.sqrt(dx * dx + dz * dz)
        const minDist = decorRadius + existing.radius + 0.5  // 0.5m buffer

        if (dist < minDist) {
          collision = true
          break
        }
      }

      if (!collision) {
        const placement = {
          libraryId: asset.id,
          position: [pos.x, pos.y || 0, pos.z],
          rotation: pos.rotation,
          scale: decor.asset.scale,
          _type: 'decoration',
          _targetStructureId: targetStructureId
        }
        placements.push(placement)

        // Add to collision list for subsequent decorations
        decorCollisionList.push({
          position: { x: pos.x, z: pos.z },
          radius: decorRadius,
          targetStructureId: targetStructureId  // Track structure for same-structure skip
        })
        placed++
      } else {
        rejected++
      }
    }

    console.log(`[Resolver]   ${decor.relationship.type} → ${decor.relationship.target}: ${placed} placed, ${rejected} rejected (collision)`)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 3: Place ARRANGEMENTS (with collision filtering)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('[Resolver] ───────────────────────────────────────────────────────────')
  console.log('[Resolver] STEP 3: Placing arrangements')

  // Build collision list from decorations + structure footprints
  // (Arrangements are ground-level and should not overlap buildings)
  const arrangementCollisionList = [...decorCollisionList]

  // Add structure footprints for ground-level collision checking
  for (const [, struct] of registry.structures) {
    arrangementCollisionList.push({
      position: struct.position,
      scale: Math.max(struct.bounds.width, struct.bounds.depth),
      radius: Math.max(struct.bounds.width, struct.bounds.depth) / 2
    })
  }

  for (const arr of plan.arrangements) {
    const arrangementPlacements = resolveArrangement(arr, registry, generatedAssets)

    // Filter arrangement placements for collisions
    const filteredPlacements = []
    let rejected = 0

    for (const p of arrangementPlacements) {
      const itemRadius = getCollisionRadius(p)  // Use real-world size

      let collision = false
      for (const existing of arrangementCollisionList) {
        const dx = p.position[0] - existing.position.x
        const dz = p.position[2] - existing.position.z
        const dist = Math.sqrt(dx * dx + dz * dz)
        const minDist = itemRadius + existing.radius + 0.5

        if (dist < minDist) {
          collision = true
          break
        }
      }

      if (!collision) {
        filteredPlacements.push(p)
        // Add to collision list
        arrangementCollisionList.push({
          position: { x: p.position[0], z: p.position[2] },
          radius: itemRadius
        })
      } else {
        rejected++
      }
    }

    // Register arrangement for NPC references (use filtered placements)
    if (filteredPlacements.length > 0) {
      const centerX = filteredPlacements.reduce((sum, p) => sum + p.position[0], 0) / filteredPlacements.length
      const centerZ = filteredPlacements.reduce((sum, p) => sum + p.position[2], 0) / filteredPlacements.length

      registry.registerArrangement(arr.name, {
        center: { x: centerX, z: centerZ },
        radius: arr.radius || 5,
        itemPositions: filteredPlacements.map(p => ({ x: p.position[0], z: p.position[2] }))
      })
    }

    placements.push(...filteredPlacements)

    console.log(`[Resolver]   ${arr.name}: ${filteredPlacements.length} items placed, ${rejected} rejected (collision)`)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 4: Place ATMOSPHERE
  // ═══════════════════════════════════════════════════════════════════════
  console.log('[Resolver] ───────────────────────────────────────────────────────────')
  console.log('[Resolver] STEP 4: Placing atmosphere')

  // Use the accumulated collision list from arrangements
  const atmosphereCollisionList = [...arrangementCollisionList]

  for (const atmos of plan.atmosphere) {
    const asset = generatedAssets.get(atmos.asset.prompt)
    if (!asset) continue

    const positions = resolveAtmosphereRelationship(atmos, registry, atmosphereCollisionList)

    // Calculate collision radius from estimated bounds (preferred) or real-world size (fallback)
    const bounds = atmos._estimatedBounds
    const atmosRadius = bounds
      ? Math.max(bounds.width, bounds.depth) / 2
      : getCollisionRadius(atmos.asset)  // Use real-world size, not inflated scale

    // Filter positions for collisions (in case resolveAtmosphereRelationship didn't fully filter)
    let placed = 0
    let rejected = 0

    for (const pos of positions) {
      let collision = false
      for (const existing of atmosphereCollisionList) {
        const dx = pos.x - existing.position.x
        const dz = pos.z - existing.position.z
        const dist = Math.sqrt(dx * dx + dz * dz)
        const minDist = atmosRadius + (existing.radius || 1) + 0.5

        if (dist < minDist) {
          collision = true
          break
        }
      }

      if (!collision) {
        const placement = {
          libraryId: asset.id,
          position: [pos.x, pos.y || 0, pos.z],
          rotation: pos.rotation || Math.random() * Math.PI * 2,
          scale: atmos.asset.scale,
          _type: 'atmosphere'
        }
        placements.push(placement)

        // Add to collision list for subsequent atmosphere
        atmosphereCollisionList.push({
          position: { x: pos.x, z: pos.z },
          radius: atmosRadius
        })
        placed++
      } else {
        rejected++
      }
    }

    console.log(`[Resolver]   ${atmos.relationship.type}: ${placed}/${atmos.count} placed, ${rejected} rejected (collision)`)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 5: Place NPCS
  // ═══════════════════════════════════════════════════════════════════════
  console.log('[Resolver] ───────────────────────────────────────────────────────────')
  console.log('[Resolver] STEP 5: Placing NPCs')

  for (const npc of plan.npcs) {
    const asset = generatedAssets.get(npc.asset.prompt)
    if (!asset) continue

    const pos = resolveNPCPlacement(npc.placement, registry)

    placements.push({
      libraryId: asset.id,
      position: [pos.x, pos.y || 0, pos.z],
      rotation: pos.rotation || 0,
      scale: npc.asset.scale,
      behavior: npc.behavior,
      wanderRadius: npc.wanderRadius,
      _type: 'npc'
    })

    console.log(`[Resolver]   NPC at (${pos.x.toFixed(0)}, ${pos.z.toFixed(0)}) - ${npc.behavior}`)
  }

  console.log('[Resolver] ═══════════════════════════════════════════════════════════')
  console.log(`[Resolver] COMPLETE: ${placements.length} total placements`)
  console.log(`[Resolver]   Structures: ${placements.filter(p => p._type === 'structure').length}`)
  console.log(`[Resolver]   Decorations: ${placements.filter(p => p._type === 'decoration').length}`)
  console.log(`[Resolver]   Arrangements: ${placements.filter(p => p._type === 'arrangement').length}`)
  console.log(`[Resolver]   Atmosphere: ${placements.filter(p => p._type === 'atmosphere').length}`)
  console.log(`[Resolver]   NPCs: ${placements.filter(p => p._type === 'npc').length}`)

  return { placements, libraryAssets }
}
