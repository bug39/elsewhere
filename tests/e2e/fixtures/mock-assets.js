/**
 * Mock asset code snippets for E2E testing.
 *
 * These provide deterministic Three.js asset code that matches the
 * production code contract without needing actual API calls.
 *
 * Code Contract (from CLAUDE.md):
 * - Export createAsset(THREE) returning a THREE.Group
 * - Centered at origin, bottom at y=0
 * - May attach userData.animate(dt) for animation
 * - May attach userData.parts with legPivots/armPivots for walk animation
 */

/**
 * Simple rock prop - minimal static asset
 */
export const MOCK_ROCK = `
export function createAsset(THREE) {
  const group = new THREE.Group();

  // Main rock body
  const rockGeo = new THREE.DodecahedronGeometry(0.8, 1);
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x666666,
    roughness: 0.9,
    flatShading: true
  });
  const rock = new THREE.Mesh(rockGeo, rockMat);
  rock.scale.set(1.2, 0.7, 1.0);
  rock.position.y = 0.5;
  group.add(rock);

  return group;
}
`;

/**
 * Simple tree - nature asset with basic animation
 */
export const MOCK_TREE = `
export function createAsset(THREE) {
  const group = new THREE.Group();

  // Trunk
  const trunkGeo = new THREE.CylinderGeometry(0.15, 0.2, 1.2, 8);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.8 });
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = 0.6;
  group.add(trunk);

  // Foliage
  const foliageGeo = new THREE.SphereGeometry(0.8, 8, 6);
  const foliageMat = new THREE.MeshStandardMaterial({ color: 0x228B22, roughness: 0.7 });
  const foliage = new THREE.Mesh(foliageGeo, foliageMat);
  foliage.position.y = 1.6;
  foliage.scale.y = 1.3;
  group.add(foliage);

  // Simple sway animation
  group.userData.animate = function(dt) {
    foliage.rotation.z = Math.sin(Date.now() * 0.001) * 0.05;
  };

  return group;
}
`;

/**
 * Dragon creature - non-biped NPC with animation
 */
export const MOCK_DRAGON = `
export function createAsset(THREE) {
  const group = new THREE.Group();

  // Body
  const bodyGeo = new THREE.CapsuleGeometry(0.4, 1.0, 4, 8);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8B0000, roughness: 0.6 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.rotation.z = Math.PI / 2;
  body.position.y = 0.6;
  group.add(body);

  // Head
  const headGeo = new THREE.ConeGeometry(0.25, 0.5, 6);
  const head = new THREE.Mesh(headGeo, bodyMat);
  head.rotation.z = -Math.PI / 2;
  head.position.set(0.8, 0.7, 0);
  group.add(head);

  // Wings (pivots for animation)
  const wingGeo = new THREE.PlaneGeometry(0.8, 0.5);
  const wingMat = new THREE.MeshStandardMaterial({
    color: 0xA52A2A,
    side: 2,
    roughness: 0.5
  });

  const leftWing = new THREE.Mesh(wingGeo, wingMat);
  leftWing.position.set(0, 0.8, 0.4);
  leftWing.rotation.x = -0.3;
  group.add(leftWing);

  const rightWing = new THREE.Mesh(wingGeo, wingMat);
  rightWing.position.set(0, 0.8, -0.4);
  rightWing.rotation.x = 0.3;
  group.add(rightWing);

  // Animation
  group.userData.animate = function(dt) {
    const t = Date.now() * 0.003;
    leftWing.rotation.x = -0.3 + Math.sin(t) * 0.3;
    rightWing.rotation.x = 0.3 - Math.sin(t) * 0.3;
  };

  return group;
}
`;

/**
 * Character with full NPC parts (biped) - for walk animation testing
 * Includes userData.parts with legPivots and armPivots
 */
export const MOCK_CHARACTER = `
export function createAsset(THREE) {
  const group = new THREE.Group();
  const parts = { legPivots: [], armPivots: [] };

  // Body
  const bodyGeo = new THREE.BoxGeometry(0.5, 0.6, 0.3);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4169E1, roughness: 0.6 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 1.1;
  group.add(body);

  // Head
  const headGeo = new THREE.SphereGeometry(0.2, 8, 8);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xFFDBAC, roughness: 0.7 });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 1.6;
  group.add(head);

  // Legs
  const legGeo = new THREE.CylinderGeometry(0.08, 0.06, 0.6, 8);
  const legMat = new THREE.MeshStandardMaterial({ color: 0x1E3A5F, roughness: 0.7 });

  const leftLegPivot = new THREE.Group();
  leftLegPivot.position.set(-0.12, 0.8, 0);
  const leftLeg = new THREE.Mesh(legGeo, legMat);
  leftLeg.position.y = -0.3;
  leftLegPivot.add(leftLeg);
  group.add(leftLegPivot);
  parts.legPivots.push(leftLegPivot);

  const rightLegPivot = new THREE.Group();
  rightLegPivot.position.set(0.12, 0.8, 0);
  const rightLeg = new THREE.Mesh(legGeo, legMat);
  rightLeg.position.y = -0.3;
  rightLegPivot.add(rightLeg);
  group.add(rightLegPivot);
  parts.legPivots.push(rightLegPivot);

  // Arms
  const armGeo = new THREE.CylinderGeometry(0.05, 0.04, 0.4, 8);
  const armMat = new THREE.MeshStandardMaterial({ color: 0x4169E1, roughness: 0.6 });

  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(-0.32, 1.25, 0);
  const leftArm = new THREE.Mesh(armGeo, armMat);
  leftArm.position.y = -0.2;
  leftArmPivot.add(leftArm);
  group.add(leftArmPivot);
  parts.armPivots.push(leftArmPivot);

  const rightArmPivot = new THREE.Group();
  rightArmPivot.position.set(0.32, 1.25, 0);
  const rightArm = new THREE.Mesh(armGeo, armMat);
  rightArm.position.y = -0.2;
  rightArmPivot.add(rightArm);
  group.add(rightArmPivot);
  parts.armPivots.push(rightArmPivot);

  // Attach parts for walk animation
  group.userData.parts = parts;

  return group;
}
`;

/**
 * Simple building - static structure
 */
export const MOCK_BUILDING = `
export function createAsset(THREE) {
  const group = new THREE.Group();

  // Main structure
  const wallGeo = new THREE.BoxGeometry(1.5, 1.2, 1.2);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xD2691E, roughness: 0.8 });
  const walls = new THREE.Mesh(wallGeo, wallMat);
  walls.position.y = 0.6;
  group.add(walls);

  // Roof
  const roofGeo = new THREE.ConeGeometry(1.1, 0.6, 4);
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.7 });
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.position.y = 1.5;
  roof.rotation.y = Math.PI / 4;
  group.add(roof);

  // Door
  const doorGeo = new THREE.BoxGeometry(0.3, 0.5, 0.05);
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x4A3728 });
  const door = new THREE.Mesh(doorGeo, doorMat);
  door.position.set(0, 0.25, 0.63);
  group.add(door);

  return group;
}
`;

/**
 * Asset registry by type - maps category to appropriate mock
 */
export const MOCK_ASSETS = {
  rock: MOCK_ROCK,
  tree: MOCK_TREE,
  dragon: MOCK_DRAGON,
  character: MOCK_CHARACTER,
  building: MOCK_BUILDING,
  // Aliases for common prompts
  knight: MOCK_CHARACTER,
  warrior: MOCK_CHARACTER,
  person: MOCK_CHARACTER,
  house: MOCK_BUILDING,
  cottage: MOCK_BUILDING,
  plant: MOCK_TREE,
  creature: MOCK_DRAGON
};

/**
 * Get mock asset code for a given prompt.
 * Uses keyword matching to return appropriate mock.
 * @param {string} prompt - Asset generation prompt
 * @returns {string} - Mock asset code
 */
export function getMockAssetCode(prompt) {
  const lower = prompt.toLowerCase();

  // Check keywords in priority order
  if (lower.includes('dragon') || lower.includes('creature') || lower.includes('monster')) {
    return MOCK_DRAGON;
  }
  if (lower.includes('character') || lower.includes('knight') || lower.includes('warrior') ||
      lower.includes('person') || lower.includes('npc') || lower.includes('human')) {
    return MOCK_CHARACTER;
  }
  if (lower.includes('tree') || lower.includes('plant') || lower.includes('flower') || lower.includes('bush')) {
    return MOCK_TREE;
  }
  if (lower.includes('house') || lower.includes('building') || lower.includes('cottage') ||
      lower.includes('castle') || lower.includes('tower')) {
    return MOCK_BUILDING;
  }
  if (lower.includes('rock') || lower.includes('stone') || lower.includes('boulder')) {
    return MOCK_ROCK;
  }

  // Default to rock for unknown prompts
  return MOCK_ROCK;
}

/**
 * Get category for a given prompt
 * @param {string} prompt
 * @returns {string}
 */
export function getCategoryForPrompt(prompt) {
  const lower = prompt.toLowerCase();

  if (lower.includes('dragon') || lower.includes('creature') || lower.includes('monster')) {
    return 'creatures';
  }
  if (lower.includes('character') || lower.includes('knight') || lower.includes('warrior') ||
      lower.includes('person') || lower.includes('npc') || lower.includes('human')) {
    return 'characters';
  }
  if (lower.includes('tree') || lower.includes('plant') || lower.includes('flower') || lower.includes('bush')) {
    return 'nature';
  }
  if (lower.includes('house') || lower.includes('building') || lower.includes('cottage') ||
      lower.includes('castle') || lower.includes('tower')) {
    return 'buildings';
  }

  return 'props';
}
