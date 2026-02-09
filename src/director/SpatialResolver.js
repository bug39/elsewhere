/**
 * SpatialResolver — Translate semantic scene plans to concrete coordinates
 *
 * Takes a ScenePlan from ScenePlanner (which uses semantic relationships like
 * "approaching") and resolves it to specific Three.js coordinates and keyframes.
 *
 * Key design principle: Gemini outputs WHAT happens (narrative), this module
 * computes WHERE it happens (spatial). This separation leverages LLM strengths
 * (temporal/narrative reasoning) while avoiding weaknesses (spatial reasoning).
 *
 * @see ./CLAUDE.md for architecture overview
 * @see ./templates/relationships.js for spatial templates
 * @see ./templates/cameras.js for camera templates
 */

import { getRelationship, RELATIONSHIPS } from './templates/relationships.js'
import { getCamera, CAMERAS, CAMERA } from './templates/cameras.js'

// Scene positioning constants
const SCENE_CENTER = { x: 200, z: 200 } // World center (400x400 world)
const WORLD_MIN = 10   // Min boundary with padding
const WORLD_MAX = 390  // Max boundary with padding

// Distance constants for initial positioning
const DISTANCES = {
  close: 6,    // 5-8m range
  medium: 13,  // 12-15m range
  far: 30      // 25-35m range
}

// Anchor asset detection patterns (things that don't move)
const ANCHOR_SUFFIXES = ['_cave', '_building', '_tower', '_gate', '_tree', '_rock', '_altar', '_throne']

/**
 * @typedef {import('./ScenePlanner').ScenePlan} ScenePlan
 * @typedef {import('./ScenePlanner').Shot} Shot
 */

/**
 * @typedef {Object} ResolvedAsset
 * @property {string} id - Asset identifier
 * @property {[number, number, number]} initialPosition - Starting [x, y, z]
 * @property {number} initialRotation - Starting yaw in radians
 */

/**
 * @typedef {Object} AnimationKeyframe
 * @property {number} time - Time in seconds (relative to shot start)
 * @property {[number, number, number]} position - [x, y, z]
 * @property {number} rotation - Yaw in radians
 */

/**
 * @typedef {Object} CameraKeyframe
 * @property {number} time - Absolute time in seconds
 * @property {[number, number, number]} position - Camera position
 * @property {[number, number, number]} lookAt - Look-at target
 * @property {number} fov - Field of view
 */

/**
 * @typedef {Object} ActionKeyframe
 * @property {number} time - Normalized 0-1 within action duration
 * @property {[number, number, number]} [positionOffset] - Additive position offset
 * @property {[number, number, number]} [rotationOffset] - Additive rotation offset (x, y, z radians)
 * @property {number} [scaleMultiplier] - Scale multiplier (1 = no change)
 */

/**
 * @typedef {Object} ParticleConfig
 * @property {string} trigger - "start" | "continuous" | "at_time:X"
 * @property {number} count - Number of particles
 * @property {[number, number, number]} color - RGB 0-255
 * @property {number} [colorVariance] - 0-1
 * @property {number} [size] - Particle size
 * @property {number} [sizeVariance] - 0-1
 * @property {number} [lifetime] - Seconds
 * @property {[number, number, number]} velocity - Direction + speed
 * @property {number} [velocitySpread] - Cone angle degrees
 * @property {number} [gravity] - -1 to 1
 * @property {[number, number, number]} [emitOffset] - Relative to asset
 * @property {string} [shape] - "point" | "cone" | "sphere"
 */

/**
 * @typedef {Object} ResolvedAction
 * @property {string} assetId - Which asset performs this action
 * @property {number} startTime - Absolute time in seconds
 * @property {number} endTime - Absolute time in seconds
 * @property {number} duration - Duration in seconds
 * @property {string} description - What the action represents
 * @property {ActionKeyframe[]} keyframes - Transform keyframes (additive)
 * @property {ParticleConfig[]} [particles] - Particle effects
 */

/**
 * @typedef {Object} ResolvedShot
 * @property {number} startTime - Seconds from scene start
 * @property {number} endTime - Seconds from scene start
 * @property {Array<{assetId: string, keyframes: AnimationKeyframe[]}>} animations
 * @property {{keyframes: CameraKeyframe[], easing: string}} camera
 * @property {ResolvedAction[]} [actions] - Actions with absolute timing
 */

/**
 * @typedef {Object} ResolvedScene
 * @property {number} duration - Total scene duration in seconds
 * @property {ResolvedAsset[]} assets - All assets with initial positions
 * @property {ResolvedShot[]} shots - Resolved shot data
 */

/**
 * Check if an asset ID represents an anchor (non-moving) object
 * @param {string} id - Asset ID
 * @returns {boolean}
 */
function isAnchorAsset(id) {
  const normalized = id.toLowerCase()
  return ANCHOR_SUFFIXES.some(suffix => normalized.includes(suffix.slice(1))) // Remove leading underscore for includes
}

/**
 * Normalize asset ID for matching (strips _01 suffixes, lowercases)
 * @param {string} id
 * @returns {string}
 */
function normalizeAssetId(id) {
  return id.toLowerCase().replace(/_\d+$/, '')
}

/**
 * Clamp a position to world boundaries
 * @param {[number, number, number]} pos
 * @returns {[number, number, number]}
 */
function clampToWorld(pos) {
  return [
    Math.max(WORLD_MIN, Math.min(WORLD_MAX, pos[0])),
    pos[1],
    Math.max(WORLD_MIN, Math.min(WORLD_MAX, pos[2]))
  ]
}

/**
 * Clamp duration to reasonable bounds
 * @param {number} duration
 * @returns {number}
 */
function clampDuration(duration) {
  return Math.max(2, Math.min(30, duration))
}

/**
 * Collect all unique asset IDs referenced in shots
 * @param {Shot[]} shots
 * @returns {Set<string>}
 */
function collectAssetIds(shots) {
  const ids = new Set()
  for (const shot of shots) {
    if (shot.subjects?.primary) ids.add(normalizeAssetId(shot.subjects.primary))
    if (shot.subjects?.secondary) ids.add(normalizeAssetId(shot.subjects.secondary))
  }
  return ids
}

/**
 * Compute initial positions for assets based on the first shot
 * @param {Shot} firstShot - First shot in the scene
 * @param {Set<string>} assetIds - All asset IDs in scene
 * @returns {Map<string, {position: [number,number,number], rotation: number}>}
 */
function computeInitialPositions(firstShot, assetIds) {
  const positions = new Map()

  // Primary subject at scene center
  const primaryId = normalizeAssetId(firstShot.subjects?.primary || 'subject')
  positions.set(primaryId, {
    position: [SCENE_CENTER.x, 0, SCENE_CENTER.z],
    rotation: 0
  })

  // Secondary subject positioned based on relationship
  if (firstShot.subjects?.secondary) {
    const secondaryId = normalizeAssetId(firstShot.subjects.secondary)
    const relationship = firstShot.spatial_relationship || 'facing_at_distance'

    let distance = DISTANCES.medium
    let angle = Math.PI // Behind primary by default

    // Adjust based on relationship
    if (relationship === 'approaching') {
      distance = DISTANCES.far // Start far away
      angle = 0 // In front (primary will approach)
    } else if (relationship === 'facing_at_distance') {
      distance = DISTANCES.medium
      angle = 0 // Face to face
    } else if (relationship === 'side_by_side') {
      distance = 3 // Side by side, close
      angle = Math.PI / 2 // To the side
    }

    positions.set(secondaryId, {
      position: [
        SCENE_CENTER.x + Math.sin(angle) * distance,
        0,
        SCENE_CENTER.z + Math.cos(angle) * distance
      ],
      rotation: Math.PI + angle // Face toward primary
    })
  }

  // Any remaining assets get placed in a circle around the scene
  let extraIndex = 0
  for (const id of assetIds) {
    if (!positions.has(id)) {
      const angle = (extraIndex * Math.PI * 2) / 6 + Math.PI / 4 // Spread in circle
      const distance = DISTANCES.far
      positions.set(id, {
        position: [
          SCENE_CENTER.x + Math.sin(angle) * distance,
          0,
          SCENE_CENTER.z + Math.cos(angle) * distance
        ],
        rotation: -angle // Face center
      })
      extraIndex++
    }
  }

  return positions
}

/**
 * Resolve actions from a shot, converting times from relative to absolute
 * @param {Array} actions - Raw actions from scene plan
 * @param {number} shotStartTime - When this shot starts (absolute)
 * @returns {ResolvedAction[]}
 */
function resolveActions(actions, shotStartTime) {
  if (!actions || !Array.isArray(actions) || actions.length === 0) {
    return []
  }

  return actions.map(action => {
    const startTime = shotStartTime + (action.startTime || 0)
    const duration = Math.max(0.1, action.duration || 1)

    return {
      assetId: normalizeAssetId(action.assetId || 'unknown'),
      startTime,
      endTime: startTime + duration,
      duration,
      description: action.description || '',
      keyframes: validateActionKeyframes(action.keyframes),
      particles: action.particles || []
    }
  })
}

/**
 * Validate and sanitize action keyframes
 * @param {ActionKeyframe[]} keyframes
 * @returns {ActionKeyframe[]}
 */
function validateActionKeyframes(keyframes) {
  if (!keyframes || !Array.isArray(keyframes) || keyframes.length === 0) {
    // Default: no transform change
    return [
      { time: 0, positionOffset: [0, 0, 0], rotationOffset: [0, 0, 0], scaleMultiplier: 1 },
      { time: 1, positionOffset: [0, 0, 0], rotationOffset: [0, 0, 0], scaleMultiplier: 1 }
    ]
  }

  return keyframes.map(kf => ({
    time: Math.max(0, Math.min(1, kf.time || 0)),
    positionOffset: clampPositionOffset(kf.positionOffset),
    rotationOffset: clampRotationOffset(kf.rotationOffset),
    scaleMultiplier: Math.max(0.1, Math.min(5, kf.scaleMultiplier ?? 1))
  })).sort((a, b) => a.time - b.time)
}

/**
 * Clamp position offset to reasonable bounds
 * @param {[number, number, number]} offset
 * @returns {[number, number, number]}
 */
function clampPositionOffset(offset) {
  if (!offset || !Array.isArray(offset)) return [0, 0, 0]
  return [
    Math.max(-20, Math.min(20, offset[0] || 0)),
    Math.max(-10, Math.min(20, offset[1] || 0)),
    Math.max(-20, Math.min(20, offset[2] || 0))
  ]
}

/**
 * Clamp rotation offset to reasonable bounds (radians)
 * @param {[number, number, number]} offset
 * @returns {[number, number, number]}
 */
function clampRotationOffset(offset) {
  if (!offset || !Array.isArray(offset)) return [0, 0, 0]
  const MAX_ROT = Math.PI / 2 // 90 degrees max tilt
  return [
    Math.max(-MAX_ROT, Math.min(MAX_ROT, offset[0] || 0)),
    Math.max(-Math.PI, Math.min(Math.PI, offset[1] || 0)),
    Math.max(-MAX_ROT, Math.min(MAX_ROT, offset[2] || 0))
  ]
}

/**
 * Resolve a single shot to animations and camera
 * @param {Shot} shot
 * @param {number} startTime
 * @param {Map<string, {position: [number,number,number], rotation: number}>} positions - Current positions (mutated)
 * @returns {ResolvedShot}
 */
function resolveShot(shot, startTime, positions) {
  const duration = clampDuration(shot.duration_seconds || 5)
  const endTime = startTime + duration

  const primaryId = normalizeAssetId(shot.subjects?.primary || 'subject')
  const secondaryId = shot.subjects?.secondary ? normalizeAssetId(shot.subjects.secondary) : null

  // Get current positions
  const primaryState = positions.get(primaryId) || { position: [SCENE_CENTER.x, 0, SCENE_CENTER.z], rotation: 0 }
  const secondaryState = secondaryId ? positions.get(secondaryId) : null

  // Resolve spatial relationship
  const relationshipName = shot.spatial_relationship || 'stationary'
  const relationshipFn = getRelationship(relationshipName)

  let relationshipResult
  if (relationshipFn) {
    const ctx = {
      duration,
      primaryStart: [...primaryState.position],
      secondaryStart: secondaryState ? [...secondaryState.position] : null,
      primaryRotation: primaryState.rotation,
      secondaryRotation: secondaryState?.rotation ?? null
    }
    relationshipResult = relationshipFn(ctx)
  } else {
    // Unknown relationship — default to stationary with warning
    console.warn(`[SpatialResolver] Unknown relationship "${relationshipName}", defaulting to stationary`)
    relationshipResult = RELATIONSHIPS.stationary({
      duration,
      primaryStart: [...primaryState.position],
      secondaryStart: secondaryState ? [...secondaryState.position] : null,
      primaryRotation: primaryState.rotation,
      secondaryRotation: secondaryState?.rotation ?? null
    })
  }

  // Build animations array
  const animations = []

  // Primary animation (if not an anchor)
  if (!isAnchorAsset(primaryId)) {
    animations.push({
      assetId: primaryId,
      keyframes: relationshipResult.primary.map(kf => ({
        time: kf.time,
        position: clampToWorld(kf.position),
        rotation: kf.rotation
      }))
    })
  }

  // Secondary animation (if exists and not an anchor)
  if (secondaryId && relationshipResult.secondary && !isAnchorAsset(secondaryId)) {
    animations.push({
      assetId: secondaryId,
      keyframes: relationshipResult.secondary.map(kf => ({
        time: kf.time,
        position: clampToWorld(kf.position),
        rotation: kf.rotation
      }))
    })
  }

  // Update positions for next shot (continuity)
  if (relationshipResult.primary.length > 0) {
    const lastPrimary = relationshipResult.primary[relationshipResult.primary.length - 1]
    positions.set(primaryId, {
      position: clampToWorld(lastPrimary.position),
      rotation: lastPrimary.rotation
    })
  }
  if (secondaryId && relationshipResult.secondary?.length > 0) {
    const lastSecondary = relationshipResult.secondary[relationshipResult.secondary.length - 1]
    positions.set(secondaryId, {
      position: clampToWorld(lastSecondary.position),
      rotation: lastSecondary.rotation
    })
  }

  // Resolve camera
  const cameraStyle = shot.camera_style || 'tracking_behind'
  const cameraFn = getCamera(cameraStyle)

  let cameraResult
  if (cameraFn) {
    // Compute scene center for camera
    const primaryPos = primaryState.position
    const sceneCenter = secondaryState
      ? [(primaryPos[0] + secondaryState.position[0]) / 2, 0, (primaryPos[2] + secondaryState.position[2]) / 2]
      : [...primaryPos]

    cameraResult = cameraFn({
      startTime,
      endTime,
      primaryKeyframes: relationshipResult.primary,
      secondaryKeyframes: relationshipResult.secondary,
      sceneCenter
    })
  } else {
    // Unknown camera style — default to tracking_behind
    console.warn(`[SpatialResolver] Unknown camera style "${cameraStyle}", defaulting to tracking_behind`)
    cameraResult = CAMERAS.tracking_behind({
      startTime,
      endTime,
      primaryKeyframes: relationshipResult.primary,
      secondaryKeyframes: relationshipResult.secondary,
      sceneCenter: [...primaryState.position]
    })
  }

  // Pass through actions with converted times (relative → absolute)
  const resolvedActions = resolveActions(shot.actions, startTime)

  return {
    startTime,
    endTime,
    animations,
    camera: cameraResult,
    actions: resolvedActions
  }
}

/**
 * Resolve a complete scene plan to coordinates and keyframes
 *
 * @param {ScenePlan} scenePlan - Plan from ScenePlanner
 * @returns {ResolvedScene}
 *
 * @example
 * const plan = await planScene('A knight approaches a dragon')
 * const resolved = resolveScene(plan)
 * // resolved.assets — [{id: 'knight', initialPosition: [200, 0, 200], ...}]
 * // resolved.shots — [{startTime: 0, endTime: 5, animations: [...], camera: {...}}]
 */
export function resolveScene(scenePlan) {
  if (!scenePlan?.shots?.length) {
    throw new Error('Scene plan must have at least one shot')
  }

  // Collect all asset IDs from shots
  const assetIds = collectAssetIds(scenePlan.shots)

  // Compute initial positions based on first shot
  const positions = computeInitialPositions(scenePlan.shots[0], assetIds)

  // Process shots sequentially (maintains position continuity)
  const resolvedShots = []
  let currentTime = 0

  for (const shot of scenePlan.shots) {
    const resolved = resolveShot(shot, currentTime, positions)
    resolvedShots.push(resolved)
    currentTime = resolved.endTime
  }

  // Build assets array from final position state
  const assets = Array.from(positions.entries()).map(([id, state]) => ({
    id,
    initialPosition: clampToWorld(state.position),
    initialRotation: state.rotation
  }))

  // For assets that never moved, use their initial computed position
  // (positions map was mutated during shot resolution, so we need to
  // re-compute initial positions for the output)
  const initialPositions = computeInitialPositions(scenePlan.shots[0], assetIds)
  const assetsWithInitial = Array.from(initialPositions.entries()).map(([id, state]) => ({
    id,
    initialPosition: clampToWorld(state.position),
    initialRotation: state.rotation
  }))

  return {
    duration: currentTime,
    assets: assetsWithInitial,
    shots: resolvedShots
  }
}

// Export constants for testing
export { SCENE_CENTER, DISTANCES, CAMERA, normalizeAssetId, isAnchorAsset }
