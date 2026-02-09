import * as THREE from 'three'
import { WORLD_SIZE } from '../shared/constants'

const WALK_SPEED = 25 // units per second (fast, responsive movement)
const RUN_SPEED = 50 // units per second (sprint)
const JUMP_FORCE = 35 // scaled for larger player (higher jump)
const GRAVITY = -50 // scaled for larger player

// H4 FIX: World boundary constants
const WORLD_MIN = 0
const WORLD_MAX = WORLD_SIZE

// Fixed timestep for consistent physics (like Minecraft's 20 ticks/sec, we use 60)
const FIXED_DT = 1 / 60
const MAX_DT = 1 / 30 // Cap frame time to prevent spiral of death

/**
 * Third-person player controller
 * Uses fixed timestep physics with interpolation for buttery smooth movement
 */
export class PlayerController {
  constructor(camera) {
    this.camera = camera
    this.mesh = null
    this.renderer = null // E2 FIX: Reference to WorldRenderer for terrain height queries
    this.velocity = new THREE.Vector3()
    this.isGrounded = true
    this.isRunning = false
    this.walkPhase = 0

    // Camera settings (tuned for ~8 unit tall player, matching scene-generated humans)
    this.cameraDistance = 25 // Distance behind player
    this.cameraHeight = 12 // Height above player's feet
    this.cameraAngle = 0 // Horizontal orbit angle (0 = behind player)
    this.cameraPitch = 0.4 // Vertical angle in radians (~23 degrees, looking down at player)
    this.playerHeight = 8.0 // Approximate player height for look-at target
    this.isOrbiting = false
    this.isPaused = false  // M3 FIX: Track if player is paused (e.g., during dialogue)

    // Fly camera mode for demo recording
    this.flyMode = false
    this.flySpeed = 50 // base speed units/sec
    this.flySpeedMultiplier = 1.0 // scroll wheel adjusts [0.25, 4.0]
    this._flyVelocity = new THREE.Vector3() // smoothed velocity for gimbal feel

    // Pointer lock state for fluid camera controls
    this.isPointerLocked = false
    this.targetElement = null // Element that has pointer lock
    this.onPointerLockExit = null // Callback when user exits pointer lock (e.g., ESC)

    // Input state
    this.keys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      jump: false,
      run: false,
      interact: false,
      descend: false
    }

    // Mouse state for orbiting (left-click drag)
    this.mouseDownX = 0
    this.mouseDownY = 0
    this.lastMouseX = 0
    this.lastMouseY = 0
    this.isDragging = false // True when drag threshold exceeded
    this.mouseIsDown = false // True when left button is held

    // Animation pivots
    this.legPivots = null
    this.armPivots = null

    // Fixed timestep accumulator for consistent physics
    this._accumulator = 0
    this._prevPosition = new THREE.Vector3()
    this._currPosition = new THREE.Vector3()
    this._prevRotationY = 0
    this._currRotationY = 0

    // Reusable vectors to avoid allocation during update
    this._cameraTarget = new THREE.Vector3()
    this._lookTarget = new THREE.Vector3()
    this._moveDir = new THREE.Vector3()
    this._cameraInitialized = false

    // Bound event listener references for cleanup
    this._boundKeyDown = this.handleKeyDown.bind(this)
    this._boundKeyUp = this.handleKeyUp.bind(this)
    this._boundMouseDown = this._onMouseDown.bind(this)
    this._boundMouseUp = this._onMouseUp.bind(this)
    this._boundMouseMove = this._onMouseMove.bind(this)
    this._boundContextMenu = this._onContextMenu.bind(this)
    this._boundPointerLockChange = this._onPointerLockChange.bind(this)
    this._boundWheel = this._onWheel.bind(this)

    this.setupInput()
  }

  /**
   * Set up keyboard and mouse input
   */
  setupInput() {
    window.addEventListener('keydown', this._boundKeyDown)
    window.addEventListener('keyup', this._boundKeyUp)
    window.addEventListener('mousedown', this._boundMouseDown)
    window.addEventListener('mouseup', this._boundMouseUp)
    window.addEventListener('mousemove', this._boundMouseMove)
    // Still prevent context menu in play mode
    window.addEventListener('contextmenu', this._boundContextMenu)
    // Scroll wheel for fly mode speed control
    window.addEventListener('wheel', this._boundWheel, { passive: false })
    // Pointer lock change listener
    document.addEventListener('pointerlockchange', this._boundPointerLockChange)
  }

  /**
   * Mouse event handlers for camera orbit (left-click drag)
   */
  _onMouseDown(e) {
    if (e.button === 0) { // Left click
      this.mouseIsDown = true
      this.isDragging = false
      this.mouseDownX = e.clientX
      this.mouseDownY = e.clientY
      this.lastMouseX = e.clientX
      this.lastMouseY = e.clientY
    }
  }

  _onMouseUp(e) {
    if (e.button === 0) {
      this.mouseIsDown = false
      // If we were dragging, consume the event to prevent click handlers
      if (this.isDragging) {
        e.stopPropagation()
      }
      this.isDragging = false
    }
  }

  _onMouseMove(e) {
    if (this.isPaused) return

    // Pointer lock mode: use raw movement deltas for fluid camera control
    if (this.isPointerLocked) {
      // Horizontal orbit
      this.cameraAngle -= e.movementX * 0.003
      // Vertical pitch — fly mode allows looking straight up/down, normal mode is clamped tighter
      const minPitch = this.flyMode ? -Math.PI / 2 + 0.01 : -0.45
      const maxPitch = this.flyMode ? Math.PI / 2 - 0.01 : 1.2
      this.cameraPitch = Math.max(minPitch, Math.min(maxPitch, this.cameraPitch + e.movementY * 0.003))

      // In fly mode, apply rotation immediately for instant visual feedback
      // (position updates on next animation frame, but rotation must feel instant)
      if (this.flyMode) {
        this.camera.rotation.order = 'YXZ'
        this.camera.rotation.set(-this.cameraPitch, this.cameraAngle, 0)
      }
      // Camera position updates in animation frame only - prevents jitter from
      // conflicting immediate vs smoothed updates
      return
    }

    // Fallback: drag-based camera orbit (when pointer lock not available)
    if (!this.mouseIsDown) return

    const deltaX = e.clientX - this.lastMouseX
    const deltaY = e.clientY - this.lastMouseY

    // Check if we've exceeded drag threshold (5 pixels)
    if (!this.isDragging) {
      const totalDeltaX = e.clientX - this.mouseDownX
      const totalDeltaY = e.clientY - this.mouseDownY
      const distance = Math.sqrt(totalDeltaX * totalDeltaX + totalDeltaY * totalDeltaY)
      if (distance > 5) {
        this.isDragging = true
      } else {
        return // Not dragging yet, don't move camera
      }
    }

    // Horizontal orbit (left-right mouse = rotate around player)
    this.cameraAngle -= deltaX * 0.005

    // Vertical pitch (up-down mouse = tilt camera)
    // Clamp between looking up (-0.3) and looking down (1.2)
    this.cameraPitch = Math.max(-0.45, Math.min(1.2, this.cameraPitch + deltaY * 0.005))

    this.lastMouseX = e.clientX
    this.lastMouseY = e.clientY
  }

  _onContextMenu(e) {
    // Prevent context menu in play mode (no longer used for camera, but keep for safety)
    e.preventDefault()
    return false
  }

  /**
   * Pointer lock state change handler
   */
  _onPointerLockChange() {
    const wasLocked = this.isPointerLocked
    this.isPointerLocked = document.pointerLockElement === this.targetElement

    // If pointer lock was released (user pressed ESC), notify callback
    if (wasLocked && !this.isPointerLocked && this.onPointerLockExit) {
      this.onPointerLockExit()
    }
  }

  /**
   * Request pointer lock on an element
   * @param {HTMLElement} element - The element to lock pointer to
   */
  requestPointerLock(element) {
    this.targetElement = element
    // Try standard API first, fall back to prefixed versions
    if (element.requestPointerLock) {
      element.requestPointerLock()
    } else if (element.mozRequestPointerLock) {
      element.mozRequestPointerLock()
    } else if (element.webkitRequestPointerLock) {
      element.webkitRequestPointerLock()
    }
  }

  /**
   * Exit pointer lock mode
   */
  exitPointerLock() {
    if (document.exitPointerLock) {
      document.exitPointerLock()
    } else if (document.mozExitPointerLock) {
      document.mozExitPointerLock()
    } else if (document.webkitExitPointerLock) {
      document.webkitExitPointerLock()
    }
    this.isPointerLocked = false
    this.targetElement = null
  }

  handleKeyDown(e) {
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.keys.forward = true
        break
      case 'KeyS':
      case 'ArrowDown':
        this.keys.backward = true
        break
      case 'KeyA':
      case 'ArrowLeft':
        this.keys.left = true
        break
      case 'KeyD':
      case 'ArrowRight':
        this.keys.right = true
        break
      case 'Space':
        this.keys.jump = true
        break
      case 'ShiftLeft':
      case 'ShiftRight':
        this.keys.run = true
        break
      case 'KeyE':
        this.keys.interact = true
        break
      case 'KeyF':
        this.toggleFlyMode()
        break
      case 'KeyC':
      case 'ControlLeft':
      case 'ControlRight':
        this.keys.descend = true
        break
    }
  }

  handleKeyUp(e) {
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.keys.forward = false
        break
      case 'KeyS':
      case 'ArrowDown':
        this.keys.backward = false
        break
      case 'KeyA':
      case 'ArrowLeft':
        this.keys.left = false
        break
      case 'KeyD':
      case 'ArrowRight':
        this.keys.right = false
        break
      case 'Space':
        this.keys.jump = false
        break
      case 'ShiftLeft':
      case 'ShiftRight':
        this.keys.run = false
        break
      case 'KeyE':
        this.keys.interact = false
        break
      case 'KeyC':
      case 'ControlLeft':
      case 'ControlRight':
        this.keys.descend = false
        break
    }
  }

  /**
   * Set the player mesh
   */
  setMesh(mesh) {
    this.mesh = mesh

    // Find animation pivots
    if (mesh.userData?.parts) {
      this.legPivots = mesh.userData.parts.legPivots || null
      this.armPivots = mesh.userData.parts.armPivots || null
    }
  }

  /**
   * E2 FIX: Set the renderer reference for terrain height queries
   */
  setRenderer(renderer) {
    this.renderer = renderer
  }

  /**
   * Update player using fixed timestep physics with interpolation
   * This ensures consistent movement regardless of frame rate (like Minecraft)
   */
  update(dt) {
    if (!this.mesh && !this.flyMode) return

    // Block all movement when paused (e.g., during dialogue)
    if (this.isPaused) {
      this.updateCamera(0)
      return
    }

    // Fly camera mode bypasses all physics
    if (this.flyMode) {
      this._flyUpdate(Math.min(dt, MAX_DT))
      return
    }

    // Clamp dt to prevent spiral of death on lag spikes
    dt = Math.min(dt, MAX_DT)

    // Accumulate time for fixed timestep
    this._accumulator += dt

    // Run physics at fixed intervals
    while (this._accumulator >= FIXED_DT) {
      // Store previous state for interpolation
      this._prevPosition.copy(this._currPosition)
      this._prevRotationY = this._currRotationY

      // Run one physics step
      this._physicsStep(FIXED_DT)

      // Store current state
      this._currPosition.copy(this.mesh.position)
      this._currRotationY = this.mesh.rotation.y

      this._accumulator -= FIXED_DT
    }

    // Interpolate between previous and current state for smooth rendering
    const alpha = this._accumulator / FIXED_DT
    this.mesh.position.lerpVectors(this._prevPosition, this._currPosition, alpha)

    // Interpolate rotation (handle wrap-around)
    let rotDiff = this._currRotationY - this._prevRotationY
    while (rotDiff > Math.PI) rotDiff -= Math.PI * 2
    while (rotDiff < -Math.PI) rotDiff += Math.PI * 2
    this.mesh.rotation.y = this._prevRotationY + rotDiff * alpha

    // Update camera (uses interpolated position)
    this.updateCamera(dt)
  }

  /**
   * Single physics step at fixed timestep
   * @param {number} dt - Fixed delta time
   */
  _physicsStep(dt) {
    // Get movement direction relative to camera
    const moveDir = this._moveDir.set(0, 0, 0)

    if (this.keys.forward) moveDir.z -= 1
    if (this.keys.backward) moveDir.z += 1
    if (this.keys.left) moveDir.x -= 1
    if (this.keys.right) moveDir.x += 1

    const isMoving = moveDir.length() > 0

    // Rotate movement by camera angle
    if (isMoving) {
      moveDir.normalize()
      const angle = this.cameraAngle
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const x = moveDir.x * cos + moveDir.z * sin
      const z = -moveDir.x * sin + moveDir.z * cos
      moveDir.x = x
      moveDir.z = z
    }

    // Calculate speed and apply directly (no smoothing - fixed timestep handles it)
    const speed = this.keys.run ? RUN_SPEED : WALK_SPEED
    this.velocity.x = moveDir.x * speed
    this.velocity.z = moveDir.z * speed

    // Apply gravity
    this.velocity.y += GRAVITY * dt

    // Jump
    if (this.keys.jump && this.isGrounded) {
      this.velocity.y = JUMP_FORCE
      this.isGrounded = false
    }

    // Move player
    this.mesh.position.x += this.velocity.x * dt
    this.mesh.position.y += this.velocity.y * dt
    this.mesh.position.z += this.velocity.z * dt

    // Clamp to world bounds
    this.mesh.position.x = Math.max(WORLD_MIN, Math.min(WORLD_MAX, this.mesh.position.x))
    this.mesh.position.z = Math.max(WORLD_MIN, Math.min(WORLD_MAX, this.mesh.position.z))

    // Ground collision
    const terrainY = this.renderer?.getTerrainHeight(this.mesh.position.x, this.mesh.position.z) ?? 0
    if (this.mesh.position.y <= terrainY) {
      this.mesh.position.y = terrainY
      this.velocity.y = 0
      this.isGrounded = true
    }

    // Face movement direction with quick turn
    if (isMoving) {
      const targetAngle = Math.atan2(moveDir.x, moveDir.z)
      let angleDiff = targetAngle - this.mesh.rotation.y
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2
      // Quick rotation (90% per physics step when moving)
      this.mesh.rotation.y += angleDiff * 0.3
    }

    // Update animation
    const actualSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z)
    this.updateAnimation(dt, isMoving, actualSpeed)
  }

  /**
   * Update player animation
   * @param {number} dt - Delta time
   * @param {boolean} isMoving - Whether player is moving
   * @param {number} [actualSpeed] - Actual movement speed for animation scaling
   */
  updateAnimation(dt, isMoving, actualSpeed = WALK_SPEED) {
    if (isMoving) {
      // Scale animation speed based on actual velocity for smooth transitions
      // Map speed to animation rate: walking (25) -> 8, running (50) -> 12
      const speedRatio = Math.min(actualSpeed / WALK_SPEED, RUN_SPEED / WALK_SPEED)
      const animSpeed = 6 + speedRatio * 4 // Range: 6-14 based on speed
      this.walkPhase += dt * animSpeed

      // Scale limb swing based on speed (more swing at higher speeds)
      const swingScale = 0.3 + speedRatio * 0.2 // Range: 0.3-0.5

      // Leg animation
      // Use for-loop instead of forEach to avoid per-frame closure allocation
      if (this.legPivots && Array.isArray(this.legPivots)) {
        for (let i = 0; i < this.legPivots.length; i++) {
          const pivot = this.legPivots[i]
          const phase = this.walkPhase + (i * Math.PI)
          if (pivot.rotation) {
            pivot.rotation.x = Math.sin(phase) * swingScale * 1.2
          }
        }
      }

      // Arm animation
      // Use for-loop instead of forEach to avoid per-frame closure allocation
      if (this.armPivots && Array.isArray(this.armPivots)) {
        for (let i = 0; i < this.armPivots.length; i++) {
          const pivot = this.armPivots[i]
          const phase = this.walkPhase + (i * Math.PI) + Math.PI
          if (pivot.rotation) {
            pivot.rotation.x = Math.sin(phase) * swingScale
          }
        }
      }
    } else {
      // Smoothly return to idle (don't reset walkPhase abruptly)
      // Gradually return limbs to neutral using exponential decay
      const idleSmooth = 1 - Math.exp(-8 * dt)

      // Use for-loop instead of forEach to avoid per-frame closure allocation
      if (this.legPivots && Array.isArray(this.legPivots)) {
        for (let i = 0; i < this.legPivots.length; i++) {
          const pivot = this.legPivots[i]
          if (pivot.rotation) {
            pivot.rotation.x += (0 - pivot.rotation.x) * idleSmooth
          }
        }
      }

      // Use for-loop instead of forEach to avoid per-frame closure allocation
      if (this.armPivots && Array.isArray(this.armPivots)) {
        for (let i = 0; i < this.armPivots.length; i++) {
          const pivot = this.armPivots[i]
          if (pivot.rotation) {
            pivot.rotation.x += (0 - pivot.rotation.x) * idleSmooth
          }
        }
      }

      // Idle animation from asset
      if (this.mesh.userData?.animate) {
        this.mesh.userData.animate.call(this.mesh, dt)
      }
    }
  }

  /**
   * Instantly snap camera to correct position (call on play mode entry)
   */
  snapCameraToPosition() {
    if (!this.mesh || !this.camera) return

    // Initialize fixed timestep state
    this._prevPosition.copy(this.mesh.position)
    this._currPosition.copy(this.mesh.position)
    this._prevRotationY = this.mesh.rotation.y
    this._currRotationY = this.mesh.rotation.y
    this._accumulator = 0

    // Calculate and set camera position
    const horizontalDistance = this.cameraDistance * Math.cos(this.cameraPitch)
    const verticalOffset = this.cameraDistance * Math.sin(this.cameraPitch)

    this._cameraTarget.set(
      this.mesh.position.x + Math.sin(this.cameraAngle) * horizontalDistance,
      this.mesh.position.y + this.cameraHeight + verticalOffset,
      this.mesh.position.z + Math.cos(this.cameraAngle) * horizontalDistance
    )
    this.camera.position.copy(this._cameraTarget)

    // Look at player chest
    this._lookTarget.set(
      this.mesh.position.x,
      this.mesh.position.y + this.playerHeight * 0.5,
      this.mesh.position.z
    )
    this.camera.lookAt(this._lookTarget)

    this._cameraInitialized = true
  }

  /**
   * Update camera position
   * Camera follows the interpolated player position directly - no additional smoothing
   * since fixed timestep interpolation already provides smooth movement
   */
  updateCamera() {
    if (!this.mesh || !this.camera) return

    // Initialize camera on first update if not already done
    if (!this._cameraInitialized) {
      this.snapCameraToPosition()
      return
    }

    // Calculate camera position from interpolated player position
    // (mesh.position is already interpolated in update())
    const horizontalDistance = this.cameraDistance * Math.cos(this.cameraPitch)
    const verticalOffset = this.cameraDistance * Math.sin(this.cameraPitch)

    this._cameraTarget.set(
      this.mesh.position.x + Math.sin(this.cameraAngle) * horizontalDistance,
      this.mesh.position.y + this.cameraHeight + verticalOffset,
      this.mesh.position.z + Math.cos(this.cameraAngle) * horizontalDistance
    )

    // Set camera position directly - no smoothing needed
    this.camera.position.copy(this._cameraTarget)

    // Look at player chest
    this._lookTarget.set(
      this.mesh.position.x,
      this.mesh.position.y + this.playerHeight * 0.5,
      this.mesh.position.z
    )
    this.camera.lookAt(this._lookTarget)
  }

  /**
   * Toggle fly camera mode on/off
   * Hides player mesh and lets camera move freely, or restores normal play
   */
  toggleFlyMode() {
    this.flyMode = !this.flyMode
    this._flyVelocity.set(0, 0, 0)

    if (this.flyMode) {
      if (this.mesh) this.mesh.visible = false
      // Switch to Euler rotation for direct angle control (FPS-style YXZ order)
      this.camera.rotation.order = 'YXZ'
      // Convert third-person pitch offset to a neutral free-look pitch
      this.cameraPitch = 0
      this.camera.rotation.set(0, this.cameraAngle, 0)
    } else {
      if (this.mesh) this.mesh.visible = true
      this.cameraPitch = 0.4 // Default third-person pitch
      this._cameraInitialized = false // Force camera snap to player
      this.flySpeedMultiplier = 1.0
    }
  }

  /**
   * Fly camera update — velocity-smoothed free movement for gimbal feel
   * Rotation is set directly via Euler angles (also applied instantly in _onMouseMove).
   * Position uses exponential velocity smoothing for cinematic drift.
   * @param {number} dt - Clamped delta time
   */
  _flyUpdate(dt) {
    // Raw input axes
    const inputX = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0)
    const inputZ = (this.keys.forward ? 1 : 0) - (this.keys.backward ? 1 : 0)
    const inputY = (this.keys.jump ? 1 : 0) - (this.keys.descend ? 1 : 0)

    // Camera orientation vectors from current angles
    const cosYaw = Math.cos(this.cameraAngle)
    const sinYaw = Math.sin(this.cameraAngle)
    const cosPitch = Math.cos(this.cameraPitch)
    const sinPitch = Math.sin(this.cameraPitch)

    // Forward = direction camera is looking (into the scene)
    const fwdX = -sinYaw * cosPitch
    const fwdY = -sinPitch
    const fwdZ = -cosYaw * cosPitch

    // Right = perpendicular to forward on XZ plane
    const rightX = cosYaw
    const rightZ = -sinYaw

    // Build world-space desired direction, normalize to prevent diagonal speedup
    const desiredX = inputX * rightX + inputZ * fwdX
    const desiredY = inputZ * fwdY + inputY
    const desiredZ = inputX * rightZ + inputZ * fwdZ
    const len = Math.sqrt(desiredX * desiredX + desiredY * desiredY + desiredZ * desiredZ)

    const maxSpeed = this.flySpeed * this.flySpeedMultiplier * (this.keys.run ? 2 : 1)
    let targetVx = 0, targetVy = 0, targetVz = 0
    if (len > 0.001) {
      const s = maxSpeed / len
      targetVx = desiredX * s
      targetVy = desiredY * s
      targetVz = desiredZ * s
    }

    // Exponential smoothing — fast accel, slow decel for gimbal drift
    const hasInput = len > 0.001
    const rate = hasInput ? 6 : 3
    const t = 1 - Math.exp(-rate * dt)
    this._flyVelocity.x += (targetVx - this._flyVelocity.x) * t
    this._flyVelocity.y += (targetVy - this._flyVelocity.y) * t
    this._flyVelocity.z += (targetVz - this._flyVelocity.z) * t

    // Apply velocity to position
    this.camera.position.x += this._flyVelocity.x * dt
    this.camera.position.y += this._flyVelocity.y * dt
    this.camera.position.z += this._flyVelocity.z * dt

    // Set rotation directly via Euler angles (YXZ = yaw-then-pitch, standard FPS order)
    // Also applied in _onMouseMove for instant response; this ensures rotation is
    // correct even on frames with no mouse input
    this.camera.rotation.set(-this.cameraPitch, this.cameraAngle, 0)
  }

  /**
   * Scroll wheel handler for fly mode speed adjustment
   * @param {WheelEvent} e
   */
  _onWheel(e) {
    if (!this.flyMode) return
    e.preventDefault()
    // Scroll up = faster, scroll down = slower
    const factor = e.deltaY < 0 ? 1.2 : 0.8
    this.flySpeedMultiplier = Math.max(0.25, Math.min(4.0, this.flySpeedMultiplier * factor))
  }

  /**
   * Check if player is currently dragging (for click vs drag detection)
   */
  wasDragging() {
    return this.isDragging
  }

  /**
   * Reset keys and state (call when switching modes)
   */
  resetKeys() {
    this.keys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      jump: false,
      run: false,
      interact: false,
      descend: false
    }
    this.mouseIsDown = false
    this.isDragging = false
    this.isPaused = false
    if (this.flyMode && this.mesh) this.mesh.visible = true
    this.flyMode = false
    this.flySpeedMultiplier = 1.0
    this._flyVelocity.set(0, 0, 0)
    this._cameraInitialized = false // Reset for clean state on next play mode entry
    this._accumulator = 0
    this.velocity.set(0, 0, 0)
  }

  /**
   * M3 FIX: Pause player movement and camera (for dialogue)
   */
  pause() {
    this.isPaused = true
  }

  /**
   * M3 FIX: Resume player movement and camera
   */
  resume() {
    this.isPaused = false
  }

  /**
   * Clean up - removes all event listeners
   */
  dispose() {
    window.removeEventListener('keydown', this._boundKeyDown)
    window.removeEventListener('keyup', this._boundKeyUp)
    window.removeEventListener('mousedown', this._boundMouseDown)
    window.removeEventListener('mouseup', this._boundMouseUp)
    window.removeEventListener('mousemove', this._boundMouseMove)
    window.removeEventListener('contextmenu', this._boundContextMenu)
    window.removeEventListener('wheel', this._boundWheel)
    document.removeEventListener('pointerlockchange', this._boundPointerLockChange)
    // Exit pointer lock if active
    this.exitPointerLock()
  }
}
