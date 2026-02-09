/**
 * Spatial Relationship Templates
 *
 * Each template receives context about the scene and returns keyframes for
 * primary and (optionally) secondary subjects. Templates translate semantic
 * relationships into concrete animation data.
 *
 * @see ../CLAUDE.md for relationship semantics
 */

const WALK_SPEED = 2 // m/s — matches NPCController.js

/**
 * @typedef {Object} RelationshipContext
 * @property {number} duration - Shot duration in seconds
 * @property {[number, number, number]} primaryStart - Primary subject start position
 * @property {[number, number, number]|null} secondaryStart - Secondary subject start position
 * @property {number} primaryRotation - Primary subject start yaw (radians)
 * @property {number|null} secondaryRotation - Secondary subject start yaw (radians)
 */

/**
 * @typedef {Object} Keyframe
 * @property {number} time - Time offset in seconds
 * @property {[number, number, number]} position - [x, y, z] position
 * @property {number} rotation - Yaw in radians
 */

/**
 * @typedef {Object} RelationshipResult
 * @property {Keyframe[]} primary - Keyframes for primary subject
 * @property {Keyframe[]|null} secondary - Keyframes for secondary subject (if exists)
 */

/**
 * Compute angle from point A to point B
 * @param {[number, number, number]} from
 * @param {[number, number, number]} to
 * @returns {number} Yaw in radians
 */
function angleToward(from, to) {
  const dx = to[0] - from[0]
  const dz = to[2] - from[2]
  return Math.atan2(dx, dz)
}

/**
 * Compute distance between two points (XZ plane)
 * @param {[number, number, number]} a
 * @param {[number, number, number]} b
 * @returns {number}
 */
function distanceXZ(a, b) {
  const dx = b[0] - a[0]
  const dz = b[2] - a[2]
  return Math.sqrt(dx * dx + dz * dz)
}

/**
 * Move toward a target, limited by walk speed and duration
 * @param {[number, number, number]} start
 * @param {[number, number, number]} target
 * @param {number} duration
 * @param {number} stopDistance - How close to get before stopping
 * @returns {[number, number, number]}
 */
function moveToward(start, target, duration, stopDistance = 0) {
  const maxDistance = WALK_SPEED * duration
  const totalDistance = distanceXZ(start, target)
  const effectiveDistance = Math.max(0, totalDistance - stopDistance)
  const actualDistance = Math.min(maxDistance, effectiveDistance)

  if (totalDistance < 0.01) return [...start]

  const ratio = actualDistance / totalDistance
  return [
    start[0] + (target[0] - start[0]) * ratio,
    start[1], // Keep Y unchanged
    start[2] + (target[2] - start[2]) * ratio
  ]
}

/**
 * Primary walks toward secondary, stops at close distance
 * @param {RelationshipContext} ctx
 * @returns {RelationshipResult}
 */
export function approaching(ctx) {
  const { duration, primaryStart, secondaryStart, secondaryRotation } = ctx
  const CLOSE_DISTANCE = 6 // Stop 6m away

  // If no secondary, walk forward in current direction
  if (!secondaryStart) {
    const angle = ctx.primaryRotation
    const endPos = [
      primaryStart[0] + Math.sin(angle) * WALK_SPEED * duration,
      primaryStart[1],
      primaryStart[2] + Math.cos(angle) * WALK_SPEED * duration
    ]
    return {
      primary: [
        { time: 0, position: [...primaryStart], rotation: angle },
        { time: duration, position: endPos, rotation: angle }
      ],
      secondary: null
    }
  }

  const targetAngle = angleToward(primaryStart, secondaryStart)
  const endPos = moveToward(primaryStart, secondaryStart, duration, CLOSE_DISTANCE)

  return {
    primary: [
      { time: 0, position: [...primaryStart], rotation: targetAngle },
      { time: duration, position: endPos, rotation: targetAngle }
    ],
    secondary: [
      // Secondary stays put, faces primary
      { time: 0, position: [...secondaryStart], rotation: secondaryRotation ?? angleToward(secondaryStart, primaryStart) },
      { time: duration, position: [...secondaryStart], rotation: angleToward(secondaryStart, endPos) }
    ]
  }
}

/**
 * Position both facing each other at specified distance (static shot)
 * @param {RelationshipContext} ctx
 * @returns {RelationshipResult}
 */
export function facing_at_distance(ctx) {
  const { duration, primaryStart, secondaryStart, primaryRotation } = ctx

  if (!secondaryStart) {
    // No secondary — just hold position
    return {
      primary: [
        { time: 0, position: [...primaryStart], rotation: primaryRotation },
        { time: duration, position: [...primaryStart], rotation: primaryRotation }
      ],
      secondary: null
    }
  }

  const primaryFacing = angleToward(primaryStart, secondaryStart)
  const secondaryFacing = angleToward(secondaryStart, primaryStart)

  return {
    primary: [
      { time: 0, position: [...primaryStart], rotation: primaryFacing },
      { time: duration, position: [...primaryStart], rotation: primaryFacing }
    ],
    secondary: [
      { time: 0, position: [...secondaryStart], rotation: secondaryFacing },
      { time: duration, position: [...secondaryStart], rotation: secondaryFacing }
    ]
  }
}

/**
 * Primary orbits secondary (180° arc over duration)
 * @param {RelationshipContext} ctx
 * @returns {RelationshipResult}
 */
export function circling(ctx) {
  const { duration, primaryStart, secondaryStart, secondaryRotation } = ctx
  const ARC_DEGREES = 180
  const ORBIT_SEGMENTS = 4 // Number of keyframes for smooth orbit

  if (!secondaryStart) {
    // No secondary — spin in place
    return {
      primary: [
        { time: 0, position: [...primaryStart], rotation: ctx.primaryRotation },
        { time: duration, position: [...primaryStart], rotation: ctx.primaryRotation + Math.PI }
      ],
      secondary: null
    }
  }

  // Calculate orbit radius from current distance
  const radius = distanceXZ(primaryStart, secondaryStart)
  const startAngle = Math.atan2(
    primaryStart[0] - secondaryStart[0],
    primaryStart[2] - secondaryStart[2]
  )

  const primaryKeyframes = []
  for (let i = 0; i <= ORBIT_SEGMENTS; i++) {
    const t = i / ORBIT_SEGMENTS
    const angle = startAngle + (ARC_DEGREES * Math.PI / 180) * t
    const pos = [
      secondaryStart[0] + Math.sin(angle) * radius,
      primaryStart[1],
      secondaryStart[2] + Math.cos(angle) * radius
    ]
    // Face toward center (secondary)
    const facingAngle = angleToward(pos, secondaryStart)
    primaryKeyframes.push({
      time: t * duration,
      position: pos,
      rotation: facingAngle
    })
  }

  // Secondary tracks primary
  const secondaryKeyframes = primaryKeyframes.map((kf, i) => ({
    time: kf.time,
    position: [...secondaryStart],
    rotation: angleToward(secondaryStart, kf.position)
  }))

  return {
    primary: primaryKeyframes,
    secondary: secondaryKeyframes
  }
}

/**
 * Both walk parallel, maintaining offset
 * @param {RelationshipContext} ctx
 * @returns {RelationshipResult}
 */
export function side_by_side(ctx) {
  const { duration, primaryStart, secondaryStart, primaryRotation } = ctx
  const walkDistance = WALK_SPEED * duration

  // Walk forward in primary's facing direction
  const angle = primaryRotation
  const deltaX = Math.sin(angle) * walkDistance
  const deltaZ = Math.cos(angle) * walkDistance

  const primaryEnd = [
    primaryStart[0] + deltaX,
    primaryStart[1],
    primaryStart[2] + deltaZ
  ]

  if (!secondaryStart) {
    return {
      primary: [
        { time: 0, position: [...primaryStart], rotation: angle },
        { time: duration, position: primaryEnd, rotation: angle }
      ],
      secondary: null
    }
  }

  const secondaryEnd = [
    secondaryStart[0] + deltaX,
    secondaryStart[1],
    secondaryStart[2] + deltaZ
  ]

  return {
    primary: [
      { time: 0, position: [...primaryStart], rotation: angle },
      { time: duration, position: primaryEnd, rotation: angle }
    ],
    secondary: [
      { time: 0, position: [...secondaryStart], rotation: angle },
      { time: duration, position: secondaryEnd, rotation: angle }
    ]
  }
}

/**
 * No movement, hold positions
 * @param {RelationshipContext} ctx
 * @returns {RelationshipResult}
 */
export function stationary(ctx) {
  const { duration, primaryStart, secondaryStart, primaryRotation, secondaryRotation } = ctx

  return {
    primary: [
      { time: 0, position: [...primaryStart], rotation: primaryRotation },
      { time: duration, position: [...primaryStart], rotation: primaryRotation }
    ],
    secondary: secondaryStart ? [
      { time: 0, position: [...secondaryStart], rotation: secondaryRotation ?? 0 },
      { time: duration, position: [...secondaryStart], rotation: secondaryRotation ?? 0 }
    ] : null
  }
}

/**
 * Primary moves away from secondary (or camera direction if no secondary)
 * @param {RelationshipContext} ctx
 * @returns {RelationshipResult}
 */
export function walking_away(ctx) {
  const { duration, primaryStart, secondaryStart, primaryRotation, secondaryRotation } = ctx
  const walkDistance = WALK_SPEED * duration

  // Direction: away from secondary, or forward in current direction
  let awayAngle
  if (secondaryStart) {
    awayAngle = angleToward(secondaryStart, primaryStart) // Opposite of "toward"
  } else {
    awayAngle = primaryRotation
  }

  const primaryEnd = [
    primaryStart[0] + Math.sin(awayAngle) * walkDistance,
    primaryStart[1],
    primaryStart[2] + Math.cos(awayAngle) * walkDistance
  ]

  return {
    primary: [
      { time: 0, position: [...primaryStart], rotation: awayAngle },
      { time: duration, position: primaryEnd, rotation: awayAngle }
    ],
    secondary: secondaryStart ? [
      // Secondary watches primary leave
      { time: 0, position: [...secondaryStart], rotation: secondaryRotation ?? angleToward(secondaryStart, primaryStart) },
      { time: duration, position: [...secondaryStart], rotation: angleToward(secondaryStart, primaryEnd) }
    ] : null
  }
}

/**
 * Map of all relationship templates
 */
export const RELATIONSHIPS = {
  approaching,
  facing_at_distance,
  circling,
  side_by_side,
  stationary,
  walking_away
}

/**
 * Resolve a relationship by name
 * @param {string} name - Relationship name
 * @returns {Function|null}
 */
export function getRelationship(name) {
  return RELATIONSHIPS[name] || null
}
