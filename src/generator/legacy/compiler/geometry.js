/**
 * Geometry Code Generator - Emits Three.js geometry creation code
 */

/**
 * Generate geometry creation code for a part
 * @returns {string} - JavaScript code creating the geometry
 */
export function emitGeometry(geomType, params, varName = 'geom') {
  switch (geomType) {
    case 'Box':
      return emitBox(params, varName)
    case 'Sphere':
      return emitSphere(params, varName)
    case 'Cylinder':
      return emitCylinder(params, varName)
    case 'Cone':
      return emitCone(params, varName)
    case 'Torus':
      return emitTorus(params, varName)
    case 'Lathe':
      return emitLathe(params, varName)
    case 'Tube':
      return emitTube(params, varName)
    default:
      // Fallback to unit box
      return `const ${varName} = new THREE.BoxGeometry(1, 1, 1);`
  }
}

function emitBox(params, varName) {
  const size = params.size || [1, 1, 1]
  const seg = params.seg || [1, 1, 1]
  return `const ${varName} = new THREE.BoxGeometry(${size[0]}, ${size[1]}, ${size[2]}, ${seg[0]}, ${seg[1]}, ${seg[2]});`
}

function emitSphere(params, varName) {
  const rad = params.rad ?? 0.5
  const ws = Math.min(params.ws ?? 8, 10)
  const hs = Math.min(params.hs ?? 6, 8)
  return `const ${varName} = new THREE.SphereGeometry(${rad}, ${ws}, ${hs});`
}

function emitCylinder(params, varName) {
  const rt = params.rt ?? 0.5
  const rb = params.rb ?? 0.5
  const h = params.h ?? 1
  const rs = Math.min(params.rs ?? 8, 10)
  return `const ${varName} = new THREE.CylinderGeometry(${rt}, ${rb}, ${h}, ${rs});`
}

function emitCone(params, varName) {
  const r = params.r ?? 0.5
  const h = params.h ?? 1
  const rs = Math.min(params.rs ?? 8, 10)
  return `const ${varName} = new THREE.ConeGeometry(${r}, ${h}, ${rs});`
}

function emitTorus(params, varName) {
  const r = params.r ?? 0.5
  const t = params.t ?? 0.2
  const rs = Math.min(params.rs ?? 8, 10)
  const ts = Math.min(params.ts ?? 10, 12)
  return `const ${varName} = new THREE.TorusGeometry(${r}, ${t}, ${rs}, ${ts});`
}

function emitLathe(params, varName) {
  const prof = params.prof || [[0.5, 0], [0.5, 1]]
  const seg = Math.min(params.seg ?? 12, 14)

  // Build profile points array
  const profileCode = prof.slice(0, 12).map(([r, y]) =>
    `new THREE.Vector2(${r}, ${y})`
  ).join(', ')

  return `const ${varName}_pts = [${profileCode}];
const ${varName} = new THREE.LatheGeometry(${varName}_pts, ${seg});`
}

function emitTube(params, varName) {
  const path = params.path || [[0, 0, 0], [0, 1, 0]]
  const ts = Math.min(params.ts ?? 12, 14)
  const rad = params.rad ?? 0.1
  const rs = Math.min(params.rs ?? 6, 8)

  // Build path points array
  const pathCode = path.slice(0, 20).map(([x, y, z]) =>
    `new THREE.Vector3(${x}, ${y}, ${z})`
  ).join(', ')

  return `const ${varName}_pathPts = [${pathCode}];
const ${varName}_curve = new THREE.CatmullRomCurve3(${varName}_pathPts);
const ${varName} = new THREE.TubeGeometry(${varName}_curve, ${ts}, ${rad}, ${rs}, false);`
}

/**
 * Compute approximate bounding box for a geometry
 * Used for auto-snap connectivity checks
 * @returns {{ min: number[], max: number[], center: number[] }}
 */
export function estimateBounds(geomType, params, position, scale) {
  let halfExtents = [0.5, 0.5, 0.5]

  switch (geomType) {
    case 'Box': {
      const size = params.size || [1, 1, 1]
      halfExtents = [size[0] / 2, size[1] / 2, size[2] / 2]
      break
    }
    case 'Sphere': {
      const rad = params.rad ?? 0.5
      halfExtents = [rad, rad, rad]
      break
    }
    case 'Cylinder': {
      const rt = params.rt ?? 0.5
      const rb = params.rb ?? 0.5
      const h = params.h ?? 1
      const maxR = Math.max(rt, rb)
      halfExtents = [maxR, h / 2, maxR]
      break
    }
    case 'Cone': {
      const r = params.r ?? 0.5
      const h = params.h ?? 1
      halfExtents = [r, h / 2, r]
      break
    }
    case 'Torus': {
      const R = params.r ?? 0.5
      const t = params.t ?? 0.2
      halfExtents = [R + t, t, R + t]
      break
    }
    case 'Lathe': {
      const prof = params.prof || [[0.5, 0], [0.5, 1]]
      const maxR = Math.max(...prof.map(p => p[0]))
      const minY = Math.min(...prof.map(p => p[1]))
      const maxY = Math.max(...prof.map(p => p[1]))
      halfExtents = [maxR, (maxY - minY) / 2, maxR]
      break
    }
    case 'Tube': {
      const path = params.path || [[0, 0, 0], [0, 1, 0]]
      const rad = params.rad ?? 0.1
      const xs = path.map(p => p[0])
      const ys = path.map(p => p[1])
      const zs = path.map(p => p[2])
      const minX = Math.min(...xs), maxX = Math.max(...xs)
      const minY = Math.min(...ys), maxY = Math.max(...ys)
      const minZ = Math.min(...zs), maxZ = Math.max(...zs)
      halfExtents = [
        (maxX - minX) / 2 + rad,
        (maxY - minY) / 2 + rad,
        (maxZ - minZ) / 2 + rad
      ]
      break
    }
  }

  // Apply scale
  const scaledHalf = [
    halfExtents[0] * (scale[0] || 1),
    halfExtents[1] * (scale[1] || 1),
    halfExtents[2] * (scale[2] || 1)
  ]

  return {
    min: [
      position[0] - scaledHalf[0],
      position[1] - scaledHalf[1],
      position[2] - scaledHalf[2]
    ],
    max: [
      position[0] + scaledHalf[0],
      position[1] + scaledHalf[1],
      position[2] + scaledHalf[2]
    ],
    center: position
  }
}
