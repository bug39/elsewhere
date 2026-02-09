import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SceneSequencer, lerp, lerp3 } from '../../../src/director/SceneSequencer.js'

/**
 * Tests for the Action System (keyframe interpolation and particle triggers)
 *
 * Note: ParticleSystem class itself requires WebGL, so we test:
 * - Action offset calculation
 * - Keyframe interpolation
 * - Particle trigger logic
 */

describe('Action System', () => {
  let mockRenderer
  let mockMeshes
  let basicResolvedScene

  beforeEach(() => {
    // Mock renderer with camera and scene
    mockRenderer = {
      scene: null, // No scene = no ParticleSystem created (avoids WebGL)
      camera: {
        position: { set: vi.fn() },
        lookAt: vi.fn(),
        fov: 60,
        updateProjectionMatrix: vi.fn()
      }
    }

    // Mock mesh with full transform interface
    const createMockMesh = () => ({
      position: { x: 0, y: 0, z: 0, set: vi.fn(function(x, y, z) { this.x = x; this.y = y; this.z = z }) },
      rotation: { x: 0, y: 0, z: 0, set: vi.fn(function(x, y, z) { this.x = x; this.y = y; this.z = z }) },
      scale: { x: 1, y: 1, z: 1, setScalar: vi.fn(function(s) { this.x = this.y = this.z = s }) }
    })

    mockMeshes = new Map([
      ['dragon', createMockMesh()],
      ['knight', createMockMesh()]
    ])

    // Basic scene with actions
    basicResolvedScene = {
      duration: 10,
      assets: [
        { id: 'dragon', initialPosition: [200, 0, 200], initialRotation: 0 },
        { id: 'knight', initialPosition: [200, 0, 215], initialRotation: Math.PI }
      ],
      shots: [
        {
          startTime: 0,
          endTime: 10,
          animations: [
            {
              assetId: 'dragon',
              keyframes: [
                { time: 0, position: [200, 0, 200], rotation: 0 },
                { time: 10, position: [200, 0, 200], rotation: 0 }
              ]
            },
            {
              assetId: 'knight',
              keyframes: [
                { time: 0, position: [200, 0, 215], rotation: Math.PI },
                { time: 10, position: [200, 0, 215], rotation: Math.PI }
              ]
            }
          ],
          camera: {
            keyframes: [
              { time: 0, position: [200, 12, 175], lookAt: [200, 1, 200], fov: 60 }
            ],
            easing: 'linear'
          },
          actions: [
            {
              assetId: 'dragon',
              startTime: 2,
              endTime: 6,
              duration: 4,
              description: 'Dragon rears back',
              keyframes: [
                { time: 0, positionOffset: [0, 0, 0], rotationOffset: [0, 0, 0], scaleMultiplier: 1 },
                { time: 0.25, positionOffset: [0, 2, -1], rotationOffset: [-0.3, 0, 0], scaleMultiplier: 1 },
                { time: 0.75, positionOffset: [0, 1, 2], rotationOffset: [0.2, 0, 0], scaleMultiplier: 1.2 },
                { time: 1, positionOffset: [0, 0, 0], rotationOffset: [0, 0, 0], scaleMultiplier: 1 }
              ],
              particles: []
            }
          ]
        }
      ]
    }
  })

  describe('_getActionOffset', () => {
    it('returns zero offset when no actions are active', () => {
      const seq = new SceneSequencer({
        resolvedScene: basicResolvedScene,
        renderer: mockRenderer,
        assetMeshes: mockMeshes
      })

      // Before action starts (t=1)
      const offset = seq._getActionOffset('dragon', 1)
      expect(offset.position).toEqual([0, 0, 0])
      expect(offset.rotation).toEqual([0, 0, 0])
      expect(offset.scale).toBe(1)
    })

    it('returns zero offset for non-existent asset', () => {
      const seq = new SceneSequencer({
        resolvedScene: basicResolvedScene,
        renderer: mockRenderer,
        assetMeshes: mockMeshes
      })

      const offset = seq._getActionOffset('unicorn', 4) // Asset doesn't exist
      expect(offset.position).toEqual([0, 0, 0])
      expect(offset.scale).toBe(1)
    })

    it('interpolates position offset during action', () => {
      const seq = new SceneSequencer({
        resolvedScene: basicResolvedScene,
        renderer: mockRenderer,
        assetMeshes: mockMeshes
      })

      // At t=3, we're 1 second into a 4-second action (normalized 0.25)
      // This is exactly at keyframe time 0.25: positionOffset [0, 2, -1]
      const offset = seq._getActionOffset('dragon', 3)
      expect(offset.position[1]).toBeCloseTo(2, 1) // Y offset
      expect(offset.position[2]).toBeCloseTo(-1, 1) // Z offset
    })

    it('interpolates rotation offset during action', () => {
      const seq = new SceneSequencer({
        resolvedScene: basicResolvedScene,
        renderer: mockRenderer,
        assetMeshes: mockMeshes
      })

      // At t=3 (normalized 0.25): rotationOffset [-0.3, 0, 0]
      const offset = seq._getActionOffset('dragon', 3)
      expect(offset.rotation[0]).toBeCloseTo(-0.3, 1) // X rotation (pitch)
    })

    it('interpolates scale multiplier during action', () => {
      const seq = new SceneSequencer({
        resolvedScene: basicResolvedScene,
        renderer: mockRenderer,
        assetMeshes: mockMeshes
      })

      // At t=5 (normalized 0.75): scaleMultiplier 1.2
      const offset = seq._getActionOffset('dragon', 5)
      expect(offset.scale).toBeCloseTo(1.2, 1)
    })

    it('returns first keyframe value at action start', () => {
      const seq = new SceneSequencer({
        resolvedScene: basicResolvedScene,
        renderer: mockRenderer,
        assetMeshes: mockMeshes
      })

      const offset = seq._getActionOffset('dragon', 2) // Exactly at startTime
      expect(offset.position).toEqual([0, 0, 0])
      expect(offset.scale).toBe(1)
    })

    it('returns last keyframe value at action end', () => {
      const seq = new SceneSequencer({
        resolvedScene: basicResolvedScene,
        renderer: mockRenderer,
        assetMeshes: mockMeshes
      })

      const offset = seq._getActionOffset('dragon', 6) // Exactly at endTime
      expect(offset.position).toEqual([0, 0, 0])
      expect(offset.scale).toBe(1)
    })

    it('returns zero offset after action ends', () => {
      const seq = new SceneSequencer({
        resolvedScene: basicResolvedScene,
        renderer: mockRenderer,
        assetMeshes: mockMeshes
      })

      const offset = seq._getActionOffset('dragon', 7) // After action ends
      expect(offset.position).toEqual([0, 0, 0])
      expect(offset.scale).toBe(1)
    })
  })

  describe('_interpolateActionKeyframes', () => {
    it('returns default for empty keyframes', () => {
      const seq = new SceneSequencer({
        resolvedScene: basicResolvedScene,
        renderer: mockRenderer,
        assetMeshes: mockMeshes
      })

      const pos = seq._interpolateActionKeyframes([], 0.5, 'positionOffset')
      const scale = seq._interpolateActionKeyframes([], 0.5, 'scaleMultiplier')

      expect(pos).toEqual([0, 0, 0])
      expect(scale).toBe(1)
    })

    it('returns first keyframe value before first time', () => {
      const seq = new SceneSequencer({
        resolvedScene: basicResolvedScene,
        renderer: mockRenderer,
        assetMeshes: mockMeshes
      })

      const keyframes = [
        { time: 0.2, positionOffset: [1, 2, 3] },
        { time: 0.8, positionOffset: [4, 5, 6] }
      ]

      const pos = seq._interpolateActionKeyframes(keyframes, 0.1, 'positionOffset')
      expect(pos).toEqual([1, 2, 3])
    })

    it('returns last keyframe value after last time', () => {
      const seq = new SceneSequencer({
        resolvedScene: basicResolvedScene,
        renderer: mockRenderer,
        assetMeshes: mockMeshes
      })

      const keyframes = [
        { time: 0.2, positionOffset: [1, 2, 3] },
        { time: 0.8, positionOffset: [4, 5, 6] }
      ]

      const pos = seq._interpolateActionKeyframes(keyframes, 0.9, 'positionOffset')
      expect(pos).toEqual([4, 5, 6])
    })

    it('interpolates between keyframes', () => {
      const seq = new SceneSequencer({
        resolvedScene: basicResolvedScene,
        renderer: mockRenderer,
        assetMeshes: mockMeshes
      })

      const keyframes = [
        { time: 0, positionOffset: [0, 0, 0] },
        { time: 1, positionOffset: [10, 20, 30] }
      ]

      const pos = seq._interpolateActionKeyframes(keyframes, 0.5, 'positionOffset')
      expect(pos).toEqual([5, 10, 15])
    })

    it('interpolates scale multiplier as scalar', () => {
      const seq = new SceneSequencer({
        resolvedScene: basicResolvedScene,
        renderer: mockRenderer,
        assetMeshes: mockMeshes
      })

      const keyframes = [
        { time: 0, scaleMultiplier: 1 },
        { time: 1, scaleMultiplier: 2 }
      ]

      const scale = seq._interpolateActionKeyframes(keyframes, 0.5, 'scaleMultiplier')
      expect(scale).toBe(1.5)
    })

    it('uses default when property is missing from keyframe', () => {
      const seq = new SceneSequencer({
        resolvedScene: basicResolvedScene,
        renderer: mockRenderer,
        assetMeshes: mockMeshes
      })

      // Keyframes without scaleMultiplier should default to 1
      const keyframes = [
        { time: 0, positionOffset: [0, 0, 0] },
        { time: 1, positionOffset: [10, 10, 10] }
      ]

      const scale = seq._interpolateActionKeyframes(keyframes, 0.5, 'scaleMultiplier')
      expect(scale).toBe(1)
    })
  })

  describe('additive action transforms', () => {
    it('applies action offset to base position', () => {
      const seq = new SceneSequencer({
        resolvedScene: basicResolvedScene,
        renderer: mockRenderer,
        assetMeshes: mockMeshes,
        assetScale: 1
      })

      // Seek to middle of action (t=4, normalized 0.5)
      // Interpolating between t=0.25 [0,2,-1] and t=0.75 [0,1,2]
      seq.seek(4)

      const dragonMesh = mockMeshes.get('dragon')
      expect(dragonMesh.position.set).toHaveBeenCalled()

      // Base position is [200, 0, 200], action adds offset
      const lastCall = dragonMesh.position.set.mock.calls[0]
      expect(lastCall[0]).toBeCloseTo(200, 0) // X unchanged
      expect(lastCall[1]).toBeGreaterThan(1) // Y has action offset + assetScale
      // Z should be between -1 and 2
    })

    it('applies action rotation offset', () => {
      const seq = new SceneSequencer({
        resolvedScene: basicResolvedScene,
        renderer: mockRenderer,
        assetMeshes: mockMeshes
      })

      // At t=3 (normalized 0.25), rotationOffset is [-0.3, 0, 0]
      seq.seek(3)

      const dragonMesh = mockMeshes.get('dragon')
      expect(dragonMesh.rotation.set).toHaveBeenCalled()

      const lastCall = dragonMesh.rotation.set.mock.calls[0]
      expect(lastCall[0]).toBeCloseTo(-0.3, 1) // X rotation from action
    })

    it('applies action scale multiplier', () => {
      const seq = new SceneSequencer({
        resolvedScene: basicResolvedScene,
        renderer: mockRenderer,
        assetMeshes: mockMeshes,
        assetScale: 2
      })

      // At t=5 (normalized 0.75), scaleMultiplier is 1.2
      seq.seek(5)

      const dragonMesh = mockMeshes.get('dragon')
      expect(dragonMesh.scale.setScalar).toHaveBeenCalled()

      const lastCall = dragonMesh.scale.setScalar.mock.calls[0]
      expect(lastCall[0]).toBeCloseTo(2 * 1.2, 1) // assetScale * action multiplier
    })
  })

  describe('multiple overlapping actions', () => {
    it('accumulates offsets from multiple actions', () => {
      const sceneWithMultipleActions = {
        ...basicResolvedScene,
        shots: [{
          ...basicResolvedScene.shots[0],
          actions: [
            {
              assetId: 'dragon',
              startTime: 0,
              endTime: 10,
              duration: 10,
              keyframes: [
                { time: 0, positionOffset: [1, 0, 0] },
                { time: 1, positionOffset: [1, 0, 0] }
              ]
            },
            {
              assetId: 'dragon',
              startTime: 0,
              endTime: 10,
              duration: 10,
              keyframes: [
                { time: 0, positionOffset: [0, 2, 0] },
                { time: 1, positionOffset: [0, 2, 0] }
              ]
            }
          ]
        }]
      }

      const seq = new SceneSequencer({
        resolvedScene: sceneWithMultipleActions,
        renderer: mockRenderer,
        assetMeshes: mockMeshes
      })

      const offset = seq._getActionOffset('dragon', 5)
      expect(offset.position[0]).toBe(1) // From first action
      expect(offset.position[1]).toBe(2) // From second action
    })

    it('multiplies scale from multiple actions', () => {
      const sceneWithMultipleActions = {
        ...basicResolvedScene,
        shots: [{
          ...basicResolvedScene.shots[0],
          actions: [
            {
              assetId: 'dragon',
              startTime: 0,
              endTime: 10,
              duration: 10,
              keyframes: [{ time: 0, scaleMultiplier: 1.5 }, { time: 1, scaleMultiplier: 1.5 }]
            },
            {
              assetId: 'dragon',
              startTime: 0,
              endTime: 10,
              duration: 10,
              keyframes: [{ time: 0, scaleMultiplier: 2 }, { time: 1, scaleMultiplier: 2 }]
            }
          ]
        }]
      }

      const seq = new SceneSequencer({
        resolvedScene: sceneWithMultipleActions,
        renderer: mockRenderer,
        assetMeshes: mockMeshes
      })

      const offset = seq._getActionOffset('dragon', 5)
      expect(offset.scale).toBe(1.5 * 2) // Multiplicative
    })
  })

  describe('particle trigger tracking', () => {
    it('resets triggers on seek', () => {
      const seq = new SceneSequencer({
        resolvedScene: basicResolvedScene,
        renderer: mockRenderer,
        assetMeshes: mockMeshes
      })

      // Manually add to triggered set
      seq._triggeredParticles.add('test:trigger')
      seq._continuousParticleTimers.set('test:timer', 5)

      seq.seek(0)

      expect(seq._triggeredParticles.size).toBe(0)
      expect(seq._continuousParticleTimers.size).toBe(0)
    })

    it('clears particles on dispose', () => {
      const seq = new SceneSequencer({
        resolvedScene: basicResolvedScene,
        renderer: mockRenderer,
        assetMeshes: mockMeshes
      })

      seq._triggeredParticles.add('test:trigger')

      seq.dispose()

      expect(seq._triggeredParticles.size).toBe(0)
    })
  })
})

describe('SpatialResolver action passthrough', () => {
  it('validates action keyframes with clamping', async () => {
    // Import dynamically to test SpatialResolver
    const { resolveScene } = await import('../../../src/director/SpatialResolver.js')

    const scenePlan = {
      shots: [{
        beat: 'test',
        description: 'test',
        duration_seconds: 5,
        subjects: { primary: 'dragon' },
        spatial_relationship: 'stationary',
        camera_style: 'wide_establishing',
        actions: [{
          assetId: 'dragon',
          startTime: 1,
          duration: 2,
          keyframes: [
            { time: -0.5, positionOffset: [100, 100, 100] }, // Should clamp
            { time: 2, scaleMultiplier: 100 } // Should clamp
          ]
        }]
      }]
    }

    const resolved = resolveScene(scenePlan)

    // Check actions were passed through with clamping
    expect(resolved.shots[0].actions).toHaveLength(1)
    const action = resolved.shots[0].actions[0]

    // Time should be clamped to [0, 1]
    expect(action.keyframes[0].time).toBe(0)
    expect(action.keyframes[1].time).toBe(1)

    // Position should be clamped to ±20
    expect(action.keyframes[0].positionOffset[0]).toBe(20)

    // Scale should be clamped to 5 max
    expect(action.keyframes[1].scaleMultiplier).toBe(5)
  })

  it('converts action times from relative to absolute', async () => {
    const { resolveScene } = await import('../../../src/director/SpatialResolver.js')

    const scenePlan = {
      shots: [
        {
          beat: 'first',
          duration_seconds: 5,
          subjects: { primary: 'dragon' },
          spatial_relationship: 'stationary',
          camera_style: 'wide_establishing'
        },
        {
          beat: 'second',
          duration_seconds: 5,
          subjects: { primary: 'dragon' },
          spatial_relationship: 'stationary',
          camera_style: 'wide_establishing',
          actions: [{
            assetId: 'dragon',
            startTime: 1, // 1 second into shot
            duration: 2
          }]
        }
      ]
    }

    const resolved = resolveScene(scenePlan)

    // Second shot starts at t=5, action is 1 second into that
    const action = resolved.shots[1].actions[0]
    expect(action.startTime).toBe(6) // 5 + 1
    expect(action.endTime).toBe(8)   // 6 + 2
  })

  it('handles missing actions gracefully', async () => {
    const { resolveScene } = await import('../../../src/director/SpatialResolver.js')

    const scenePlan = {
      shots: [{
        beat: 'test',
        duration_seconds: 5,
        subjects: { primary: 'dragon' },
        spatial_relationship: 'stationary',
        camera_style: 'wide_establishing'
        // No actions field
      }]
    }

    const resolved = resolveScene(scenePlan)
    expect(resolved.shots[0].actions).toEqual([])
  })
})
