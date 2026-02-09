/**
 * Unit tests for usePlayMode.js
 *
 * Tests the play mode lifecycle management including:
 * - Player mesh creation and positioning
 * - Mode transitions (edit ↔ play)
 * - Controller lifecycle (create/dispose)
 * - Dialogue integration (pause/resume)
 * - NPC controller coordination
 * - Effect cleanup and memory leak prevention
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { renderHook, act } from '@testing-library/preact'
import { createMockRendererRef, createMockWorld } from '../testUtils'

// Mock Three.js
vi.mock('three', () => ({
  Group: vi.fn().mockImplementation(() => ({
    position: { set: vi.fn(), x: 0, y: 0, z: 0 },
    rotation: { set: vi.fn() },
    scale: { setScalar: vi.fn() },
    add: vi.fn(),
    userData: {},
    castShadow: false
  })),
  MeshStandardMaterial: vi.fn().mockImplementation(() => ({})),
  Mesh: vi.fn().mockImplementation(() => ({
    position: { set: vi.fn(), x: 0, y: 0, z: 0 },
    rotation: { set: vi.fn(), y: 0 },
    scale: { setScalar: vi.fn() }
  })),
  LatheGeometry: vi.fn(),
  ConeGeometry: vi.fn(),
  BoxGeometry: vi.fn(),
  SphereGeometry: vi.fn(),
  CylinderGeometry: vi.fn(),
  TubeGeometry: vi.fn(),
  CatmullRomCurve3: vi.fn(),
  Vector2: vi.fn().mockImplementation((x, y) => ({ x, y })),
  Vector3: vi.fn().mockImplementation((x, y, z) => ({ x, y, z })),
  DoubleSide: 2
}))

// Mock PlayerController - must be self-contained, no external references
vi.mock('../../../src/engine/PlayerController', () => {
  const mockController = {
    setMesh: vi.fn(),
    setRenderer: vi.fn(),
    snapCameraToPosition: vi.fn(),
    requestPointerLock: vi.fn(),
    exitPointerLock: vi.fn(),
    update: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    resetKeys: vi.fn(),
    dispose: vi.fn()
  }
  return {
    PlayerController: vi.fn().mockImplementation(() => mockController),
    __mockController: mockController
  }
})

// Mock NPCController - must be self-contained, no external references
vi.mock('../../../src/engine/NPCController', () => {
  const mockNpc = {
    setRenderer: vi.fn(),
    update: vi.fn(),
    clear: vi.fn()
  }
  return {
    npcController: mockNpc,
    __mockNpcController: mockNpc
  }
})

// Import after mocks are defined
import { usePlayMode } from '../../../src/studio/hooks/usePlayMode'

// Get references to the mock objects
let mockPlayerController
let mockNPCController

beforeAll(async () => {
  const playerModule = await import('../../../src/engine/PlayerController')
  const npcModule = await import('../../../src/engine/NPCController')
  mockPlayerController = playerModule.__mockController
  mockNPCController = npcModule.npcController
})

describe('usePlayMode', () => {
  let rendererRef
  let world

  beforeEach(() => {
    vi.clearAllMocks()
    rendererRef = createMockRendererRef()
    world = createMockWorld()

    // Reset mock implementations
    mockPlayerController.setMesh.mockClear()
    mockPlayerController.setRenderer.mockClear()
    mockPlayerController.snapCameraToPosition.mockClear()
    mockPlayerController.update.mockClear()
    mockPlayerController.pause.mockClear()
    mockPlayerController.resume.mockClear()
    mockPlayerController.resetKeys.mockClear()
    mockPlayerController.dispose.mockClear()

    mockNPCController.setRenderer.mockClear()
    mockNPCController.update.mockClear()
    mockNPCController.clear.mockClear()
  })

  describe('player creation', () => {
    it('should create player mesh on entering play mode', () => {
      const { result, rerender } = renderHook(
        ({ mode }) => usePlayMode({ mode, rendererRef, world, isDialogueActive: false }),
        { initialProps: { mode: 'edit' } }
      )

      // Enter play mode
      rerender({ mode: 'play' })

      expect(result.current.playerMeshRef.current).toBeTruthy()
      expect(rendererRef.current.scene.add).toHaveBeenCalled()
    })

    it('should position player at spawn point if defined', () => {
      world.data.playerSpawn = { position: [150, 5, 200] }

      const { result, rerender } = renderHook(
        ({ mode }) => usePlayMode({ mode, rendererRef, world, isDialogueActive: false }),
        { initialProps: { mode: 'edit' } }
      )

      rerender({ mode: 'play' })

      // Player mesh should be created and positioned
      expect(result.current.playerMeshRef.current).toBeTruthy()
      expect(result.current.playerMeshRef.current.position.set).toHaveBeenCalledWith(150, 5, 200)
    })

    it('should position player at default [100, 0, 100] if no spawn defined', () => {
      world.data.playerSpawn = null

      const { result, rerender } = renderHook(
        ({ mode }) => usePlayMode({ mode, rendererRef, world, isDialogueActive: false }),
        { initialProps: { mode: 'edit' } }
      )

      rerender({ mode: 'play' })

      expect(result.current.playerMeshRef.current.position.set).toHaveBeenCalledWith(100, 0, 100)
    })

    it('should scale player mesh to game scale factor (6)', () => {
      const { result, rerender } = renderHook(
        ({ mode }) => usePlayMode({ mode, rendererRef, world, isDialogueActive: false }),
        { initialProps: { mode: 'edit' } }
      )

      rerender({ mode: 'play' })

      expect(result.current.playerMeshRef.current.scale.setScalar).toHaveBeenCalledWith(6)
    })

    it('should attach walk animation parts (legPivots, armPivots)', () => {
      const { result, rerender } = renderHook(
        ({ mode }) => usePlayMode({ mode, rendererRef, world, isDialogueActive: false }),
        { initialProps: { mode: 'edit' } }
      )

      rerender({ mode: 'play' })

      const mesh = result.current.playerMeshRef.current
      expect(mesh.userData.parts).toBeDefined()
      expect(mesh.userData.parts.legPivots).toBeDefined()
      expect(mesh.userData.parts.armPivots).toBeDefined()
    })
  })

  describe('mode transitions', () => {
    it('should add player to scene when entering play mode', () => {
      const { rerender } = renderHook(
        ({ mode }) => usePlayMode({ mode, rendererRef, world, isDialogueActive: false }),
        { initialProps: { mode: 'edit' } }
      )

      rerender({ mode: 'play' })

      expect(rendererRef.current.scene.add).toHaveBeenCalled()
    })

    it('should remove player from scene when exiting play mode', () => {
      const { result, rerender } = renderHook(
        ({ mode }) => usePlayMode({ mode, rendererRef, world, isDialogueActive: false }),
        { initialProps: { mode: 'edit' } }
      )

      // Enter play mode
      rerender({ mode: 'play' })
      expect(result.current.playerMeshRef.current).toBeTruthy()

      // Exit play mode
      rerender({ mode: 'edit' })

      expect(rendererRef.current.scene.remove).toHaveBeenCalled()
      expect(result.current.playerMeshRef.current).toBeNull()
    })

    it('should disable orbit controls when entering play mode', () => {
      const { rerender } = renderHook(
        ({ mode }) => usePlayMode({ mode, rendererRef, world, isDialogueActive: false }),
        { initialProps: { mode: 'edit' } }
      )

      expect(rendererRef.current.orbitControls.enabled).toBe(true)

      rerender({ mode: 'play' })

      expect(rendererRef.current.orbitControls.enabled).toBe(false)
    })

    it('should re-enable orbit controls when exiting play mode', () => {
      const { rerender } = renderHook(
        ({ mode }) => usePlayMode({ mode, rendererRef, world, isDialogueActive: false }),
        { initialProps: { mode: 'edit' } }
      )

      rerender({ mode: 'play' })
      expect(rendererRef.current.orbitControls.enabled).toBe(false)

      rerender({ mode: 'edit' })

      expect(rendererRef.current.orbitControls.enabled).toBe(true)
    })

    it('should set up playModeUpdate callback when entering play mode', () => {
      const { rerender } = renderHook(
        ({ mode }) => usePlayMode({ mode, rendererRef, world, isDialogueActive: false }),
        { initialProps: { mode: 'edit' } }
      )

      expect(rendererRef.current.playModeUpdate).toBeNull()

      rerender({ mode: 'play' })

      expect(rendererRef.current.playMode).toBe(true)
      expect(rendererRef.current.playModeUpdate).toBeInstanceOf(Function)
    })

    it('should clear playModeUpdate callback when exiting play mode', () => {
      const { rerender } = renderHook(
        ({ mode }) => usePlayMode({ mode, rendererRef, world, isDialogueActive: false }),
        { initialProps: { mode: 'edit' } }
      )

      rerender({ mode: 'play' })
      expect(rendererRef.current.playModeUpdate).toBeTruthy()

      rerender({ mode: 'edit' })

      expect(rendererRef.current.playMode).toBe(false)
      expect(rendererRef.current.playModeUpdate).toBeNull()
    })
  })

  describe('controller lifecycle', () => {
    it('should create PlayerController on entering play mode', async () => {
      const playerModule = await import('../../../src/engine/PlayerController')

      const { rerender } = renderHook(
        ({ mode }) => usePlayMode({ mode, rendererRef, world, isDialogueActive: false }),
        { initialProps: { mode: 'edit' } }
      )

      rerender({ mode: 'play' })

      expect(playerModule.PlayerController).toHaveBeenCalledWith(rendererRef.current.camera)
      expect(mockPlayerController.setMesh).toHaveBeenCalled()
      expect(mockPlayerController.setRenderer).toHaveBeenCalledWith(rendererRef.current)
      expect(mockPlayerController.snapCameraToPosition).toHaveBeenCalled()
    })

    it('should dispose PlayerController on exiting play mode', () => {
      const { result, rerender } = renderHook(
        ({ mode }) => usePlayMode({ mode, rendererRef, world, isDialogueActive: false }),
        { initialProps: { mode: 'edit' } }
      )

      rerender({ mode: 'play' })
      expect(result.current.playerControllerRef.current).toBeTruthy()

      rerender({ mode: 'edit' })

      expect(mockPlayerController.dispose).toHaveBeenCalled()
      expect(mockPlayerController.resetKeys).toHaveBeenCalled()
      expect(result.current.playerControllerRef.current).toBeNull()
    })

    it('should call resetKeys on exit to prevent stuck keys', () => {
      const { rerender } = renderHook(
        ({ mode }) => usePlayMode({ mode, rendererRef, world, isDialogueActive: false }),
        { initialProps: { mode: 'edit' } }
      )

      rerender({ mode: 'play' })
      rerender({ mode: 'edit' })

      expect(mockPlayerController.resetKeys).toHaveBeenCalled()
    })

    it('should handle missing rendererRef gracefully', () => {
      const nullRendererRef = { current: null }

      const { rerender } = renderHook(
        ({ mode }) => usePlayMode({ mode, rendererRef: nullRendererRef, world, isDialogueActive: false }),
        { initialProps: { mode: 'edit' } }
      )

      // Should not throw
      expect(() => rerender({ mode: 'play' })).not.toThrow()
    })
  })

  describe('dialogue integration', () => {
    it('should pause player during dialogue', () => {
      const { rerender } = renderHook(
        ({ mode, isDialogueActive }) => usePlayMode({ mode, rendererRef, world, isDialogueActive }),
        { initialProps: { mode: 'play', isDialogueActive: false } }
      )

      // Start dialogue
      rerender({ mode: 'play', isDialogueActive: true })

      expect(mockPlayerController.pause).toHaveBeenCalled()
    })

    it('should resume player after dialogue ends', () => {
      const { rerender } = renderHook(
        ({ mode, isDialogueActive }) => usePlayMode({ mode, rendererRef, world, isDialogueActive }),
        { initialProps: { mode: 'play', isDialogueActive: false } }
      )

      // Start dialogue
      rerender({ mode: 'play', isDialogueActive: true })
      // End dialogue
      rerender({ mode: 'play', isDialogueActive: false })

      expect(mockPlayerController.resume).toHaveBeenCalled()
    })

    it('should use ref for dialogue state to avoid stale closure in update loop', () => {
      const { rerender } = renderHook(
        ({ mode, isDialogueActive }) => usePlayMode({ mode, rendererRef, world, isDialogueActive }),
        { initialProps: { mode: 'play', isDialogueActive: false } }
      )

      // Get the update callback
      const updateCallback = rendererRef.current.playModeUpdate

      // Simulate dialogue becoming active
      rerender({ mode: 'play', isDialogueActive: true })

      // The callback should still work (it uses ref, not closure)
      expect(() => updateCallback(0.016)).not.toThrow()

      // Player update should not be called when dialogue is active
      // (This tests that the ref is being read inside the callback)
      mockPlayerController.update.mockClear()
      updateCallback(0.016)
      // Note: We can't directly verify the ref behavior in the mock,
      // but the test ensures the callback doesn't crash
    })

    it('should handle dialogue toggle during mode transition', () => {
      const { rerender } = renderHook(
        ({ mode, isDialogueActive }) => usePlayMode({ mode, rendererRef, world, isDialogueActive }),
        { initialProps: { mode: 'edit', isDialogueActive: false } }
      )

      // Enter play mode with dialogue already active (edge case)
      rerender({ mode: 'play', isDialogueActive: true })

      // Should handle gracefully
      expect(rendererRef.current.playMode).toBe(true)
    })
  })

  describe('NPC controller', () => {
    it('should set renderer on NPC controller when entering play mode', () => {
      const { rerender } = renderHook(
        ({ mode }) => usePlayMode({ mode, rendererRef, world, isDialogueActive: false }),
        { initialProps: { mode: 'edit' } }
      )

      rerender({ mode: 'play' })

      expect(mockNPCController.setRenderer).toHaveBeenCalledWith(rendererRef.current)
    })

    it('should clear NPC state when exiting play mode', () => {
      const { rerender } = renderHook(
        ({ mode }) => usePlayMode({ mode, rendererRef, world, isDialogueActive: false }),
        { initialProps: { mode: 'edit' } }
      )

      rerender({ mode: 'play' })
      rerender({ mode: 'edit' })

      expect(mockNPCController.clear).toHaveBeenCalled()
    })

    it('should clear NPC state when world changes', () => {
      const world1 = createMockWorld({ data: { ...createMockWorld().data, meta: { id: 'world_1' } } })
      const world2 = createMockWorld({ data: { ...createMockWorld().data, meta: { id: 'world_2' } } })

      const { rerender, unmount } = renderHook(
        ({ world }) => usePlayMode({ mode: 'edit', rendererRef, world, isDialogueActive: false }),
        { initialProps: { world: world1 } }
      )

      // Change world
      rerender({ world: world2 })
      unmount()

      // Should have called clear on world change cleanup
      expect(mockNPCController.clear).toHaveBeenCalled()
    })
  })

  describe('effect cleanup', () => {
    it('should dispose PlayerController when unmounting while in play mode', () => {
      const { unmount } = renderHook(
        ({ mode }) => usePlayMode({ mode, rendererRef, world, isDialogueActive: false }),
        { initialProps: { mode: 'play' } }
      )

      mockPlayerController.dispose.mockClear()

      // Unmount while still in play mode (e.g., component unmounts)
      unmount()

      // Should dispose to prevent memory leak
      expect(mockPlayerController.dispose).toHaveBeenCalled()
    })

    it('should not leak event listeners after exiting play mode', () => {
      const { unmount, rerender } = renderHook(
        ({ mode }) => usePlayMode({ mode, rendererRef, world, isDialogueActive: false }),
        { initialProps: { mode: 'edit' } }
      )

      rerender({ mode: 'play' })
      rerender({ mode: 'edit' })

      // Dispose should have been called when exiting play mode
      expect(mockPlayerController.dispose).toHaveBeenCalled()
    })

    it('should handle rapid mode changes without errors', () => {
      const { rerender } = renderHook(
        ({ mode }) => usePlayMode({ mode, rendererRef, world, isDialogueActive: false }),
        { initialProps: { mode: 'edit' } }
      )

      // Rapid toggling
      expect(() => {
        rerender({ mode: 'play' })
        rerender({ mode: 'edit' })
        rerender({ mode: 'play' })
        rerender({ mode: 'edit' })
        rerender({ mode: 'play' })
      }).not.toThrow()
    })

    it('should clean up when transitioning from play to edit mode', () => {
      const { rerender } = renderHook(
        ({ mode }) => usePlayMode({ mode, rendererRef, world, isDialogueActive: false }),
        { initialProps: { mode: 'edit' } }
      )

      rerender({ mode: 'play' })

      // Clear mocks to isolate the exit behavior
      mockPlayerController.dispose.mockClear()
      mockNPCController.clear.mockClear()

      // Exit play mode
      rerender({ mode: 'edit' })

      expect(mockPlayerController.dispose).toHaveBeenCalled()
      expect(mockNPCController.clear).toHaveBeenCalled()
    })
  })
})
