import * as THREE from 'three'
import { WORLD_SIZE } from '../shared/constants'

const WALK_SPEED = 2 // meters per second
const IDLE_MIN_TIME = 2 // seconds
const IDLE_MAX_TIME = 5 // seconds

// M8 FIX: World boundary constants
const WORLD_MIN = 0
const WORLD_MAX = WORLD_SIZE

/**
 * NPC behavior states
 */
const STATE = {
  IDLE: 'idle',
  WALKING: 'walking',
  TALKING: 'talking'
}

/**
 * Controls a single NPC instance
 */
class NPCInstance {
  constructor(mesh, config) {
    this.mesh = mesh
    this.config = config // { type: 'idle' | 'wander', radius?: number }
    this.state = STATE.IDLE
    this.homePosition = new THREE.Vector3().copy(mesh.position)
    this.targetPosition = new THREE.Vector3()
    this.stateTimer = 0
    this.idleTime = this.randomIdleTime()

    // For walk animation
    this.walkPhase = 0
    this.legPivots = null
    this.armPivots = null
    this.wingPivots = null

    // Pooled vector for movement calculations (avoids per-frame allocation)
    this._direction = new THREE.Vector3()

    // Find animation pivot groups if they exist
    this.findAnimationPivots()
  }

  /**
   * Find leg, arm, and wing pivot groups for walk animation
   */
  findAnimationPivots() {
    if (this.mesh.userData?.parts) {
      this.legPivots = this.mesh.userData.parts.legPivots || null
      this.armPivots = this.mesh.userData.parts.armPivots || null
      this.wingPivots = this.mesh.userData.parts.wingPivots || null
    }
    // Detect archetype from userData (set by compiler)
    this.archetype = this.mesh.userData?.archetype || 'biped'
    // Quadruped detection: 4 legs and no arms
    if (this.legPivots?.length >= 4 && !this.armPivots?.length) {
      this.archetype = 'quadruped'
    }
  }

  /**
   * Get random idle time
   */
  randomIdleTime() {
    return IDLE_MIN_TIME + Math.random() * (IDLE_MAX_TIME - IDLE_MIN_TIME)
  }

  /**
   * Pick a random point within wander radius
   */
  pickWanderTarget() {
    // L5 FIX: Validate wander radius (default to 10, clamp to positive)
    const radius = Math.max(1, this.config.radius || 10)
    const angle = Math.random() * Math.PI * 2
    const distance = Math.random() * radius

    // M8 FIX: Clamp wander target to world bounds
    this.targetPosition.set(
      Math.max(WORLD_MIN, Math.min(WORLD_MAX, this.homePosition.x + Math.cos(angle) * distance)),
      this.homePosition.y,
      Math.max(WORLD_MIN, Math.min(WORLD_MAX, this.homePosition.z + Math.sin(angle) * distance))
    )
  }

  /**
   * Start talking (pause movement)
   * @param {THREE.Vector3} playerPosition - Optional player position to face towards
   */
  startTalking(playerPosition = null) {
    this.state = STATE.TALKING

    // L3 FIX: Face the player if position provided
    if (playerPosition && this.mesh) {
      const dx = playerPosition.x - this.mesh.position.x
      const dz = playerPosition.z - this.mesh.position.z
      this.mesh.rotation.y = Math.atan2(dx, dz)
    }
  }

  /**
   * Stop talking (resume previous behavior)
   */
  stopTalking() {
    this.state = STATE.IDLE
    this.stateTimer = 0
    this.idleTime = this.randomIdleTime()
  }

  /**
   * Update NPC behavior
   * @param {number} dt - Delta time
   * @param {Object} renderer - WorldRenderer for terrain height queries
   */
  update(dt, renderer = null) {
    // Don't update if talking
    if (this.state === STATE.TALKING) {
      this.updateIdleAnimation(dt)
      return
    }

    // Idle behavior - just play idle animation
    if (this.config.type === 'idle') {
      this.updateIdleAnimation(dt)
      return
    }

    // Wander behavior
    if (this.config.type === 'wander') {
      this.updateWanderBehavior(dt, renderer)
    }
  }

  /**
   * Update idle animation
   */
  updateIdleAnimation(dt) {
    // If the asset has its own animate function, use it
    if (this.mesh.userData?.animate) {
      this.mesh.userData.animate.call(this.mesh, dt)
    }
  }

  /**
   * Update wander behavior
   * @param {number} dt - Delta time
   * @param {Object} renderer - WorldRenderer for terrain height queries
   */
  updateWanderBehavior(dt, renderer = null) {
    this.stateTimer += dt

    if (this.state === STATE.IDLE) {
      // Check if it's time to start walking
      if (this.stateTimer >= this.idleTime) {
        this.pickWanderTarget()
        this.state = STATE.WALKING
        this.stateTimer = 0
      } else {
        this.updateIdleAnimation(dt)
      }
    } else if (this.state === STATE.WALKING) {
      // Move toward target (reuse pooled vector)
      this._direction.subVectors(this.targetPosition, this.mesh.position)

      const distance = this._direction.length()

      if (distance < 0.5) {
        // Reached target, go back to idle
        this.state = STATE.IDLE
        this.stateTimer = 0
        this.idleTime = this.randomIdleTime()
        this.walkPhase = 0

        // Reset body dynamics when stopping
        const asset = this.mesh.children?.find(c => c.name !== '__selectionHelper__')
        if (asset && asset.userData._walkBaseY !== undefined) {
          asset.position.y = asset.userData._walkBaseY
          asset.rotation.z = 0
        }
      } else {
        // Move toward target
        this._direction.normalize()
        const moveDistance = Math.min(WALK_SPEED * dt, distance)

        this.mesh.position.x += this._direction.x * moveDistance
        this.mesh.position.z += this._direction.z * moveDistance

        // E2 FIX: Update Y position based on terrain height
        // Must include centerOffset to match how InstanceManager positions assets
        const terrainY = renderer?.getTerrainHeight(this.mesh.position.x, this.mesh.position.z) ?? 0
        const centerOffset = this.mesh.userData?.centerOffset
        const scale = this.mesh.scale?.x ?? 1
        this.mesh.position.y = terrainY + (centerOffset?.y ?? 0) * scale

        // Face movement direction
        this.mesh.rotation.y = Math.atan2(this._direction.x, this._direction.z)

        // Update walk animation
        this.updateWalkAnimation(dt)
      }
    }
  }

  /**
   * Update procedural walk animation with body dynamics
   */
  updateWalkAnimation(dt) {
    this.walkPhase += dt * 8 // Walk cycle speed

    // Get the actual asset inside the container (skip selection helper)
    const asset = this.mesh.children?.find(c => c.name !== '__selectionHelper__')

    // Body dynamics - adds life to walk cycle
    if (asset) {
      // Initialize base Y on first walk frame
      if (asset.userData._walkBaseY === undefined) {
        asset.userData._walkBaseY = asset.position.y
      }

      // Body bob: 2x frequency for step cadence (bounce with each foot strike)
      // Using Math.abs ensures always-positive bounce
      const bobAmplitude = 0.03
      asset.position.y = asset.userData._walkBaseY + Math.abs(Math.sin(this.walkPhase * 2)) * bobAmplitude

      // Body sway: lateral rock at walk frequency
      const swayAmplitude = 0.02
      asset.rotation.z = Math.sin(this.walkPhase) * swayAmplitude
    }

    // If asset has leg pivots, animate them
    if (this.legPivots && Array.isArray(this.legPivots)) {
      if (this.archetype === 'quadruped' && this.legPivots.length >= 4) {
        // Quadruped diagonal gait: front-left + back-right move together
        // Phase map: [FL, FR, BL, BR] = [0, PI, PI, 0]
        const phaseMap = [0, Math.PI, Math.PI, 0]
        // Use for-loop instead of forEach to avoid per-frame closure allocation
        for (let i = 0; i < this.legPivots.length; i++) {
          const pivot = this.legPivots[i]
          // Check for per-joint animation config
          const animConfig = pivot.userData?.animConfig
          if (animConfig?.enabled === false) continue

          const amplitude = (animConfig?.amplitude ?? 1) * 0.35
          const frequency = animConfig?.frequency ?? 1
          const phase = (this.walkPhase * frequency) + (phaseMap[i % 4] || 0)
          if (pivot.rotation) {
            pivot.rotation.x = Math.sin(phase) * amplitude
          }
        }
      } else {
        // Biped: alternating legs
        // Use for-loop instead of forEach to avoid per-frame closure allocation
        for (let i = 0; i < this.legPivots.length; i++) {
          const pivot = this.legPivots[i]
          const animConfig = pivot.userData?.animConfig
          if (animConfig?.enabled === false) continue

          const amplitude = (animConfig?.amplitude ?? 1) * 0.4
          const frequency = animConfig?.frequency ?? 1
          const phase = (this.walkPhase * frequency) + (i * Math.PI)
          if (pivot.rotation) {
            pivot.rotation.x = Math.sin(phase) * amplitude
          }
        }
      }
    }

    // If asset has arm pivots, animate them (opposite phase to legs)
    if (this.armPivots && Array.isArray(this.armPivots)) {
      // Use for-loop instead of forEach to avoid per-frame closure allocation
      for (let i = 0; i < this.armPivots.length; i++) {
        const pivot = this.armPivots[i]
        const animConfig = pivot.userData?.animConfig
        if (animConfig?.enabled === false) continue

        const amplitude = (animConfig?.amplitude ?? 1) * 0.3
        const frequency = animConfig?.frequency ?? 1
        const phase = (this.walkPhase * frequency) + (i * Math.PI) + Math.PI
        if (pivot.rotation) {
          pivot.rotation.x = Math.sin(phase) * amplitude
        }
      }
    }

    // If asset has wing pivots, animate them (flapping)
    if (this.wingPivots && Array.isArray(this.wingPivots)) {
      // Use for-loop instead of forEach to avoid per-frame closure allocation
      for (let i = 0; i < this.wingPivots.length; i++) {
        const pivot = this.wingPivots[i]
        const animConfig = pivot.userData?.animConfig
        if (animConfig?.enabled === false) continue

        const amplitude = (animConfig?.amplitude ?? 1) * 0.3
        const frequency = animConfig?.frequency ?? 1
        // Wings flap together (no phase offset between left/right)
        const flapPhase = this.walkPhase * 1.5 * frequency
        if (pivot.rotation) {
          pivot.rotation.z = Math.sin(flapPhase) * amplitude * (i % 2 === 0 ? 1 : -1) // Mirror for left/right
        }
      }
    }
  }
}

/**
 * Manages all NPCs in the world
 */
export class NPCController {
  constructor() {
    this.npcs = new Map() // instanceId -> NPCInstance
    this.renderer = null // E2 FIX: Reference to WorldRenderer for terrain height queries
  }

  /**
   * E2 FIX: Set the renderer reference for terrain height queries
   */
  setRenderer(renderer) {
    this.renderer = renderer
  }

  /**
   * Register an NPC
   */
  register(instanceId, mesh, behaviorConfig) {
    if (!behaviorConfig || behaviorConfig.type === 'none') {
      return
    }

    // Mark mesh as NPC so WorldRenderer skips it in the generic animation loop
    mesh.userData.isNPC = true

    const npc = new NPCInstance(mesh, behaviorConfig)
    this.npcs.set(instanceId, npc)
  }

  /**
   * Unregister an NPC
   */
  unregister(instanceId) {
    this.npcs.delete(instanceId)
  }

  /**
   * Get NPC by instance ID
   */
  get(instanceId) {
    return this.npcs.get(instanceId)
  }

  /**
   * Start NPC dialogue
   * @param {string} instanceId
   * @param {THREE.Vector3} playerPosition - Optional player position to face towards
   */
  startDialogue(instanceId, playerPosition = null) {
    const npc = this.npcs.get(instanceId)
    if (npc) {
      npc.startTalking(playerPosition)
    }
  }

  /**
   * End NPC dialogue
   */
  endDialogue(instanceId) {
    const npc = this.npcs.get(instanceId)
    if (npc) {
      npc.stopTalking()
    }
  }

  /**
   * Update all NPCs
   */
  update(dt) {
    for (const [id, npc] of this.npcs) {
      // H1 FIX: Wrap in try/catch so one broken NPC doesn't halt all NPCs
      try {
        // E2 FIX: Pass renderer for terrain height queries
        npc.update(dt, this.renderer)
      } catch (err) {
        console.error(`[NPCController] Error updating NPC ${id}:`, err)
        // Continue updating other NPCs
      }
    }
  }

  /**
   * Clear all NPCs
   */
  clear() {
    this.npcs.clear()
  }

  /**
   * Sync NPCs with placed assets - only register new NPCs, unregister removed ones,
   * and update behavior config if changed. Preserves existing NPC state (walk targets,
   * timers, animation phase) to prevent thrashing on every world change.
   *
   * @param {Array} placedAssets - Array of placed asset instances
   * @param {Array} library - Array of library assets
   * @param {Map} instanceMeshes - Map of instanceId -> THREE.Object3D meshes
   * @param {Map} [libraryMap] - Optional O(1) lookup map (id -> library asset)
   */
  syncNPCs(placedAssets, library, instanceMeshes, libraryMap = null) {
    const currentNPCIds = new Set()
    // Use provided Map for O(1) lookup, or fall back to building one
    const libMap = libraryMap || new Map(library.map(a => [a.id, a]))

    for (const instance of placedAssets) {
      const libraryAsset = libMap.get(instance.libraryId)
      const isNPC = libraryAsset?.category === 'characters' ||
                    libraryAsset?.category === 'creatures'

      if (isNPC && instance.behavior && instance.behavior.type !== 'none') {
        currentNPCIds.add(instance.instanceId)
        const existing = this.npcs.get(instance.instanceId)

        if (!existing) {
          // New NPC: register it
          const mesh = instanceMeshes.get(instance.instanceId)
          if (mesh) {
            this.register(instance.instanceId, mesh, instance.behavior)
          }
        } else {
          // Update mesh reference if it changed (handles mesh replacement from rebuilds)
          const currentMesh = instanceMeshes.get(instance.instanceId)
          if (currentMesh && existing.mesh !== currentMesh) {
            existing.mesh = currentMesh
            existing.homePosition.copy(currentMesh.position)
            existing.findAnimationPivots() // Re-find pivots on new mesh
          }

          if (existing.config.type !== instance.behavior.type) {
            // H3 FIX: Behavior TYPE changed: reset state to prevent stale state bugs
            existing.config = { ...instance.behavior }
            existing.state = STATE.IDLE
            existing.stateTimer = 0
            existing.idleTime = existing.randomIdleTime()
            existing.walkPhase = 0  // M6 FIX: Also reset walk animation phase
          } else if (existing.config.radius !== instance.behavior.radius) {
            // Only radius changed: update config, preserve state
            existing.config = { ...instance.behavior }
          }
          // Else: existing NPC with same behavior, preserve all state
        }
      }
    }

    // Remove NPCs that no longer exist in placedAssets
    for (const id of this.npcs.keys()) {
      if (!currentNPCIds.has(id)) {
        this.unregister(id)
      }
    }
  }
}

// Singleton instance
export const npcController = new NPCController()
