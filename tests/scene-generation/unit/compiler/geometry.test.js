/**
 * Tests for geometry code generator - emits Three.js geometry creation code
 */
import { describe, it, expect } from 'vitest'
import { emitGeometry, estimateBounds } from '../../../../src/generator/compiler/geometry.js'

describe('emitGeometry', () => {
  describe('Box geometry', () => {
    it('generates BoxGeometry with default params', () => {
      const code = emitGeometry('Box', {})
      expect(code).toContain('BoxGeometry')
      expect(code).toContain('1, 1, 1') // Default size
    })

    it('generates BoxGeometry with custom size', () => {
      const code = emitGeometry('Box', { size: [2, 3, 4] })
      expect(code).toContain('BoxGeometry(2, 3, 4')
    })

    it('generates BoxGeometry with segments', () => {
      const code = emitGeometry('Box', { size: [1, 1, 1], seg: [2, 2, 2] })
      expect(code).toContain('BoxGeometry(1, 1, 1, 2, 2, 2)')
    })

    it('uses custom variable name', () => {
      const code = emitGeometry('Box', {}, 'myGeom')
      expect(code).toContain('const myGeom =')
    })
  })

  describe('Sphere geometry', () => {
    it('generates SphereGeometry with default params', () => {
      const code = emitGeometry('Sphere', {})
      expect(code).toContain('SphereGeometry(0.5')
    })

    it('generates SphereGeometry with custom radius', () => {
      const code = emitGeometry('Sphere', { rad: 1.5 })
      expect(code).toContain('SphereGeometry(1.5')
    })

    it('clamps segments', () => {
      const code = emitGeometry('Sphere', { ws: 100, hs: 100 })
      expect(code).toContain('SphereGeometry(0.5, 24, 16)')
    })
  })

  describe('Cylinder geometry', () => {
    it('generates CylinderGeometry with default params', () => {
      const code = emitGeometry('Cylinder', {})
      expect(code).toContain('CylinderGeometry(0.5, 0.5, 1')
    })

    it('generates CylinderGeometry with different top/bottom radii', () => {
      const code = emitGeometry('Cylinder', { rt: 0.3, rb: 0.5, h: 2 })
      expect(code).toContain('CylinderGeometry(0.3, 0.5, 2')
    })

    it('clamps radial segments', () => {
      const code = emitGeometry('Cylinder', { rs: 50 })
      expect(code).toMatch(/CylinderGeometry\([^)]+, 24\)/)
    })
  })

  describe('Cone geometry', () => {
    it('generates ConeGeometry with default params', () => {
      const code = emitGeometry('Cone', {})
      expect(code).toContain('ConeGeometry(0.5, 1')
    })

    it('generates ConeGeometry with custom radius and height', () => {
      const code = emitGeometry('Cone', { r: 0.8, h: 2 })
      expect(code).toContain('ConeGeometry(0.8, 2')
    })

    it('clamps radial segments', () => {
      const code = emitGeometry('Cone', { rs: 50 })
      expect(code).toMatch(/ConeGeometry\([^)]+, 24\)/)
    })
  })

  describe('Torus geometry', () => {
    it('generates TorusGeometry with default params', () => {
      const code = emitGeometry('Torus', {})
      expect(code).toContain('TorusGeometry(0.5, 0.2')
    })

    it('generates TorusGeometry with custom params', () => {
      const code = emitGeometry('Torus', { r: 1, t: 0.3 })
      expect(code).toContain('TorusGeometry(1, 0.3')
    })

    it('clamps both segment types', () => {
      const code = emitGeometry('Torus', { rs: 50, ts: 50 })
      expect(code).toMatch(/TorusGeometry\([^)]+, 16, 32\)/)
    })
  })

  describe('Lathe geometry', () => {
    it('generates LatheGeometry with default profile', () => {
      const code = emitGeometry('Lathe', {})
      expect(code).toContain('LatheGeometry')
      expect(code).toContain('Vector2')
    })

    it('generates LatheGeometry with custom profile', () => {
      const code = emitGeometry('Lathe', {
        prof: [[0, 0], [0.5, 0.5], [0.3, 1]]
      })
      expect(code).toContain('Vector2(0, 0)')
      expect(code).toContain('Vector2(0.5, 0.5)')
      expect(code).toContain('Vector2(0.3, 1)')
    })

    it('limits profile points to 12', () => {
      const prof = Array(20).fill(null).map((_, i) => [0.5, i * 0.1])
      const code = emitGeometry('Lathe', { prof })
      const matches = code.match(/Vector2/g)
      expect(matches).toHaveLength(12)
    })

    it('clamps segments', () => {
      const code = emitGeometry('Lathe', { seg: 50 })
      expect(code).toContain(', 24)')
    })
  })

  describe('Tube geometry', () => {
    it('generates TubeGeometry with default path', () => {
      const code = emitGeometry('Tube', {})
      expect(code).toContain('TubeGeometry')
      expect(code).toContain('CatmullRomCurve3')
      expect(code).toContain('Vector3')
    })

    it('generates TubeGeometry with custom path', () => {
      const code = emitGeometry('Tube', {
        path: [[0, 0, 0], [0, 1, 0], [1, 2, 0]]
      })
      expect(code).toContain('Vector3(0, 0, 0)')
      expect(code).toContain('Vector3(0, 1, 0)')
      expect(code).toContain('Vector3(1, 2, 0)')
    })

    it('limits path points to 20', () => {
      const path = Array(30).fill(null).map((_, i) => [0, i * 0.1, 0])
      const code = emitGeometry('Tube', { path })
      const matches = code.match(/Vector3/g)
      expect(matches).toHaveLength(20)
    })

    it('uses custom radius', () => {
      const code = emitGeometry('Tube', { rad: 0.5 })
      expect(code).toContain(', 0.5,')
    })

    it('clamps segments', () => {
      const code = emitGeometry('Tube', { ts: 50, rs: 50 })
      expect(code).toContain(', 24,')
      expect(code).toContain(', 12, false)')
    })
  })

  describe('Dome geometry', () => {
    it('generates LatheGeometry with semicircular profile', () => {
      const code = emitGeometry('Dome', {})
      expect(code).toContain('LatheGeometry')
      expect(code).toContain('Vector2')
      // Should have profile points array
      expect(code).toContain('_pts')
    })

    it('uses default params when none provided', () => {
      const code = emitGeometry('Dome', {})
      // Default rad=0.5, h=0.5, seg=12
      expect(code).toContain(', 12)')  // Default segments
      // First point should be at (rad, 0) = (0.5, 0)
      expect(code).toContain('Vector2(0.5000, 0.0000)')
      // Last point should be at (0, h) = (0, 0.5)
      expect(code).toContain('Vector2(0.0000, 0.5000)')
    })

    it('generates with custom radius and height', () => {
      const code = emitGeometry('Dome', { rad: 0.8, h: 0.4 })
      // First point at (0.8, 0)
      expect(code).toContain('Vector2(0.8000, 0.0000)')
      // Last point at (0, 0.4)
      expect(code).toContain('Vector2(0.0000, 0.4000)')
    })

    it('clamps segments to max 14', () => {
      const code = emitGeometry('Dome', { seg: 50 })
      expect(code).toContain(', 14)')
    })

    it('generates valid semicircular profile with 9 points', () => {
      const code = emitGeometry('Dome', {})
      // Should have 9 Vector2 points (steps=8, so 0 to 8 inclusive)
      const matches = code.match(/Vector2/g)
      expect(matches).toHaveLength(9)
    })

    it('uses custom variable name', () => {
      const code = emitGeometry('Dome', {}, 'lidGeom')
      expect(code).toContain('const lidGeom_pts')
      expect(code).toContain('const lidGeom =')
    })
  })

  describe('unknown geometry type', () => {
    it('falls back to unit BoxGeometry', () => {
      const code = emitGeometry('Unknown', {})
      expect(code).toContain('BoxGeometry(1, 1, 1)')
    })
  })

  describe('code validity', () => {
    it('generates syntactically valid JavaScript', () => {
      const geometries = ['Box', 'Sphere', 'Cylinder', 'Cone', 'Torus', 'Lathe', 'Tube', 'Dome']

      for (const geom of geometries) {
        const code = emitGeometry(geom, {})
        // Code should be a valid const declaration
        expect(code).toContain('const geom')
        // Should contain THREE geometry constructor
        expect(code).toMatch(/new THREE\.\w+Geometry/)
      }
    })
  })
})

describe('estimateBounds', () => {
  const defaultPosition = [0, 0, 0]
  const defaultScale = [1, 1, 1]

  describe('Box bounds', () => {
    it('estimates unit box bounds', () => {
      const bounds = estimateBounds('Box', {}, defaultPosition, defaultScale)
      expect(bounds.min).toEqual([-0.5, -0.5, -0.5])
      expect(bounds.max).toEqual([0.5, 0.5, 0.5])
    })

    it('estimates custom size box bounds', () => {
      const bounds = estimateBounds('Box', { size: [2, 4, 6] }, defaultPosition, defaultScale)
      expect(bounds.min).toEqual([-1, -2, -3])
      expect(bounds.max).toEqual([1, 2, 3])
    })

    it('applies position offset', () => {
      const bounds = estimateBounds('Box', {}, [5, 10, 15], defaultScale)
      expect(bounds.min).toEqual([4.5, 9.5, 14.5])
      expect(bounds.max).toEqual([5.5, 10.5, 15.5])
    })

    it('applies scale', () => {
      const bounds = estimateBounds('Box', {}, defaultPosition, [2, 2, 2])
      expect(bounds.min).toEqual([-1, -1, -1])
      expect(bounds.max).toEqual([1, 1, 1])
    })
  })

  describe('Sphere bounds', () => {
    it('estimates unit sphere bounds', () => {
      const bounds = estimateBounds('Sphere', {}, defaultPosition, defaultScale)
      expect(bounds.min).toEqual([-0.5, -0.5, -0.5])
      expect(bounds.max).toEqual([0.5, 0.5, 0.5])
    })

    it('estimates custom radius sphere bounds', () => {
      const bounds = estimateBounds('Sphere', { rad: 2 }, defaultPosition, defaultScale)
      expect(bounds.min).toEqual([-2, -2, -2])
      expect(bounds.max).toEqual([2, 2, 2])
    })
  })

  describe('Cylinder bounds', () => {
    it('estimates cylinder bounds with equal radii', () => {
      const bounds = estimateBounds('Cylinder', {}, defaultPosition, defaultScale)
      expect(bounds.min).toEqual([-0.5, -0.5, -0.5])
      expect(bounds.max).toEqual([0.5, 0.5, 0.5])
    })

    it('uses larger radius for bounds', () => {
      const bounds = estimateBounds('Cylinder', { rt: 0.3, rb: 0.8 }, defaultPosition, defaultScale)
      expect(bounds.min[0]).toBe(-0.8)
      expect(bounds.max[0]).toBe(0.8)
    })

    it('uses height for Y axis', () => {
      const bounds = estimateBounds('Cylinder', { h: 4 }, defaultPosition, defaultScale)
      expect(bounds.min[1]).toBe(-2)
      expect(bounds.max[1]).toBe(2)
    })
  })

  describe('Cone bounds', () => {
    it('estimates cone bounds', () => {
      const bounds = estimateBounds('Cone', { r: 1, h: 2 }, defaultPosition, defaultScale)
      expect(bounds.min).toEqual([-1, -1, -1])
      expect(bounds.max).toEqual([1, 1, 1])
    })
  })

  describe('Torus bounds', () => {
    it('estimates torus bounds', () => {
      const bounds = estimateBounds('Torus', { r: 1, t: 0.2 }, defaultPosition, defaultScale)
      // Outer radius = r + t = 1.2
      expect(bounds.min[0]).toBeCloseTo(-1.2)
      expect(bounds.max[0]).toBeCloseTo(1.2)
      // Height is tube radius
      expect(bounds.min[1]).toBeCloseTo(-0.2)
      expect(bounds.max[1]).toBeCloseTo(0.2)
    })
  })

  describe('Lathe bounds', () => {
    it('estimates lathe bounds from profile', () => {
      const bounds = estimateBounds('Lathe', {
        prof: [[0, 0], [1, 0.5], [0.5, 1]]
      }, defaultPosition, defaultScale)

      // Max radius is 1
      expect(bounds.min[0]).toBe(-1)
      expect(bounds.max[0]).toBe(1)
      // Height range is 0-1, half-extent = (1-0)/2 = 0.5
      // So min = 0 - 0.5 = -0.5, max = 0 + 0.5 = 0.5
      // But the geometry calculates center as (minY + maxY)/2 = 0.5
      // Half-extent is (1-0)/2 = 0.5
      // Since position is [0,0,0], the bounds are centered at origin
      expect(bounds.min[1]).toBe(-0.5)  // position.y - halfExtent
      expect(bounds.max[1]).toBe(0.5)   // position.y + halfExtent
    })
  })

  describe('Tube bounds', () => {
    it('estimates tube bounds from path', () => {
      const bounds = estimateBounds('Tube', {
        path: [[-1, 0, 0], [0, 1, 0], [1, 0, 0]],
        rad: 0.1
      }, defaultPosition, defaultScale)

      // X: range -1 to 1, half = 1, plus radius 0.1 = 1.1
      expect(bounds.min[0]).toBeCloseTo(-1.1)
      expect(bounds.max[0]).toBeCloseTo(1.1)
      // Y: range 0 to 1, half = 0.5, center = 0.5, plus radius 0.1 = 0.6
      // So min = 0 - 0.6 = -0.6, max = 0 + 0.6 = 0.6
      // But the bounds are centered at position [0,0,0]
      // halfExtent[1] = (maxY - minY) / 2 + rad = (1-0)/2 + 0.1 = 0.6
      expect(bounds.min[1]).toBeCloseTo(-0.6)
      expect(bounds.max[1]).toBeCloseTo(0.6)
    })
  })

  describe('Dome bounds', () => {
    it('estimates dome bounds with default params', () => {
      const bounds = estimateBounds('Dome', {}, defaultPosition, defaultScale)
      // Default rad=0.5, h=0.5, halfExtents = [rad, h/2, rad]
      expect(bounds.min).toEqual([-0.5, -0.25, -0.5])
      expect(bounds.max).toEqual([0.5, 0.25, 0.5])
    })

    it('estimates dome bounds with custom radius and height', () => {
      const bounds = estimateBounds('Dome', { rad: 0.8, h: 0.6 }, defaultPosition, defaultScale)
      // halfExtents = [0.8, 0.3, 0.8]
      expect(bounds.min).toEqual([-0.8, -0.3, -0.8])
      expect(bounds.max).toEqual([0.8, 0.3, 0.8])
    })

    it('applies position offset', () => {
      const bounds = estimateBounds('Dome', { rad: 0.5, h: 0.5 }, [1, 2, 3], defaultScale)
      expect(bounds.min).toEqual([0.5, 1.75, 2.5])
      expect(bounds.max).toEqual([1.5, 2.25, 3.5])
    })

    it('applies scale', () => {
      const bounds = estimateBounds('Dome', { rad: 0.5, h: 0.5 }, defaultPosition, [2, 2, 2])
      // halfExtents scaled: [1, 0.5, 1]
      expect(bounds.min).toEqual([-1, -0.5, -1])
      expect(bounds.max).toEqual([1, 0.5, 1])
    })
  })

  describe('center calculation', () => {
    it('returns position as center', () => {
      const bounds = estimateBounds('Box', {}, [5, 10, 15], defaultScale)
      expect(bounds.center).toEqual([5, 10, 15])
    })
  })

  describe('scale application', () => {
    it('applies non-uniform scale', () => {
      const bounds = estimateBounds('Box', {}, defaultPosition, [2, 3, 4])
      expect(bounds.min).toEqual([-1, -1.5, -2])
      expect(bounds.max).toEqual([1, 1.5, 2])
    })

    it('handles zero scale gracefully', () => {
      // Zero scale collapses the bounds to the position
      // The implementation multiplies halfExtent by scale (which is 0)
      // halfExtent * 0 = 0, but default halfExtent is [0.5, 0.5, 0.5]
      // Actually scale[0] || 1 means it falls back to 1 if scale[0] is 0/falsy
      // So with [0,0,0] scale, it uses fallback [1,1,1]
      const bounds = estimateBounds('Box', {}, defaultPosition, [0, 0, 0])
      // Due to || 1 fallback, zero becomes 1
      expect(bounds.min).toEqual([-0.5, -0.5, -0.5])
      expect(bounds.max).toEqual([0.5, 0.5, 0.5])
    })
  })

  describe('unknown geometry type', () => {
    it('returns default bounds', () => {
      const bounds = estimateBounds('Unknown', {}, defaultPosition, defaultScale)
      expect(bounds.min).toEqual([-0.5, -0.5, -0.5])
      expect(bounds.max).toEqual([0.5, 0.5, 0.5])
    })
  })
})
