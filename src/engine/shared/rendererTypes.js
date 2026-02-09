/**
 * @fileoverview JSDoc type definitions for WorldRenderer subsystems.
 * Provides shared type contracts for constructor injection pattern.
 */

/**
 * Shared state passed to all subsystems via constructor injection.
 * Contains Three.js core objects needed by multiple subsystems.
 * @typedef {Object} SharedRendererState
 * @property {THREE.Scene} scene - The Three.js scene
 * @property {THREE.PerspectiveCamera} camera - The main camera
 * @property {THREE.WebGLRenderer} renderer - The WebGL renderer
 * @property {HTMLElement} container - The DOM container element
 * @property {OrbitControls} orbitControls - Camera orbit controls
 * @property {boolean} darkMode - Current dark mode state
 * @property {boolean} isDisposed - Whether renderer has been disposed
 */

/**
 * Render options for controlling visual effects.
 * @typedef {Object} RenderOptions
 * @property {string} environment - Environment map type ('none' | 'room' | 'neutral')
 * @property {boolean} postProcessing - Whether post-processing is enabled
 * @property {number} lightIntensityScale - Global light intensity multiplier
 * @property {number} frontFillIntensity - Front fill light intensity
 * @property {number} rimFillIntensity - Rim/back fill light intensity
 */

/**
 * Transform update object for instance transforms.
 * @typedef {Object} TransformUpdate
 * @property {number[]} [position] - [x, y, z] world position
 * @property {number} [rotation] - Y-axis rotation in radians
 * @property {number} [scale] - Uniform scale factor
 */

/**
 * Raycast hit result for instance picking.
 * @typedef {Object} RaycastHit
 * @property {'instance' | 'terrain'} type - What was hit
 * @property {string} [instanceId] - Instance ID if type is 'instance'
 * @property {number} [tileX] - Terrain tile X if type is 'terrain'
 * @property {number} [tileZ] - Terrain tile Z if type is 'terrain'
 * @property {THREE.Vector3} point - World position of hit
 * @property {Object} [cycleInfo] - Selection cycling info for overlapping instances
 * @property {Array} [allHits] - All overlapping instance hits
 */

/**
 * Part tweak definition for modifying asset sub-parts.
 * @typedef {Object} PartTweak
 * @property {string} name - Part name to modify
 * @property {number[]} [position] - [x, y, z] local position offset
 * @property {number[]} [rotation] - [x, y, z] rotation in degrees
 * @property {number[]} [scale] - [x, y, z] scale factors
 */

/**
 * Selectable part from asset hierarchy.
 * @typedef {Object} SelectablePart
 * @property {THREE.Object3D} object - The part object
 * @property {number} depth - Depth in hierarchy from root
 * @property {'group' | 'mesh'} type - Part type
 * @property {string} displayName - Unique display name
 * @property {boolean} fromUserData - Whether found in userData.parts
 */

export {}
