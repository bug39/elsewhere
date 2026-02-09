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
    case 'Dome':
      return emitDome(params, varName)
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
  const ws = Math.min(params.ws ?? 16, 24)
  const hs = Math.min(params.hs ?? 12, 16)
  return `const ${varName} = new THREE.SphereGeometry(${rad}, ${ws}, ${hs});`
}

function emitCylinder(params, varName) {
  const rt = params.rt ?? 0.5
  const rb = params.rb ?? 0.5
  const h = params.h ?? 1
  const rs = Math.min(params.rs ?? 16, 24)
  return `const ${varName} = new THREE.CylinderGeometry(${rt}, ${rb}, ${h}, ${rs});`
}

function emitCone(params, varName) {
  const r = params.r ?? 0.5
  const h = params.h ?? 1
  const rs = Math.min(params.rs ?? 16, 24)
  return `const ${varName} = new THREE.ConeGeometry(${r}, ${h}, ${rs});`
}

function emitTorus(params, varName) {
  const r = params.r ?? 0.5
  const t = params.t ?? 0.2
  const rs = Math.min(params.rs ?? 12, 16)
  const ts = Math.min(params.ts ?? 24, 32)
  return `const ${varName} = new THREE.TorusGeometry(${r}, ${t}, ${rs}, ${ts});`
}

function emitLathe(params, varName) {
  const prof = params.prof || [[0.5, 0], [0.5, 1]]
  const seg = Math.min(params.seg ?? 16, 24)

  // Build profile points array
  const profileCode = prof.slice(0, 12).map(([r, y]) =>
    `new THREE.Vector2(${r}, ${y})`
  ).join(', ')

  return `const ${varName}_pts = [${profileCode}];
const ${varName} = new THREE.LatheGeometry(${varName}_pts, ${seg});`
}

function emitTube(params, varName) {
  const path = params.path || [[0, 0, 0], [0, 1, 0]]
  const ts = Math.min(params.ts ?? 16, 24)
  const rad = params.rad ?? 0.1
  const rs = Math.min(params.rs ?? 8, 12)

  // Build path points array
  const pathCode = path.slice(0, 20).map(([x, y, z]) =>
    `new THREE.Vector3(${x}, ${y}, ${z})`
  ).join(', ')

  return `const ${varName}_pathPts = [${pathCode}];
const ${varName}_curve = new THREE.CatmullRomCurve3(${varName}_pathPts);
const ${varName} = new THREE.TubeGeometry(${varName}_curve, ${ts}, ${rad}, ${rs}, false);`
}

function emitDome(params, varName) {
  const rad = params.rad ?? 0.5
  const h = params.h ?? 0.5
  const seg = Math.min(params.seg ?? 12, 14)

  // Generate semicircular profile from bottom (rad, 0) to top (0, h)
  const profilePoints = []
  const steps = 8
  for (let i = 0; i <= steps; i++) {
    const angle = (Math.PI / 2) * (i / steps)
    const r = rad * Math.cos(angle)
    const y = h * Math.sin(angle)
    profilePoints.push(`new THREE.Vector2(${r.toFixed(4)}, ${y.toFixed(4)})`)
  }

  return `const ${varName}_pts = [${profilePoints.join(', ')}];
const ${varName} = new THREE.LatheGeometry(${varName}_pts, ${seg});`
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
    case 'Dome': {
      const rad = params.rad ?? 0.5
      const h = params.h ?? 0.5
      halfExtents = [rad, h / 2, rad]
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

/**
 * Estimate bounds for a single part definition in LOCAL space (without instance transform).
 * Used for computing pivot positions during code generation.
 * @param {Object} part - Normalized part object from parser
 * @returns {{ min: number[], max: number[], center: number[] }}
 */
export function estimatePartBounds(part) {
  return estimateBounds(
    part.geometry,
    part.geomParams,
    [0, 0, 0],  // Local origin
    [1, 1, 1]   // Default scale
  )
}

/**
 * Compute pivot position for a part based on its role and bounds.
 * NOTE: This is NOT used for auto-pivot in the emitter - it's available for other tools.
 * @param {Object} part - Normalized part object
 * @returns {number[]} - [x, y, z] pivot position
 */
export function computePivotPosition(part) {
  const bounds = estimatePartBounds(part)
  const role = part.role

  switch (role) {
    case 'leg':
    case 'arm':
    case 'wing':
      // Pivot at top (connection point to body)
      return [bounds.center[0], bounds.max[1], bounds.center[2]]

    case 'body':
      // Pivot at center-bottom for bob animation
      return [bounds.center[0], bounds.min[1], bounds.center[2]]

    case 'head':
    case 'tail':
      // Pivot at base (where it connects to body)
      return [bounds.center[0], bounds.min[1], bounds.center[2]]

    case 'branch':
    case 'leaf':
      // Pivot at base
      return [bounds.center[0], bounds.min[1], bounds.center[2]]

    default:
      // Default: center of geometry
      return bounds.center
  }
}
