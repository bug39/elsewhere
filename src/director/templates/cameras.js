/**
 * Camera Style Templates
 *
 * Each template generates camera keyframes based on subject positions and
 * shot timing. Cameras track subjects dynamically, creating cinematic motion.
 *
 * @see ../CLAUDE.md for camera style semantics
 */

/**
 * Asset scale in Director Mode — must match ASSET_SCALE in DirectorView.jsx
 * Assets are ~16 units tall (base 2 * scale 8)
 */
const ASSET_HEIGHT = 16

/**
 * Camera constants — tuned for ASSET_SCALE = 8 (16-unit tall assets)
 *
 * Key insight: We don't need to scale distances proportionally to asset size.
 * We just need to:
 * 1. Look at the right height (middle of asset, not feet)
 * 2. Pull back slightly to fit larger assets in frame
 */
const CAMERA = {
  height: 16,              // Camera height (at asset mid-height)
  distance: 40,            // Follow distance (fits 16-unit asset in frame)
  closeUpDistance: 12,     // Close-up shot distance
  lowAngleHeight: 4,       // Dramatic low angle height
  orbitRadius: 35,         // Orbit radius
  wideHeight: 50,          // Wide establishing shot height
  wideDistance: 70,        // Wide establishing shot pullback
  sideOffset: 35,          // Side tracking offset
  assetHeight: ASSET_HEIGHT, // Asset height for lookAt targets
  fov: {
    normal: 60,
    wide: 75,
    tight: 40
  }
}

/**
 * @typedef {Object} CameraContext
 * @property {number} startTime - Shot start time (seconds from scene start)
 * @property {number} endTime - Shot end time (seconds from scene start)
 * @property {Array<{time: number, position: [number,number,number]}>} primaryKeyframes - Primary subject keyframes
 * @property {Array<{time: number, position: [number,number,number]}>|null} secondaryKeyframes - Secondary subject keyframes
 * @property {[number, number, number]} sceneCenter - Center of action
 */

/**
 * @typedef {Object} CameraKeyframe
 * @property {number} time - Absolute time in seconds
 * @property {[number, number, number]} position - Camera position
 * @property {[number, number, number]} lookAt - Camera look-at target
 * @property {number} fov - Field of view in degrees
 */

/**
 * @typedef {Object} CameraResult
 * @property {CameraKeyframe[]} keyframes
 * @property {string} easing - Easing function name
 */

/**
 * Interpolate between two positions
 * @param {[number, number, number]} a
 * @param {[number, number, number]} b
 * @param {number} t - 0 to 1
 * @returns {[number, number, number]}
 */
function lerp3(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ]
}

/**
 * Get subject position at a given time by interpolating keyframes
 * @param {Array<{time: number, position: [number,number,number]}>} keyframes
 * @param {number} time
 * @returns {[number, number, number]}
 */
function getPositionAtTime(keyframes, time) {
  if (!keyframes || keyframes.length === 0) return [0, 0, 0]
  if (keyframes.length === 1) return [...keyframes[0].position]

  // Find surrounding keyframes
  for (let i = 0; i < keyframes.length - 1; i++) {
    const curr = keyframes[i]
    const next = keyframes[i + 1]
    if (time >= curr.time && time <= next.time) {
      const t = (time - curr.time) / (next.time - curr.time)
      return lerp3(curr.position, next.position, t)
    }
  }

  // Outside range — clamp to last keyframe
  return [...keyframes[keyframes.length - 1].position]
}

/**
 * Compute center point between primary and secondary (or just primary if no secondary)
 * @param {CameraContext} ctx
 * @param {number} time
 * @returns {[number, number, number]}
 */
function getActionCenter(ctx, time) {
  const primaryPos = getPositionAtTime(ctx.primaryKeyframes, time)
  if (!ctx.secondaryKeyframes) return primaryPos

  const secondaryPos = getPositionAtTime(ctx.secondaryKeyframes, time)
  return lerp3(primaryPos, secondaryPos, 0.5)
}

/**
 * Follow behind primary subject
 * @param {CameraContext} ctx
 * @returns {CameraResult}
 */
export function tracking_behind(ctx) {
  const { startTime, endTime, primaryKeyframes } = ctx
  const duration = endTime - startTime
  const NUM_KEYFRAMES = 3

  const keyframes = []
  for (let i = 0; i < NUM_KEYFRAMES; i++) {
    const t = i / (NUM_KEYFRAMES - 1)
    const time = startTime + t * duration
    const subjectPos = getPositionAtTime(primaryKeyframes, time)

    // Get subject's facing direction from keyframes
    const nextTime = Math.min(time + 0.5, endTime)
    const nextPos = getPositionAtTime(primaryKeyframes, nextTime)
    const dx = nextPos[0] - subjectPos[0]
    const dz = nextPos[2] - subjectPos[2]
    const angle = Math.atan2(dx, dz)

    // Camera behind and above
    keyframes.push({
      time,
      position: [
        subjectPos[0] - Math.sin(angle) * CAMERA.distance,
        subjectPos[1] + CAMERA.height,
        subjectPos[2] - Math.cos(angle) * CAMERA.distance
      ],
      lookAt: [subjectPos[0], subjectPos[1] + CAMERA.assetHeight * 0.5, subjectPos[2]], // Look at chest height
      fov: CAMERA.fov.normal
    })
  }

  return { keyframes, easing: 'easeInOutQuad' }
}

/**
 * Wide pullback shot showing the full scene
 * @param {CameraContext} ctx
 * @returns {CameraResult}
 */
export function wide_establishing(ctx) {
  const { startTime, endTime, sceneCenter } = ctx

  // Static wide shot — camera doesn't move
  const cameraPos = [
    sceneCenter[0] - CAMERA.wideDistance * 0.7, // Offset for angle
    sceneCenter[1] + CAMERA.wideHeight,
    sceneCenter[2] + CAMERA.wideDistance * 0.7
  ]

  return {
    keyframes: [
      {
        time: startTime,
        position: [...cameraPos],
        lookAt: [...sceneCenter],
        fov: CAMERA.fov.wide
      },
      {
        time: endTime,
        position: [...cameraPos],
        lookAt: [...sceneCenter],
        fov: CAMERA.fov.wide
      }
    ],
    easing: 'linear'
  }
}

/**
 * Tight shot on primary subject's face
 * @param {CameraContext} ctx
 * @returns {CameraResult}
 */
export function close_up(ctx) {
  const { startTime, endTime, primaryKeyframes } = ctx

  const startPos = getPositionAtTime(primaryKeyframes, startTime)
  const endPos = getPositionAtTime(primaryKeyframes, endTime)

  // Get subject facing direction
  const dx = endPos[0] - startPos[0]
  const dz = endPos[2] - startPos[2]
  const angle = Math.abs(dx) > 0.01 || Math.abs(dz) > 0.01
    ? Math.atan2(dx, dz)
    : 0

  // Camera in front at face level
  const makeCameraPos = (subjectPos) => [
    subjectPos[0] + Math.sin(angle) * CAMERA.closeUpDistance,
    subjectPos[1] + CAMERA.assetHeight * 0.8, // Face height
    subjectPos[2] + Math.cos(angle) * CAMERA.closeUpDistance
  ]

  const makeLookAt = (subjectPos) => [
    subjectPos[0],
    subjectPos[1] + CAMERA.assetHeight * 0.8,
    subjectPos[2]
  ]

  return {
    keyframes: [
      {
        time: startTime,
        position: makeCameraPos(startPos),
        lookAt: makeLookAt(startPos),
        fov: CAMERA.fov.tight
      },
      {
        time: endTime,
        position: makeCameraPos(endPos),
        lookAt: makeLookAt(endPos),
        fov: CAMERA.fov.tight
      }
    ],
    easing: 'easeInOutQuad'
  }
}

/**
 * Low camera looking up at subject (heroic/menacing)
 * @param {CameraContext} ctx
 * @returns {CameraResult}
 */
export function dramatic_low_angle(ctx) {
  const { startTime, endTime, primaryKeyframes } = ctx

  const startPos = getPositionAtTime(primaryKeyframes, startTime)
  const endPos = getPositionAtTime(primaryKeyframes, endTime)

  // Camera low and in front
  const distance = CAMERA.closeUpDistance * 1.5

  // Get subject facing direction
  const dx = endPos[0] - startPos[0]
  const dz = endPos[2] - startPos[2]
  const angle = Math.abs(dx) > 0.01 || Math.abs(dz) > 0.01
    ? Math.atan2(dx, dz)
    : 0

  const makeCameraPos = (subjectPos) => [
    subjectPos[0] + Math.sin(angle) * distance,
    subjectPos[1] + CAMERA.lowAngleHeight,
    subjectPos[2] + Math.cos(angle) * distance
  ]

  const makeLookAt = (subjectPos) => [
    subjectPos[0],
    subjectPos[1] + CAMERA.assetHeight * 0.6, // Look up at subject torso
    subjectPos[2]
  ]

  return {
    keyframes: [
      {
        time: startTime,
        position: makeCameraPos(startPos),
        lookAt: makeLookAt(startPos),
        fov: CAMERA.fov.normal
      },
      {
        time: endTime,
        position: makeCameraPos(endPos),
        lookAt: makeLookAt(endPos),
        fov: CAMERA.fov.normal
      }
    ],
    easing: 'easeInOutQuad'
  }
}

/**
 * Camera orbits around center of action
 * @param {CameraContext} ctx
 * @returns {CameraResult}
 */
export function orbit(ctx) {
  const { startTime, endTime, primaryKeyframes, secondaryKeyframes } = ctx
  const duration = endTime - startTime
  const ARC_DEGREES = 135
  const NUM_KEYFRAMES = 5

  const keyframes = []
  const startAngle = 0 // Start from front

  for (let i = 0; i < NUM_KEYFRAMES; i++) {
    const t = i / (NUM_KEYFRAMES - 1)
    const time = startTime + t * duration
    const angle = startAngle + (ARC_DEGREES * Math.PI / 180) * t

    const actionCenter = getActionCenter(ctx, time)

    keyframes.push({
      time,
      position: [
        actionCenter[0] + Math.sin(angle) * CAMERA.orbitRadius,
        actionCenter[1] + CAMERA.height * 0.8,
        actionCenter[2] + Math.cos(angle) * CAMERA.orbitRadius
      ],
      lookAt: [actionCenter[0], actionCenter[1] + CAMERA.assetHeight * 0.5, actionCenter[2]],
      fov: CAMERA.fov.normal
    })
  }

  return { keyframes, easing: 'easeInOutQuad' }
}

/**
 * Camera follows alongside subject from the side
 * @param {CameraContext} ctx
 * @returns {CameraResult}
 */
export function tracking_side(ctx) {
  const { startTime, endTime, primaryKeyframes } = ctx
  const duration = endTime - startTime
  const NUM_KEYFRAMES = 3

  const keyframes = []
  for (let i = 0; i < NUM_KEYFRAMES; i++) {
    const t = i / (NUM_KEYFRAMES - 1)
    const time = startTime + t * duration
    const subjectPos = getPositionAtTime(primaryKeyframes, time)

    // Get subject's movement direction
    const nextTime = Math.min(time + 0.5, endTime)
    const nextPos = getPositionAtTime(primaryKeyframes, nextTime)
    const dx = nextPos[0] - subjectPos[0]
    const dz = nextPos[2] - subjectPos[2]
    const angle = Math.atan2(dx, dz)

    // Camera perpendicular to movement (90 degrees offset)
    const sideAngle = angle + Math.PI / 2

    keyframes.push({
      time,
      position: [
        subjectPos[0] + Math.sin(sideAngle) * CAMERA.sideOffset,
        subjectPos[1] + CAMERA.height * 0.6,
        subjectPos[2] + Math.cos(sideAngle) * CAMERA.sideOffset
      ],
      lookAt: [subjectPos[0], subjectPos[1] + CAMERA.assetHeight * 0.5, subjectPos[2]],
      fov: CAMERA.fov.normal
    })
  }

  return { keyframes, easing: 'easeInOutQuad' }
}

/**
 * Map of all camera templates
 */
export const CAMERAS = {
  tracking_behind,
  wide_establishing,
  close_up,
  dramatic_low_angle,
  orbit,
  tracking_side
}

/**
 * Get a camera template by name
 * @param {string} name
 * @returns {Function|null}
 */
export function getCamera(name) {
  return CAMERAS[name] || null
}

/**
 * Export constants for use in other modules
 */
export { CAMERA }
