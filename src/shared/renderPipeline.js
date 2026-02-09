import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'

// Vignette shader - subtle edge darkening
// Exported for reuse in Part Editor and other isolated previews
export const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    darkness: { value: 0.15 },
    offset: { value: 1.2 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float darkness;
    uniform float offset;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec2 uv = (vUv - 0.5) * 2.0;
      float d = length(uv);
      float vignetteAmount = smoothstep(offset, offset - 0.5, d);
      color.rgb *= mix(1.0 - darkness, 1.0, vignetteAmount);
      gl_FragColor = color;
    }
  `
}

// Color grading shader - saturation and shadow lift
// Exported for reuse in Part Editor and other isolated previews
export const ColorGradingShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 0.85 },
    shadowLift: { value: 0.0 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float shadowLift;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      vec3 result = mix(vec3(luma), color.rgb, saturation);
      // Lift shadows to prevent pure black (lifts darks more than lights)
      result = result + shadowLift * (1.0 - result);
      gl_FragColor = vec4(result, color.a);
    }
  `
}

// Pipeline A: Matches Studio's "soft" preset for color-accurate rendering
export const PIPELINE_ACES = {
  toneMapping: THREE.ACESFilmicToneMapping,
  toneMappingExposure: 1.0,
  outputColorSpace: THREE.SRGBColorSpace,
  environment: 'neutral',
  postProcessing: true,
  // Matches LIGHTING_PRESETS.soft from constants.js
  // Light positions scaled for ~20 unit Part Editor scene (vs Studio's 400m world)
  lights: {
    ambient: { color: 0xffffff, intensity: 1.6 },
    sun: { color: 0xffffff, intensity: 0.8, position: [0, 50, 0] },
    fill: { color: 0xffffff, intensity: 0.6, position: [-30, 20, 30] },
    hemisphere: { skyColor: 0xaaccff, groundColor: 0x778877, intensity: 0.9 },
    rim: { color: 0xccddff, intensity: 0.3, position: [0, 40, -50] }
  },
  // Matches DEFAULT_SETTINGS from SettingsModal.jsx
  colorGrading: {
    saturation: 1.0,
    shadowLift: 0.08
  }
}

// Pipeline B: Neutral (color-accurate, less stylized)
// - Neutral tone mapping preserves original colors more faithfully
// - Works well at exposure 1.0
export const PIPELINE_NEUTRAL = {
  toneMapping: THREE.NeutralToneMapping,
  toneMappingExposure: 1.0,
  outputColorSpace: THREE.SRGBColorSpace,
  environment: 'neutral',
  postProcessing: true,
  // Light positions scaled for ~20 unit Part Editor scene
  lights: {
    ambient: { color: 0xffffff, intensity: 1.6 },
    sun: { color: 0xffffff, intensity: 0.8, position: [0, 50, 0] },
    fill: { color: 0xffffff, intensity: 0.6, position: [-30, 20, 30] },
    hemisphere: { skyColor: 0xaaccff, groundColor: 0x778877, intensity: 0.9 },
    rim: { color: 0xccddff, intensity: 0.3, position: [0, 40, -50] }
  },
  colorGrading: {
    saturation: 1.0,
    shadowLift: 0.08
  }
}

// Default pipeline for parts editor and general use
// Uses tuned ACES for stylized low-poly aesthetic
export const PARTS_EDITOR_PIPELINE = PIPELINE_ACES

export function applyRenderPipeline(renderer, pipeline) {
  if (!pipeline || !renderer) return

  renderer.toneMapping = pipeline.toneMapping
  renderer.toneMappingExposure = pipeline.toneMappingExposure
  renderer.outputColorSpace = pipeline.outputColorSpace
}

export function addPipelineLights(scene, pipeline, options = {}) {
  if (!scene || !pipeline?.lights) return {}

  const scale = options.scale ?? 1
  const intensityScale = options.intensityScale ?? 1
  const result = {}

  // Ambient light
  if (pipeline.lights.ambient) {
    const ambient = new THREE.AmbientLight(
      pipeline.lights.ambient.color,
      pipeline.lights.ambient.intensity * intensityScale
    )
    scene.add(ambient)
    result.ambient = ambient
  }

  // Sun/key light (main directional with shadows)
  const sunConfig = pipeline.lights.sun || pipeline.lights.key
  if (sunConfig) {
    const sun = new THREE.DirectionalLight(
      sunConfig.color,
      sunConfig.intensity * intensityScale
    )
    const sunPos = sunConfig.position
    sun.position.set(sunPos[0] * scale, sunPos[1] * scale, sunPos[2] * scale)
    sun.castShadow = Boolean(options.sunCastShadow ?? options.keyCastShadow)
    scene.add(sun)
    result.sun = sun
  }

  // Fill light
  if (pipeline.lights.fill) {
    const fill = new THREE.DirectionalLight(
      pipeline.lights.fill.color,
      pipeline.lights.fill.intensity * intensityScale
    )
    const fillPos = pipeline.lights.fill.position
    fill.position.set(fillPos[0] * scale, fillPos[1] * scale, fillPos[2] * scale)
    scene.add(fill)
    result.fill = fill
  }

  // Hemisphere light (prevents pitch-black shadows)
  if (pipeline.lights.hemisphere) {
    const hemiConfig = pipeline.lights.hemisphere
    const hemisphere = new THREE.HemisphereLight(
      hemiConfig.skyColor,
      hemiConfig.groundColor,
      hemiConfig.intensity * intensityScale
    )
    scene.add(hemisphere)
    result.hemisphere = hemisphere
  }

  // Rim light (backlight for edge definition)
  if (pipeline.lights.rim) {
    const rim = new THREE.DirectionalLight(
      pipeline.lights.rim.color,
      pipeline.lights.rim.intensity * intensityScale
    )
    const rimPos = pipeline.lights.rim.position
    rim.position.set(rimPos[0] * scale, rimPos[1] * scale, rimPos[2] * scale)
    scene.add(rim)
    result.rim = rim
  }

  return result
}

/**
 * Creates a neutral environment map for MeshStandardMaterial reflections.
 * This is critical for materials to look correct - without it they appear dull/dark.
 * Matches the Studio's LightingSystem.setupNeutralEnvironment().
 *
 * @param {THREE.WebGLRenderer} renderer - The WebGL renderer
 * @returns {{ texture: THREE.Texture, dispose: Function }}
 */
export function createNeutralEnvironment(renderer) {
  const pmremGenerator = new THREE.PMREMGenerator(renderer)

  const envScene = new THREE.Scene()
  envScene.background = new THREE.Color(0x444444)

  // Ground plane
  const groundGeo = new THREE.PlaneGeometry(20, 20)
  const groundMat = new THREE.MeshBasicMaterial({ color: 0x222222 })
  const ground = new THREE.Mesh(groundGeo, groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -2
  envScene.add(ground)

  // Ceiling
  const ceilingGeo = groundGeo.clone()
  const ceilingMat = new THREE.MeshBasicMaterial({ color: 0x666666 })
  const ceiling = new THREE.Mesh(ceilingGeo, ceilingMat)
  ceiling.rotation.x = Math.PI / 2
  ceiling.position.y = 6
  envScene.add(ceiling)

  // Dim panels for subtle specular highlights
  const panelGeo = new THREE.PlaneGeometry(4, 4)
  const panelMat = new THREE.MeshBasicMaterial({ color: 0x555555 })

  const panel1 = new THREE.Mesh(panelGeo, panelMat)
  panel1.position.set(5, 3, 5)
  panel1.lookAt(0, 0, 0)
  envScene.add(panel1)

  const panelGeo2 = panelGeo.clone()
  const panel2 = new THREE.Mesh(panelGeo2, panelMat)
  panel2.position.set(-5, 3, 5)
  panel2.lookAt(0, 0, 0)
  envScene.add(panel2)

  const panelGeo3 = panelGeo.clone()
  const panel3 = new THREE.Mesh(panelGeo3, panelMat)
  panel3.position.set(0, 4, -6)
  panel3.lookAt(0, 0, 0)
  envScene.add(panel3)

  const panelGeo4 = panelGeo.clone()
  const panel4 = new THREE.Mesh(panelGeo4, panelMat)
  panel4.position.set(0, 7, 0)
  panel4.rotation.x = Math.PI / 2
  envScene.add(panel4)

  // Walls
  const wallMat = new THREE.MeshBasicMaterial({ color: 0x444444 })
  const wallGeo1 = new THREE.PlaneGeometry(20, 10)
  const wallGeo2 = new THREE.PlaneGeometry(20, 10)
  const wallGeo3 = new THREE.PlaneGeometry(20, 10)

  const backWall = new THREE.Mesh(wallGeo1, wallMat)
  backWall.position.set(0, 2, -8)
  envScene.add(backWall)

  const sideWall1 = new THREE.Mesh(wallGeo2, wallMat)
  sideWall1.position.set(8, 2, 0)
  sideWall1.rotation.y = -Math.PI / 2
  envScene.add(sideWall1)

  const sideWall2 = new THREE.Mesh(wallGeo3, wallMat)
  sideWall2.position.set(-8, 2, 0)
  sideWall2.rotation.y = Math.PI / 2
  envScene.add(sideWall2)

  const texture = pmremGenerator.fromScene(envScene).texture

  // Dispose all temporary geometries and materials
  pmremGenerator.dispose()
  groundGeo.dispose()
  groundMat.dispose()
  ceilingGeo.dispose()
  ceilingMat.dispose()
  panelGeo.dispose()
  panelGeo2.dispose()
  panelGeo3.dispose()
  panelGeo4.dispose()
  panelMat.dispose()
  wallGeo1.dispose()
  wallGeo2.dispose()
  wallGeo3.dispose()
  wallMat.dispose()

  return {
    texture,
    dispose: () => {
      texture.dispose()
    }
  }
}

/**
 * Creates an EffectComposer with color grading and vignette post-processing.
 * Matches the Studio's visual appearance for consistent rendering.
 *
 * @param {THREE.WebGLRenderer} renderer - The WebGL renderer
 * @param {THREE.Scene} scene - The scene to render
 * @param {THREE.Camera} camera - The camera to use
 * @param {Object} options - Optional settings (can pass pipeline.colorGrading)
 * @param {number} options.saturation - Color saturation (default: 0.85)
 * @param {number} options.shadowLift - Shadow lift to prevent pure blacks (default: 0.08)
 * @param {number} options.vignetteDarkness - Vignette edge darkness (default: 0.15)
 * @returns {{ composer: EffectComposer, setSize: Function, dispose: Function }}
 */
export function createPostProcessingComposer(renderer, scene, camera, options = {}) {
  const saturation = options.saturation ?? 0.85
  const shadowLift = options.shadowLift ?? 0.08  // Studio default from SettingsModal
  const vignetteDarkness = options.vignetteDarkness ?? 0.15
  const msaaSamples = options.msaaSamples ?? 4  // Default 4x MSAA, use 0 for performance

  // Create render target with configurable MSAA
  // Use getDrawingBufferSize to get the actual pixel dimensions (accounts for devicePixelRatio)
  const size = renderer.getDrawingBufferSize(new THREE.Vector2())
  const renderTarget = new THREE.WebGLRenderTarget(size.width, size.height, {
    samples: msaaSamples,
    type: THREE.HalfFloatType
  })

  const composer = new EffectComposer(renderer, renderTarget)

  // Render pass - captures the scene
  const renderPass = new RenderPass(scene, camera)
  composer.addPass(renderPass)

  // Color grading pass - saturation and shadow lift
  const colorGradingPass = new ShaderPass(ColorGradingShader)
  colorGradingPass.uniforms.saturation.value = saturation
  colorGradingPass.uniforms.shadowLift.value = shadowLift
  composer.addPass(colorGradingPass)

  // Vignette pass - subtle edge darkening
  const vignettePass = new ShaderPass(VignetteShader)
  vignettePass.uniforms.darkness.value = vignetteDarkness
  composer.addPass(vignettePass)

  return {
    composer,
    setSize: (width, height) => {
      composer.setSize(width, height)
    },
    dispose: () => {
      composer.dispose()
      renderTarget.dispose()
    }
  }
}
