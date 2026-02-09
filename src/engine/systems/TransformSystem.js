/**
 * @fileoverview TransformSystem - Manages TransformControls and transform modifiers.
 * Handles gizmo behavior, snapping, ground constraint, and ground projection helpers.
 */

import * as THREE from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { INSTANCE_SCALE } from '../../shared/constants'
import { clamp } from '../shared/rendererUtils'

/**
 * Detect the uniform scale value from an object's scale.
 * TransformControls only modifies the dragged axis, so we find which component
 * differs from the others (the dragged one) and use that for uniform scaling.
 * @param {THREE.Vector3} scale - The object's scale
 * @returns {number} The detected uniform scale value
 */
function getUniformScaleValue(scale) {
  const { x, y, z } = scale

  // Check which pair of axes are still equal (those weren't dragged)
  const xyClose = Math.abs(x - y) < 0.0001
  const xzClose = Math.abs(x - z) < 0.0001
  const yzClose = Math.abs(y - z) < 0.0001

  if (yzClose && !xzClose) {
    // Y and Z are equal, X was dragged
    return x
  } else if (xzClose && !xyClose) {
    // X and Z are equal, Y was dragged
    return y
  } else if (xyClose && !xzClose) {
    // X and Y are equal, Z was dragged
    return z
  } else {
    // Fallback: all equal or ambiguous, use max for scale-up behavior
    return Math.max(x, y, z)
  }
}

/**
 * Manages object transforms via TransformControls with custom modifiers.
 */
export class TransformSystem {
  /**
   * @param {Object} shared - Shared renderer state
   * @param {THREE.Scene} shared.scene - The Three.js scene
   * @param {THREE.PerspectiveCamera} shared.camera - The main camera
   * @param {THREE.WebGLRenderer} shared.renderer - The WebGL renderer
   * @param {OrbitControls} shared.orbitControls - Camera orbit controls
   * @param {Object} deps - Dependencies
   * @param {Function} deps.getTerrainHeight - Function to get terrain height at (x, z)
   */
  constructor(shared, deps) {
    this.shared = shared
    this.deps = deps

    // TransformControls
    this.transformControls = null
    this.transformMode = 'translate'

    // State flags
    this.isDragging = false
    this._isTransformAdjusting = false
    this._snappingActive = false
    this._groundConstraintActive = false

    // Camera target during drag
    this._preDragCameraTarget = null

    // Ground projection helpers
    this.groundProjectionCross = null
    this.groundProjectionLine = null

    // Callbacks
    this.onTransformChange = null
    this.onTransformDragging = null
    this.onTransformComplete = null  // Called when transform drag ends (for shadow update)
  }

  /**
   * Initialize the transform system.
   */
  init() {
    this.createTransformControls()
    this.createGroundProjectionHelpers()
  }

  /**
   * Create and configure TransformControls.
   */
  createTransformControls() {
    this.transformControls = new TransformControls(
      this.shared.camera,
      this.shared.renderer.domElement
    )

    this.transformControls.addEventListener('dragging-changed', (e) => {
      this.shared.orbitControls.enabled = !e.value
      this.shared.orbitControls.enableZoom = !e.value
      this.isDragging = e.value

      // Lock camera target during drag
      if (e.value) {
        this._preDragCameraTarget = this.shared.orbitControls.target.clone()
      } else if (this._preDragCameraTarget) {
        this.shared.orbitControls.target.copy(this._preDragCameraTarget)
        this._preDragCameraTarget = null
      }

      // When drag ends, persist transform and hide helpers
      if (!e.value) {
        this.hideGroundProjection()
        if (this.onTransformDragging) this.onTransformDragging(null)
        if (this.onTransformComplete) this.onTransformComplete()  // Notify for shadow update

        if (this.onTransformChange) {
          const attached = this.transformControls.object
          if (attached) {
            const instanceId = attached.userData?.instanceId
            if (instanceId) {
              const terrainHeight = this.deps.getTerrainHeight(
                attached.position.x,
                attached.position.z
              )
              const centerOffset = attached.userData?.centerOffset || new THREE.Vector3()
              const scale = clamp(getUniformScaleValue(attached.scale), INSTANCE_SCALE.min, INSTANCE_SCALE.max)
              attached.scale.setScalar(scale)

              this.onTransformChange(instanceId, {
                position: [
                  attached.position.x - centerOffset.x * scale,
                  attached.position.y - terrainHeight - centerOffset.y * scale,
                  attached.position.z - centerOffset.z * scale
                ],
                rotation: attached.rotation.y,
                scale: scale
              })
            }
          }
        }
      }
    })

    this.transformControls.addEventListener('objectChange', () => {
      const obj = this.transformControls.object
      if (!obj || !obj.userData?.instanceId || this._isTransformAdjusting) return

      this._isTransformAdjusting = true

      // M1 FIX: Use try/finally to ensure flag is reset even on exception
      try {
        if (this.transformMode === 'translate') {
          // Apply ground constraint if Alt is held
          if (this._groundConstraintActive) {
            const terrainY = this.deps.getTerrainHeight(obj.position.x, obj.position.z)
            const centerOffset = obj.userData?.centerOffset || new THREE.Vector3()
            const scale = obj.scale.x
            obj.position.y = terrainY + centerOffset.y * scale
          }

          // Apply snapping if Shift is held
          if (this._snappingActive) {
            obj.position.x = Math.round(obj.position.x)
            obj.position.z = Math.round(obj.position.z)
            if (!this._groundConstraintActive) {
              obj.position.y = Math.round(obj.position.y)
            }
          }

          // Update ground projection helpers
          this.updateGroundProjection(obj)

          // Report height to Viewport
          if (this.onTransformDragging) {
            const terrainY = this.deps.getTerrainHeight(obj.position.x, obj.position.z)
            const centerOffset = obj.userData?.centerOffset || new THREE.Vector3()
            const scale = obj.scale.x
            const heightAboveTerrain = obj.position.y - terrainY - centerOffset.y * scale
            this.onTransformDragging(heightAboveTerrain)
          }
        } else if (this.transformMode === 'rotate') {
          // Extract pure Y-axis rotation using quaternion math
          const quat = obj.quaternion.clone()
          const yRotation = Math.atan2(
            2 * (quat.w * quat.y + quat.x * quat.z),
            1 - 2 * (quat.y * quat.y + quat.z * quat.z)
          )

          // Apply rotation snapping if Shift is held (15° increments)
          const finalRotation = this._snappingActive
            ? Math.round(yRotation / (Math.PI / 12)) * (Math.PI / 12)
            : yRotation

          obj.rotation.set(0, finalRotation, 0)
        } else if (this.transformMode === 'scale') {
          const uniform = clamp(getUniformScaleValue(obj.scale), INSTANCE_SCALE.min, INSTANCE_SCALE.max)
          obj.scale.setScalar(uniform)
          this.setGizmoSize(obj)
        }
      } finally {
        this._isTransformAdjusting = false
      }
    })

    // Add to scene
    const transformRoot = this.transformControls._root || this.transformControls
    this.shared.scene.add(transformRoot)

    this.setMode('translate')
  }

  /**
   * Create ground projection helpers for depth perception.
   */
  createGroundProjectionHelpers() {
    // Cross marker on ground
    const crossSize = 2
    const crossGeometry = new THREE.BufferGeometry()
    const crossPositions = new Float32Array([
      -crossSize, 0, 0, crossSize, 0, 0,
      0, 0, -crossSize, 0, 0, crossSize
    ])
    crossGeometry.setAttribute('position', new THREE.BufferAttribute(crossPositions, 3))
    const crossMaterial = new THREE.LineBasicMaterial({
      color: 0x22cc44,
      linewidth: 2,
      depthTest: false,
      transparent: true,
      opacity: 0.8
    })
    this.groundProjectionCross = new THREE.LineSegments(crossGeometry, crossMaterial)
    this.groundProjectionCross.renderOrder = 999
    this.groundProjectionCross.visible = false
    this.shared.scene.add(this.groundProjectionCross)

    // Vertical dashed line from asset to ground
    const lineGeometry = new THREE.BufferGeometry()
    const dashCount = 50
    const linePositions = new Float32Array(dashCount * 6)
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3))
    const lineMaterial = new THREE.LineDashedMaterial({
      color: 0x22cc44,
      dashSize: 0.5,
      gapSize: 0.3,
      depthTest: false,
      transparent: true,
      opacity: 0.6
    })
    this.groundProjectionLine = new THREE.LineSegments(lineGeometry, lineMaterial)
    this.groundProjectionLine.renderOrder = 999
    this.groundProjectionLine.visible = false
    this.shared.scene.add(this.groundProjectionLine)
  }

  /**
   * Update ground projection helpers during translate.
   * @param {THREE.Object3D} mesh - The mesh being transformed
   */
  updateGroundProjection(mesh) {
    if (!mesh || !this.groundProjectionCross || !this.groundProjectionLine) return

    const pos = mesh.position
    const terrainY = this.deps.getTerrainHeight(pos.x, pos.z)

    // Only show if asset is significantly above ground
    const heightAboveGround = pos.y - terrainY
    if (heightAboveGround < 0.5) {
      this.hideGroundProjection()
      return
    }

    // Update cross position
    this.groundProjectionCross.position.set(pos.x, terrainY + 0.05, pos.z)
    this.groundProjectionCross.visible = true

    // Update vertical line
    const positions = this.groundProjectionLine.geometry.attributes.position.array
    const dashCount = 50
    const dashHeight = heightAboveGround / dashCount

    for (let i = 0; i < dashCount; i++) {
      const y1 = terrainY + i * dashHeight
      const y2 = terrainY + (i + 0.6) * dashHeight
      const idx = i * 6
      positions[idx] = pos.x
      positions[idx + 1] = y1
      positions[idx + 2] = pos.z
      positions[idx + 3] = pos.x
      positions[idx + 4] = Math.min(y2, pos.y)
      positions[idx + 5] = pos.z
    }
    this.groundProjectionLine.geometry.attributes.position.needsUpdate = true
    this.groundProjectionLine.visible = true
  }

  /**
   * Hide ground projection helpers.
   */
  hideGroundProjection() {
    if (this.groundProjectionCross) this.groundProjectionCross.visible = false
    if (this.groundProjectionLine) this.groundProjectionLine.visible = false
  }

  /**
   * Set transform mode.
   * @param {'translate' | 'rotate' | 'scale'} mode - Transform mode
   */
  setMode(mode) {
    this.transformMode = mode
    this.transformControls.setMode(mode)

    if (mode === 'rotate') {
      this.transformControls.showX = false
      this.transformControls.showY = true
      this.transformControls.showZ = false
    } else {
      this.transformControls.showX = true
      this.transformControls.showY = !this._groundConstraintActive
      this.transformControls.showZ = true
    }
  }

  /**
   * Set gizmo size based on asset bounding radius.
   * @param {THREE.Object3D|null} mesh - The mesh or null to reset
   */
  setGizmoSize(mesh) {
    if (!this.transformControls || !mesh) {
      this.transformControls?.setSize(1)
      return
    }

    const boundingRadius = mesh.userData.boundingRadius || 1
    const scale = mesh.scale?.x || 1
    const effectiveRadius = boundingRadius * scale

    // Logarithmic scaling for smooth behavior
    const logScale = Math.log10(effectiveRadius + 1)
    const gizmoSize = Math.max(0.5, Math.min(1.8, 1.5 / (1 + logScale * 0.5)))
    this.transformControls.setSize(gizmoSize)
  }

  /**
   * Attach transform controls to an object.
   * @param {THREE.Object3D} mesh - The mesh to attach to
   */
  attach(mesh) {
    if (mesh?.userData?.isLoadingPlaceholder) return
    this.transformControls.attach(mesh)
    this.setGizmoSize(mesh)
  }

  /**
   * Detach transform controls.
   */
  detach() {
    this.transformControls.detach()
    this.setGizmoSize(null)
  }

  /**
   * Set snapping state.
   * @param {boolean} active - Whether snapping is active
   */
  setSnappingActive(active) {
    this._snappingActive = active
  }

  /**
   * Set ground constraint state.
   * @param {boolean} active - Whether ground constraint is active
   */
  setGroundConstraintActive(active) {
    this._groundConstraintActive = active
    if (this.transformControls && this.transformMode === 'translate') {
      this.transformControls.showY = !active
    }
  }

  /**
   * Get the currently attached object.
   * @returns {THREE.Object3D|null} The attached object
   */
  get object() {
    return this.transformControls?.object || null
  }

  /**
   * Dispose of transform system resources.
   */
  dispose() {
    if (this.transformControls) {
      this.transformControls.dispose()
    }

    if (this.groundProjectionCross) {
      this.shared.scene.remove(this.groundProjectionCross)
      this.groundProjectionCross.geometry?.dispose()
      this.groundProjectionCross.material?.dispose()
      this.groundProjectionCross = null
    }

    if (this.groundProjectionLine) {
      this.shared.scene.remove(this.groundProjectionLine)
      this.groundProjectionLine.geometry?.dispose()
      this.groundProjectionLine.material?.dispose()
      this.groundProjectionLine = null
    }
  }
}
