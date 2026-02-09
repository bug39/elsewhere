/**
 * Play mode hook for Viewport
 *
 * Manages the player mesh, controller, and play/edit mode transitions.
 * Extracted from Viewport.jsx to reduce component complexity.
 */

import { useEffect, useRef, useCallback } from 'preact/hooks'
import * as THREE from 'three'
import { PlayerController } from '../../engine/PlayerController'
import { npcController } from '../../engine/NPCController'

/**
 * Creates the player mesh (anime girl character)
 * @returns {THREE.Group} Player mesh with userData.parts for walk animation
 */
function createPlayerMesh() {
  const group = new THREE.Group()

  // Materials
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xffdbac, roughness: 0.8 })
  const shirtMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 })
  const skirtMat = new THREE.MeshStandardMaterial({ color: 0x4169e1, roughness: 0.9, side: THREE.DoubleSide }) // Royal Blue
  const hairMat = new THREE.MeshStandardMaterial({ color: 0xff69b4, roughness: 0.6 }) // Hot Pink
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff })
  const irisMat = new THREE.MeshStandardMaterial({ color: 0x333333 })
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x222222 })
  const sockMat = new THREE.MeshStandardMaterial({ color: 0xffffff })

  // 1. Torso (Lathe for a tapered shape)
  const torsoProfile = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.12, 0.05),
    new THREE.Vector2(0.1, 0.2),
    new THREE.Vector2(0.14, 0.35),
    new THREE.Vector2(0, 0.38)
  ]
  const torso = new THREE.Mesh(new THREE.LatheGeometry(torsoProfile, 10), shirtMat)
  torso.position.y = 0.65
  group.add(torso)

  // 2. Skirt (Lathe for flared shape)
  const skirtProfile = [
    new THREE.Vector2(0.10, 0.22),  // waist attachment
    new THREE.Vector2(0.12, 0.18),  // hip
    new THREE.Vector2(0.16, 0.12),  // gradual flare
    new THREE.Vector2(0.22, 0.06),  // more flare
    new THREE.Vector2(0.28, 0)      // hem
  ]
  const skirt = new THREE.Mesh(new THREE.LatheGeometry(skirtProfile, 20), skirtMat)
  skirt.position.y = 0.58
  group.add(skirt)

  // 3. Head
  const headProfile = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.14, 0.08),
    new THREE.Vector2(0.16, 0.2),
    new THREE.Vector2(0.1, 0.3),
    new THREE.Vector2(0, 0.32)
  ]
  const head = new THREE.Mesh(new THREE.LatheGeometry(headProfile, 12), skinMat)
  head.position.y = 1.0
  group.add(head)

  // Eyes
  for (let side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.02), eyeMat)
    eye.position.set(side * 0.07, 1.15, 0.14)
    eye.rotation.y = side * 0.1
    group.add(eye)

    const iris = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.01), irisMat)
    iris.position.set(side * 0.07, 1.14, 0.15)
    group.add(iris)
  }

  // 4. Hair (Cap + Spikes)
  const hairCapProfile = [
    new THREE.Vector2(0.1, 0),
    new THREE.Vector2(0.18, 0.1),
    new THREE.Vector2(0.15, 0.25),
    new THREE.Vector2(0, 0.28)
  ]
  const hairCap = new THREE.Mesh(new THREE.LatheGeometry(hairCapProfile, 12), hairMat)
  hairCap.position.y = 1.1
  group.add(hairCap)

  // Hair spikes - positioned outside head
  const hairSpikes = new THREE.Group()
  const spikeData = [
    // Bangs - pushed forward to clear face
    { pos: [0, 0.2, 0.18], rot: [0.5, 0, 0], s: 0.8 },
    { pos: [0.1, 0.2, 0.16], rot: [0.5, 0, -0.4], s: 0.7 },
    { pos: [-0.1, 0.2, 0.16], rot: [0.5, 0, 0.4], s: 0.7 },
    // Side spikes - pushed outward to clear head
    { pos: [0.20, 0.1, 0], rot: [0, 0, -1.2], s: 1.2 },
    { pos: [-0.20, 0.1, 0], rot: [0, 0, 1.2], s: 1.2 },
    // Back spike - pushed back to clear head
    { pos: [0, 0.05, -0.18], rot: [-0.8, 0, 0], s: 1.5 }
  ]
  spikeData.forEach(d => {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 4), hairMat)
    spike.position.set(...d.pos)
    spike.rotation.set(...d.rot)
    spike.scale.setScalar(d.s)
    hairSpikes.add(spike)
  })
  hairSpikes.position.y = 1.1
  group.add(hairSpikes)

  // 5. Arms (Pivoted for walk animation)
  const armPivots = []
  for (let side of [-1, 1]) {
    const pivot = new THREE.Group()
    pivot.position.set(side * 0.14, 0.95, 0)
    group.add(pivot)

    // Shoulder puff (sphere at shoulder joint)
    const shoulderPuff = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), shirtMat)
    shoulderPuff.position.set(0, 0, 0)  // At pivot origin (shoulder)
    pivot.add(shoulderPuff)

    const armCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(side * 0.1, -0.15, 0.05),
      new THREE.Vector3(side * 0.05, -0.3, 0.1)
    ])
    const arm = new THREE.Mesh(new THREE.TubeGeometry(armCurve, 6, 0.04, 6), skinMat)
    pivot.add(arm)
    armPivots.push(pivot)
  }

  // 6. Legs (Pivoted for walk animation)
  const legPivots = []
  for (let side of [-1, 1]) {
    const pivot = new THREE.Group()
    pivot.position.set(side * 0.08, 0.65, 0)
    group.add(pivot)

    const legCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, -0.3, 0),
      new THREE.Vector3(0, -0.6, 0)
    ])
    const leg = new THREE.Mesh(new THREE.TubeGeometry(legCurve, 6, 0.06, 8), skinMat)
    pivot.add(leg)
    legPivots.push(pivot)

    const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.2, 8), sockMat)
    sock.position.y = -0.5
    pivot.add(sock)

    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.2), shoeMat)
    shoe.position.set(0, -0.65, 0.04)
    pivot.add(shoe)
  }

  // Store pivots for walk animation (PlayerController handles animation)
  group.userData.parts = { legPivots, armPivots }
  group.castShadow = true

  // Scale to match scene-generated humans (GAME_SCALE_FACTOR = 4)
  // Anime girl base = ~1.3 units, target = ~8 units (2m human × 4)
  // Scale: 8 / 1.3 ≈ 6
  group.scale.setScalar(6)

  return group
}

/**
 * @typedef {Object} PlayModeOptions
 * @property {'edit'|'play'} mode - Current app mode
 * @property {Object} rendererRef - Ref to WorldRenderer
 * @property {Object} world - World state
 * @property {boolean} isDialogueActive - Whether dialogue is currently active
 */

/**
 * Hook that manages play mode lifecycle
 *
 * @param {PlayModeOptions} options
 * @returns {{ playerControllerRef: Object, playerMeshRef: Object }}
 */
export function usePlayMode({ mode, rendererRef, world, isDialogueActive }) {
  const playerControllerRef = useRef(null)
  const playerMeshRef = useRef(null)
  const isDialogueActiveRef = useRef(false)

  // Keep ref in sync with isDialogueActive state
  useEffect(() => {
    isDialogueActiveRef.current = isDialogueActive
    if (playerControllerRef.current) {
      if (isDialogueActive) {
        playerControllerRef.current.pause()
      } else {
        playerControllerRef.current.resume()
      }
    }
  }, [isDialogueActive])

  // Enter play mode
  const enterPlayMode = useCallback(() => {
    if (!rendererRef.current) return

    // Create player mesh (simple capsule)
    const playerMesh = createPlayerMesh()
    const spawnPos = world.data?.playerSpawn?.position || [100, 0, 100]
    playerMesh.position.set(spawnPos[0], spawnPos[1], spawnPos[2])
    rendererRef.current.scene.add(playerMesh)
    playerMeshRef.current = playerMesh

    // Create player controller
    playerControllerRef.current = new PlayerController(rendererRef.current.camera)
    playerControllerRef.current.setMesh(playerMesh)
    // Set renderer for terrain collision
    playerControllerRef.current.setRenderer(rendererRef.current)
    npcController.setRenderer(rendererRef.current)

    // Snap camera to correct position immediately (don't wait for lerp)
    playerControllerRef.current.snapCameraToPosition()

    // Disable orbit controls
    rendererRef.current.orbitControls.enabled = false

    // Set up play mode update callback (uses WorldRenderer's single animation loop)
    rendererRef.current.playMode = true
    rendererRef.current.playModeUpdate = (dt) => {
      // Update player (pause during dialogue using ref for current value)
      if (playerControllerRef.current && !isDialogueActiveRef.current) {
        playerControllerRef.current.update(dt)
      }
      // Update NPCs
      npcController.update(dt)
    }
  }, [rendererRef, world.data])

  // Exit play mode
  const exitPlayMode = useCallback(() => {
    if (!rendererRef.current) return

    // Remove player mesh
    if (playerMeshRef.current) {
      rendererRef.current.scene.remove(playerMeshRef.current)
      playerMeshRef.current = null
    }

    // Clean up controller
    if (playerControllerRef.current) {
      playerControllerRef.current.dispose()  // Remove event listeners to prevent memory leak
      playerControllerRef.current.resetKeys()
      playerControllerRef.current = null
    }

    // Clear NPC state to stop behavioral animations in edit mode
    npcController.clear()

    // Re-enable orbit controls and clear play mode callbacks
    rendererRef.current.orbitControls.enabled = true
    rendererRef.current.playMode = false
    rendererRef.current.playModeUpdate = null
  }, [rendererRef])

  // Handle mode changes
  useEffect(() => {
    if (!rendererRef.current) return

    if (mode === 'play') {
      enterPlayMode()
    } else {
      exitPlayMode()
    }

    // Cleanup on unmount (handles case where component unmounts while in play mode)
    return () => {
      if (mode === 'play') {
        exitPlayMode()
      }
    }
  }, [mode, enterPlayMode, exitPlayMode])

  // Clean up NPC state when world changes
  useEffect(() => {
    return () => {
      npcController.clear()
    }
  }, [world.data?.meta?.id])

  return {
    playerControllerRef,
    playerMeshRef
  }
}
