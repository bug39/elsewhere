/**
 * ParticleSystem — GPU-instanced particle renderer for Director Mode actions
 *
 * Renders physics-based particle effects (fire, dust, magic) using THREE.InstancedMesh
 * for high performance. Particles are defined by physics parameters, not templates.
 *
 * Design:
 * - Structure of Arrays (SoA) for cache-friendly updates
 * - Pool-based allocation (swap dead with last active)
 * - Additive blending for fire/glow effects
 *
 * @see ./CLAUDE.md for architecture overview
 */

import * as THREE from 'three'

// Default limits
const DEFAULT_MAX_PARTICLES = 10000
const PARTICLE_SIZE = 0.5

/**
 * @typedef {Object} ParticleConfig
 * @property {string} trigger - "start" | "continuous" | "at_time:X" (X = normalized 0-1)
 * @property {number} count - Number of particles to emit
 * @property {[number, number, number]} color - RGB 0-255
 * @property {number} [colorVariance=0] - Random color variance 0-1
 * @property {number} [size=0.5] - Base particle size in meters
 * @property {number} [sizeVariance=0] - Random size variance 0-1
 * @property {number} [lifetime=1] - Particle lifetime in seconds
 * @property {[number, number, number]} velocity - Direction + speed (m/s)
 * @property {number} [velocitySpread=0] - Cone angle in degrees
 * @property {number} [gravity=1] - -1 = float up, 1 = fall down
 * @property {[number, number, number]} [emitOffset=[0,0,0]] - Offset from asset origin
 * @property {string} [shape="point"] - "point" | "cone" | "sphere"
 */

/**
 * GPU-instanced particle system
 */
export class ParticleSystem {
  /**
   * @param {THREE.Scene} scene - Three.js scene to add particles to
   * @param {Object} [options]
   * @param {number} [options.maxParticles=10000] - Maximum concurrent particles
   */
  constructor(scene, { maxParticles = DEFAULT_MAX_PARTICLES } = {}) {
    this.scene = scene
    this.maxParticles = maxParticles
    this._activeCount = 0

    // Structure of Arrays for particle data
    this._positions = new Float32Array(maxParticles * 3)
    this._velocities = new Float32Array(maxParticles * 3)
    this._colors = new Float32Array(maxParticles * 3)
    this._sizes = new Float32Array(maxParticles)
    this._lifetimes = new Float32Array(maxParticles)      // Remaining lifetime
    this._maxLifetimes = new Float32Array(maxParticles)   // Original lifetime (for fade)
    this._gravities = new Float32Array(maxParticles)

    // Create instanced mesh
    this._createMesh()
  }

  /**
   * Create the THREE.InstancedMesh for rendering
   * @private
   */
  _createMesh() {
    // Simple plane geometry facing camera
    const geometry = new THREE.PlaneGeometry(PARTICLE_SIZE, PARTICLE_SIZE)

    // Custom shader material for particles
    const material = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: `
        attribute vec3 instanceColor;
        attribute float instanceOpacity;
        varying vec3 vColor;
        varying float vOpacity;

        void main() {
          vColor = instanceColor;
          vOpacity = instanceOpacity;

          // Billboard: always face camera
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          mvPosition.xy += position.xy;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vOpacity;

        void main() {
          // Soft circular particle
          vec2 center = gl_PointCoord - 0.5;
          float dist = length(center * 2.0);
          float alpha = smoothstep(1.0, 0.3, dist) * vOpacity;

          if (alpha < 0.01) discard;

          gl_FragColor = vec4(vColor, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    })

    this._mesh = new THREE.InstancedMesh(geometry, material, this.maxParticles)
    this._mesh.frustumCulled = false
    this._mesh.count = 0

    // Add custom attributes for color and opacity
    const instanceColors = new THREE.InstancedBufferAttribute(
      new Float32Array(this.maxParticles * 3),
      3
    )
    const instanceOpacities = new THREE.InstancedBufferAttribute(
      new Float32Array(this.maxParticles),
      1
    )
    this._mesh.geometry.setAttribute('instanceColor', instanceColors)
    this._mesh.geometry.setAttribute('instanceOpacity', instanceOpacities)

    this._instanceColors = instanceColors
    this._instanceOpacities = instanceOpacities

    // Dummy matrix for positioning
    this._matrix = new THREE.Matrix4()
    this._tempVec = new THREE.Vector3()

    this.scene.add(this._mesh)
  }

  /**
   * Spawn particles from a config at a world position
   *
   * @param {ParticleConfig} config - Particle configuration
   * @param {[number, number, number]} worldPosition - Asset world position
   * @param {number} worldRotation - Asset Y rotation in radians
   */
  spawn(config, worldPosition, worldRotation = 0) {
    const count = Math.min(config.count || 10, this.maxParticles - this._activeCount)
    if (count <= 0) return

    const baseColor = config.color || [255, 255, 255]
    const colorVar = config.colorVariance || 0
    const baseSize = config.size || 0.5
    const sizeVar = config.sizeVariance || 0
    const lifetime = config.lifetime || 1
    const velocity = config.velocity || [0, 1, 0]
    const spread = (config.velocitySpread || 0) * Math.PI / 180 // Convert to radians
    const gravity = config.gravity ?? 1
    const emitOffset = config.emitOffset || [0, 0, 0]
    const shape = config.shape || 'point'

    // Calculate emit position with rotation
    const cos = Math.cos(worldRotation)
    const sin = Math.sin(worldRotation)
    const rotatedOffset = [
      emitOffset[0] * cos - emitOffset[2] * sin,
      emitOffset[1],
      emitOffset[0] * sin + emitOffset[2] * cos
    ]

    const emitPos = [
      worldPosition[0] + rotatedOffset[0],
      worldPosition[1] + rotatedOffset[1],
      worldPosition[2] + rotatedOffset[2]
    ]

    // Rotate velocity direction
    const rotatedVel = [
      velocity[0] * cos - velocity[2] * sin,
      velocity[1],
      velocity[0] * sin + velocity[2] * cos
    ]

    for (let i = 0; i < count; i++) {
      const idx = this._activeCount + i
      const i3 = idx * 3

      // Position with shape variance
      let px = emitPos[0]
      let py = emitPos[1]
      let pz = emitPos[2]

      if (shape === 'sphere') {
        const r = Math.random() * 0.5
        const theta = Math.random() * Math.PI * 2
        const phi = Math.acos(2 * Math.random() - 1)
        px += r * Math.sin(phi) * Math.cos(theta)
        py += r * Math.sin(phi) * Math.sin(theta)
        pz += r * Math.cos(phi)
      }

      this._positions[i3] = px
      this._positions[i3 + 1] = py
      this._positions[i3 + 2] = pz

      // Velocity with spread
      let vx = rotatedVel[0]
      let vy = rotatedVel[1]
      let vz = rotatedVel[2]

      if (spread > 0) {
        // Add random cone spread
        const spreadAngle = Math.random() * spread
        const spreadDir = Math.random() * Math.PI * 2

        // Create perpendicular vectors
        const velMag = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1
        const spreadMag = Math.tan(spreadAngle) * velMag

        // Simple spread in XZ plane relative to velocity direction
        vx += Math.cos(spreadDir) * spreadMag
        vz += Math.sin(spreadDir) * spreadMag
      }

      this._velocities[i3] = vx
      this._velocities[i3 + 1] = vy
      this._velocities[i3 + 2] = vz

      // Color with variance
      const cv = colorVar * (Math.random() - 0.5) * 2
      this._colors[i3] = Math.max(0, Math.min(1, (baseColor[0] / 255) + cv))
      this._colors[i3 + 1] = Math.max(0, Math.min(1, (baseColor[1] / 255) + cv))
      this._colors[i3 + 2] = Math.max(0, Math.min(1, (baseColor[2] / 255) + cv))

      // Size with variance
      this._sizes[idx] = baseSize * (1 + sizeVar * (Math.random() - 0.5) * 2)

      // Lifetime (with small variance for natural look)
      this._lifetimes[idx] = lifetime * (0.8 + Math.random() * 0.4)
      this._maxLifetimes[idx] = this._lifetimes[idx]

      // Gravity
      this._gravities[idx] = gravity
    }

    this._activeCount += count
  }

  /**
   * Update particle physics and rendering each frame
   * @param {number} dt - Delta time in seconds
   */
  update(dt) {
    if (this._activeCount === 0) return

    const GRAVITY_ACCEL = 9.8

    let i = 0
    while (i < this._activeCount) {
      const i3 = i * 3

      // Update lifetime
      this._lifetimes[i] -= dt

      // Remove dead particles by swapping with last active
      if (this._lifetimes[i] <= 0) {
        const lastIdx = this._activeCount - 1
        const last3 = lastIdx * 3

        if (i !== lastIdx) {
          // Swap all arrays
          this._positions[i3] = this._positions[last3]
          this._positions[i3 + 1] = this._positions[last3 + 1]
          this._positions[i3 + 2] = this._positions[last3 + 2]

          this._velocities[i3] = this._velocities[last3]
          this._velocities[i3 + 1] = this._velocities[last3 + 1]
          this._velocities[i3 + 2] = this._velocities[last3 + 2]

          this._colors[i3] = this._colors[last3]
          this._colors[i3 + 1] = this._colors[last3 + 1]
          this._colors[i3 + 2] = this._colors[last3 + 2]

          this._sizes[i] = this._sizes[lastIdx]
          this._lifetimes[i] = this._lifetimes[lastIdx]
          this._maxLifetimes[i] = this._maxLifetimes[lastIdx]
          this._gravities[i] = this._gravities[lastIdx]
        }

        this._activeCount--
        continue // Don't increment i, check swapped particle
      }

      // Apply gravity to velocity
      this._velocities[i3 + 1] -= GRAVITY_ACCEL * this._gravities[i] * dt

      // Update position from velocity
      this._positions[i3] += this._velocities[i3] * dt
      this._positions[i3 + 1] += this._velocities[i3 + 1] * dt
      this._positions[i3 + 2] += this._velocities[i3 + 2] * dt

      i++
    }

    // Update instanced mesh
    this._updateMesh()
  }

  /**
   * Sync particle data to GPU
   * @private
   */
  _updateMesh() {
    for (let i = 0; i < this._activeCount; i++) {
      const i3 = i * 3

      // Set instance matrix (position + scale)
      this._tempVec.set(
        this._positions[i3],
        this._positions[i3 + 1],
        this._positions[i3 + 2]
      )
      this._matrix.makeTranslation(this._tempVec.x, this._tempVec.y, this._tempVec.z)
      this._matrix.scale(this._tempVec.set(this._sizes[i], this._sizes[i], this._sizes[i]))
      this._mesh.setMatrixAt(i, this._matrix)

      // Set color
      this._instanceColors.setXYZ(i, this._colors[i3], this._colors[i3 + 1], this._colors[i3 + 2])

      // Set opacity based on lifetime (fade out)
      const lifeRatio = this._lifetimes[i] / this._maxLifetimes[i]
      this._instanceOpacities.setX(i, lifeRatio)
    }

    this._mesh.count = this._activeCount
    this._mesh.instanceMatrix.needsUpdate = true
    this._instanceColors.needsUpdate = true
    this._instanceOpacities.needsUpdate = true
  }

  /**
   * Remove all active particles
   */
  clear() {
    this._activeCount = 0
    this._mesh.count = 0
  }

  /**
   * Get current active particle count
   * @returns {number}
   */
  get activeCount() {
    return this._activeCount
  }

  /**
   * Clean up resources
   */
  dispose() {
    this.clear()
    this.scene.remove(this._mesh)
    this._mesh.geometry.dispose()
    this._mesh.material.dispose()
    this._mesh = null
  }
}
