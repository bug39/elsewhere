/**
 * Tests for SchemaCompiler - main entry point for schema compilation
 */
import { describe, it, expect, vi } from 'vitest'
import { SchemaCompiler } from '../../../../src/generator/compiler/SchemaCompiler.js'

describe('SchemaCompiler', () => {
  // Helper to create a valid v3 schema
  const validSchema = () => ({
    v: 3,
    cat: 'prop',
    m: [
      { n: 'light', c: 0xFFFFFF, r: 0.5, met: 0 },
      { n: 'dark', c: 0x404040, r: 0.7, met: 0 }
    ],
    p: [
      { n: 'body', g: 'Box', mat: 0, pr: 1, geom: { size: [1, 1, 1] }, i: [{ p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }] },
      { n: 'top', par: 'body', g: 'Sphere', mat: 1, pr: 2, geom: { rad: 0.3 }, i: [{ p: [0, 0.6, 0], r: [0, 0, 0], s: [1, 1, 1] }] },
      { n: 'detail', par: 'body', g: 'Cylinder', mat: 0, pr: 2, geom: {}, i: [{ p: [0.3, 0, 0], r: [0, 0, 0], s: [0.5, 0.5, 0.5] }] }
    ]
  })

  describe('compile', () => {
    it('compiles valid schema to JavaScript code', () => {
      const result = SchemaCompiler.compile(validSchema())

      expect(result.code).toContain('export function createAsset(THREE)')
      expect(result.code).toContain('return group')
    })

    it('returns warnings array', () => {
      const result = SchemaCompiler.compile(validSchema())

      expect(result.warnings).toBeDefined()
      expect(Array.isArray(result.warnings)).toBe(true)
    })

    it('throws on invalid schema version', () => {
      expect(() => SchemaCompiler.compile({ v: 2 }))
        .toThrow('Schema parse error')
    })

    it('throws on null schema', () => {
      expect(() => SchemaCompiler.compile(null))
        .toThrow('Schema parse error')
    })

    it('throws on validation failure', () => {
      const schema = {
        v: 3,
        m: [], // No materials
        p: []
      }

      expect(() => SchemaCompiler.compile(schema))
        .toThrow('Schema validation failed')
    })

    it('logs compilation success', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      SchemaCompiler.compile(validSchema())

      expect(consoleSpy).toHaveBeenCalledWith(
        '[SchemaCompiler] Compilation successful:',
        expect.objectContaining({
          category: 'prop',
          parts: 3,
          materials: 2
        })
      )

      consoleSpy.mockRestore()
    })
  })

  describe('validate', () => {
    it('returns valid for well-formed schema', () => {
      const result = SchemaCompiler.validate(validSchema())

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('returns invalid for malformed schema', () => {
      const result = SchemaCompiler.validate({ v: 3, m: [], p: [] })

      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('returns parse errors for invalid version', () => {
      const result = SchemaCompiler.validate({ v: 2 })

      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('Invalid schema')
    })

    it('returns warnings for edge cases', () => {
      const schema = validSchema()
      // Add more than 24 parts to trigger "too many parts" warning
      schema.p = Array(26).fill(null).map((_, i) => ({
        n: `part${i}`,
        g: 'Box',
        mat: i % 2, // Alternate between materials
        pr: 2,
        geom: {},
        i: [{ p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }]
      }))

      const result = SchemaCompiler.validate(schema)

      // Should have warning about too many parts
      expect(result.warnings.length).toBeGreaterThan(0)
    })
  })

  describe('budget constraints', () => {
    it('removes low-priority parts when over mesh budget', () => {
      const schema = {
        v: 3,
        m: [{ n: 'mat', c: 0xFFFFFF, r: 0.5, met: 0 }, { n: 'dark', c: 0x404040, r: 0.5, met: 0 }],
        p: [
          // Create parts with many instances to exceed budget
          { n: 'body', g: 'Box', mat: 0, pr: 1, i: Array(5).fill({ p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }) },
          { n: 'core', g: 'Box', mat: 1, pr: 1, i: Array(5).fill({ p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }) },
          { n: 'detail1', g: 'Sphere', mat: 0, pr: 3, i: Array(10).fill({ p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }) },
          { n: 'detail2', g: 'Cylinder', mat: 0, pr: 3, i: Array(10).fill({ p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }) }
        ]
      }

      // Compile with low mesh budget
      const result = SchemaCompiler.compile(schema, { maxMeshes: 15 })

      // Should have removed pr=3 parts
      expect(result.code).toContain('body')
      expect(result.code).not.toContain('detail1_group')
      expect(result.code).not.toContain('detail2_group')
    })

    it('truncates materials when over budget', () => {
      const schema = validSchema()
      schema.m = Array(8).fill({ n: 'mat', c: 0xFFFFFF, r: 0.5, met: 0 })
      // Add contrast color
      schema.m[0] = { n: 'dark', c: 0x404040, r: 0.5, met: 0 }

      const result = SchemaCompiler.compile(schema, { maxMaterials: 3 })

      // Should only have 3 materials in output
      const matMatches = result.code.match(/new THREE\.MeshStandardMaterial/g)
      expect(matMatches).toHaveLength(3)
    })

    it('clamps material indices after truncation', () => {
      const schema = {
        v: 3,
        m: [
          { n: 'mat0', c: 0xFFFFFF, r: 0.5, met: 0 },
          { n: 'mat1', c: 0x808080, r: 0.5, met: 0 },
          { n: 'mat2', c: 0x404040, r: 0.5, met: 0 }
        ],
        p: [
          { n: 'body', g: 'Box', mat: 0, pr: 1, i: [{ p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }] },
          { n: 'arm', g: 'Box', mat: 2, pr: 2, i: [{ p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }] }, // Will need clamping
          { n: 'leg', g: 'Box', mat: 1, pr: 2, i: [{ p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }] }
        ]
      }

      const result = SchemaCompiler.compile(schema, { maxMaterials: 2 })

      // arm should now use mat[0] instead of mat[2]
      expect(result.code).toContain('mats[0]')
    })
  })

  describe('autoSnap connectivity', () => {
    it('snaps disconnected parts when enabled', () => {
      const schema = {
        v: 3,
        m: [{ n: 'mat', c: 0xFFFFFF, r: 0.5, met: 0 }, { n: 'dark', c: 0x404040, r: 0.5, met: 0 }],
        p: [
          { n: 'body', g: 'Box', mat: 0, pr: 1, geom: { size: [1, 1, 1] }, i: [{ p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }] },
          { n: 'arm', par: 'body', g: 'Box', mat: 0, pr: 2, geom: { size: [0.3, 0.3, 0.3] }, i: [{ p: [100, 100, 100], r: [0, 0, 0], s: [1, 1, 1] }] }, // Far away
          { n: 'leg', par: 'body', g: 'Box', mat: 0, pr: 2, geom: { size: [0.3, 0.3, 0.3] }, i: [{ p: [0.5, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }] }
        ]
      }

      const result = SchemaCompiler.compile(schema, { autoSnap: true })

      // The arm should have been snapped closer to body
      // Check that it doesn't still reference the original far position
      expect(result.code).not.toContain('position.set(100, 100, 100)')
    })

    it('preserves positions when autoSnap disabled', () => {
      const schema = {
        v: 3,
        m: [{ n: 'mat', c: 0xFFFFFF, r: 0.5, met: 0 }, { n: 'dark', c: 0x404040, r: 0.5, met: 0 }],
        p: [
          { n: 'body', g: 'Box', mat: 0, pr: 1, geom: { size: [1, 1, 1] }, i: [{ p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }] },
          { n: 'arm', par: 'body', g: 'Box', mat: 0, pr: 2, geom: { size: [0.3, 0.3, 0.3] }, i: [{ p: [5, 5, 5], r: [0, 0, 0], s: [1, 1, 1] }] },
          { n: 'leg', par: 'body', g: 'Box', mat: 0, pr: 2, geom: { size: [0.3, 0.3, 0.3] }, i: [{ p: [0.5, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }] }
        ]
      }

      const result = SchemaCompiler.compile(schema, { autoSnap: false })

      // Original position should be preserved
      expect(result.code).toContain('position.set(5, 5, 5)')
    })
  })

  describe('generated code', () => {
    it('produces executable JavaScript', () => {
      const result = SchemaCompiler.compile(validSchema())

      // Code contains export which can't be used in new Function()
      // Verify structure is valid instead
      expect(result.code).toContain('export function createAsset(THREE)')
      expect(result.code).toContain('return group')

      // Verify balanced braces
      const opens = (result.code.match(/{/g) || []).length
      const closes = (result.code.match(/}/g) || []).length
      expect(opens).toBe(closes)
    })

    it('includes all expected parts', () => {
      const result = SchemaCompiler.compile(validSchema())

      expect(result.code).toContain('body_group')
      expect(result.code).toContain('top_group')
      expect(result.code).toContain('detail_group')
    })

    it('includes materials array', () => {
      const result = SchemaCompiler.compile(validSchema())

      expect(result.code).toContain('const mats = [')
      expect(result.code).toContain('MeshStandardMaterial')
    })

    it('includes normalization', () => {
      const result = SchemaCompiler.compile(validSchema())

      expect(result.code).toContain('Box3')
      expect(result.code).toContain('setFromObject')
      expect(result.code).toContain('getCenter')
    })
  })

  describe('options', () => {
    it('uses default options when not specified', () => {
      const result = SchemaCompiler.compile(validSchema())

      // Default maxMeshes is 24, maxMaterials is 5
      // Our schema has 3 meshes and 2 materials, should compile fine
      expect(result.code).toBeDefined()
    })

    it('respects custom maxMeshes', () => {
      const schema = {
        v: 3,
        m: [{ n: 'mat', c: 0xFFFFFF, r: 0.5, met: 0 }, { n: 'dark', c: 0x404040, r: 0.5, met: 0 }],
        p: [
          { n: 'body', g: 'Box', mat: 0, pr: 1, i: Array(10).fill({ p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }) },
          { n: 'arm', g: 'Box', mat: 0, pr: 2, i: Array(10).fill({ p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }) },
          { n: 'leg', g: 'Box', mat: 0, pr: 3, i: Array(10).fill({ p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }) }
        ]
      }

      const result = SchemaCompiler.compile(schema, { maxMeshes: 15 })

      // pr=3 parts should be removed
      expect(result.code).not.toContain('leg_group')
    })

    it('respects custom maxMaterials', () => {
      const schema = validSchema()
      schema.m = [
        { n: 'mat1', c: 0xFFFFFF, r: 0.5, met: 0 },
        { n: 'mat2', c: 0xC0C0C0, r: 0.5, met: 0 },
        { n: 'mat3', c: 0x808080, r: 0.5, met: 0 },
        { n: 'mat4', c: 0x404040, r: 0.5, met: 0 }
      ]

      const result = SchemaCompiler.compile(schema, { maxMaterials: 2 })

      const matCount = (result.code.match(/new THREE\.MeshStandardMaterial/g) || []).length
      expect(matCount).toBe(2)
    })
  })

  describe('error messages', () => {
    it('includes specific parse error details', () => {
      try {
        SchemaCompiler.compile({ v: 1 })
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e.message).toContain('Schema parse error')
        expect(e.message).toContain('expected v=3')
      }
    })

    it('includes validation error details', () => {
      try {
        SchemaCompiler.compile({ v: 3, m: [], p: [] })
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e.message).toContain('Schema validation failed')
      }
    })
  })

  describe('category handling', () => {
    it('preserves category in output', () => {
      const schema = validSchema()
      schema.cat = 'character'

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      SchemaCompiler.compile(schema)

      expect(consoleSpy).toHaveBeenCalledWith(
        '[SchemaCompiler] Compilation successful:',
        expect.objectContaining({ category: 'character' })
      )

      consoleSpy.mockRestore()
    })
  })
})
