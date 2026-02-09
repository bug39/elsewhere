/**
 * Tests for code emitter - generates complete Three.js module code
 */
import { describe, it, expect } from 'vitest'
import { emitModule } from '../../../../src/generator/compiler/emitter.js'

describe('emitModule', () => {
  // Helper to create a minimal parsed schema
  const minimalSchema = () => ({
    v: 3,
    cat: 'prop',
    floatY: 0,
    materials: [
      { index: 0, name: 'mat0', color: 0x808080, roughness: 0.7, metalness: 0, emissive: 0, emissiveIntensity: 0, flatShading: true }
    ],
    parts: [
      {
        index: 0,
        name: 'body',
        parent: null,
        geometry: 'Box',
        priority: 1,
        materialIndex: 0,
        geomParams: {},
        joint: null,
        instances: [{ index: 0, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }]
      }
    ],
    attachPoints: [],
    anim: { on: false, style: 'none', j: [] }
  })

  describe('function structure', () => {
    it('exports createAsset function', () => {
      const code = emitModule(minimalSchema())
      expect(code).toContain('export function createAsset(THREE)')
    })

    it('creates and returns a group', () => {
      const code = emitModule(minimalSchema())
      expect(code).toContain('const group = new THREE.Group()')
      expect(code).toContain('return group')
    })

    it('includes normalization code', () => {
      const code = emitModule(minimalSchema())
      expect(code).toContain('Box3().setFromObject(group)')
      expect(code).toContain('getCenter')
      expect(code).toContain('getSize')
    })
  })

  describe('material generation', () => {
    it('generates MeshStandardMaterial for each material', () => {
      const schema = {
        ...minimalSchema(),
        materials: [
          { index: 0, name: 'wood', color: 0x8B4513, roughness: 0.8, metalness: 0, emissive: 0, emissiveIntensity: 0, flatShading: true },
          { index: 1, name: 'metal', color: 0xC0C0C0, roughness: 0.3, metalness: 0.8, emissive: 0, emissiveIntensity: 0, flatShading: false }
        ]
      }

      const code = emitModule(schema)
      expect(code).toContain('MeshStandardMaterial')
      expect(code).toContain('0x8b4513') // lowercase hex
      expect(code).toContain('0xc0c0c0')
      expect(code).toContain('roughness: 0.8')
      expect(code).toContain('metalness: 0.8')
    })

    it('includes emissive properties when non-zero', () => {
      const schema = {
        ...minimalSchema(),
        materials: [
          { index: 0, name: 'glow', color: 0xFFFFFF, roughness: 0.5, metalness: 0, emissive: 0xFF0000, emissiveIntensity: 0.5, flatShading: true }
        ]
      }

      const code = emitModule(schema)
      expect(code).toContain('emissive: 0xff0000')
      expect(code).toContain('emissiveIntensity: 0.5')
    })

    it('excludes emissive when zero', () => {
      const code = emitModule(minimalSchema())
      expect(code).not.toContain('emissive:')
      expect(code).not.toContain('emissiveIntensity')
    })

    it('includes DoubleSide for materials', () => {
      const code = emitModule(minimalSchema())
      expect(code).toContain('side: THREE.DoubleSide')
    })
  })

  describe('part generation', () => {
    it('creates part groups', () => {
      const code = emitModule(minimalSchema())
      expect(code).toContain('body_group = new THREE.Group()')
      expect(code).toContain('body_group.name = "body"')
    })

    it('creates geometry for each part', () => {
      const code = emitModule(minimalSchema())
      expect(code).toContain('body_geom = new THREE.BoxGeometry')
      expect(code).toContain('computeVertexNormals()')
    })

    it('creates mesh instances', () => {
      const code = emitModule(minimalSchema())
      expect(code).toContain('body_0 = new THREE.Mesh(body_geom, mats[0])')
      expect(code).toContain('body_0.name = "body_0"')
    })

    it('applies position when non-zero', () => {
      const schema = minimalSchema()
      schema.parts[0].instances[0].position = [1, 2, 3]

      const code = emitModule(schema)
      expect(code).toContain('body_0.position.set(1, 2, 3)')
    })

    it('skips position when zero', () => {
      const code = emitModule(minimalSchema())
      expect(code).not.toContain('body_0.position.set(0, 0, 0)')
    })

    it('applies rotation when non-zero', () => {
      const schema = minimalSchema()
      schema.parts[0].instances[0].rotation = [0.1, 0.2, 0.3]

      const code = emitModule(schema)
      expect(code).toContain('body_0.rotation.set(0.1, 0.2, 0.3)')
    })

    it('applies scale when non-uniform', () => {
      const schema = minimalSchema()
      schema.parts[0].instances[0].scale = [2, 2, 2]

      const code = emitModule(schema)
      expect(code).toContain('body_0.scale.set(2, 2, 2)')
    })

    it('skips scale when uniform 1,1,1', () => {
      const code = emitModule(minimalSchema())
      expect(code).not.toContain('body_0.scale.set(1, 1, 1)')
    })
  })

  describe('hierarchy', () => {
    it('adds root parts to group', () => {
      const code = emitModule(minimalSchema())
      expect(code).toContain('group.add(body_group)')
    })

    it('adds child parts to parent', () => {
      const schema = {
        ...minimalSchema(),
        parts: [
          {
            index: 0,
            name: 'body',
            parent: null,
            geometry: 'Box',
            priority: 1,
            materialIndex: 0,
            geomParams: {},
            joint: null,
            instances: [{ index: 0, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }]
          },
          {
            index: 1,
            name: 'arm',
            parent: 'body',
            geometry: 'Cylinder',
            priority: 2,
            materialIndex: 0,
            geomParams: {},
            joint: null,
            instances: [{ index: 0, position: [0.5, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }]
          }
        ]
      }

      const code = emitModule(schema)
      expect(code).toContain('parts["body"].add(arm_group)')
    })

    it('stores parts in parts map', () => {
      const code = emitModule(minimalSchema())
      expect(code).toContain('parts["body"] = body_group')
    })
  })

  describe('joints', () => {
    it('creates pivot groups for joints', () => {
      const schema = {
        ...minimalSchema(),
        parts: [{
          ...minimalSchema().parts[0],
          joint: { name: 'hip_joint', position: [0, 0.5, 0], axes: 'x' }
        }]
      }

      const code = emitModule(schema)
      expect(code).toContain('hip_joint_pivot = new THREE.Group()')
      expect(code).toContain('hip_joint_pivot.name = "hip_joint"')
      // Pivot position is now computed from geometry bounds, not from schema joint.position
      expect(code).toContain('hip_joint_pivot.position.set(')
    })

    it('does NOT create pivot for parts with only role (no explicit joint)', () => {
      // Auto-pivots based on role were removed because LLM positions represent mesh placement,
      // not pivot attachment points - auto-pivots caused limbs to disconnect from bodies
      const schema = {
        ...minimalSchema(),
        parts: [{
          ...minimalSchema().parts[0],
          name: 'leg_L',
          role: 'leg', // Role alone should NOT trigger pivot creation
          joint: null
        }]
      }

      const code = emitModule(schema)
      // Part should be added directly without pivot wrapper
      expect(code).not.toContain('leg_L_pivot')
      expect(code).toContain('leg_L_group.add(leg_L_0)')
    })

    it('offsets mesh from pivot', () => {
      const schema = {
        ...minimalSchema(),
        parts: [{
          ...minimalSchema().parts[0],
          joint: { name: 'hip', position: [0, 0.5, 0], axes: 'x' }
        }]
      }

      const code = emitModule(schema)
      // Pivot should be at joint position, mesh offset by subtraction
      expect(code).toContain('hip_pivot.position.set(')
      expect(code).toContain('body_0.position.sub(hip_pivot.position)')
      expect(code).toContain('hip_pivot.add(body_0)')
    })

    it('stores joint pivots in userData.parts', () => {
      const schema = {
        ...minimalSchema(),
        parts: [{
          ...minimalSchema().parts[0],
          joint: { name: 'hip', position: [0, 0.5, 0], axes: 'x' }
        }]
      }

      const code = emitModule(schema)
      expect(code).toContain('group.userData.parts["hip"] = hip_pivot')
    })
  })

  describe('pivot arrays for walk animation', () => {
    it('generates legPivots collection code', () => {
      const code = emitModule(minimalSchema())
      expect(code).toContain('legPivots = []')
      // Uses regex for broader matching of leg-related names
      expect(code).toContain('/hip|leg|thigh|calf|shin|foot/.test(lower)')
    })

    it('generates armPivots collection code', () => {
      const code = emitModule(minimalSchema())
      expect(code).toContain('armPivots = []')
      // Uses regex for broader matching of arm-related names
      expect(code).toContain('/shoulder|arm|forearm|hand|elbow/.test(lower)')
    })

    it('generates wingPivots collection code', () => {
      const code = emitModule(minimalSchema())
      expect(code).toContain('wingPivots = []')
      expect(code).toContain('/wing/.test(lower)')
    })

    it('assigns pivot arrays to userData', () => {
      const code = emitModule(minimalSchema())
      expect(code).toContain('group.userData.parts.legPivots = legPivots')
      expect(code).toContain('group.userData.parts.armPivots = armPivots')
      expect(code).toContain('group.userData.parts.wingPivots = wingPivots')
    })
  })

  describe('attach points', () => {
    it('creates attach point groups', () => {
      const schema = {
        ...minimalSchema(),
        attachPoints: [
          { n: 'hand_slot', p: [0.5, 0, 0] },
          { n: 'head_slot', p: [0, 1, 0] }
        ]
      }

      const code = emitModule(schema)
      expect(code).toContain('hand_slot = new THREE.Group()')
      expect(code).toContain('hand_slot.name = "hand_slot"')
      expect(code).toContain('hand_slot.position.set(0.5, 0, 0)')
      expect(code).toContain('group.add(hand_slot)')
    })

    it('handles attach points with no position', () => {
      const schema = {
        ...minimalSchema(),
        attachPoints: [{ n: 'slot' }]
      }

      const code = emitModule(schema)
      expect(code).toContain('slot.position.set(0, 0, 0)')
    })
  })

  describe('animation', () => {
    it('does not generate animate function when animation off', () => {
      const code = emitModule(minimalSchema())
      expect(code).not.toContain('group.userData.animate')
    })

    it('generates bob animation', () => {
      const schema = {
        ...minimalSchema(),
        anim: { on: true, style: 'bob', j: ['body'] }
      }

      const code = emitModule(schema)
      expect(code).toContain('group.userData.animate = function(dt)')
      expect(code).toContain('_t += dt')
      expect(code).toContain('Math.sin(_t * 3) * 0.2')
      expect(code).toContain('_animBobOffset')
    })

    it('stores base Y position for bob animation', () => {
      const schema = {
        ...minimalSchema(),
        anim: { on: true, style: 'bob', j: ['body'] }
      }

      const code = emitModule(schema)
      expect(code).toContain('_baseY_body')
    })

    it('generates sway animation', () => {
      const schema = {
        ...minimalSchema(),
        anim: { on: true, style: 'sway', j: ['body'] }
      }

      const code = emitModule(schema)
      expect(code).toContain('rotation.z = Math.sin(_t * 2) * 0.1')
    })

    it('generates spin animation', () => {
      const schema = {
        ...minimalSchema(),
        anim: { on: true, style: 'spin', j: ['body'] }
      }

      const code = emitModule(schema)
      expect(code).toContain('rotation.y += dt * 2')
    })

    it('generates walk animation', () => {
      const schema = {
        ...minimalSchema(),
        anim: { on: true, style: 'walk', j: ['body'] }
      }

      const code = emitModule(schema)
      expect(code).toContain('rotation.x = Math.sin(_t * 8) * 0.4')
    })

    it('generates flap animation', () => {
      const schema = {
        ...minimalSchema(),
        anim: { on: true, style: 'flap', j: ['body'] }
      }

      const code = emitModule(schema)
      expect(code).toContain('rotation.z = Math.sin(_t * 10) * 0.3')
    })

    it('handles multiple joints', () => {
      const schema = {
        ...minimalSchema(),
        parts: [
          ...minimalSchema().parts,
          {
            index: 1,
            name: 'arm',
            parent: null,
            geometry: 'Cylinder',
            priority: 2,
            materialIndex: 0,
            geomParams: {},
            joint: null,
            instances: [{ index: 0, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }]
          }
        ],
        anim: { on: true, style: 'walk', j: ['body', 'arm'] }
      }

      const code = emitModule(schema)
      expect(code).toContain('group.userData.parts["body"]')
      expect(code).toContain('group.userData.parts["arm"]')
    })
  })

  describe('floatY', () => {
    it('does not add floatY when zero', () => {
      const code = emitModule(minimalSchema())
      expect(code).not.toContain('group.position.y +=')
    })

    it('adds floatY when non-zero', () => {
      const schema = { ...minimalSchema(), floatY: 0.5 }
      const code = emitModule(schema)
      expect(code).toContain('group.position.y += 0.5')
    })
  })

  describe('name sanitization', () => {
    it('sanitizes part names with special characters', () => {
      const schema = {
        ...minimalSchema(),
        parts: [{
          ...minimalSchema().parts[0],
          name: 'my-part.test'
        }]
      }

      const code = emitModule(schema)
      expect(code).toContain('my_part_test_group')
    })

    it('handles names starting with numbers', () => {
      const schema = {
        ...minimalSchema(),
        parts: [{
          ...minimalSchema().parts[0],
          name: '1stPart'
        }]
      }

      const code = emitModule(schema)
      expect(code).toContain('_1stPart_group')
    })
  })

  describe('code validity', () => {
    it('generates syntactically valid JavaScript', () => {
      const code = emitModule(minimalSchema())

      // Code contains export which can't be used in new Function()
      // Instead verify the structure is valid
      expect(code).toContain('export function createAsset(THREE)')
      expect(code).toContain('const group = new THREE.Group()')
      expect(code).toContain('return group')

      // Verify balanced braces (simple check)
      const opens = (code.match(/{/g) || []).length
      const closes = (code.match(/}/g) || []).length
      expect(opens).toBe(closes)
    })

    it('generates valid code for complex schema', () => {
      const schema = {
        v: 3,
        cat: 'character',
        floatY: 0.1,
        materials: [
          { index: 0, name: 'skin', color: 0xDEB887, roughness: 0.8, metalness: 0, emissive: 0, emissiveIntensity: 0, flatShading: true },
          { index: 1, name: 'cloth', color: 0x4169E1, roughness: 0.6, metalness: 0, emissive: 0, emissiveIntensity: 0, flatShading: true }
        ],
        parts: [
          { index: 0, name: 'body', parent: null, geometry: 'Box', priority: 1, materialIndex: 1, geomParams: { size: [1, 1.5, 0.5] }, joint: null, instances: [{ index: 0, position: [0, 0.75, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }] },
          { index: 1, name: 'head', parent: 'body', geometry: 'Sphere', priority: 1, materialIndex: 0, geomParams: { rad: 0.4 }, joint: null, instances: [{ index: 0, position: [0, 1.7, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }] },
          { index: 2, name: 'leg', parent: 'body', geometry: 'Cylinder', priority: 2, materialIndex: 1, geomParams: { rt: 0.15, rb: 0.15, h: 0.8 }, joint: { name: 'hip', position: [0, 0, 0], axes: 'x' }, instances: [{ index: 0, position: [-0.25, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, { index: 1, position: [0.25, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }] }
        ],
        attachPoints: [{ n: 'hand', p: [0.6, 1.2, 0] }],
        anim: { on: true, style: 'bob', j: ['hip'] }
      }

      const code = emitModule(schema)

      // Verify structure and balanced delimiters
      expect(code).toContain('export function createAsset(THREE)')
      expect(code).toContain('body_group')
      expect(code).toContain('head_group')
      expect(code).toContain('leg_group')

      const opens = (code.match(/{/g) || []).length
      const closes = (code.match(/}/g) || []).length
      expect(opens).toBe(closes)
    })
  })
})
