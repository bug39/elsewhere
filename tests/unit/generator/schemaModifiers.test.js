/**
 * Tests for schemaModifiers - Apply modifications to v3 schemas
 */
import { describe, it, expect, vi } from 'vitest'
import {
  applyTier1Modification,
  deriveVariantName,
  checkVariantDepth,
  createVariantAsset
} from '../../../src/generator/schemaModifiers.js'

// Helper to create a minimal v3 schema
function createTestSchema(overrides = {}) {
  return {
    v: 3,
    cat: 'character',
    m: [
      { n: 'body', c: '#808080', r: 0.7, met: 0 },
      { n: 'detail', c: '#404040', r: 0.5, met: 0.3 }
    ],
    p: [
      {
        n: 'body',
        par: null,
        g: 'Box',
        geom: { w: 1, h: 1.5, d: 0.6 },
        mat: 0,
        pr: 1,
        i: [{ p: [0, 0.75, 0], r: [0, 0, 0], s: [1, 1, 1] }]
      },
      {
        n: 'head',
        par: 'body',
        g: 'Sphere',
        geom: { r: 0.4 },
        mat: 0,
        pr: 1,
        i: [{ p: [0, 1.7, 0], r: [0, 0, 0], s: [1, 1, 1] }]
      },
      {
        n: 'eyes',
        par: 'head',
        g: 'Sphere',
        geom: { r: 0.1 },
        mat: 1,
        pr: 2,
        i: [
          { p: [-0.15, 0.1, 0.3], r: [0, 0, 0], s: [1, 1, 1] },
          { p: [0.15, 0.1, 0.3], r: [0, 0, 0], s: [1, 1, 1] }
        ]
      }
    ],
    ...overrides
  }
}

describe('applyTier1Modification', () => {
  describe('colorChange', () => {
    it('changes all materials when target is "all"', () => {
      const schema = createTestSchema()
      const classification = {
        type: 'colorChange',
        targets: ['all'],
        parameters: { color: '#FF0000' }
      }

      const result = applyTier1Modification(schema, classification)

      expect(result.applied).toBe(true)
      expect(result.schema.m[0].c).toBe('#FF0000')
      expect(result.schema.m[1].c).toBe('#FF0000')
      expect(result.description).toContain('#FF0000')
    })

    it('changes only targeted part materials', () => {
      const schema = createTestSchema()
      const classification = {
        type: 'colorChange',
        targets: ['head'],
        parameters: { color: '#00FF00' }
      }

      const result = applyTier1Modification(schema, classification)

      expect(result.applied).toBe(true)
      // Head uses material 0
      expect(result.schema.m[0].c).toBe('#00FF00')
      // Eyes use material 1 and should be unchanged
      // Note: If eyes share 'head' as parent but 'head' is the target, only head's material changes
    })

    it('changes materials for parts matching target name', () => {
      const schema = createTestSchema()
      const classification = {
        type: 'colorChange',
        targets: ['eyes'],
        parameters: { color: '#0000FF' }
      }

      const result = applyTier1Modification(schema, classification)

      expect(result.applied).toBe(true)
      // Eyes use material 1
      expect(result.schema.m[1].c).toBe('#0000FF')
      // Body/head use material 0, should be unchanged
      expect(result.schema.m[0].c).toBe('#808080')
    })

    it('falls back to all when no parts match', () => {
      const schema = createTestSchema()
      const classification = {
        type: 'colorChange',
        targets: ['nonexistent'],
        parameters: { color: '#FFFF00' }
      }

      const result = applyTier1Modification(schema, classification)

      expect(result.applied).toBe(true)
      expect(result.schema.m[0].c).toBe('#FFFF00')
      expect(result.schema.m[1].c).toBe('#FFFF00')
      expect(result.warnings).toBeDefined()
      expect(result.warnings[0]).toContain('No parts matched')
    })

    it('parses color names', () => {
      const schema = createTestSchema()
      const classification = {
        type: 'colorChange',
        targets: ['all'],
        parameters: { color: 'red' }
      }

      const result = applyTier1Modification(schema, classification)

      expect(result.applied).toBe(true)
      expect(result.schema.m[0].c).toBe('#FF0000')
    })
  })

  describe('materialChange', () => {
    it('changes roughness for all materials', () => {
      const schema = createTestSchema()
      const classification = {
        type: 'materialChange',
        targets: ['all'],
        parameters: { roughness: 0.2 }
      }

      const result = applyTier1Modification(schema, classification)

      expect(result.applied).toBe(true)
      expect(result.schema.m[0].r).toBe(0.2)
      expect(result.schema.m[1].r).toBe(0.2)
    })

    it('changes metalness for all materials', () => {
      const schema = createTestSchema()
      const classification = {
        type: 'materialChange',
        targets: ['all'],
        parameters: { metalness: 0.9 }
      }

      const result = applyTier1Modification(schema, classification)

      expect(result.applied).toBe(true)
      expect(result.schema.m[0].met).toBe(0.9)
      expect(result.schema.m[1].met).toBe(0.9)
    })

    it('clamps roughness/metalness to valid range', () => {
      const schema = createTestSchema()
      const classification = {
        type: 'materialChange',
        targets: ['all'],
        parameters: { roughness: 1.5, metalness: -0.5 }
      }

      const result = applyTier1Modification(schema, classification)

      expect(result.applied).toBe(true)
      expect(result.schema.m[0].r).toBe(1) // Clamped to max
      expect(result.schema.m[0].met).toBe(0) // Clamped to min
    })

    it('adds emissive properties', () => {
      const schema = createTestSchema()
      const classification = {
        type: 'materialChange',
        targets: ['all'],
        parameters: { emissive: '#FF0000', emissiveIntensity: 0.5 }
      }

      const result = applyTier1Modification(schema, classification)

      expect(result.applied).toBe(true)
      expect(result.schema.m[0].e).toBe('#FF0000')
      expect(result.schema.m[0].ei).toBe(0.5)
    })
  })

  describe('scaleChange', () => {
    it('scales all parts uniformly', () => {
      const schema = createTestSchema()
      const classification = {
        type: 'scaleChange',
        targets: ['all'],
        parameters: { scaleFactor: 2, axis: 'all' }
      }

      const result = applyTier1Modification(schema, classification)

      expect(result.applied).toBe(true)
      // Check body part's instance scale
      expect(result.schema.p[0].i[0].s).toEqual([2, 2, 2])
      // Geometry should NOT be scaled (only instance scale is modified)
      // This prevents double-scaling where both geometry and instance scale compound
      expect(result.schema.p[0].geom.w).toBe(1)  // Original width
      expect(result.schema.p[0].geom.h).toBe(1.5)  // Original height
      expect(result.schema.p[0].geom.d).toBe(0.6)  // Original depth
    })

    it('scales only on specific axis', () => {
      const schema = createTestSchema()
      const classification = {
        type: 'scaleChange',
        targets: ['all'],
        parameters: { scaleFactor: 2, axis: 'y' }
      }

      const result = applyTier1Modification(schema, classification)

      expect(result.applied).toBe(true)
      expect(result.schema.p[0].i[0].s).toEqual([1, 2, 1])
    })

    it('clamps scale factor to valid range', () => {
      const schema = createTestSchema()
      const classification = {
        type: 'scaleChange',
        targets: ['all'],
        parameters: { scaleFactor: 100, axis: 'all' }
      }

      const result = applyTier1Modification(schema, classification)

      expect(result.applied).toBe(true)
      // Scale clamped to max of 5
      expect(result.schema.p[0].i[0].s).toEqual([5, 5, 5])
    })

    it('scales only targeted parts', () => {
      const schema = createTestSchema()
      const classification = {
        type: 'scaleChange',
        targets: ['head'],
        parameters: { scaleFactor: 1.5, axis: 'all' }
      }

      const result = applyTier1Modification(schema, classification)

      expect(result.applied).toBe(true)
      // Head should be scaled
      expect(result.schema.p[1].i[0].s).toEqual([1.5, 1.5, 1.5])
      // Body should NOT be scaled
      expect(result.schema.p[0].i[0].s).toEqual([1, 1, 1])
    })
  })

  describe('non-tier-1 types', () => {
    it('returns applied=false for addParts', () => {
      const schema = createTestSchema()
      const classification = {
        type: 'addParts',
        targets: ['head'],
        parameters: {}
      }

      const result = applyTier1Modification(schema, classification)

      expect(result.applied).toBe(false)
      expect(result.description).toContain('Not a Tier 1')
    })
  })
})

describe('deriveVariantName', () => {
  // Note: deriveVariantName prefers short descriptions (<30 chars, <20 chars) first,
  // then falls back to type-specific logic. Tests use long descriptions to test type logic.

  it('uses short description when available', () => {
    const classification = {
      type: 'colorChange',
      parameters: { color: '#FF0000' },
      targets: ['all'],
      description: 'Red version'  // Short enough to be used directly
    }

    const name = deriveVariantName('Robot', classification)

    expect(name).toBe('Red version Robot')
  })

  it('generates "Red Robot" for color change when description is long', () => {
    const classification = {
      type: 'colorChange',
      parameters: { color: '#FF0000' },
      targets: ['all'],
      description: 'This is a very long description that exceeds the character limit'
    }

    const name = deriveVariantName('Robot', classification)

    expect(name).toBe('Red Robot')
  })

  it('generates "Large Robot" for scale > 1.3', () => {
    const classification = {
      type: 'scaleChange',
      parameters: { scaleFactor: 1.5 },
      targets: ['all'],
      description: 'This description is long enough to be ignored by the function'
    }

    const name = deriveVariantName('Robot', classification)

    expect(name).toBe('Large Robot')
  })

  it('generates "Small Robot" for scale < 0.7', () => {
    const classification = {
      type: 'scaleChange',
      parameters: { scaleFactor: 0.5 },
      targets: ['all'],
      description: 'This description is long enough to be ignored by the function'
    }

    const name = deriveVariantName('Robot', classification)

    expect(name).toBe('Small Robot')
  })

  it('generates "Robot with ears" for addParts', () => {
    const classification = {
      type: 'addParts',
      parameters: { partDescription: 'ears' },
      targets: ['head'],
      description: 'Adding some decorative bunny ears to the character head'
    }

    const name = deriveVariantName('Robot', classification)

    expect(name).toBe('Robot with ears')
  })

  it('generates "Robot without tail" for removeParts', () => {
    const classification = {
      type: 'removeParts',
      parameters: { partDescription: 'tail' },
      targets: ['body'],
      description: 'Removing the tail appendage from the character model'
    }

    const name = deriveVariantName('Robot', classification)

    expect(name).toBe('Robot without tail')
  })

  it('generates "Metallic Robot" for high metalness', () => {
    const classification = {
      type: 'materialChange',
      parameters: { metalness: 0.8 },
      targets: ['all'],
      description: 'Changing all materials to be more metallic and shiny looking'
    }

    const name = deriveVariantName('Robot', classification)

    expect(name).toBe('Metallic Robot')
  })

  it('generates "Glossy Robot" for low roughness', () => {
    const classification = {
      type: 'materialChange',
      parameters: { roughness: 0.1 },
      targets: ['all'],
      description: 'Making all surfaces smooth and glossy with low roughness'
    }

    const name = deriveVariantName('Robot', classification)

    expect(name).toBe('Glossy Robot')
  })

  it('generates "Glowing Robot" for emissive', () => {
    const classification = {
      type: 'materialChange',
      parameters: { emissiveIntensity: 0.5 },
      targets: ['all'],
      description: 'Adding emissive glow effect to all materials in the model'
    }

    const name = deriveVariantName('Robot', classification)

    expect(name).toBe('Glowing Robot')
  })

  it('falls back to "(variant)" suffix for unclear', () => {
    const classification = {
      type: 'unclear',
      parameters: {},
      targets: [],
      description: 'Some very long description that exceeds the length limit and cannot be used'
    }

    const name = deriveVariantName('Robot', classification)

    expect(name).toBe('Robot (variant)')
  })
})

describe('checkVariantDepth', () => {
  const createLibrary = () => [
    { id: 'root', name: 'Root Asset', variantOf: null },
    { id: 'v1', name: 'Variant 1', variantOf: 'root' },
    { id: 'v2', name: 'Variant 2', variantOf: 'v1' },
    { id: 'v3', name: 'Variant 3', variantOf: 'v2' }
  ]

  it('returns depth 0 for non-variant (root asset)', () => {
    const library = createLibrary()
    const result = checkVariantDepth(library, 'root')

    expect(result.depth).toBe(0)
    expect(result.exceeds).toBe(false)
  })

  it('returns depth 1 for first-level variant', () => {
    const library = createLibrary()
    const result = checkVariantDepth(library, 'v1')

    expect(result.depth).toBe(1)
    expect(result.exceeds).toBe(false)
  })

  it('returns depth 2 for second-level variant', () => {
    const library = createLibrary()
    const result = checkVariantDepth(library, 'v2')

    expect(result.depth).toBe(2)
    expect(result.exceeds).toBe(false)
  })

  it('returns exceeds=true at depth 3', () => {
    const library = createLibrary()
    const result = checkVariantDepth(library, 'v3')

    expect(result.depth).toBe(3)
    expect(result.exceeds).toBe(true)
  })

  it('handles missing asset gracefully', () => {
    const library = createLibrary()
    const result = checkVariantDepth(library, 'nonexistent')

    expect(result.depth).toBe(0)
    expect(result.exceeds).toBe(false)
  })

  it('handles empty library', () => {
    const result = checkVariantDepth([], 'any')

    expect(result.depth).toBe(0)
    expect(result.exceeds).toBe(false)
  })

  it('respects custom maxDepth', () => {
    const library = createLibrary()

    const result2 = checkVariantDepth(library, 'v2', 2)
    expect(result2.exceeds).toBe(true)

    const result5 = checkVariantDepth(library, 'v3', 5)
    expect(result5.exceeds).toBe(false)
  })
})

describe('createVariantAsset', () => {
  const parentAsset = {
    id: 'parent-123',
    name: 'Robot',
    category: 'character',
    generatedCode: 'function createAsset() {}',
    thumbnail: 'data:image/png;base64,...',
    tags: ['robot', 'ai'],
    isWalkingCharacter: true,
    preferredScale: 10,
    originalPrompt: 'A friendly robot'
  }

  const modifiedSchema = { v: 3, cat: 'character', m: [], p: [] }
  const modifiedCode = 'function createAsset() { /* modified */ }'
  const mockGenerateId = () => 'new-variant-456'

  it('creates variant with correct structure', () => {
    const classification = {
      type: 'colorChange',
      parameters: { color: '#FF0000' },
      targets: ['all'],
      description: 'Change to red'
    }

    const variant = createVariantAsset(
      parentAsset,
      modifiedSchema,
      modifiedCode,
      classification,
      mockGenerateId
    )

    expect(variant.id).toBe('new-variant-456')
    expect(variant.variantOf).toBe('parent-123')
    expect(variant.category).toBe('character')
    expect(variant.generatedCode).toBe(modifiedCode)
    expect(variant.v3Schema).toBe(modifiedSchema)
  })

  it('derives appropriate variant name', () => {
    const classification = {
      type: 'colorChange',
      parameters: { color: '#FF0000' },
      targets: ['all'],
      description: 'Changed all material colors to a bright red tone'  // Long description triggers color lookup
    }

    const variant = createVariantAsset(
      parentAsset,
      modifiedSchema,
      modifiedCode,
      classification,
      mockGenerateId
    )

    expect(variant.name).toBe('Red Robot')
  })

  it('preserves parent properties', () => {
    const classification = {
      type: 'scaleChange',
      parameters: { scaleFactor: 2 },
      targets: ['all'],
      description: 'Scale up'
    }

    const variant = createVariantAsset(
      parentAsset,
      modifiedSchema,
      modifiedCode,
      classification,
      mockGenerateId
    )

    expect(variant.isWalkingCharacter).toBe(true)
    expect(variant.preferredScale).toBe(10)
    expect(variant.originalPrompt).toBe('A friendly robot')
  })

  it('adds variant tag', () => {
    const classification = {
      type: 'colorChange',
      parameters: { color: '#00FF00' },
      targets: ['all'],
      description: 'Change to green'
    }

    const variant = createVariantAsset(
      parentAsset,
      modifiedSchema,
      modifiedCode,
      classification,
      mockGenerateId
    )

    expect(variant.tags).toContain('variant')
    expect(variant.tags).toContain('robot')
    expect(variant.tags).toContain('ai')
  })

  it('initializes editHistory', () => {
    const classification = {
      type: 'colorChange',
      parameters: { color: '#0000FF' },
      targets: ['all'],
      description: 'Change to blue'
    }

    const variant = createVariantAsset(
      parentAsset,
      modifiedSchema,
      modifiedCode,
      classification,
      mockGenerateId
    )

    expect(variant.editHistory).toHaveLength(1)
    expect(variant.editHistory[0].type).toBe('text')
    expect(variant.editHistory[0].prompt).toBe('Change to blue')
    expect(variant.editHistory[0].timestamp).toBeDefined()
  })

  it('sets thumbnail to null for later generation', () => {
    const classification = {
      type: 'colorChange',
      parameters: { color: '#FFFF00' },
      targets: ['all'],
      description: 'Change to yellow'
    }

    const variant = createVariantAsset(
      parentAsset,
      modifiedSchema,
      modifiedCode,
      classification,
      mockGenerateId
    )

    expect(variant.thumbnail).toBeNull()
    expect(variant.thumbnailVersion).toBeNull()
  })
})
