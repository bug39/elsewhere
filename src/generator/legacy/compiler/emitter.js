/**
 * Code Emitter - Generates complete Three.js module code
 */

import { emitGeometry } from './geometry.js'
import { topologicalSort } from './validator.js'

/**
 * Emit complete createAsset module from parsed schema
 */
export function emitModule(schema) {
  const lines = []

  // Function header
  lines.push('export function createAsset(THREE) {')
  lines.push('  const group = new THREE.Group();')
  lines.push('')

  // Emit materials
  lines.push('  // Materials')
  lines.push('  const mats = [')
  for (const mat of schema.materials) {
    lines.push(`    new THREE.MeshStandardMaterial({`)
    lines.push(`      color: 0x${mat.color.toString(16).padStart(6, '0')},`)
    lines.push(`      roughness: ${mat.roughness},`)
    lines.push(`      metalness: ${mat.metalness},`)
    if (mat.emissive > 0) {
      lines.push(`      emissive: 0x${mat.emissive.toString(16).padStart(6, '0')},`)
      lines.push(`      emissiveIntensity: ${mat.emissiveIntensity},`)
    }
    lines.push(`      flatShading: ${mat.flatShading},`)
    lines.push(`      side: THREE.DoubleSide`)
    lines.push(`    }),`)
  }
  lines.push('  ];')
  lines.push('')

  // Build part map for parenting
  lines.push('  // Part groups for hierarchy')
  lines.push('  const parts = {};')
  lines.push('')

  // Emit parts in topological order
  const sortedParts = topologicalSort(schema.parts)

  for (const part of sortedParts) {
    lines.push(`  // Part: ${part.name}`)
    lines.push(`  {`)

    // Create part group
    const partGroupVar = `${sanitizeName(part.name)}_group`
    lines.push(`    const ${partGroupVar} = new THREE.Group();`)
    lines.push(`    ${partGroupVar}.name = "${part.name}";`)

    // Create geometry (once, shared across instances)
    const geomVar = `${sanitizeName(part.name)}_geom`
    const geomCode = emitGeometry(part.geometry, part.geomParams, geomVar)
    // Indent geometry code lines
    for (const gLine of geomCode.split('\n')) {
      lines.push(`    ${gLine}`)
    }
    lines.push(`    ${geomVar}.computeVertexNormals();`)

    // Create mesh instances
    for (let i = 0; i < part.instances.length; i++) {
      const inst = part.instances[i]
      const meshVar = `${sanitizeName(part.name)}_${i}`

      lines.push(`    const ${meshVar} = new THREE.Mesh(${geomVar}, mats[${part.materialIndex}]);`)
      lines.push(`    ${meshVar}.name = "${part.name}_${i}";`)

      // Apply transform
      if (inst.position[0] !== 0 || inst.position[1] !== 0 || inst.position[2] !== 0) {
        lines.push(`    ${meshVar}.position.set(${inst.position.join(', ')});`)
      }
      if (inst.rotation[0] !== 0 || inst.rotation[1] !== 0 || inst.rotation[2] !== 0) {
        lines.push(`    ${meshVar}.rotation.set(${inst.rotation.join(', ')});`)
      }
      if (inst.scale[0] !== 1 || inst.scale[1] !== 1 || inst.scale[2] !== 1) {
        lines.push(`    ${meshVar}.scale.set(${inst.scale.join(', ')});`)
      }

      // Handle joint (pivot) if defined
      if (part.joint) {
        const pivotVar = `${sanitizeName(part.joint.name)}_pivot`
        lines.push(`    const ${pivotVar} = new THREE.Group();`)
        lines.push(`    ${pivotVar}.name = "${part.joint.name}";`)
        lines.push(`    ${pivotVar}.position.set(${part.joint.position.join(', ')});`)

        // Offset mesh from pivot
        lines.push(`    ${meshVar}.position.sub(${pivotVar}.position);`)
        lines.push(`    ${pivotVar}.add(${meshVar});`)
        lines.push(`    ${partGroupVar}.add(${pivotVar});`)

        // Store pivot reference in userData.parts
        lines.push(`    if (!group.userData.parts) group.userData.parts = {};`)
        lines.push(`    group.userData.parts["${part.joint.name}"] = ${pivotVar};`)
      } else {
        lines.push(`    ${partGroupVar}.add(${meshVar});`)
      }
    }

    // Attach to parent or root
    if (part.parent !== null) {
      lines.push(`    parts["${part.parent}"].add(${partGroupVar});`)
    } else {
      lines.push(`    group.add(${partGroupVar});`)
    }

    // Store in parts map for children
    lines.push(`    parts["${part.name}"] = ${partGroupVar};`)
    lines.push(`  }`)
    lines.push('')
  }

  // Populate pivot arrays for walk animation
  // Animation controllers expect legPivots/armPivots as arrays, not named dictionary
  lines.push('  // Populate pivot arrays for walk animation')
  lines.push('  if (group.userData.parts) {')
  lines.push('    const legPivots = [];')
  lines.push('    const armPivots = [];')
  lines.push('    ')
  lines.push('    // Collect leg pivots (hip, leg_joint)')
  lines.push('    for (const [name, pivot] of Object.entries(group.userData.parts)) {')
  lines.push('      const lowerName = name.toLowerCase();')
  lines.push('      if (lowerName.includes("hip") || lowerName.includes("leg_joint") || lowerName.includes("leg_pivot")) {')
  lines.push('        legPivots.push(pivot);')
  lines.push('      }')
  lines.push('      if (lowerName.includes("shoulder") || lowerName.includes("arm_joint") || lowerName.includes("arm_pivot")) {')
  lines.push('        armPivots.push(pivot);')
  lines.push('      }')
  lines.push('    }')
  lines.push('    ')
  lines.push('    if (legPivots.length > 0) group.userData.parts.legPivots = legPivots;')
  lines.push('    if (armPivots.length > 0) group.userData.parts.armPivots = armPivots;')
  lines.push('  }')
  lines.push('')

  // Emit attach points
  if (schema.attachPoints && schema.attachPoints.length > 0) {
    lines.push('  // Attach points')
    for (const ap of schema.attachPoints) {
      const apVar = sanitizeName(ap.n)
      lines.push(`  const ${apVar} = new THREE.Group();`)
      lines.push(`  ${apVar}.name = "${ap.n}";`)
      const pos = ap.p || [0, 0, 0]
      lines.push(`  ${apVar}.position.set(${pos.join(', ')});`)
      lines.push(`  group.add(${apVar});`)
    }
    lines.push('')
  }

  // Emit animation if configured
  if (schema.anim && schema.anim.on && schema.anim.j && schema.anim.j.length > 0) {
    lines.push('  // Animation')
    lines.push('  // Ensure userData.parts exists for animation joint access')
    lines.push('  if (!group.userData.parts) group.userData.parts = {};')
    lines.push('  let _t = 0;')

    const style = schema.anim.style || 'bob'

    // For bob animation, store initial Y positions before the animate function
    if (style === 'bob') {
      for (const jointName of schema.anim.j) {
        const jointVar = `group.userData.parts["${jointName}"]`
        const baseYVar = `_baseY_${sanitizeName(jointName)}`
        lines.push(`  const ${baseYVar} = ${jointVar} ? ${jointVar}.position.y : 0;`)
      }
    }

    lines.push('  group.userData.animate = function(dt) {')
    lines.push('    _t += dt;')

    for (const jointName of schema.anim.j) {
      const jointVar = `group.userData.parts["${jointName}"]`
      switch (style) {
        case 'bob': {
          const baseYVar = `_baseY_${sanitizeName(jointName)}`
          // Use assignment (=) to oscillate around rest position, not accumulate (+=)
          // Amplitude 0.2 for visible bob effect; expose offset for selection helper sync
          lines.push(`    if (${jointVar}) {`)
          lines.push(`      const _bobOffset = Math.sin(_t * 3) * 0.2;`)
          lines.push(`      ${jointVar}.position.y = ${baseYVar} + _bobOffset;`)
          lines.push(`      this.userData._animBobOffset = _bobOffset;`)
          lines.push(`    }`)
          break
        }
        case 'sway':
          lines.push(`    if (${jointVar}) ${jointVar}.rotation.z = Math.sin(_t * 2) * 0.1;`)
          break
        case 'spin':
          lines.push(`    if (${jointVar}) ${jointVar}.rotation.y += dt * 2;`)
          break
        case 'walk':
          lines.push(`    if (${jointVar}) ${jointVar}.rotation.x = Math.sin(_t * 8) * 0.4;`)
          break
        case 'flap':
          lines.push(`    if (${jointVar}) ${jointVar}.rotation.z = Math.sin(_t * 10) * 0.3;`)
          break
        default:
          lines.push(`    if (${jointVar}) ${jointVar}.rotation.y = Math.sin(_t * 2) * 0.05;`)
      }
    }

    lines.push('  };')
    lines.push('')
  }

  // Normalization (mandatory)
  lines.push('  // Normalization')
  lines.push('  const box = new THREE.Box3().setFromObject(group);')
  lines.push('  const center = box.getCenter(new THREE.Vector3());')
  lines.push('  const size = box.getSize(new THREE.Vector3());')
  lines.push('  group.position.set(-center.x, -box.min.y, -center.z);')
  lines.push('  const maxDim = Math.max(size.x, size.y, size.z);')
  lines.push('  if (maxDim > 2.0) {')
  lines.push('    const s = 2.0 / maxDim;')
  lines.push('    group.scale.set(s, s, s);')
  lines.push('  }')

  // Apply floatY if specified
  if (schema.floatY > 0) {
    lines.push(`  group.position.y += ${schema.floatY};`)
  }

  lines.push('')
  lines.push('  return group;')
  lines.push('}')

  return lines.join('\n')
}

/**
 * Sanitize a name for use as JavaScript variable
 */
function sanitizeName(name) {
  return name
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^(\d)/, '_$1')
}
