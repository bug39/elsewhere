import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  lerp,
  lerp3,
  lerpAngle,
  getValueAtTime,
  getCameraAtTime,
  SceneSequencer
} from '../../../src/director/SceneSequencer.js'

describe('SceneSequencer', () => {
  describe('lerp', () => {
    it('interpolates between two values', () => {
      expect(lerp(0, 10, 0)).toBe(0)
      expect(lerp(0, 10, 0.5)).toBe(5)
      expect(lerp(0, 10, 1)).toBe(10)
    })

    it('handles negative values', () => {
      expect(lerp(-10, 10, 0.5)).toBe(0)
    })
  })

  describe('lerp3', () => {
    it('interpolates 3D positions', () => {
      const a = [0, 0, 0]
      const b = [10, 20, 30]

      expect(lerp3(a, b, 0)).toEqual([0, 0, 0])
      expect(lerp3(a, b, 0.5)).toEqual([5, 10, 15])
      expect(lerp3(a, b, 1)).toEqual([10, 20, 30])
    })
  })

  describe('lerpAngle', () => {
    it('interpolates angles linearly when no wraparound needed', () => {
      expect(lerpAngle(0, Math.PI / 2, 0.5)).toBeCloseTo(Math.PI / 4)
    })

    it('takes shortest path across PI boundary', () => {
      // From 170° to -170° should go through 180°, not through 0°
      const start = (170 / 180) * Math.PI  // ~2.96 rad
      const end = (-170 / 180) * Math.PI   // ~-2.96 rad

      const mid = lerpAngle(start, end, 0.5)
      // Midpoint should be ~±180° (±PI)
      expect(Math.abs(mid)).toBeCloseTo(Math.PI, 1)
    })

    it('handles negative to positive transition', () => {
      const start = -Math.PI / 4
      const end = Math.PI / 4
      expect(lerpAngle(start, end, 0.5)).toBeCloseTo(0)
    })
  })

  describe('getValueAtTime', () => {
    const positionKeyframes = [
      { time: 0, position: [0, 0, 0], rotation: 0 },
      { time: 5, position: [10, 0, 0], rotation: Math.PI },
      { time: 10, position: [10, 0, 10], rotation: Math.PI }
    ]

    it('returns first value before first keyframe', () => {
      const pos = getValueAtTime(positionKeyframes, -1, 'position')
      expect(pos).toEqual([0, 0, 0])
    })

    it('returns first value at first keyframe', () => {
      const pos = getValueAtTime(positionKeyframes, 0, 'position')
      expect(pos).toEqual([0, 0, 0])
    })

    it('interpolates between keyframes', () => {
      const pos = getValueAtTime(positionKeyframes, 2.5, 'position')
      expect(pos).toEqual([5, 0, 0])
    })

    it('returns last value at last keyframe', () => {
      const pos = getValueAtTime(positionKeyframes, 10, 'position')
      expect(pos).toEqual([10, 0, 10])
    })

    it('returns last value after last keyframe', () => {
      const pos = getValueAtTime(positionKeyframes, 15, 'position')
      expect(pos).toEqual([10, 0, 10])
    })

    it('interpolates rotation', () => {
      const rot = getValueAtTime(positionKeyframes, 2.5, 'rotation')
      expect(rot).toBeCloseTo(Math.PI / 2)
    })

    it('handles empty keyframes array', () => {
      expect(getValueAtTime([], 5, 'position')).toEqual([0, 0, 0])
      expect(getValueAtTime([], 5, 'rotation')).toBe(0)
    })

    it('handles single keyframe', () => {
      const single = [{ time: 0, position: [5, 5, 5], rotation: 1 }]
      expect(getValueAtTime(single, 10, 'position')).toEqual([5, 5, 5])
    })

    it('applies easing function', () => {
      // easeInOutQuad at t=0.5 should equal 0.5 (inflection point)
      const pos = getValueAtTime(positionKeyframes, 2.5, 'position', 'easeInOutQuad')
      expect(pos).toEqual([5, 0, 0])

      // At t=0.25 (first quarter), easeInOutQuad = 2 * 0.25² = 0.125
      const posEarly = getValueAtTime(positionKeyframes, 1.25, 'position', 'easeInOutQuad')
      expect(posEarly[0]).toBeCloseTo(1.25) // 10 * 0.125
    })
  })

  describe('getCameraAtTime', () => {
    const cameraKeyframes = [
      { time: 0, position: [0, 10, 20], lookAt: [0, 0, 0], fov: 60 },
      { time: 5, position: [10, 10, 20], lookAt: [10, 0, 0], fov: 40 }
    ]

    it('returns first value before first keyframe', () => {
      const cam = getCameraAtTime(cameraKeyframes, -1)
      expect(cam.position).toEqual([0, 10, 20])
      expect(cam.lookAt).toEqual([0, 0, 0])
      expect(cam.fov).toBe(60)
    })

    it('interpolates camera values', () => {
      const cam = getCameraAtTime(cameraKeyframes, 2.5)
      expect(cam.position).toEqual([5, 10, 20])
      expect(cam.lookAt).toEqual([5, 0, 0])
      expect(cam.fov).toBe(50)
    })

    it('returns last value after last keyframe', () => {
      const cam = getCameraAtTime(cameraKeyframes, 10)
      expect(cam.position).toEqual([10, 10, 20])
      expect(cam.fov).toBe(40)
    })

    it('handles empty keyframes', () => {
      const cam = getCameraAtTime([], 5)
      expect(cam.position).toEqual([0, 10, 20])
      expect(cam.fov).toBe(60)
    })
  })

  describe('SceneSequencer class', () => {
    let mockRenderer
    let mockMeshes
    let resolvedScene

    beforeEach(() => {
      // Mock renderer with camera
      mockRenderer = {
        camera: {
          position: { set: vi.fn() },
          lookAt: vi.fn(),
          fov: 60,
          updateProjectionMatrix: vi.fn()
        }
      }

      // Mock meshes map (full transform interface for action system)
      const createMockMesh = () => ({
        position: { x: 0, y: 0, z: 0, set: vi.fn() },
        rotation: { x: 0, y: 0, z: 0, set: vi.fn() },
        scale: { x: 1, y: 1, z: 1, setScalar: vi.fn() }
      })
      mockMeshes = new Map([
        ['knight', createMockMesh()],
        ['dragon', createMockMesh()]
      ])

      // Sample resolved scene
      resolvedScene = {
        duration: 10,
        assets: [
          { id: 'knight', initialPosition: [200, 0, 200], initialRotation: 0 },
          { id: 'dragon', initialPosition: [200, 0, 230], initialRotation: Math.PI }
        ],
        shots: [
          {
            startTime: 0,
            endTime: 5,
            animations: [
              {
                assetId: 'knight',
                keyframes: [
                  { time: 0, position: [200, 0, 200], rotation: 0 },
                  { time: 5, position: [200, 0, 215], rotation: 0 }
                ]
              }
            ],
            camera: {
              keyframes: [
                { time: 0, position: [200, 12, 175], lookAt: [200, 1, 200], fov: 60 },
                { time: 5, position: [200, 12, 190], lookAt: [200, 1, 207], fov: 60 }
              ],
              easing: 'easeInOutQuad'
            }
          },
          {
            startTime: 5,
            endTime: 10,
            animations: [
              {
                assetId: 'dragon',
                keyframes: [
                  { time: 0, position: [200, 0, 230], rotation: Math.PI },
                  { time: 5, position: [200, 0, 220], rotation: Math.PI }
                ]
              }
            ],
            camera: {
              keyframes: [
                { time: 5, position: [200, 12, 250], lookAt: [200, 1, 225], fov: 60 },
                { time: 10, position: [200, 8, 240], lookAt: [200, 1, 220], fov: 40 }
              ],
              easing: 'linear'
            }
          }
        ]
      }
    })

    describe('constructor and getters', () => {
      it('initializes with correct defaults', () => {
        const seq = new SceneSequencer({
          resolvedScene,
          renderer: mockRenderer,
          assetMeshes: mockMeshes
        })

        expect(seq.currentTime).toBe(0)
        expect(seq.duration).toBe(10)
        expect(seq.isPlaying).toBe(false)
        expect(seq.currentShotIndex).toBe(0)
      })

      it('handles missing resolvedScene gracefully', () => {
        const seq = new SceneSequencer({
          resolvedScene: null,
          renderer: mockRenderer,
          assetMeshes: mockMeshes
        })

        expect(seq.duration).toBe(0)
      })
    })

    describe('play/pause/stop', () => {
      it('play sets isPlaying to true', () => {
        const seq = new SceneSequencer({
          resolvedScene,
          renderer: mockRenderer,
          assetMeshes: mockMeshes
        })

        seq.play()
        expect(seq.isPlaying).toBe(true)
      })

      it('pause sets isPlaying to false', () => {
        const seq = new SceneSequencer({
          resolvedScene,
          renderer: mockRenderer,
          assetMeshes: mockMeshes
        })

        seq.play()
        seq.pause()
        expect(seq.isPlaying).toBe(false)
      })

      it('stop resets to beginning', () => {
        const seq = new SceneSequencer({
          resolvedScene,
          renderer: mockRenderer,
          assetMeshes: mockMeshes
        })

        seq.play()
        seq.update(3) // Advance 3 seconds
        seq.stop()

        expect(seq.isPlaying).toBe(false)
        expect(seq.currentTime).toBe(0)
      })
    })

    describe('seek', () => {
      it('clamps to valid range', () => {
        const seq = new SceneSequencer({
          resolvedScene,
          renderer: mockRenderer,
          assetMeshes: mockMeshes
        })

        seq.seek(-5)
        expect(seq.currentTime).toBe(0)

        seq.seek(100)
        expect(seq.currentTime).toBe(10) // Clamped to duration
      })

      it('updates shot index on seek', () => {
        const onShotChange = vi.fn()
        const seq = new SceneSequencer({
          resolvedScene,
          renderer: mockRenderer,
          assetMeshes: mockMeshes,
          onShotChange
        })

        seq.seek(7) // Into second shot
        expect(seq.currentShotIndex).toBe(1)
        expect(onShotChange).toHaveBeenCalledWith(1)
      })

      it('fires onTimeUpdate callback', () => {
        const onTimeUpdate = vi.fn()
        const seq = new SceneSequencer({
          resolvedScene,
          renderer: mockRenderer,
          assetMeshes: mockMeshes,
          onTimeUpdate
        })

        seq.seek(3)
        expect(onTimeUpdate).toHaveBeenCalledWith(3)
      })
    })

    describe('update', () => {
      it('does nothing when paused', () => {
        const onTimeUpdate = vi.fn()
        const seq = new SceneSequencer({
          resolvedScene,
          renderer: mockRenderer,
          assetMeshes: mockMeshes,
          onTimeUpdate
        })

        seq.update(1)
        expect(onTimeUpdate).not.toHaveBeenCalled()
        expect(seq.currentTime).toBe(0)
      })

      it('advances time when playing', () => {
        const seq = new SceneSequencer({
          resolvedScene,
          renderer: mockRenderer,
          assetMeshes: mockMeshes
        })

        seq.play()
        seq.update(0.5)
        expect(seq.currentTime).toBe(0.5)
      })

      it('fires onShotChange when crossing shot boundary', () => {
        const onShotChange = vi.fn()
        const seq = new SceneSequencer({
          resolvedScene,
          renderer: mockRenderer,
          assetMeshes: mockMeshes,
          onShotChange
        })

        seq.play()
        seq.update(4.9) // Still in shot 0
        expect(onShotChange).not.toHaveBeenCalled()

        seq.update(0.2) // Cross into shot 1
        expect(onShotChange).toHaveBeenCalledWith(1)
      })

      it('fires onComplete when reaching end', () => {
        const onComplete = vi.fn()
        const seq = new SceneSequencer({
          resolvedScene,
          renderer: mockRenderer,
          assetMeshes: mockMeshes,
          onComplete
        })

        seq.play()
        seq.update(11) // Jump past end

        expect(onComplete).toHaveBeenCalled()
        expect(seq.isPlaying).toBe(false)
        expect(seq.currentTime).toBe(10) // Clamped to duration
      })

      it('updates mesh positions', () => {
        const seq = new SceneSequencer({
          resolvedScene,
          renderer: mockRenderer,
          assetMeshes: mockMeshes
        })

        seq.play()
        seq.update(2.5) // Halfway through first shot

        const knightMesh = mockMeshes.get('knight')
        expect(knightMesh.position.set).toHaveBeenCalled()
      })

      it('updates camera position and lookAt', () => {
        const seq = new SceneSequencer({
          resolvedScene,
          renderer: mockRenderer,
          assetMeshes: mockMeshes
        })

        seq.play()
        seq.update(2.5)

        expect(mockRenderer.camera.position.set).toHaveBeenCalled()
        expect(mockRenderer.camera.lookAt).toHaveBeenCalled()
      })

      it('updates camera FOV and projection matrix when FOV changes', () => {
        const seq = new SceneSequencer({
          resolvedScene,
          renderer: mockRenderer,
          assetMeshes: mockMeshes
        })

        seq.seek(7.5) // Second shot where FOV transitions from 60 to 40
        seq.play()
        seq.update(0.1)

        expect(mockRenderer.camera.updateProjectionMatrix).toHaveBeenCalled()
      })
    })

    describe('dispose', () => {
      it('clears callbacks and stops playback', () => {
        const onComplete = vi.fn()
        const seq = new SceneSequencer({
          resolvedScene,
          renderer: mockRenderer,
          assetMeshes: mockMeshes,
          onComplete
        })

        seq.play()
        seq.dispose()

        expect(seq.isPlaying).toBe(false)

        // Should not fire callbacks after dispose
        seq.play()
        seq.update(11)
        expect(onComplete).not.toHaveBeenCalled()
      })
    })
  })
})
