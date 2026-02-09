/**
 * Tests for schema parser - normalizes and validates v3 schema input
 */
import { describe, it, expect } from 'vitest'
import { normalizeColor, clampSegments, parseSchema } from '../../../../src/generator/compiler/parser.js'

describe('normalizeColor', () => {
  describe('number inputs', () => {
    it('passes through valid hex numbers', () => {
      expect(normalizeColor(0xFFFFFF)).toBe(0xFFFFFF)
      expect(normalizeColor(0x000000)).toBe(0x000000)
      expect(normalizeColor(0x8B4513)).toBe(0x8B4513)
    })

    it('clamps negative numbers to 0', () => {
      expect(normalizeColor(-1)).toBe(0)
      expect(normalizeColor(-255)).toBe(0)
    })

    it('clamps numbers over 0xFFFFFF', () => {
      expect(normalizeColor(0xFFFFFF + 1)).toBe(0xFFFFFF)
      expect(normalizeColor(0x1FFFFFF)).toBe(0xFFFFFF)
    })
  })

  describe('string inputs', () => {
    it('parses hex strings with # prefix', () => {
      expect(normalizeColor('#FFFFFF')).toBe(0xFFFFFF)
      expect(normalizeColor('#000000')).toBe(0x000000)
      expect(normalizeColor('#8B4513')).toBe(0x8B4513)
    })

    it('parses hex strings with 0x prefix', () => {
      expect(normalizeColor('0xFFFFFF')).toBe(0xFFFFFF)
      expect(normalizeColor('0x8B4513')).toBe(0x8B4513)
    })

    it('parses hex strings with 0X prefix (uppercase)', () => {
      expect(normalizeColor('0XFFFFFF')).toBe(0xFFFFFF)
    })

    it('parses bare hex strings', () => {
      expect(normalizeColor('FFFFFF')).toBe(0xFFFFFF)
      expect(normalizeColor('8B4513')).toBe(0x8B4513)
    })

    it('handles lowercase hex', () => {
      expect(normalizeColor('#ffffff')).toBe(0xFFFFFF)
      expect(normalizeColor('0xffffff')).toBe(0xFFFFFF)
      expect(normalizeColor('ffffff')).toBe(0xFFFFFF)
    })

    it('trims whitespace', () => {
      expect(normalizeColor('  #FFFFFF  ')).toBe(0xFFFFFF)
      expect(normalizeColor(' 0xFF0000 ')).toBe(0xFF0000)
    })

    it('returns default gray for invalid strings', () => {
      expect(normalizeColor('not-a-color')).toBe(0x808080)
      expect(normalizeColor('ZZZZZZ')).toBe(0x808080)
      expect(normalizeColor('')).toBe(0x808080)
    })
  })

  describe('edge cases', () => {
    it('returns default gray for null/undefined', () => {
      expect(normalizeColor(null)).toBe(0x808080)
      expect(normalizeColor(undefined)).toBe(0x808080)
    })

    it('returns default gray for non-number/non-string types', () => {
      expect(normalizeColor({})).toBe(0x808080)
      expect(normalizeColor([])).toBe(0x808080)
      expect(normalizeColor(true)).toBe(0x808080)
    })
  })
})

describe('clampSegments', () => {
  describe('Sphere segments', () => {
    it('clamps widthSegments to max 10', () => {
      expect(clampSegments('Sphere', { ws: 20 })).toEqual({ ws: 10 })
      expect(clampSegments('Sphere', { ws: 10 })).toEqual({ ws: 10 })
      expect(clampSegments('Sphere', { ws: 5 })).toEqual({ ws: 5 })
    })

    it('clamps heightSegments to max 8', () => {
      expect(clampSegments('Sphere', { hs: 16 })).toEqual({ hs: 8 })
      expect(clampSegments('Sphere', { hs: 8 })).toEqual({ hs: 8 })
    })

    it('rounds non-integer segments', () => {
      expect(clampSegments('Sphere', { ws: 5.7 })).toEqual({ ws: 6 })
      expect(clampSegments('Sphere', { hs: 3.2 })).toEqual({ hs: 3 })
    })

    it('clamps to minimum 1', () => {
      expect(clampSegments('Sphere', { ws: 0 })).toEqual({ ws: 1 })
      expect(clampSegments('Sphere', { ws: -5 })).toEqual({ ws: 1 })
    })
  })

  describe('Cylinder segments', () => {
    it('clamps radialSegments to max 10', () => {
      expect(clampSegments('Cylinder', { rs: 20 })).toEqual({ rs: 10 })
    })
  })

  describe('Cone segments', () => {
    it('clamps radialSegments to max 10', () => {
      expect(clampSegments('Cone', { rs: 15 })).toEqual({ rs: 10 })
    })
  })

  describe('Torus segments', () => {
    it('clamps radialSegments to max 10 and tubularSegments to max 12', () => {
      expect(clampSegments('Torus', { rs: 20, ts: 24 })).toEqual({ rs: 10, ts: 12 })
    })
  })

  describe('Lathe segments', () => {
    it('clamps segments to max 14', () => {
      expect(clampSegments('Lathe', { seg: 30 })).toEqual({ seg: 14 })
    })
  })

  describe('Tube segments', () => {
    it('clamps tubularSegments to max 14 and radialSegments to max 8', () => {
      expect(clampSegments('Tube', { ts: 20, rs: 12 })).toEqual({ ts: 14, rs: 8 })
    })
  })

  describe('Dome segments', () => {
    it('clamps segments to max 14', () => {
      expect(clampSegments('Dome', { seg: 30 })).toEqual({ seg: 14 })
    })

    it('preserves segments within limit', () => {
      expect(clampSegments('Dome', { seg: 10 })).toEqual({ seg: 10 })
    })

    it('rounds non-integer segments', () => {
      expect(clampSegments('Dome', { seg: 8.7 })).toEqual({ seg: 9 })
    })

    it('clamps to minimum 1', () => {
      expect(clampSegments('Dome', { seg: 0 })).toEqual({ seg: 1 })
      expect(clampSegments('Dome', { seg: -5 })).toEqual({ seg: 1 })
    })

    it('preserves other properties', () => {
      expect(clampSegments('Dome', { seg: 20, rad: 0.5, h: 0.3 })).toEqual({ seg: 14, rad: 0.5, h: 0.3 })
    })
  })

  describe('unknown geometry types', () => {
    it('returns params unchanged for Box', () => {
      const params = { size: [1, 2, 3] }
      expect(clampSegments('Box', params)).toEqual(params)
    })

    it('returns params unchanged for unknown types', () => {
      const params = { foo: 'bar' }
      expect(clampSegments('Unknown', params)).toEqual(params)
    })
  })

  describe('preserves other properties', () => {
    it('keeps non-segment properties unchanged', () => {
      const result = clampSegments('Sphere', { ws: 20, rad: 0.5, color: 'red' })
      expect(result).toEqual({ ws: 10, rad: 0.5, color: 'red' })
    })
  })
})

describe('parseSchema', () => {
  describe('validation', () => {
    it('throws for null schema', () => {
      expect(() => parseSchema(null)).toThrow('Invalid schema: expected v=3')
    })

    it('throws for schema without v=3', () => {
      expect(() => parseSchema({})).toThrow('Invalid schema: expected v=3')
      expect(() => parseSchema({ v: 2 })).toThrow('Invalid schema: expected v=3')
    })

    it('accepts valid v3 schema', () => {
      const result = parseSchema({ v: 3 })
      expect(result.v).toBe(3)
    })
  })

  describe('defaults', () => {
    it('sets default category to prop', () => {
      const result = parseSchema({ v: 3 })
      expect(result.cat).toBe('prop')
    })

    it('uses provided category', () => {
      const result = parseSchema({ v: 3, cat: 'character' })
      expect(result.cat).toBe('character')
    })

    it('sets default floatY to 0', () => {
      const result = parseSchema({ v: 3 })
      expect(result.floatY).toBe(0)
    })

    it('uses provided floatY', () => {
      const result = parseSchema({ v: 3, floatY: 0.5 })
      expect(result.floatY).toBe(0.5)
    })

    it('sets empty arrays for missing materials and parts', () => {
      const result = parseSchema({ v: 3 })
      expect(result.materials).toEqual([])
      expect(result.parts).toEqual([])
    })

    it('sets default animation to off', () => {
      const result = parseSchema({ v: 3 })
      expect(result.anim).toEqual({ on: false, style: 'none', j: [] })
    })
  })

  describe('material normalization', () => {
    it('normalizes material properties', () => {
      const result = parseSchema({
        v: 3,
        m: [{ n: 'wood', c: '#8B4513', r: 0.7, met: 0.1 }]
      })

      expect(result.materials).toHaveLength(1)
      expect(result.materials[0]).toMatchObject({
        index: 0,
        name: 'wood',
        color: 0x8B4513,
        roughness: 0.7,
        metalness: 0.1,
        emissive: 0,
        emissiveIntensity: 0,
        flatShading: true
      })
    })

    it('truncates to max 5 materials', () => {
      const result = parseSchema({
        v: 3,
        m: Array(10).fill({ c: 0xFFFFFF })
      })
      expect(result.materials).toHaveLength(5)
    })

    it('provides default material names', () => {
      const result = parseSchema({
        v: 3,
        m: [{ c: 0xFFFFFF }, { c: 0x000000 }]
      })
      expect(result.materials[0].name).toBe('mat0')
      expect(result.materials[1].name).toBe('mat1')
    })

    it('clamps roughness and metalness to 0-1', () => {
      const result = parseSchema({
        v: 3,
        m: [{ c: 0xFFFFFF, r: 2.0, met: -0.5 }]
      })
      expect(result.materials[0].roughness).toBe(1)
      expect(result.materials[0].metalness).toBe(0)
    })

    it('handles emissive properties', () => {
      const result = parseSchema({
        v: 3,
        m: [{ c: 0xFFFFFF, e: 0xFF0000, ei: 0.5 }]
      })
      expect(result.materials[0].emissive).toBe(0xFF0000)
      expect(result.materials[0].emissiveIntensity).toBe(0.5)
    })

    it('respects flatShading flag', () => {
      const result = parseSchema({
        v: 3,
        m: [{ c: 0xFFFFFF, flat: false }]
      })
      expect(result.materials[0].flatShading).toBe(false)
    })
  })

  describe('part normalization', () => {
    it('normalizes part properties', () => {
      const result = parseSchema({
        v: 3,
        m: [{ c: 0xFFFFFF }],
        p: [{
          n: 'body',
          g: 'Box',
          mat: 0,
          pr: 1,
          i: [{ p: [0, 1, 0], r: [0, 0, 0], s: [1, 1, 1] }]
        }]
      })

      expect(result.parts).toHaveLength(1)
      expect(result.parts[0]).toMatchObject({
        index: 0,
        name: 'body',
        parent: null,
        geometry: 'Box',
        priority: 1,
        materialIndex: 0,
        joint: null
      })
    })

    it('provides default part names', () => {
      const result = parseSchema({
        v: 3,
        p: [{ g: 'Box' }]
      })
      expect(result.parts[0].name).toBe('part0')
    })

    it('defaults geometry to Box', () => {
      const result = parseSchema({
        v: 3,
        p: [{ n: 'test' }]
      })
      expect(result.parts[0].geometry).toBe('Box')
    })

    it('clamps priority values', () => {
      const result = parseSchema({
        v: 3,
        p: [
          { n: 'p1', pr: 0.5 },  // Should become 1
          { n: 'p2', pr: 1.2 },  // Should become 1.5
          { n: 'p3', pr: 1.8 },  // Should become 2
          { n: 'p4', pr: 5 }     // Should become 3
        ]
      })
      expect(result.parts[0].priority).toBe(1)
      expect(result.parts[1].priority).toBe(1.5)
      expect(result.parts[2].priority).toBe(2)
      expect(result.parts[3].priority).toBe(3)
    })

    it('normalizes instance positions, rotations, and scales', () => {
      const result = parseSchema({
        v: 3,
        p: [{
          n: 'test',
          i: [{ p: [1, 2, 3], r: [0.1, 0.2, 0.3], s: [2, 2, 2] }]
        }]
      })

      const inst = result.parts[0].instances[0]
      expect(inst.position).toEqual([1, 2, 3])
      expect(inst.rotation).toEqual([0.1, 0.2, 0.3])
      expect(inst.scale).toEqual([2, 2, 2])
    })

    it('defaults instance transforms', () => {
      const result = parseSchema({
        v: 3,
        p: [{ n: 'test', i: [{}] }]
      })

      const inst = result.parts[0].instances[0]
      expect(inst.position).toEqual([0, 0, 0])
      expect(inst.rotation).toEqual([0, 0, 0])
      expect(inst.scale).toEqual([1, 1, 1])
    })

    it('handles joint properties', () => {
      const result = parseSchema({
        v: 3,
        p: [{
          n: 'leg',
          j: { n: 'hip_joint', pos: [0, 0.5, 0], axes: 'x' },
          i: [{}]
        }]
      })

      expect(result.parts[0].joint).toMatchObject({
        name: 'hip_joint',
        position: [0, 0.5, 0],
        axes: 'x'
      })
    })

    it('provides default joint name', () => {
      const result = parseSchema({
        v: 3,
        p: [{ n: 'test', j: { pos: [0, 0, 0] }, i: [{}] }]
      })
      expect(result.parts[0].joint.name).toBe('joint0')
    })

    it('applies segment clamping to geometry params', () => {
      const result = parseSchema({
        v: 3,
        p: [{
          n: 'sphere',
          g: 'Sphere',
          geom: { rad: 0.5, ws: 32, hs: 32 },
          i: [{}]
        }]
      })

      expect(result.parts[0].geomParams.ws).toBe(10)
      expect(result.parts[0].geomParams.hs).toBe(8)
      expect(result.parts[0].geomParams.rad).toBe(0.5)
    })
  })

  describe('parent references', () => {
    it('preserves parent references', () => {
      const result = parseSchema({
        v: 3,
        p: [
          { n: 'body', i: [{}] },
          { n: 'arm', par: 'body', i: [{}] }
        ]
      })

      expect(result.parts[0].parent).toBe(null)
      expect(result.parts[1].parent).toBe('body')
    })
  })

  describe('attach points', () => {
    it('preserves attach points', () => {
      const result = parseSchema({
        v: 3,
        ap: [{ n: 'hand_slot', p: [0.5, 0, 0] }]
      })

      expect(result.attachPoints).toHaveLength(1)
      expect(result.attachPoints[0]).toEqual({ n: 'hand_slot', p: [0.5, 0, 0] })
    })
  })

  describe('animation config', () => {
    it('preserves animation config', () => {
      const result = parseSchema({
        v: 3,
        anim: { on: true, style: 'bob', j: ['body'] }
      })

      expect(result.anim).toEqual({ on: true, style: 'bob', j: ['body'] })
    })
  })
})
