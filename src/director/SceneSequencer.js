/**
 * SceneSequencer — Animate resolved scenes in real-time
 *
 * Takes a ResolvedScene (coordinates/keyframes from SpatialResolver) and plays
 * it back in Three.js, animating both assets and camera.
 *
 * @see ./SpatialResolver.js for ResolvedScene format
 * @see ./CLAUDE.md for architecture overview
 */

import { ParticleSystem } from './ParticleSystem.js'

/**
 * @typedef {import('./SpatialResolver').ResolvedScene} ResolvedScene
 * @typedef {import('./SpatialResolver').ResolvedShot} ResolvedShot
 * @typedef {import('./SpatialResolver').AnimationKeyframe} AnimationKeyframe
 * @typedef {import('./SpatialResolver').CameraKeyframe} CameraKeyframe
 * @typedef {import('./SpatialResolver').ResolvedAction} ResolvedAction
 * @typedef {import('./SpatialResolver').ActionKeyframe} ActionKeyframe
 */

// Easing functions
const EASING = {
  linear: t => t,
  easeInOutQuad: t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

/**
 * Linear interpolation between two values
 * @param {number} a - Start value
 * @param {number} b - End value
 * @param {number} t - Progress (0-1)
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t
}

/**
 * Interpolate between two 3D positions
 * @param {[number, number, number]} a
 * @param {[number, number, number]} b
 * @param {number} t - Progress (0-1)
 * @returns {[number, number, number]}
 */
export function lerp3(a, b, t) {
  return [
    lerp(a[0], b[0], t),
    lerp(a[1], b[1], t),
    lerp(a[2], b[2], t)
  ]
}

/**
 * Interpolate between two angles (handles wraparound)
 * @param {number} a - Start angle (radians)
 * @param {number} b - End angle (radians)
 * @param {number} t - Progress (0-1)
 * @returns {number}
 */
export function lerpAngle(a, b, t) {
  // Normalize difference to [-PI, PI]
  let diff = b - a
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  return a + diff * t
}

/**
 * Get interpolated value from keyframes at a given time
 * @param {AnimationKeyframe[]} keyframes - Keyframes with time, position, rotation
 * @param {number} time - Time to sample (relative to shot start)
 * @param {string} property - Property to interpolate ('position' or 'rotation')
 * @param {string} [easing='linear'] - Easing function name
 * @returns {[number, number, number]|number}
 */
export function getValueAtTime(keyframes, time, property, easing = 'linear') {
  if (!keyframes || keyframes.length === 0) {
    return property === 'position' ? [0, 0, 0] : 0
  }

  if (keyframes.length === 1) {
    return keyframes[0][property]
  }

  // Before first keyframe — return first value
  if (time <= keyframes[0].time) {
    return keyframes[0][property]
  }

  // Find surrounding keyframes
  for (let i = 0; i < keyframes.length - 1; i++) {
    const curr = keyframes[i]
    const next = keyframes[i + 1]

    if (time >= curr.time && time <= next.time) {
      // Calculate progress within this segment
      const segmentDuration = next.time - curr.time
      const rawT = segmentDuration > 0 ? (time - curr.time) / segmentDuration : 1
      const t = (EASING[easing] || EASING.linear)(rawT)

      if (property === 'position') {
        return lerp3(curr.position, next.position, t)
      } else if (property === 'rotation') {
        return lerpAngle(curr.rotation, next.rotation, t)
      }
    }
  }

  // Past last keyframe — return last value
  return keyframes[keyframes.length - 1][property]
}

/**
 * Get interpolated camera values at a given time
 * @param {CameraKeyframe[]} keyframes - Camera keyframes
 * @param {number} time - Absolute time in seconds
 * @param {string} [easing='linear'] - Easing function name
 * @returns {{position: [number,number,number], lookAt: [number,number,number], fov: number}}
 */
export function getCameraAtTime(keyframes, time, easing = 'linear') {
  if (!keyframes || keyframes.length === 0) {
    return { position: [0, 10, 20], lookAt: [0, 0, 0], fov: 60 }
  }

  if (keyframes.length === 1) {
    return {
      position: [...keyframes[0].position],
      lookAt: [...keyframes[0].lookAt],
      fov: keyframes[0].fov
    }
  }

  // Before first keyframe
  if (time <= keyframes[0].time) {
    return {
      position: [...keyframes[0].position],
      lookAt: [...keyframes[0].lookAt],
      fov: keyframes[0].fov
    }
  }

  // Find surrounding keyframes
  for (let i = 0; i < keyframes.length - 1; i++) {
    const curr = keyframes[i]
    const next = keyframes[i + 1]

    if (time >= curr.time && time <= next.time) {
      const segmentDuration = next.time - curr.time
      const rawT = segmentDuration > 0 ? (time - curr.time) / segmentDuration : 1
      const t = (EASING[easing] || EASING.linear)(rawT)

      return {
        position: lerp3(curr.position, next.position, t),
        lookAt: lerp3(curr.lookAt, next.lookAt, t),
        fov: lerp(curr.fov, next.fov, t)
      }
    }
  }

  // Past last keyframe
  const last = keyframes[keyframes.length - 1]
  return {
    position: [...last.position],
    lookAt: [...last.lookAt],
    fov: last.fov
  }
}

/**
 * SceneSequencer — Orchestrates playback of resolved scenes
 */
export class SceneSequencer {
  /**
   * @param {Object} options
   * @param {ResolvedScene} options.resolvedScene - Scene data from SpatialResolver
   * @param {Object} options.renderer - WorldRenderer instance (or any object with camera)
   * @param {Map<string, Object>} options.assetMeshes - Map of assetId → Three.js mesh
   * @param {number} [options.assetScale=1] - Scale factor for assets (used for Y offset)
   * @param {Function} [options.onShotChange] - Called when current shot changes (shotIndex)
   * @param {Function} [options.onTimeUpdate] - Called each frame (currentTime)
   * @param {Function} [options.onComplete] - Called when playback reaches end
   */
  constructor({ resolvedScene, renderer, assetMeshes, assetScale = 1, onShotChange, onTimeUpdate, onComplete }) {
    this.resolvedScene = resolvedScene
    this.renderer = renderer
    this.assetMeshes = assetMeshes || new Map()
    this.assetScale = assetScale

    // Callbacks
    this.onShotChange = onShotChange
    this.onTimeUpdate = onTimeUpdate
    this.onComplete = onComplete

    // Playback state
    this._currentTime = 0
    this._isPlaying = false
    this._currentShotIndex = 0

    // Action system
    this.particleSystem = renderer?.scene ? new ParticleSystem(renderer.scene) : null
    this._triggeredParticles = new Set()        // Track one-shot triggers (start, at_time)
    this._continuousParticleTimers = new Map()  // For continuous emitters: actionKey → lastSpawnTime
  }

  /**
   * Get current playback time in seconds
   * @returns {number}
   */
  get currentTime() {
    return this._currentTime
  }

  /**
   * Get total scene duration in seconds
   * @returns {number}
   */
  get duration() {
    return this.resolvedScene?.duration || 0
  }

  /**
   * Check if currently playing
   * @returns {boolean}
   */
  get isPlaying() {
    return this._isPlaying
  }

  /**
   * Get current shot index
   * @returns {number}
   */
  get currentShotIndex() {
    return this._currentShotIndex
  }

  /**
   * Start or resume playback
   */
  play() {
    this._isPlaying = true
  }

  /**
   * Pause playback
   */
  pause() {
    this._isPlaying = false
  }

  /**
   * Stop playback and reset to start
   */
  stop() {
    this._isPlaying = false
    this.seek(0)
  }

  /**
   * Jump to a specific time
   * @param {number} time - Time in seconds
   */
  seek(time) {
    const previousTime = this._currentTime
    this._currentTime = Math.max(0, Math.min(time, this.duration))

    // Update shot index
    const newShotIndex = this._findShotAtTime(this._currentTime)
    if (newShotIndex !== this._currentShotIndex) {
      this._currentShotIndex = newShotIndex
      this.onShotChange?.(newShotIndex)
    }

    // Reset particle triggers when seeking (they'll re-trigger as time passes)
    this._resetParticleTriggers()

    // Apply positions immediately when seeking
    this._applyPositions()

    this.onTimeUpdate?.(this._currentTime)
  }

  /**
   * Reset particle trigger tracking (called on seek)
   * @private
   */
  _resetParticleTriggers() {
    this._triggeredParticles.clear()
    this._continuousParticleTimers.clear()
    this.particleSystem?.clear()
  }

  /**
   * Find which shot contains the given time
   * @param {number} time
   * @returns {number} Shot index
   */
  _findShotAtTime(time) {
    const shots = this.resolvedScene?.shots || []
    for (let i = 0; i < shots.length; i++) {
      if (time >= shots[i].startTime && time < shots[i].endTime) {
        return i
      }
    }
    // If at or past end, return last shot
    return Math.max(0, shots.length - 1)
  }

  /**
   * Update function called each frame
   * @param {number} dt - Delta time in seconds
   */
  update(dt) {
    if (!this._isPlaying || !this.resolvedScene) return

    // Advance time
    const previousTime = this._currentTime
    this._currentTime += dt

    // Check for completion
    if (this._currentTime >= this.duration) {
      this._currentTime = this.duration
      this._isPlaying = false
      this._applyPositions(dt)
      this.onTimeUpdate?.(this._currentTime)
      this.onComplete?.()
      return
    }

    // Check for shot change
    const newShotIndex = this._findShotAtTime(this._currentTime)
    if (newShotIndex !== this._currentShotIndex) {
      this._currentShotIndex = newShotIndex
      this.onShotChange?.(newShotIndex)
    }

    // Apply positions and camera
    this._applyPositions(dt)

    this.onTimeUpdate?.(this._currentTime)
  }

  /**
   * Apply interpolated positions to meshes and camera
   * @param {number} [dt=0] - Delta time for animations
   */
  _applyPositions(dt = 0) {
    const shot = this.resolvedScene?.shots?.[this._currentShotIndex]
    if (!shot) return

    // Time relative to shot start
    const shotTime = this._currentTime - shot.startTime

    // Update asset positions
    for (const anim of shot.animations) {
      const mesh = this.assetMeshes.get(anim.assetId)
      if (!mesh) continue

      // Get base position/rotation from spatial relationships
      const basePosition = getValueAtTime(anim.keyframes, shotTime, 'position')
      const baseRotation = getValueAtTime(anim.keyframes, shotTime, 'rotation')

      // Get additive action offset
      const actionOffset = this._getActionOffset(anim.assetId, this._currentTime)

      // Apply combined transform with Y offset for ground level
      mesh.position.set(
        basePosition[0] + actionOffset.position[0],
        basePosition[1] + this.assetScale + actionOffset.position[1],
        basePosition[2] + actionOffset.position[2]
      )

      // Rotation: X/Z from action, Y combines base + action
      mesh.rotation.set(
        actionOffset.rotation[0],
        baseRotation + actionOffset.rotation[1],
        actionOffset.rotation[2]
      )

      // Scale: multiply base by action multiplier
      mesh.scale.setScalar(this.assetScale * actionOffset.scale)

      // Run asset's built-in animation if present
      if (dt > 0 && mesh.userData?.animate) {
        mesh.userData.animate.call(mesh, dt)
      }
    }

    // Process action particles
    if (shot.actions && this.particleSystem) {
      this._processActions(shot, dt)
      this.particleSystem.update(dt)
    }

    // Update camera
    if (shot.camera && this.renderer?.camera) {
      const cam = getCameraAtTime(shot.camera.keyframes, this._currentTime, shot.camera.easing)

      this.renderer.camera.position.set(cam.position[0], cam.position[1], cam.position[2])
      this.renderer.camera.lookAt(cam.lookAt[0], cam.lookAt[1], cam.lookAt[2])

      if (this.renderer.camera.fov !== cam.fov) {
        this.renderer.camera.fov = cam.fov
        this.renderer.camera.updateProjectionMatrix()
      }
    }
  }

  /**
   * Get combined additive offset from all active actions for an asset
   * @param {string} assetId - Asset to get offset for
   * @param {number} absoluteTime - Current absolute time in seconds
   * @returns {{position: [number,number,number], rotation: [number,number,number], scale: number}}
   */
  _getActionOffset(assetId, absoluteTime) {
    const result = {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: 1
    }

    // Check all shots for active actions on this asset
    for (const shot of this.resolvedScene?.shots || []) {
      if (!shot.actions) continue

      for (const action of shot.actions) {
        if (action.assetId !== assetId) continue
        if (absoluteTime < action.startTime || absoluteTime > action.endTime) continue

        // Calculate normalized time within action (0-1)
        const normalizedTime = (absoluteTime - action.startTime) / action.duration

        // Interpolate keyframes
        const posOffset = this._interpolateActionKeyframes(action.keyframes, normalizedTime, 'positionOffset')
        const rotOffset = this._interpolateActionKeyframes(action.keyframes, normalizedTime, 'rotationOffset')
        const scaleMultiplier = this._interpolateActionKeyframes(action.keyframes, normalizedTime, 'scaleMultiplier')

        // Accumulate offsets (additive)
        result.position[0] += posOffset[0]
        result.position[1] += posOffset[1]
        result.position[2] += posOffset[2]
        result.rotation[0] += rotOffset[0]
        result.rotation[1] += rotOffset[1]
        result.rotation[2] += rotOffset[2]
        result.scale *= scaleMultiplier
      }
    }

    return result
  }

  /**
   * Interpolate action keyframes for a specific property
   * @param {ActionKeyframe[]} keyframes - Action keyframes
   * @param {number} normalizedTime - Time 0-1 within action
   * @param {string} property - Property to interpolate
   * @returns {[number,number,number]|number}
   */
  _interpolateActionKeyframes(keyframes, normalizedTime, property) {
    if (!keyframes || keyframes.length === 0) {
      return property === 'scaleMultiplier' ? 1 : [0, 0, 0]
    }

    const defaultValue = property === 'scaleMultiplier' ? 1 : [0, 0, 0]

    // Before first keyframe
    if (normalizedTime <= keyframes[0].time) {
      return keyframes[0][property] ?? defaultValue
    }

    // Find surrounding keyframes
    for (let i = 0; i < keyframes.length - 1; i++) {
      const curr = keyframes[i]
      const next = keyframes[i + 1]

      if (normalizedTime >= curr.time && normalizedTime <= next.time) {
        const segmentDuration = next.time - curr.time
        const t = segmentDuration > 0 ? (normalizedTime - curr.time) / segmentDuration : 1

        const currVal = curr[property] ?? defaultValue
        const nextVal = next[property] ?? defaultValue

        if (property === 'scaleMultiplier') {
          return lerp(currVal, nextVal, t)
        } else {
          return lerp3(currVal, nextVal, t)
        }
      }
    }

    // Past last keyframe
    return keyframes[keyframes.length - 1][property] ?? defaultValue
  }

  /**
   * Process particle triggers for active actions
   * @param {ResolvedShot} shot - Current shot
   * @param {number} dt - Delta time
   */
  _processActions(shot, dt) {
    if (!shot.actions) return

    const CONTINUOUS_EMIT_RATE = 0.05 // Emit every 50ms for continuous

    for (const action of shot.actions) {
      // Skip if action not active
      if (this._currentTime < action.startTime || this._currentTime > action.endTime) continue

      if (!action.particles) continue

      const normalizedTime = (this._currentTime - action.startTime) / action.duration

      for (let pIdx = 0; pIdx < action.particles.length; pIdx++) {
        const pConfig = action.particles[pIdx]
        const triggerKey = `${action.assetId}:${action.startTime}:${pIdx}`

        // Get asset position for particle spawn
        const mesh = this.assetMeshes.get(action.assetId)
        if (!mesh) continue

        const worldPosition = [mesh.position.x, mesh.position.y, mesh.position.z]
        const worldRotation = mesh.rotation.y

        // Handle different trigger types
        if (pConfig.trigger === 'start') {
          // Trigger once at action start
          if (!this._triggeredParticles.has(triggerKey) && normalizedTime >= 0) {
            this._triggeredParticles.add(triggerKey)
            this.particleSystem.spawn(pConfig, worldPosition, worldRotation)
          }
        } else if (pConfig.trigger === 'continuous') {
          // Emit at regular intervals while action active
          const lastSpawn = this._continuousParticleTimers.get(triggerKey) || 0
          if (this._currentTime - lastSpawn >= CONTINUOUS_EMIT_RATE) {
            this._continuousParticleTimers.set(triggerKey, this._currentTime)
            // Spawn fewer particles for continuous (rate-limited)
            const continuousConfig = { ...pConfig, count: Math.ceil(pConfig.count / 20) }
            this.particleSystem.spawn(continuousConfig, worldPosition, worldRotation)
          }
        } else if (pConfig.trigger?.startsWith('at_time:')) {
          // Trigger once at specific normalized time
          const triggerTime = parseFloat(pConfig.trigger.split(':')[1]) || 0
          if (!this._triggeredParticles.has(triggerKey) && normalizedTime >= triggerTime) {
            this._triggeredParticles.add(triggerKey)
            this.particleSystem.spawn(pConfig, worldPosition, worldRotation)
          }
        }
      }
    }
  }

  /**
   * Clean up resources
   */
  dispose() {
    this._isPlaying = false
    this.onShotChange = null
    this.onTimeUpdate = null
    this.onComplete = null

    // Clean up particle system
    this.particleSystem?.dispose()
    this.particleSystem = null
    this._triggeredParticles.clear()
    this._continuousParticleTimers.clear()
  }
}
