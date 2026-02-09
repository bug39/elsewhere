import { describe, it, expect } from 'vitest'
import { resolveScene, normalizeAssetId, isAnchorAsset, SCENE_CENTER, DISTANCES } from '../../../src/director/SpatialResolver.js'
import * as relationships from '../../../src/director/templates/relationships.js'
import * as cameras from '../../../src/director/templates/cameras.js'

describe('SpatialResolver', () => {
  describe('normalizeAssetId', () => {
    it('lowercases IDs', () => {
      expect(normalizeAssetId('Knight')).toBe('knight')
      expect(normalizeAssetId('DRAGON')).toBe('dragon')
    })

    it('strips numeric suffixes', () => {
      expect(normalizeAssetId('knight_01')).toBe('knight')
      expect(normalizeAssetId('dragon_123')).toBe('dragon')
    })

    it('preserves non-numeric suffixes', () => {
      expect(normalizeAssetId('dragon_cave')).toBe('dragon_cave')
    })
  })

  describe('isAnchorAsset', () => {
    it('detects anchor patterns', () => {
      expect(isAnchorAsset('dragon_cave')).toBe(true)
      expect(isAnchorAsset('castle_tower')).toBe(true)
      expect(isAnchorAsset('ancient_altar')).toBe(true)
      expect(isAnchorAsset('stone_gate')).toBe(true)
    })

    it('returns false for non-anchors', () => {
      expect(isAnchorAsset('knight')).toBe(false)
      expect(isAnchorAsset('dragon')).toBe(false)
      expect(isAnchorAsset('wizard_01')).toBe(false)
    })
  })

  describe('resolveScene', () => {
    it('requires at least one shot', () => {
      expect(() => resolveScene({})).toThrow('must have at least one shot')
      expect(() => resolveScene({ shots: [] })).toThrow('must have at least one shot')
    })

    it('returns correct structure', () => {
      const plan = {
        shots: [{
          beat: 'approach',
          duration_seconds: 5,
          subjects: { primary: 'knight', secondary: 'dragon' },
          spatial_relationship: 'approaching',
          camera_style: 'tracking_behind'
        }]
      }

      const result = resolveScene(plan)

      expect(result).toHaveProperty('duration')
      expect(result).toHaveProperty('assets')
      expect(result).toHaveProperty('shots')
      expect(result.duration).toBe(5)
      expect(result.assets.length).toBe(2)
      expect(result.shots.length).toBe(1)
    })

    it('computes correct initial positions', () => {
      const plan = {
        shots: [{
          beat: 'approach',
          duration_seconds: 5,
          subjects: { primary: 'knight', secondary: 'dragon' },
          spatial_relationship: 'approaching',
          camera_style: 'tracking_behind'
        }]
      }

      const result = resolveScene(plan)

      // Primary at scene center
      const knight = result.assets.find(a => a.id === 'knight')
      expect(knight.initialPosition[0]).toBe(SCENE_CENTER.x)
      expect(knight.initialPosition[2]).toBe(SCENE_CENTER.z)

      // Secondary positioned away (for approaching - offset in Z direction)
      const dragon = result.assets.find(a => a.id === 'dragon')
      // For "approaching", secondary is placed far away in front of primary
      // X stays the same, but Z should be offset
      expect(dragon.initialPosition[2]).not.toBe(SCENE_CENTER.z)
    })

    it('maintains continuity across shots', () => {
      const plan = {
        shots: [
          {
            beat: 'approach',
            duration_seconds: 5,
            subjects: { primary: 'knight', secondary: 'dragon' },
            spatial_relationship: 'approaching',
            camera_style: 'tracking_behind'
          },
          {
            beat: 'face_off',
            duration_seconds: 3,
            subjects: { primary: 'knight', secondary: 'dragon' },
            spatial_relationship: 'facing_at_distance',
            camera_style: 'wide_establishing'
          }
        ]
      }

      const result = resolveScene(plan)

      expect(result.duration).toBe(8) // 5 + 3
      expect(result.shots[0].startTime).toBe(0)
      expect(result.shots[0].endTime).toBe(5)
      expect(result.shots[1].startTime).toBe(5)
      expect(result.shots[1].endTime).toBe(8)
    })

    it('handles unknown relationships gracefully', () => {
      const plan = {
        shots: [{
          beat: 'test',
          duration_seconds: 5,
          subjects: { primary: 'knight' },
          spatial_relationship: 'unknown_relationship',
          camera_style: 'tracking_behind'
        }]
      }

      // Should not throw, should default to stationary
      const result = resolveScene(plan)
      expect(result.shots.length).toBe(1)
    })

    it('handles unknown camera styles gracefully', () => {
      const plan = {
        shots: [{
          beat: 'test',
          duration_seconds: 5,
          subjects: { primary: 'knight' },
          spatial_relationship: 'stationary',
          camera_style: 'unknown_camera'
        }]
      }

      // Should not throw, should default to tracking_behind
      const result = resolveScene(plan)
      expect(result.shots[0].camera.keyframes.length).toBeGreaterThan(0)
    })

    it('clamps durations to valid range', () => {
      const plan = {
        shots: [
          {
            beat: 'too_short',
            duration_seconds: 0.5, // Below minimum
            subjects: { primary: 'knight' },
            spatial_relationship: 'stationary',
            camera_style: 'tracking_behind'
          },
          {
            beat: 'too_long',
            duration_seconds: 60, // Above maximum
            subjects: { primary: 'knight' },
            spatial_relationship: 'stationary',
            camera_style: 'tracking_behind'
          }
        ]
      }

      const result = resolveScene(plan)

      // First shot clamped to minimum (2s)
      expect(result.shots[0].endTime - result.shots[0].startTime).toBe(2)
      // Second shot clamped to maximum (30s)
      expect(result.shots[1].endTime - result.shots[1].startTime).toBe(30)
    })
  })
})

describe('Relationship Templates', () => {
  const baseCtx = {
    duration: 5,
    primaryStart: [200, 0, 200],
    secondaryStart: [200, 0, 230],
    primaryRotation: 0,
    secondaryRotation: Math.PI
  }

  describe('approaching', () => {
    it('moves primary toward secondary', () => {
      const result = relationships.approaching(baseCtx)

      expect(result.primary.length).toBe(2)
      expect(result.secondary.length).toBe(2)

      // Primary should move toward secondary (z increases)
      const startZ = result.primary[0].position[2]
      const endZ = result.primary[1].position[2]
      expect(endZ).toBeGreaterThan(startZ)
    })

    it('handles no secondary', () => {
      const ctx = { ...baseCtx, secondaryStart: null, secondaryRotation: null }
      const result = relationships.approaching(ctx)

      expect(result.primary.length).toBe(2)
      expect(result.secondary).toBeNull()
    })
  })

  describe('facing_at_distance', () => {
    it('keeps both subjects stationary', () => {
      const result = relationships.facing_at_distance(baseCtx)

      // Positions should not change
      expect(result.primary[0].position).toEqual(result.primary[1].position)
      expect(result.secondary[0].position).toEqual(result.secondary[1].position)
    })

    it('orients subjects to face each other', () => {
      const result = relationships.facing_at_distance(baseCtx)

      // Primary rotation should point toward secondary
      // Secondary is at z=230, primary at z=200, so primary should face +z (angle ~0)
      expect(result.primary[0].rotation).toBeCloseTo(0, 1)
    })
  })

  describe('circling', () => {
    it('creates multiple keyframes for smooth orbit', () => {
      const result = relationships.circling(baseCtx)

      expect(result.primary.length).toBeGreaterThan(2)
      // Should be arc, verify positions change
      const positions = result.primary.map(kf => kf.position)
      const uniqueX = new Set(positions.map(p => p[0].toFixed(2)))
      expect(uniqueX.size).toBeGreaterThan(1) // Multiple unique X positions
    })
  })

  describe('side_by_side', () => {
    it('moves both subjects parallel', () => {
      const result = relationships.side_by_side(baseCtx)

      // Both should move same delta
      const primaryDelta = result.primary[1].position[2] - result.primary[0].position[2]
      const secondaryDelta = result.secondary[1].position[2] - result.secondary[0].position[2]
      expect(primaryDelta).toBeCloseTo(secondaryDelta, 5)
    })
  })

  describe('stationary', () => {
    it('keeps all positions unchanged', () => {
      const result = relationships.stationary(baseCtx)

      expect(result.primary[0].position).toEqual(result.primary[1].position)
      expect(result.secondary[0].position).toEqual(result.secondary[1].position)
    })
  })

  describe('walking_away', () => {
    it('moves primary away from secondary', () => {
      const result = relationships.walking_away(baseCtx)

      // Primary should move away (z decreases, since secondary is at z=230)
      const startZ = result.primary[0].position[2]
      const endZ = result.primary[1].position[2]
      expect(endZ).toBeLessThan(startZ)
    })
  })
})

describe('Camera Templates', () => {
  const baseCameraCtx = {
    startTime: 0,
    endTime: 5,
    primaryKeyframes: [
      { time: 0, position: [200, 0, 200], rotation: 0 },
      { time: 5, position: [200, 0, 210], rotation: 0 }
    ],
    secondaryKeyframes: null,
    sceneCenter: [200, 0, 200]
  }

  describe('tracking_behind', () => {
    it('positions camera behind subject', () => {
      const result = cameras.tracking_behind(baseCameraCtx)

      expect(result.keyframes.length).toBeGreaterThan(0)
      expect(result.easing).toBe('easeInOutQuad')

      // Camera should be behind (lower z for forward-facing subject)
      const camZ = result.keyframes[0].position[2]
      const subjectZ = baseCameraCtx.primaryKeyframes[0].position[2]
      expect(camZ).toBeLessThan(subjectZ)
    })
  })

  describe('wide_establishing', () => {
    it('creates static wide shot', () => {
      const result = cameras.wide_establishing(baseCameraCtx)

      expect(result.keyframes.length).toBe(2)
      expect(result.easing).toBe('linear')

      // Camera position should not change
      expect(result.keyframes[0].position).toEqual(result.keyframes[1].position)

      // FOV should be wide
      expect(result.keyframes[0].fov).toBe(cameras.CAMERA.fov.wide)
    })
  })

  describe('close_up', () => {
    it('uses tight FOV', () => {
      const result = cameras.close_up(baseCameraCtx)

      expect(result.keyframes[0].fov).toBe(cameras.CAMERA.fov.tight)
    })
  })

  describe('dramatic_low_angle', () => {
    it('positions camera low', () => {
      const result = cameras.dramatic_low_angle(baseCameraCtx)

      // Camera height should be low
      expect(result.keyframes[0].position[1]).toBe(cameras.CAMERA.lowAngleHeight)
    })
  })

  describe('orbit', () => {
    it('creates multiple keyframes for smooth orbit', () => {
      const result = cameras.orbit(baseCameraCtx)

      expect(result.keyframes.length).toBeGreaterThan(2)

      // Positions should vary (orbit)
      const uniqueX = new Set(result.keyframes.map(kf => kf.position[0].toFixed(2)))
      expect(uniqueX.size).toBeGreaterThan(1)
    })
  })

  describe('tracking_side', () => {
    it('positions camera to the side', () => {
      const result = cameras.tracking_side(baseCameraCtx)

      expect(result.keyframes.length).toBeGreaterThan(0)
      // Camera should be offset on X axis (perpendicular to z-forward movement)
      const camX = result.keyframes[0].position[0]
      const subjectX = baseCameraCtx.primaryKeyframes[0].position[0]
      expect(Math.abs(camX - subjectX)).toBeGreaterThan(5)
    })
  })
})
