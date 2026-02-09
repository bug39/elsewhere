export function collectMeshes(root, THREE) {
  const meshes = [];
  root.traverse(child => {
    if (!child.isMesh || !child.geometry) return;
    const box = new THREE.Box3().setFromObject(child);
    const size = box.getSize(new THREE.Vector3());
    const volume = size.x * size.y * size.z;
    meshes.push({ mesh: child, box, size, volume });
  });
  return meshes;
}

function materialList(mesh) {
  if (!mesh.material) return [];
  return Array.isArray(mesh.material) ? mesh.material.filter(Boolean) : [mesh.material];
}

function colorLuma(color) {
  if (!color) return null;
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

function intersectionVolume(a, b) {
  const minX = Math.max(a.min.x, b.min.x);
  const minY = Math.max(a.min.y, b.min.y);
  const minZ = Math.max(a.min.z, b.min.z);
  const maxX = Math.min(a.max.x, b.max.x);
  const maxY = Math.min(a.max.y, b.max.y);
  const maxZ = Math.min(a.max.z, b.max.z);
  if (maxX <= minX || maxY <= minY || maxZ <= minZ) return 0;
  return (maxX - minX) * (maxY - minY) * (maxZ - minZ);
}

function aabbDistance(a, b) {
  const dx = Math.max(0, Math.max(a.min.x - b.max.x, b.min.x - a.max.x));
  const dy = Math.max(0, Math.max(a.min.y - b.max.y, b.min.y - a.max.y));
  const dz = Math.max(0, Math.max(a.min.z - b.max.z, b.min.z - a.max.z));
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function analyzeAsset(asset, THREE) {
  const meshes = collectMeshes(asset, THREE);
  const meshCount = meshes.length;

  const materialIds = new Set();
  let lumaMin = null;
  let lumaMax = null;
  let thinMeshCount = 0;
  let thinNoDoubleSide = 0;

  meshes.forEach(({ mesh, size }) => {
    const mats = materialList(mesh);
    mats.forEach(mat => {
      materialIds.add(mat.uuid);
      const luma = colorLuma(mat.color);
      if (luma !== null) {
        lumaMin = lumaMin === null ? luma : Math.min(lumaMin, luma);
        lumaMax = lumaMax === null ? luma : Math.max(lumaMax, luma);
      }
    });

    const maxDim = Math.max(size.x, size.y, size.z);
    const minDim = Math.min(size.x, size.y, size.z);
    if (maxDim > 0 && minDim / maxDim < 0.05) {
      thinMeshCount++;
      const hasDouble = mats.some(mat => mat.side === THREE.DoubleSide);
      if (!hasDouble) thinNoDoubleSide++;
    }
  });

  let totalVolume = 0;
  let maxVolume = 0;
  meshes.forEach(({ volume }) => {
    totalVolume += volume;
    if (volume > maxVolume) maxVolume = volume;
  });
  const primaryMassRatio = totalVolume > 0 ? maxVolume / totalVolume : 0;

  let overlapVolume = 0;
  for (let i = 0; i < meshes.length; i++) {
    for (let j = i + 1; j < meshes.length; j++) {
      overlapVolume += intersectionVolume(meshes[i].box, meshes[j].box);
    }
  }
  const overlapRatio = totalVolume > 0 ? overlapVolume / totalVolume : 0;

  const threshold = 0.05;
  const visited = new Array(meshes.length).fill(false);
  let componentCount = 0;
  for (let i = 0; i < meshes.length; i++) {
    if (visited[i]) continue;
    componentCount++;
    const stack = [i];
    visited[i] = true;
    while (stack.length) {
      const idx = stack.pop();
      for (let j = 0; j < meshes.length; j++) {
        if (visited[j]) continue;
        const dist = aabbDistance(meshes[idx].box, meshes[j].box);
        if (dist <= threshold) {
          visited[j] = true;
          stack.push(j);
        }
      }
    }
  }

  const bounds = new THREE.Box3().setFromObject(asset);
  const size = bounds.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);

  return {
    meshCount,
    materialCount: materialIds.size,
    bounds: { size, maxDim },
    primaryMassRatio,
    overlapRatio,
    componentCount,
    thinMeshCount,
    thinNoDoubleSide,
    lumaMin,
    lumaMax
  };
}

export function measureAnimationDrift(asset, steps = 120, dt = 1 / 60) {
  const animate = asset?.userData?.animate;
  if (typeof animate !== 'function') {
    return { hasAnimation: false, drift: 0, minY: 0, maxY: 0, monotonic: false };
  }

  const baseY = asset.position.y;
  let minY = baseY;
  let maxY = baseY;
  let lastY = baseY;
  let monotonic = true;

  for (let i = 0; i < steps; i++) {
    animate.call(asset, dt);
    const y = asset.position.y;
    if (y < lastY - 0.001) monotonic = false;
    lastY = y;
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  const drift = Math.max(Math.abs(maxY - baseY), Math.abs(minY - baseY));
  return { hasAnimation: true, drift, minY, maxY, monotonic };
}

export function analyzeCode(code) {
  const hasCreateAsset = /createAsset/.test(code);
  const hasExport = /export\s+function\s+createAsset\s*\(/.test(code) || /export\s*\{\s*createAsset\s*\}/.test(code);
  const hasDefaultExport = /export\s+default\s+function/.test(code);
  const usesComputeFrenetFrame = /computeFrenetFrame/.test(code);
  const usesTubeGeometry = /TubeGeometry/.test(code);
  const usesArrayTubePath = /new\s+THREE\.TubeGeometry\s*\(\s*\[/.test(code);
  const endsWithBrace = code.trim().endsWith('}');

  return {
    hasCreateAsset,
    hasExport,
    hasDefaultExport,
    usesComputeFrenetFrame,
    usesTubeGeometry,
    usesArrayTubePath,
    endsWithBrace
  };
}

export function summarizeWarnings(metrics) {
  const warnings = [];
  if (metrics.meshCount > 24) warnings.push('mesh>24');
  if (metrics.materialCount > 5) warnings.push('mat>5');
  if (metrics.primaryMassRatio > 0 && metrics.primaryMassRatio < 0.35) warnings.push('weak-primary');
  if (metrics.overlapRatio > 0.6) warnings.push('heavy-overlap');
  if (metrics.componentCount > 1) warnings.push('disconnected');
  if (metrics.lumaMax !== null && metrics.lumaMax < 0.2) warnings.push('very-dark');
  if (metrics.thinNoDoubleSide > 0) warnings.push('thin-no-ds');
  return warnings;
}
