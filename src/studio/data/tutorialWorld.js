/**
 * Tutorial World — Snow Biome "Winter Wonderland"
 *
 * Pre-built demo world with ~45 hand-crafted assets arranged in a
 * village-clearing-in-forest layout. Auto-loaded for first-time users.
 *
 * Asset code contract: each generatedCode string exports createAsset(THREE)
 * returning a THREE.Group, centered at origin, bottom at y=0, ~2x2x2 box.
 */

import { generateId } from '../state/storage'
import { GRID_SIZE, WORLD_SIZE } from '../../shared/constants'

// ── Color Palette ──
// Stored as hex strings so they interpolate readably into code templates
// (numeric 0x8B4513 would become decimal "9127187" in template literals)

const C = {
  SNOW_WHITE:  '0xf0f0f0',
  SNOW_BLUE:   '0xdde8f0',
  ICE_BLUE:    '0xc0d8e8',
  ICE_BRIGHT:  '0x93c5fd',
  WOOD_BROWN:  '0x8B4513',
  WOOD_LIGHT:  '0xA0522D',
  STONE_GREY:  '0x808898',
  STONE_DARK:  '0x696969',
  FIRE_ORANGE: '0xff6600',
  GOLD:        '0xffd700',
  PINE_GREEN:  '0x2d5a27',
  PINE_LIGHT:  '0x3a7a33',
  CARROT:      '0xff6b00',
  BLACK:       '0x222222',
  WARM_GLOW:   '0xffaa44',
  RED:         '0xcc3333',
  RED_DARK:    '0x992222',
  BIRCH_WHITE: '0xe8ddd0',
  BIRCH_MARK:  '0x443322',
  MOSS_GREEN:  '0x556b2f',
  PURPLE:      '0x7744aa',
  BLUE_DARK:   '0x334466',
  ORANGE:      '0xdd6622',
  ANTLER:      '0xc8a87a',
  FUR_BROWN:   '0x8b6f47',
  RIBBON_RED:  '0xcc2244',
}

// ── Asset Code Templates ──
// Each defines function createAsset(THREE) returning a THREE.Group

// ─── NATURE ───

const snowPineTreeCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.5, 6), new THREE.MeshStandardMaterial({ color: ${C.WOOD_BROWN}, flatShading: true }));
  trunk.position.y = 0.25; g.add(trunk);
  [{y:0.55,r:0.5,h:0.4},{y:0.85,r:0.38,h:0.35},{y:1.1,r:0.25,h:0.3}].forEach(l => {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(l.r, l.h, 7), new THREE.MeshStandardMaterial({ color: ${C.PINE_GREEN}, flatShading: true }));
    cone.position.y = l.y; g.add(cone);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(l.r*0.95, l.h*0.3, 7), new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true }));
    cap.position.y = l.y + l.h*0.2; g.add(cap);
  });
  let t = 0;
  g.userData.animate = function(dt) { t += dt; this.rotation.z = Math.sin(t*0.8)*0.015; };
  return g;
}`

const tallSnowPineCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.7, 6), new THREE.MeshStandardMaterial({ color: ${C.WOOD_BROWN}, flatShading: true }));
  trunk.position.y = 0.35; g.add(trunk);
  [{y:0.7,r:0.45,h:0.35},{y:0.95,r:0.35,h:0.3},{y:1.15,r:0.28,h:0.28},{y:1.35,r:0.18,h:0.25}].forEach(l => {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(l.r, l.h, 7), new THREE.MeshStandardMaterial({ color: ${C.PINE_LIGHT}, flatShading: true }));
    cone.position.y = l.y; g.add(cone);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(l.r*0.9, l.h*0.25, 7), new THREE.MeshStandardMaterial({ color: ${C.SNOW_BLUE}, flatShading: true }));
    cap.position.y = l.y + l.h*0.22; g.add(cap);
  });
  let t = 0;
  g.userData.animate = function(dt) { t += dt; this.rotation.z = Math.sin(t*0.6+1)*0.012; };
  return g;
}`

const bareWinterTreeCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: ${C.WOOD_LIGHT}, flatShading: true });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.8, 5), mat);
  trunk.position.y = 0.4; g.add(trunk);
  [{a:0.5,ry:0,y:0.6},{a:-0.4,ry:1.8,y:0.7},{a:0.6,ry:3.5,y:0.5},{a:-0.3,ry:5,y:0.75}].forEach(b => {
    const br = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.025, 0.35, 4), mat);
    br.position.set(Math.sin(b.ry)*0.1, b.y, Math.cos(b.ry)*0.1);
    br.rotation.set(0, b.ry, b.a); g.add(br);
  });
  const snow = new THREE.Mesh(new THREE.SphereGeometry(0.18, 5, 4), new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true }));
  snow.position.y = 0.85; snow.scale.y = 0.4; g.add(snow);
  return g;
}`

const snowRockCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.4, 1), new THREE.MeshStandardMaterial({ color: ${C.STONE_GREY}, flatShading: true }));
  rock.position.y = 0.3; rock.scale.set(1, 0.7, 0.9); g.add(rock);
  const snow = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 4, 0, Math.PI*2, 0, Math.PI*0.5), new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true }));
  snow.position.y = 0.38; g.add(snow);
  return g;
}`

const frozenBushCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: ${C.ICE_BLUE}, flatShading: true });
  [[0,0.12,0],[-0.1,0.1,0.08],[0.08,0.09,-0.06],[0.05,0.15,0.1],[-0.07,0.14,-0.05],[0,0.18,0.03]].forEach(p => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.06+Math.random()*0.04, 5, 4), mat);
    s.position.set(p[0], p[1], p[2]); g.add(s);
  });
  const snow = new THREE.Mesh(new THREE.SphereGeometry(0.15, 5, 3), new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true }));
  snow.position.y = 0.2; snow.scale.y = 0.3; g.add(snow);
  return g;
}`

const iceCrystalCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: ${C.ICE_BRIGHT}, flatShading: true, transparent: true, opacity: 0.7, metalness: 0.3, roughness: 0.1 });
  const prism = new THREE.Mesh(new THREE.CylinderGeometry(0, 0.2, 0.8, 6), mat);
  prism.position.y = 0.4; g.add(prism);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0, 0.3, 6), mat);
  base.position.y = 0.15; g.add(base);
  [-0.15, 0.15].forEach(x => {
    const spike = new THREE.Mesh(new THREE.CylinderGeometry(0, 0.08, 0.3, 6), mat);
    spike.position.set(x, 0.25, 0); spike.rotation.z = x > 0 ? -0.3 : 0.3; g.add(spike);
  });
  let t = 0;
  g.userData.animate = function(dt) { t += dt; this.rotation.y = t*0.5; };
  return g;
}`

const birchTreeCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: ${C.BIRCH_WHITE}, flatShading: true });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.9, 6), trunkMat);
  trunk.position.y = 0.45; g.add(trunk);
  var markMat = new THREE.MeshStandardMaterial({ color: ${C.BIRCH_MARK}, flatShading: true });
  [0.25, 0.45, 0.65].forEach(y => {
    var mark = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, 0.02), markMat);
    mark.position.set(0.04, y, 0); g.add(mark);
  });
  [0.7, 0.8].forEach((y, i) => {
    var br = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.015, 0.25, 4), trunkMat);
    br.position.set(0.08, y, 0); br.rotation.z = -0.6 + i*0.3; g.add(br);
    var br2 = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.015, 0.2, 4), trunkMat);
    br2.position.set(-0.06, y+0.05, 0); br2.rotation.z = 0.5; g.add(br2);
  });
  var snow = new THREE.Mesh(new THREE.SphereGeometry(0.12, 5, 3), new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true }));
  snow.position.y = 0.92; snow.scale.y = 0.3; g.add(snow);
  return g;
}`

const snowStumpCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.25, 7), new THREE.MeshStandardMaterial({ color: ${C.WOOD_BROWN}, flatShading: true }));
  stump.position.y = 0.125; g.add(stump);
  var top = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.03, 7), new THREE.MeshStandardMaterial({ color: ${C.WOOD_LIGHT}, flatShading: true }));
  top.position.y = 0.25; g.add(top);
  var snow = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.21, 0.05, 7), new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true }));
  snow.position.y = 0.28; g.add(snow);
  return g;
}`

const fallenLogCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var mat = new THREE.MeshStandardMaterial({ color: ${C.WOOD_BROWN}, flatShading: true });
  var log = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.8, 6), mat);
  log.position.y = 0.1; log.rotation.z = Math.PI/2; g.add(log);
  var cap1 = new THREE.Mesh(new THREE.CircleGeometry(0.1, 6), new THREE.MeshStandardMaterial({ color: ${C.WOOD_LIGHT}, flatShading: true }));
  cap1.position.set(0.4, 0.1, 0); cap1.rotation.y = Math.PI/2; g.add(cap1);
  var snow = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.03, 0.12), new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true }));
  snow.position.y = 0.19; g.add(snow);
  return g;
}`

const snowDriftCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var drift = new THREE.Mesh(new THREE.SphereGeometry(0.4, 7, 5), new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true }));
  drift.position.y = 0.05; drift.scale.set(1.2, 0.35, 0.8); g.add(drift);
  var top = new THREE.Mesh(new THREE.SphereGeometry(0.2, 5, 4), new THREE.MeshStandardMaterial({ color: ${C.SNOW_BLUE}, flatShading: true }));
  top.position.set(0.1, 0.15, 0); top.scale.set(1, 0.3, 0.7); g.add(top);
  return g;
}`

const icicleClusterCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var mat = new THREE.MeshStandardMaterial({ color: ${C.ICE_BRIGHT}, flatShading: true, transparent: true, opacity: 0.75 });
  var shelf = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.15), new THREE.MeshStandardMaterial({ color: ${C.STONE_GREY}, flatShading: true }));
  shelf.position.y = 0.45; g.add(shelf);
  [[-0.12,0.08],[-0.04,0.14],[0.05,0.12],[0.14,0.06],[0,0.05]].forEach(function(p) {
    var ic = new THREE.Mesh(new THREE.ConeGeometry(0.02, p[1], 4), mat);
    ic.position.set(p[0], 0.45 - p[1]/2, 0); ic.rotation.x = Math.PI; g.add(ic);
  });
  return g;
}`

const mushroomClusterCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var stemMat = new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true });
  var capMat = new THREE.MeshStandardMaterial({ color: ${C.RED}, flatShading: true });
  var dotMat = new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true });
  [[0, 0, 0, 0.12, 0.18], [-0.1, 0, 0.08, 0.08, 0.12], [0.08, 0, -0.05, 0.06, 0.1]].forEach(function(m) {
    var stem = new THREE.Mesh(new THREE.CylinderGeometry(m[3]*0.3, m[3]*0.35, m[4], 5), stemMat);
    stem.position.set(m[0], m[4]/2, m[2]); g.add(stem);
    var cap = new THREE.Mesh(new THREE.SphereGeometry(m[3], 5, 4, 0, Math.PI*2, 0, Math.PI*0.5), capMat);
    cap.position.set(m[0], m[4], m[2]); g.add(cap);
    var dot = new THREE.Mesh(new THREE.SphereGeometry(m[3]*0.15, 3, 3), dotMat);
    dot.position.set(m[0]+m[3]*0.4, m[4]+m[3]*0.3, m[2]); g.add(dot);
  });
  var snow = new THREE.Mesh(new THREE.SphereGeometry(0.15, 5, 3), new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true }));
  snow.position.set(-0.05, 0.01, 0.05); snow.scale.set(1.5, 0.15, 1); g.add(snow);
  return g;
}`

const pineSaplingCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.2, 5), new THREE.MeshStandardMaterial({ color: ${C.WOOD_BROWN}, flatShading: true }));
  trunk.position.y = 0.1; g.add(trunk);
  var cone = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.3, 6), new THREE.MeshStandardMaterial({ color: ${C.PINE_GREEN}, flatShading: true }));
  cone.position.y = 0.35; g.add(cone);
  var cap = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.08, 6), new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true }));
  cap.position.y = 0.42; g.add(cap);
  return g;
}`

const boulderPileCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var mat = new THREE.MeshStandardMaterial({ color: ${C.STONE_GREY}, flatShading: true });
  var r1 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.25, 1), mat);
  r1.position.set(0, 0.2, 0); r1.scale.set(1, 0.8, 0.9); g.add(r1);
  var r2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.18, 1), mat);
  r2.position.set(0.15, 0.15, 0.12); g.add(r2);
  var r3 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.13, 0), mat);
  r3.position.set(-0.1, 0.35, 0); g.add(r3);
  var snow = new THREE.Mesh(new THREE.SphereGeometry(0.2, 5, 3, 0, Math.PI*2, 0, Math.PI*0.5), new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true }));
  snow.position.y = 0.35; g.add(snow);
  return g;
}`

const frostFlowerCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var mat = new THREE.MeshStandardMaterial({ color: ${C.ICE_BRIGHT}, flatShading: true, transparent: true, opacity: 0.8 });
  var stem = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.015, 0.2, 4), new THREE.MeshStandardMaterial({ color: ${C.ICE_BLUE}, flatShading: true }));
  stem.position.y = 0.1; g.add(stem);
  for (var i = 0; i < 6; i++) {
    var angle = (i/6)*Math.PI*2;
    var petal = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 4), mat);
    petal.position.set(Math.sin(angle)*0.05, 0.22, Math.cos(angle)*0.05);
    petal.rotation.z = Math.sin(angle)*0.8;
    petal.rotation.x = Math.cos(angle)*0.8;
    g.add(petal);
  }
  var center = new THREE.Mesh(new THREE.SphereGeometry(0.025, 4, 4), new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true, emissive: ${C.ICE_BRIGHT}, emissiveIntensity: 0.3 }));
  center.position.y = 0.22; g.add(center);
  return g;
}`

// ─── BUILDINGS ───

const logCabinCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var wallMat = new THREE.MeshStandardMaterial({ color: ${C.WOOD_BROWN}, flatShading: true });
  var body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.6, 0.8), wallMat);
  body.position.y = 0.3; g.add(body);
  var roofMat = new THREE.MeshStandardMaterial({ color: ${C.WOOD_LIGHT}, flatShading: true });
  var shape = new THREE.Shape();
  shape.moveTo(-0.55, 0); shape.lineTo(0, 0.35); shape.lineTo(0.55, 0); shape.lineTo(-0.55, 0);
  var roof = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.9, bevelEnabled: false }), roofMat);
  roof.position.set(0, 0.6, -0.45); g.add(roof);
  var snow = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.85), new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true }));
  snow.position.y = 0.85; snow.rotation.x = 0.05; g.add(snow);
  var chimney = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.12), wallMat);
  chimney.position.set(0.3, 0.9, 0); g.add(chimney);
  var door = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.35, 0.02), roofMat);
  door.position.set(0, 0.175, 0.41); g.add(door);
  return g;
}`

const watchtowerCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var mat = new THREE.MeshStandardMaterial({ color: ${C.STONE_GREY}, flatShading: true });
  var base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 1.0, 8), mat);
  base.position.y = 0.5; g.add(base);
  var top = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.3, 0.15, 8), mat);
  top.position.y = 1.05; g.add(top);
  for (var i = 0; i < 8; i++) {
    var a = (i/8)*Math.PI*2;
    var c = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.08), mat);
    c.position.set(Math.sin(a)*0.3, 1.17, Math.cos(a)*0.3); c.rotation.y = a; g.add(c);
  }
  var snow = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.04, 8), new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true }));
  snow.position.y = 1.13; g.add(snow);
  return g;
}`

const woodenBridgeCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var mat = new THREE.MeshStandardMaterial({ color: ${C.WOOD_BROWN}, flatShading: true });
  var deck = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.5), mat);
  deck.position.y = 0.15; g.add(deck);
  [[-0.5,0.22],[0.5,0.22],[-0.5,-0.22],[0.5,-0.22]].forEach(function(p) {
    var s = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 4), mat);
    s.position.set(p[0], 0.07, p[1]); g.add(s);
  });
  [-0.22, 0.22].forEach(function(z) {
    [-0.4, 0, 0.4].forEach(function(x) {
      var post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.25, 4), mat);
      post.position.set(x, 0.3, z); g.add(post);
    });
    var rail = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.02, 0.02), mat);
    rail.position.set(0, 0.38, z); g.add(rail);
  });
  return g;
}`

const stoneWellCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var mat = new THREE.MeshStandardMaterial({ color: ${C.STONE_GREY}, flatShading: true });
  var wall = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.28, 0.3, 8), mat);
  wall.position.y = 0.15; g.add(wall);
  var inner = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.32, 8), new THREE.MeshStandardMaterial({ color: ${C.BLACK}, flatShading: true }));
  inner.position.y = 0.16; g.add(inner);
  var woodMat = new THREE.MeshStandardMaterial({ color: ${C.WOOD_BROWN}, flatShading: true });
  [-1, 1].forEach(function(s) {
    var post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 4), woodMat);
    post.position.set(s*0.22, 0.5, 0); g.add(post);
  });
  var beam = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.1, 4), woodMat);
  beam.position.y = 0.7; beam.rotation.z = Math.PI/2; g.add(beam);
  var roofShape = new THREE.Shape();
  roofShape.moveTo(-0.3, 0); roofShape.lineTo(0, 0.15); roofShape.lineTo(0.3, 0); roofShape.lineTo(-0.3, 0);
  var roof = new THREE.Mesh(new THREE.ExtrudeGeometry(roofShape, { depth: 0.35, bevelEnabled: false }), woodMat);
  roof.position.set(0, 0.7, -0.175); g.add(roof);
  var snow = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.03, 0.3), new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true }));
  snow.position.y = 0.83; g.add(snow);
  return g;
}`

const woodenFenceCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var mat = new THREE.MeshStandardMaterial({ color: ${C.WOOD_BROWN}, flatShading: true });
  [-0.35, 0, 0.35].forEach(function(x) {
    var post = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.4, 0.04), mat);
    post.position.set(x, 0.2, 0); g.add(post);
  });
  [0.15, 0.3].forEach(function(y) {
    var rail = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.03, 0.02), mat);
    rail.position.set(0, y, 0); g.add(rail);
  });
  var snow = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.025, 0.05), new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true }));
  snow.position.y = 0.37; g.add(snow);
  return g;
}`

const smallCottageCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var wallMat = new THREE.MeshStandardMaterial({ color: ${C.STONE_GREY}, flatShading: true });
  var body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.6), wallMat);
  body.position.y = 0.225; g.add(body);
  var roofMat = new THREE.MeshStandardMaterial({ color: ${C.WOOD_LIGHT}, flatShading: true });
  var shape = new THREE.Shape();
  shape.moveTo(-0.4, 0); shape.lineTo(0, 0.25); shape.lineTo(0.4, 0); shape.lineTo(-0.4, 0);
  var roof = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.7, bevelEnabled: false }), roofMat);
  roof.position.set(0, 0.45, -0.35); g.add(roof);
  var snow = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.04, 0.65), new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true }));
  snow.position.y = 0.62; g.add(snow);
  var door = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.28, 0.02), new THREE.MeshStandardMaterial({ color: ${C.WOOD_BROWN}, flatShading: true }));
  door.position.set(0, 0.14, 0.31); g.add(door);
  var win = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.02), new THREE.MeshStandardMaterial({ color: ${C.ICE_BLUE}, flatShading: true, transparent: true, opacity: 0.5 }));
  win.position.set(0.2, 0.3, 0.31); g.add(win);
  return g;
}`

const marketStallCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var mat = new THREE.MeshStandardMaterial({ color: ${C.WOOD_BROWN}, flatShading: true });
  [[-0.35,-0.2],[0.35,-0.2],[-0.35,0.2],[0.35,0.2]].forEach(function(p) {
    var post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 5), mat);
    post.position.set(p[0], 0.3, p[1]); g.add(post);
  });
  var counter = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.04, 0.45), mat);
  counter.position.y = 0.25; g.add(counter);
  var roofMat = new THREE.MeshStandardMaterial({ color: ${C.RED_DARK}, flatShading: true });
  var roof = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.03, 0.55), roofMat);
  roof.position.y = 0.6; roof.rotation.x = 0.08; g.add(roof);
  var snow = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.025, 0.5), new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true }));
  snow.position.y = 0.63; g.add(snow);
  return g;
}`

const stoneArchCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var mat = new THREE.MeshStandardMaterial({ color: ${C.STONE_GREY}, flatShading: true });
  [-0.3, 0.3].forEach(function(x) {
    var pillar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.8, 0.12), mat);
    pillar.position.set(x, 0.4, 0); g.add(pillar);
  });
  var archGeo = new THREE.TorusGeometry(0.3, 0.06, 6, 8, Math.PI);
  var arch = new THREE.Mesh(archGeo, mat);
  arch.position.y = 0.8; arch.rotation.z = Math.PI; g.add(arch);
  var snow = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.03, 0.15), new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true }));
  snow.position.y = 1.1; g.add(snow);
  return g;
}`

// ─── PROPS ───

const campfireCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var stoneMat = new THREE.MeshStandardMaterial({ color: ${C.STONE_DARK}, flatShading: true });
  for (var i = 0; i < 8; i++) {
    var a = (i/8)*Math.PI*2;
    var stone = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.08), stoneMat);
    stone.position.set(Math.sin(a)*0.2, 0.04, Math.cos(a)*0.2); stone.rotation.y = a; g.add(stone);
  }
  var logMat = new THREE.MeshStandardMaterial({ color: ${C.WOOD_BROWN}, flatShading: true });
  [0.4, 1.2, 2.0].forEach(function(ry) {
    var log = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.25, 5), logMat);
    log.position.y = 0.05; log.rotation.set(Math.PI/2*0.7, ry, 0); g.add(log);
  });
  var flameMat = new THREE.MeshStandardMaterial({ color: ${C.FIRE_ORANGE}, emissive: ${C.FIRE_ORANGE}, emissiveIntensity: 0.8, flatShading: true });
  var flames = [];
  [[-0.03,0],[0.04,0.02],[0,-0.03]].forEach(function(o) {
    var f = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.25, 5), flameMat);
    f.position.set(o[0], 0.18, o[1]); g.add(f); flames.push(f);
  });
  let t = 0;
  g.userData.animate = function(dt) {
    t += dt;
    flames.forEach(function(f, i) {
      var p = t*8 + i*2.1;
      f.scale.y = 0.8 + Math.sin(p)*0.3; f.scale.x = 0.9 + Math.sin(p*1.3)*0.15;
      f.position.y = 0.18 + Math.sin(p*0.7)*0.02;
    });
  };
  return g;
}`

const woodenSignCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var mat = new THREE.MeshStandardMaterial({ color: ${C.WOOD_BROWN}, flatShading: true });
  var post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.6, 5), mat);
  post.position.y = 0.3; g.add(post);
  var board = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.03), new THREE.MeshStandardMaterial({ color: ${C.WOOD_LIGHT}, flatShading: true }));
  board.position.y = 0.55; g.add(board);
  var snow = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.03, 0.06), new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true }));
  snow.position.y = 0.68; g.add(snow);
  return g;
}`

const snowLanternCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.5, 6), new THREE.MeshStandardMaterial({ color: ${C.STONE_DARK}, flatShading: true }));
  post.position.y = 0.25; g.add(post);
  var glowMat = new THREE.MeshStandardMaterial({ color: ${C.WARM_GLOW}, emissive: ${C.WARM_GLOW}, emissiveIntensity: 0.6, flatShading: true });
  var glow = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 5), glowMat);
  glow.position.y = 0.55; g.add(glow);
  var cap = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.08, 6), new THREE.MeshStandardMaterial({ color: ${C.STONE_GREY}, flatShading: true }));
  cap.position.y = 0.62; g.add(cap);
  let t = 0;
  g.userData.animate = function(dt) { t += dt; glow.material.emissiveIntensity = 0.5 + Math.sin(t*3)*0.15; };
  return g;
}`

const treasureChestCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var mat = new THREE.MeshStandardMaterial({ color: ${C.WOOD_BROWN}, flatShading: true });
  var body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.25), mat);
  body.position.y = 0.11; g.add(body);
  var lid = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.42, 8, 1, false, 0, Math.PI), mat);
  lid.position.y = 0.22; lid.rotation.z = Math.PI/2; lid.rotation.y = Math.PI/2; g.add(lid);
  var goldMat = new THREE.MeshStandardMaterial({ color: ${C.GOLD}, metalness: 0.6, roughness: 0.3, flatShading: true });
  var lock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.03), goldMat);
  lock.position.set(0, 0.18, 0.13); g.add(lock);
  var band = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.03, 0.27), goldMat);
  band.position.y = 0.22; g.add(band);
  return g;
}`

const barrelCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var mat = new THREE.MeshStandardMaterial({ color: ${C.WOOD_BROWN}, flatShading: true });
  var body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.16, 0.4, 8), mat);
  body.position.y = 0.2; g.add(body);
  var bandMat = new THREE.MeshStandardMaterial({ color: ${C.STONE_DARK}, flatShading: true });
  [0.08, 0.2, 0.32].forEach(function(y) {
    var band = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.01, 4, 8), bandMat);
    band.position.y = y; band.rotation.x = Math.PI/2; g.add(band);
  });
  var top = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 8), mat);
  top.position.y = 0.4; g.add(top);
  return g;
}`

const woodenCrateCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var mat = new THREE.MeshStandardMaterial({ color: ${C.WOOD_LIGHT}, flatShading: true });
  var box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), mat);
  box.position.y = 0.15; g.add(box);
  var edgeMat = new THREE.MeshStandardMaterial({ color: ${C.WOOD_BROWN}, flatShading: true });
  [[-1,-1],[1,-1],[1,1],[-1,1]].forEach(function(c) {
    var edge = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.32, 0.02), edgeMat);
    edge.position.set(c[0]*0.15, 0.15, c[1]*0.15); g.add(edge);
  });
  return g;
}`

const sledCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var mat = new THREE.MeshStandardMaterial({ color: ${C.WOOD_BROWN}, flatShading: true });
  var deck = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.3), mat);
  deck.position.y = 0.1; g.add(deck);
  var metalMat = new THREE.MeshStandardMaterial({ color: ${C.STONE_DARK}, flatShading: true, metalness: 0.4 });
  [-0.12, 0.12].forEach(function(z) {
    var runner = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 0.02), metalMat);
    runner.position.set(0, 0.03, z); g.add(runner);
    var curl = new THREE.Mesh(new THREE.SphereGeometry(0.03, 4, 4), metalMat);
    curl.position.set(0.27, 0.05, z); g.add(curl);
  });
  var handle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08, 0.28), mat);
  handle.position.set(-0.24, 0.14, 0); g.add(handle);
  return g;
}`

const snowballPileCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var mat = new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true });
  [[0,0.08,0,0.08],[-0.08,0.07,0.05,0.07],[0.07,0.07,-0.04,0.065],[0,0.06,-0.08,0.06],[-0.03,0.17,0.02,0.06],[0.04,0.16,-0.01,0.055]].forEach(function(s) {
    var ball = new THREE.Mesh(new THREE.SphereGeometry(s[3], 6, 5), mat);
    ball.position.set(s[0], s[1], s[2]); g.add(ball);
  });
  return g;
}`

const torchCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var mat = new THREE.MeshStandardMaterial({ color: ${C.WOOD_BROWN}, flatShading: true });
  var post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.5, 5), mat);
  post.position.y = 0.25; g.add(post);
  var holder = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.06, 6), new THREE.MeshStandardMaterial({ color: ${C.STONE_DARK}, flatShading: true }));
  holder.position.y = 0.5; g.add(holder);
  var flameMat = new THREE.MeshStandardMaterial({ color: ${C.FIRE_ORANGE}, emissive: ${C.FIRE_ORANGE}, emissiveIntensity: 0.9, flatShading: true });
  var flame = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 5), flameMat);
  flame.position.y = 0.58; g.add(flame);
  let t = 0;
  g.userData.animate = function(dt) {
    t += dt;
    flame.scale.y = 0.8 + Math.sin(t*10)*0.25;
    flame.scale.x = 0.9 + Math.sin(t*7)*0.15;
    flame.position.y = 0.58 + Math.sin(t*5)*0.01;
  };
  return g;
}`

const benchCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var mat = new THREE.MeshStandardMaterial({ color: ${C.WOOD_BROWN}, flatShading: true });
  var seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.03, 0.2), mat);
  seat.position.y = 0.22; g.add(seat);
  var back = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.02), mat);
  back.position.set(0, 0.35, -0.09); g.add(back);
  [[-0.25,-0.08],[0.25,-0.08],[-0.25,0.08],[0.25,0.08]].forEach(function(p) {
    var leg = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.03), mat);
    leg.position.set(p[0], 0.1, p[1]); g.add(leg);
  });
  var snow = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.02, 0.18), new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true }));
  snow.position.y = 0.24; g.add(snow);
  return g;
}`

const mailboxCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var mat = new THREE.MeshStandardMaterial({ color: ${C.WOOD_BROWN}, flatShading: true });
  var post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.5, 5), mat);
  post.position.y = 0.25; g.add(post);
  var boxMat = new THREE.MeshStandardMaterial({ color: ${C.WOOD_LIGHT}, flatShading: true });
  var box = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 0.1), boxMat);
  box.position.y = 0.52; g.add(box);
  var lid = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 6, 1, false, 0, Math.PI), boxMat);
  lid.position.y = 0.57; lid.rotation.z = Math.PI/2; lid.rotation.y = Math.PI/2; g.add(lid);
  var snow = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 0.09), new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true }));
  snow.position.y = 0.61; g.add(snow);
  return g;
}`

const giftBoxCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var mat = new THREE.MeshStandardMaterial({ color: ${C.RED}, flatShading: true });
  var box = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.2, 0.25), mat);
  box.position.y = 0.1; g.add(box);
  var ribbonMat = new THREE.MeshStandardMaterial({ color: ${C.RIBBON_RED}, flatShading: true });
  var r1 = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.04, 0.04), ribbonMat);
  r1.position.y = 0.1; g.add(r1);
  var r2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.26), ribbonMat);
  r2.position.y = 0.1; g.add(r2);
  var goldMat = new THREE.MeshStandardMaterial({ color: ${C.GOLD}, flatShading: true, metalness: 0.5 });
  var bow = new THREE.Mesh(new THREE.SphereGeometry(0.04, 5, 4), goldMat);
  bow.position.y = 0.22; g.add(bow);
  [-0.04, 0.04].forEach(function(x) {
    var loop = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.008, 4, 6), goldMat);
    loop.position.set(x, 0.23, 0); loop.rotation.y = Math.PI/2; g.add(loop);
  });
  return g;
}`

// ─── CHARACTERS ───

const snowmanCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var snowMat = new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true });
  var bottom = new THREE.Mesh(new THREE.SphereGeometry(0.25, 7, 6), snowMat);
  bottom.position.y = 0.25; g.add(bottom);
  var middle = new THREE.Mesh(new THREE.SphereGeometry(0.18, 7, 6), snowMat);
  middle.position.y = 0.55; g.add(middle);
  var head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 7, 6), snowMat);
  head.position.y = 0.78; g.add(head);
  var eyeMat = new THREE.MeshStandardMaterial({ color: ${C.BLACK}, flatShading: true });
  [[-0.04, 0.81, 0.11],[0.04, 0.81, 0.11]].forEach(function(p) {
    var eye = new THREE.Mesh(new THREE.SphereGeometry(0.02, 4, 4), eyeMat);
    eye.position.set(p[0], p[1], p[2]); g.add(eye);
  });
  var nose = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.12, 5), new THREE.MeshStandardMaterial({ color: ${C.CARROT}, flatShading: true }));
  nose.position.set(0, 0.77, 0.14); nose.rotation.x = Math.PI/2; g.add(nose);
  var stickMat = new THREE.MeshStandardMaterial({ color: ${C.WOOD_LIGHT}, flatShading: true });
  [-1, 1].forEach(function(s) {
    var arm = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.3, 4), stickMat);
    arm.position.set(s*0.25, 0.55, 0); arm.rotation.z = s*-0.8; g.add(arm);
  });
  let t = 0;
  g.userData.animate = function(dt) { t += dt; this.rotation.y = Math.sin(t*0.5)*0.05; };
  return g;
}`

const snowWizardCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var robeMat = new THREE.MeshStandardMaterial({ color: ${C.PURPLE}, flatShading: true });
  var body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.18, 0.5, 6), robeMat);
  body.position.y = 0.25; g.add(body);
  var head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true }));
  head.position.y = 0.58; g.add(head);
  var hat = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.25, 6), robeMat);
  hat.position.y = 0.75; hat.rotation.z = 0.1; g.add(hat);
  var eyeMat = new THREE.MeshStandardMaterial({ color: ${C.BLACK}, flatShading: true });
  [[-0.03, 0.6, 0.08],[0.03, 0.6, 0.08]].forEach(function(p) {
    var eye = new THREE.Mesh(new THREE.SphereGeometry(0.015, 4, 4), eyeMat);
    eye.position.set(p[0], p[1], p[2]); g.add(eye);
  });
  var staffMat = new THREE.MeshStandardMaterial({ color: ${C.WOOD_BROWN}, flatShading: true });
  var staff = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.7, 5), staffMat);
  staff.position.set(0.2, 0.35, 0); staff.rotation.z = -0.15; g.add(staff);
  var orb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 5), new THREE.MeshStandardMaterial({ color: ${C.ICE_BRIGHT}, emissive: ${C.ICE_BRIGHT}, emissiveIntensity: 0.5, flatShading: true }));
  orb.position.set(0.23, 0.72, 0); g.add(orb);
  let t = 0;
  g.userData.animate = function(dt) { t += dt; orb.material.emissiveIntensity = 0.4 + Math.sin(t*2)*0.2; };
  return g;
}`

const bundledVillagerCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var coatMat = new THREE.MeshStandardMaterial({ color: ${C.BLUE_DARK}, flatShading: true });
  var body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.4, 6), coatMat);
  body.position.y = 0.2; g.add(body);
  var head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true }));
  head.position.y = 0.48; g.add(head);
  var hatMat = new THREE.MeshStandardMaterial({ color: ${C.RED}, flatShading: true });
  var hat = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.1, 6), hatMat);
  hat.position.y = 0.55; g.add(hat);
  var pompom = new THREE.Mesh(new THREE.SphereGeometry(0.025, 4, 4), new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true }));
  pompom.position.y = 0.6; g.add(pompom);
  var eyeMat = new THREE.MeshStandardMaterial({ color: ${C.BLACK}, flatShading: true });
  [[-0.03, 0.5, 0.07],[0.03, 0.5, 0.07]].forEach(function(p) {
    var eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 4, 4), eyeMat);
    eye.position.set(p[0], p[1], p[2]); g.add(eye);
  });
  var scarf = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 4, 8), hatMat);
  scarf.position.y = 0.42; scarf.rotation.x = Math.PI/2; g.add(scarf);
  return g;
}`

const iceGolemCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var mat = new THREE.MeshStandardMaterial({ color: ${C.ICE_BLUE}, flatShading: true, transparent: true, opacity: 0.85 });
  var body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.3), mat);
  body.position.y = 0.4; g.add(body);
  var head = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.2, 0.22), mat);
  head.position.y = 0.75; g.add(head);
  var eyeMat = new THREE.MeshStandardMaterial({ color: ${C.ICE_BRIGHT}, emissive: ${C.ICE_BRIGHT}, emissiveIntensity: 0.8, flatShading: true });
  [[-0.06, 0.78, 0.11],[0.06, 0.78, 0.11]].forEach(function(p) {
    var eye = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.02), eyeMat);
    eye.position.set(p[0], p[1], p[2]); g.add(eye);
  });
  [-1, 1].forEach(function(s) {
    var arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.35, 0.12), mat);
    arm.position.set(s*0.3, 0.35, 0); g.add(arm);
  });
  [-0.1, 0.1].forEach(function(x) {
    var leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.14), mat);
    leg.position.set(x, 0.1, 0); g.add(leg);
  });
  let t = 0;
  g.userData.animate = function(dt) { t += dt; this.rotation.y = Math.sin(t*0.3)*0.08; this.position.y = Math.sin(t*0.5)*0.01; };
  return g;
}`

const scarecrowCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var mat = new THREE.MeshStandardMaterial({ color: ${C.WOOD_BROWN}, flatShading: true });
  var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.9, 5), mat);
  pole.position.y = 0.45; g.add(pole);
  var crossbar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 4), mat);
  crossbar.position.y = 0.7; crossbar.rotation.z = Math.PI/2; g.add(crossbar);
  var head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), new THREE.MeshStandardMaterial({ color: ${C.SNOW_BLUE}, flatShading: true }));
  head.position.y = 0.85; g.add(head);
  var hat = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 0.12, 6), new THREE.MeshStandardMaterial({ color: ${C.BLACK}, flatShading: true }));
  hat.position.y = 0.95; g.add(hat);
  var brim = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.02, 6), new THREE.MeshStandardMaterial({ color: ${C.BLACK}, flatShading: true }));
  brim.position.y = 0.89; g.add(brim);
  var coat = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.3, 0.15), new THREE.MeshStandardMaterial({ color: ${C.WOOD_LIGHT}, flatShading: true }));
  coat.position.y = 0.55; g.add(coat);
  let t = 0;
  g.userData.animate = function(dt) { t += dt; this.rotation.y = Math.sin(t*0.4)*0.03; };
  return g;
}`

// ─── CREATURES ───

const snowFoxCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var furMat = new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true });
  var body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.2), furMat);
  body.position.set(0, 0.22, 0); g.add(body);
  var head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.15, 0.16), furMat);
  head.position.set(0.3, 0.28, 0); g.add(head);
  var snout = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.08), new THREE.MeshStandardMaterial({ color: ${C.SNOW_BLUE}, flatShading: true }));
  snout.position.set(0.4, 0.24, 0); g.add(snout);
  var nose = new THREE.Mesh(new THREE.SphereGeometry(0.015, 4, 4), new THREE.MeshStandardMaterial({ color: ${C.BLACK}, flatShading: true }));
  nose.position.set(0.44, 0.25, 0); g.add(nose);
  [[-0.04],[0.04]].forEach(function(o) {
    var ear = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 4), furMat);
    ear.position.set(0.28, 0.4, o[0]); g.add(ear);
  });
  var legMat = new THREE.MeshStandardMaterial({ color: ${C.SNOW_BLUE}, flatShading: true });
  [[-0.15,-0.07],[-0.15,0.07],[0.15,-0.07],[0.15,0.07]].forEach(function(p) {
    var leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.05), legMat);
    leg.position.set(p[0], 0.06, p[1]); g.add(leg);
  });
  var tail = new THREE.Mesh(new THREE.SphereGeometry(0.08, 5, 4), furMat);
  tail.position.set(-0.32, 0.26, 0); tail.scale.set(1.5, 0.8, 0.8); g.add(tail);
  let t = 0;
  g.userData.animate = function(dt) { t += dt; tail.rotation.y = Math.sin(t*3)*0.4; tail.position.x = -0.32+Math.sin(t*3)*0.02; };
  return g;
}`

const snowRabbitCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var mat = new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true });
  var body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), mat);
  body.position.y = 0.14; body.scale.set(1, 0.85, 0.8); g.add(body);
  var head = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 5), mat);
  head.position.set(0.1, 0.22, 0); g.add(head);
  [[-0.03],[0.03]].forEach(function(o) {
    var ear = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.12, 4), mat);
    ear.position.set(0.08, 0.32, o[0]); g.add(ear);
  });
  var eyeMat = new THREE.MeshStandardMaterial({ color: ${C.BLACK}, flatShading: true });
  [[0.15, 0.24, 0.05],[0.15, 0.24, -0.05]].forEach(function(p) {
    var eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 4, 4), eyeMat);
    eye.position.set(p[0], p[1], p[2]); g.add(eye);
  });
  var nose = new THREE.Mesh(new THREE.SphereGeometry(0.01, 3, 3), new THREE.MeshStandardMaterial({ color: ${C.CARROT}, flatShading: true }));
  nose.position.set(0.18, 0.22, 0); g.add(nose);
  var tail = new THREE.Mesh(new THREE.SphereGeometry(0.04, 5, 4), mat);
  tail.position.set(-0.14, 0.14, 0); g.add(tail);
  let t = 0;
  g.userData.animate = function(dt) { t += dt; this.position.y = Math.abs(Math.sin(t*2))*0.02; };
  return g;
}`

const penguinCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var blackMat = new THREE.MeshStandardMaterial({ color: ${C.BLACK}, flatShading: true });
  var whiteMat = new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true });
  var body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.3, 7), blackMat);
  body.position.y = 0.2; g.add(body);
  var belly = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.25, 7), whiteMat);
  belly.position.set(0, 0.2, 0.03); g.add(belly);
  var head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), blackMat);
  head.position.y = 0.4; g.add(head);
  [[-0.03, 0.42, 0.07],[0.03, 0.42, 0.07]].forEach(function(p) {
    var eye = new THREE.Mesh(new THREE.SphereGeometry(0.015, 4, 4), whiteMat);
    eye.position.set(p[0], p[1], p[2]); g.add(eye);
  });
  var beak = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.05, 4), new THREE.MeshStandardMaterial({ color: ${C.ORANGE}, flatShading: true }));
  beak.position.set(0, 0.38, 0.08); beak.rotation.x = Math.PI/2; g.add(beak);
  var feetMat = new THREE.MeshStandardMaterial({ color: ${C.ORANGE}, flatShading: true });
  [-0.04, 0.04].forEach(function(x) {
    var foot = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.06), feetMat);
    foot.position.set(x, 0.01, 0.02); g.add(foot);
  });
  [-1, 1].forEach(function(s) {
    var wing = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.15, 0.08), blackMat);
    wing.position.set(s*0.12, 0.22, 0); wing.rotation.z = s*0.2; g.add(wing);
  });
  let t = 0;
  g.userData.animate = function(dt) { t += dt; this.rotation.z = Math.sin(t*2)*0.05; };
  return g;
}`

const reindeerCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var mat = new THREE.MeshStandardMaterial({ color: ${C.FUR_BROWN}, flatShading: true });
  var body = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.2, 0.18), mat);
  body.position.set(0, 0.3, 0); g.add(body);
  var head = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.13, 0.12), mat);
  head.position.set(0.28, 0.38, 0); g.add(head);
  var nose = new THREE.Mesh(new THREE.SphereGeometry(0.025, 4, 4), new THREE.MeshStandardMaterial({ color: ${C.RED}, flatShading: true }));
  nose.position.set(0.36, 0.36, 0); g.add(nose);
  var antlerMat = new THREE.MeshStandardMaterial({ color: ${C.ANTLER}, flatShading: true });
  [-1, 1].forEach(function(s) {
    var a1 = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.015, 0.12, 4), antlerMat);
    a1.position.set(0.26, 0.48, s*0.06); g.add(a1);
    var a2 = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.06, 4), antlerMat);
    a2.position.set(0.28, 0.52, s*0.08); a2.rotation.z = s*0.5; g.add(a2);
  });
  [[-0.15,-0.06],[-0.15,0.06],[0.12,-0.06],[0.12,0.06]].forEach(function(p) {
    var leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.04), mat);
    leg.position.set(p[0], 0.1, p[1]); g.add(leg);
  });
  var tail = new THREE.Mesh(new THREE.SphereGeometry(0.03, 4, 3), new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true }));
  tail.position.set(-0.25, 0.32, 0); g.add(tail);
  let t = 0;
  g.userData.animate = function(dt) { t += dt; head.rotation.y = Math.sin(t*0.8)*0.15; };
  return g;
}`

const snowOwlCode = `function createAsset(THREE) {
  const g = new THREE.Group();
  var mat = new THREE.MeshStandardMaterial({ color: ${C.SNOW_WHITE}, flatShading: true });
  var perchMat = new THREE.MeshStandardMaterial({ color: ${C.WOOD_BROWN}, flatShading: true });
  var perch = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.35, 5), perchMat);
  perch.position.y = 0.175; g.add(perch);
  var crossbar = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.15, 4), perchMat);
  crossbar.position.y = 0.35; crossbar.rotation.z = Math.PI/2; g.add(crossbar);
  var body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), mat);
  body.position.y = 0.45; body.scale.set(0.9, 1.1, 0.8); g.add(body);
  var head = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 5), mat);
  head.position.y = 0.58; g.add(head);
  var eyeRingMat = new THREE.MeshStandardMaterial({ color: ${C.SNOW_BLUE}, flatShading: true });
  [[-0.03, 0.6, 0.06],[0.03, 0.6, 0.06]].forEach(function(p) {
    var ring = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.005, 4, 6), eyeRingMat);
    ring.position.set(p[0], p[1], p[2]); g.add(ring);
    var eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 4, 4), new THREE.MeshStandardMaterial({ color: ${C.BLACK}, flatShading: true }));
    eye.position.set(p[0], p[1], p[2]+0.01); g.add(eye);
  });
  var beak = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.03, 4), new THREE.MeshStandardMaterial({ color: ${C.ORANGE}, flatShading: true }));
  beak.position.set(0, 0.57, 0.08); beak.rotation.x = Math.PI/2; g.add(beak);
  [-1, 1].forEach(function(s) {
    var wing = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.12), mat);
    wing.position.set(s*0.1, 0.45, 0); g.add(wing);
  });
  let t = 0;
  g.userData.animate = function(dt) { t += dt; head.rotation.y = Math.sin(t*0.6)*0.5; };
  return g;
}`

// ── Asset Definitions ──

const ASSETS = [
  // ─── Nature (15) ───
  { name: 'Snow Pine Tree',    cat: 'nature',    code: snowPineTreeCode,    tags: ['tree','pine','snow','forest'],       scale: 20 },
  { name: 'Tall Snow Pine',    cat: 'nature',    code: tallSnowPineCode,    tags: ['tree','pine','tall','snow'],         scale: 22 },
  { name: 'Bare Winter Tree',  cat: 'nature',    code: bareWinterTreeCode,  tags: ['tree','bare','winter','branches'],   scale: 18 },
  { name: 'Birch Tree',        cat: 'nature',    code: birchTreeCode,       tags: ['tree','birch','white','winter'],     scale: 17 },
  { name: 'Pine Sapling',      cat: 'nature',    code: pineSaplingCode,     tags: ['tree','pine','small','sapling'],     scale: 8 },
  { name: 'Snow-Covered Rock', cat: 'nature',    code: snowRockCode,        tags: ['rock','stone','snow'],              scale: 12 },
  { name: 'Boulder Pile',      cat: 'nature',    code: boulderPileCode,     tags: ['rock','boulder','stone','pile'],     scale: 10 },
  { name: 'Frozen Bush',       cat: 'nature',    code: frozenBushCode,      tags: ['bush','ice','frozen'],              scale: 6 },
  { name: 'Snow Drift',        cat: 'nature',    code: snowDriftCode,       tags: ['snow','drift','mound'],             scale: 8 },
  { name: 'Snow Stump',        cat: 'nature',    code: snowStumpCode,       tags: ['stump','tree','wood','cut'],         scale: 6 },
  { name: 'Fallen Log',        cat: 'nature',    code: fallenLogCode,       tags: ['log','fallen','wood'],              scale: 10 },
  { name: 'Ice Crystal',       cat: 'nature',    code: iceCrystalCode,      tags: ['ice','crystal','magic','spinning'],  scale: 6 },
  { name: 'Icicle Cluster',    cat: 'nature',    code: icicleClusterCode,   tags: ['ice','icicle','hanging'],           scale: 5 },
  { name: 'Mushroom Cluster',  cat: 'nature',    code: mushroomClusterCode, tags: ['mushroom','red','forest','snow'],    scale: 4 },
  { name: 'Frost Flower',      cat: 'nature',    code: frostFlowerCode,     tags: ['flower','frost','ice','crystal'],    scale: 3 },
  // ─── Buildings (8) ───
  { name: 'Log Cabin',         cat: 'buildings',  code: logCabinCode,       tags: ['cabin','house','wood','snow'],       scale: 20 },
  { name: 'Stone Watchtower',  cat: 'buildings',  code: watchtowerCode,     tags: ['tower','stone','medieval'],          scale: 25 },
  { name: 'Wooden Bridge',     cat: 'buildings',  code: woodenBridgeCode,   tags: ['bridge','wood','crossing'],          scale: 15 },
  { name: 'Stone Well',        cat: 'buildings',  code: stoneWellCode,      tags: ['well','stone','water'],             scale: 8 },
  { name: 'Wooden Fence',      cat: 'buildings',  code: woodenFenceCode,    tags: ['fence','wood','barrier'],            scale: 10 },
  { name: 'Small Cottage',     cat: 'buildings',  code: smallCottageCode,   tags: ['cottage','house','stone','small'],   scale: 18 },
  { name: 'Market Stall',      cat: 'buildings',  code: marketStallCode,    tags: ['market','stall','shop','trade'],     scale: 15 },
  { name: 'Stone Arch',        cat: 'buildings',  code: stoneArchCode,      tags: ['arch','gate','stone','entrance'],    scale: 18 },
  // ─── Props (12) ───
  { name: 'Campfire',          cat: 'props',      code: campfireCode,       tags: ['fire','campfire','warm','light'],    scale: 5 },
  { name: 'Wooden Sign',       cat: 'props',      code: woodenSignCode,     tags: ['sign','wood','post'],               scale: 5 },
  { name: 'Snow Lantern',      cat: 'props',      code: snowLanternCode,    tags: ['lantern','light','glow'],           scale: 4 },
  { name: 'Treasure Chest',    cat: 'props',      code: treasureChestCode,  tags: ['chest','treasure','gold'],          scale: 4 },
  { name: 'Barrel',            cat: 'props',      code: barrelCode,         tags: ['barrel','wood','container'],         scale: 4 },
  { name: 'Wooden Crate',      cat: 'props',      code: woodenCrateCode,    tags: ['crate','box','wood','storage'],      scale: 3 },
  { name: 'Sled',              cat: 'props',      code: sledCode,           tags: ['sled','winter','transport'],         scale: 6 },
  { name: 'Snowball Pile',     cat: 'props',      code: snowballPileCode,   tags: ['snowball','pile','fun'],            scale: 3 },
  { name: 'Torch',             cat: 'props',      code: torchCode,          tags: ['torch','fire','light'],             scale: 4 },
  { name: 'Bench',             cat: 'props',      code: benchCode,          tags: ['bench','seat','wood','rest'],        scale: 5 },
  { name: 'Mailbox',           cat: 'props',      code: mailboxCode,        tags: ['mailbox','post','letter'],          scale: 3 },
  { name: 'Gift Box',          cat: 'props',      code: giftBoxCode,        tags: ['gift','present','box','holiday'],    scale: 3 },
  // ─── Characters (5) ───
  { name: 'Snowman',           cat: 'characters',  code: snowmanCode,       tags: ['snowman','winter','character'],      scale: 8 },
  { name: 'Snow Wizard',       cat: 'characters',  code: snowWizardCode,    tags: ['wizard','magic','staff','character'],scale: 7 },
  { name: 'Bundled Villager',  cat: 'characters',  code: bundledVillagerCode,tags: ['villager','person','winter'],       scale: 6 },
  { name: 'Ice Golem',         cat: 'characters',  code: iceGolemCode,      tags: ['golem','ice','monster','large'],     scale: 15 },
  { name: 'Scarecrow',         cat: 'characters',  code: scarecrowCode,     tags: ['scarecrow','field','guard'],         scale: 8 },
  // ─── Creatures (5) ───
  { name: 'Snow Fox',          cat: 'creatures',   code: snowFoxCode,       tags: ['fox','arctic','wildlife','animal'],  scale: 5 },
  { name: 'Snow Rabbit',       cat: 'creatures',   code: snowRabbitCode,    tags: ['rabbit','bunny','white','small'],    scale: 3 },
  { name: 'Penguin',           cat: 'creatures',   code: penguinCode,       tags: ['penguin','bird','black','white'],    scale: 5 },
  { name: 'Reindeer',          cat: 'creatures',   code: reindeerCode,      tags: ['reindeer','deer','antlers','brown'], scale: 8 },
  { name: 'Snow Owl',          cat: 'creatures',   code: snowOwlCode,       tags: ['owl','bird','perch','white'],        scale: 4 },
]

function createAssetDefinitions() {
  return ASSETS.map(a => ({
    id: generateId('asset'),
    name: a.name,
    category: a.cat,
    generatedCode: a.code,
    tags: a.tags,
    preferredScale: a.scale,
    originalPrompt: a.name
  }))
}

// ── Scene Layout ──

function createPlacedAssets(library) {
  const byName = (name) => library.find(a => a.name === name)

  const place = (name, x, z, scale, rotation = 0) => ({
    instanceId: generateId('inst'),
    libraryId: byName(name).id,
    position: [x, 0, z],
    rotation,
    scale
  })

  return [
    // ── Zone 1 — Village Center (within ~30m of center) ──
    place('Campfire',         200, 200, 5),
    place('Snowman',          218, 190, 8, 2.5),
    place('Wooden Sign',      185, 218, 5, 0.3),
    place('Snow Lantern',     210, 214, 4),
    place('Snow Lantern',     190, 186, 4),
    place('Bench',            182, 210, 5, 1.2),
    place('Snowball Pile',    215, 206, 3),
    place('Torch',            192, 192, 4, 0.5),
    place('Mailbox',          225, 206, 3, -0.5),
    place('Gift Box',         206, 222, 3),
    place('Bundled Villager', 214, 186, 6, 2.0),
    place('Snow Wizard',      184, 206, 7, 0.8),

    // ── Zone 2 — Buildings (70-130m from center, well spaced) ──
    place('Log Cabin',        300, 240, 20, -0.8),
    place('Stone Watchtower', 105, 115, 25, 0.5),
    place('Small Cottage',    305, 120, 18, 0.4),
    place('Market Stall',      85, 295, 15, -0.3),
    place('Stone Arch',       255,  90, 18),
    place('Wooden Bridge',    200, 320, 15, Math.PI / 2),
    place('Stone Well',        95, 250, 8, 0.2),
    place('Wooden Fence',     310, 232, 10, -0.8),
    place('Wooden Fence',     315, 252, 10, -0.8),
    place('Wooden Fence',     100, 120, 10, 0.5),
    place('Treasure Chest',   292, 235, 4, -0.4),
    place('Barrel',           308, 258, 4),
    place('Barrel',           312, 265, 4, 0.4),
    place('Wooden Crate',     310, 262, 3, 0.2),
    place('Sled',             298, 130, 6, 1.0),
    place('Torch',            305, 238, 4),
    place('Bench',             90, 288, 5, -1.5),
    place('Scarecrow',        248,  96, 8, 1.0),

    // ── Zone 3 — Forest Perimeter (120-190m from center) ──
    place('Snow Pine Tree',   350, 300, 22, 0.2),
    place('Snow Pine Tree',    55, 140, 18, 1.5),
    place('Snow Pine Tree',   340, 100, 25, 3.1),
    place('Snow Pine Tree',   375, 200, 20, 0.8),
    place('Snow Pine Tree',    30, 280, 23, 2.2),
    place('Snow Pine Tree',   360, 350, 19, 1.1),
    place('Tall Snow Pine',    60, 320, 22, 0.8),
    place('Tall Snow Pine',   370,  55, 24, 2.5),
    place('Tall Snow Pine',    30, 160, 20, 1.9),
    place('Bare Winter Tree',  60,  60, 18, 2.0),
    place('Bare Winter Tree', 360, 310, 16, 0.6),
    place('Birch Tree',        45, 210, 17, 1.3),
    place('Birch Tree',       340, 345, 15, 2.7),
    place('Birch Tree',       380, 155, 16, 0.4),
    place('Pine Sapling',     320, 270, 8, 0.5),
    place('Pine Sapling',      85, 180, 7, 2.1),
    place('Pine Sapling',     335, 335, 6, 1.4),
    place('Snow-Covered Rock',330,  75, 12),
    place('Snow-Covered Rock', 50, 275, 10, 1.0),
    place('Boulder Pile',     355, 135, 10, 0.7),
    place('Frozen Bush',      110, 310, 6, 0.5),
    place('Frozen Bush',      335, 325, 5, 1.8),
    place('Snow Stump',        80, 310, 6, 0.3),
    place('Snow Stump',       345, 110, 5, 1.5),
    place('Fallen Log',       365, 270, 10, 0.4),
    place('Snow Drift',        50, 105, 8, 0.2),
    place('Snow Drift',       350, 340, 6, 2.0),
    place('Icicle Cluster',   298, 248, 5),
    place('Mushroom Cluster', 325, 285, 4, 0.8),
    place('Frost Flower',      70, 225, 3, 0.5),
    place('Frost Flower',     315, 310, 3, 2.1),

    // ── Zone 4 — Discovery (scattered creatures) ──
    place('Ice Crystal',      365, 330, 6),
    place('Ice Crystal',       45, 320, 5, 1.2),
    place('Snow Fox',         110, 340, 5, -1.2),
    place('Snow Rabbit',      315, 305, 3, 0.8),
    place('Snow Rabbit',       85, 270, 3, 2.5),
    place('Penguin',          150,  70, 5, 0.6),
    place('Penguin',          158,  75, 5, -0.3),
    place('Reindeer',         375, 240, 8, -0.5),
    place('Snow Owl',          55, 335, 4, 1.0),
    place('Ice Golem',        380, 100, 15, 2.5),
  ]
}

// ── Main Export ──

/**
 * Creates a complete tutorial world data object with real 3D thumbnails.
 * Uses the same ThumbnailRenderer as the normal generation pipeline.
 * All IDs are unique per invocation (safe to delete + recreate).
 * @returns {Promise<import('../../shared/types').WorldData>}
 */
export async function createTutorialWorld() {
  const library = createAssetDefinitions()
  const placedAssets = createPlacedAssets(library)

  // Generate real 3D thumbnails — same path as queueProcessor
  const THREE = await import('three')
  const { generateThumbnailAsync } = await import('../../generator/ThumbnailRenderer')

  for (const asset of library) {
    try {
      const cleanCode = asset.generatedCode.replace(/^\s*export\s+/, '')
      const wrappedCode = `return (function(THREE) { ${cleanCode}\nreturn createAsset; })`
      const createModule = new Function(wrappedCode)() // eslint-disable-line no-new-func
      const createAssetFn = createModule(THREE)
      const mesh = createAssetFn(THREE)
      asset.thumbnail = await generateThumbnailAsync(mesh, asset.id)
      asset.thumbnailVersion = 2
      mesh.traverse(child => {
        if (child.geometry) child.geometry.dispose()
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose())
          else child.material.dispose()
        }
      })
    } catch (e) {
      console.warn(`[Tutorial] Thumbnail failed for ${asset.name}:`, e)
    }
  }

  return {
    meta: {
      id: generateId('world'),
      name: 'Winter Wonderland',
      created: new Date().toISOString(),
      version: 1
    },
    terrain: {
      biome: 'snow',
      heightmap: Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0)),
      texturemap: Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0))
    },
    playerSpawn: {
      position: [WORLD_SIZE / 2, 0, WORLD_SIZE / 2],
      character: 'explorer'
    },
    placedAssets,
    library
  }
}

