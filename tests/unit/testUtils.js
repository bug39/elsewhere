/**
 * Shared test utilities for unit tests
 *
 * Provides mock factories and helpers for:
 * - WorldRenderer mocking
 * - World state mocking
 * - Selection state mocking
 * - Keyboard event simulation
 * - Timer helpers for async testing
 */

import { vi } from 'vitest'

// ================================
// Mock Factories
// ================================

/**
 * Create a mock WorldRenderer ref
 * @param {Object} overrides - Override specific methods or properties
 * @returns {{ current: Object }}
 */
export function createMockRendererRef(overrides = {}) {
  return {
    current: {
      scene: {
        add: vi.fn(),
        remove: vi.fn()
      },
      camera: {
        position: { set: vi.fn(), x: 0, y: 50, z: 100 },
        lookAt: vi.fn()
      },
      orbitControls: {
        enabled: true,
        target: { set: vi.fn() }
      },
      playMode: false,
      playModeUpdate: null,
      focusOnInstance: vi.fn(),
      resetCamera: vi.fn(),
      setTransformMode: vi.fn(),
      setSnappingActive: vi.fn(),
      setGroundConstraintActive: vi.fn(),
      clearPartSelection: vi.fn(),
      ...overrides
    }
  }
}

/**
 * Create a mock world state object
 * @param {Object} overrides - Override specific properties
 * @returns {Object}
 */
export function createMockWorld(overrides = {}) {
  const defaultAssets = [
    { id: 'lib_1', name: 'Dragon', generatedCode: 'code', category: 'creatures' },
    { id: 'lib_2', name: 'Tree', generatedCode: 'code', category: 'nature' }
  ]

  const defaultInstances = [
    { instanceId: 'inst_1', libraryId: 'lib_1', position: [100, 0, 100], rotation: 0, scale: 10 },
    { instanceId: 'inst_2', libraryId: 'lib_2', position: [150, 0, 150], rotation: 0, scale: 10 }
  ]

  return {
    data: {
      meta: { id: 'world_test', name: 'Test World' },
      terrain: {
        biome: 'grass',
        heightmap: Array(20).fill(null).map(() => Array(20).fill(0)),
        texturemap: Array(20).fill(null).map(() => Array(20).fill(0))
      },
      library: overrides.library ?? defaultAssets,
      placedAssets: overrides.placedAssets ?? defaultInstances,
      ...overrides.data
    },
    isDirty: false,
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    save: vi.fn().mockResolvedValue({ success: true }),
    placeInstance: vi.fn().mockReturnValue('inst_new'),
    updateInstance: vi.fn(),
    deleteInstance: vi.fn(),
    addLibraryAsset: vi.fn(),
    removeLibraryAsset: vi.fn(),
    updateLibraryPartTweaks: vi.fn(),
    updateInstancePartTweaks: vi.fn(),
    ...overrides
  }
}

/**
 * Create a mock selection state object
 * @param {string|null} instanceId - Currently selected instance ID
 * @param {Object} overrides - Override specific properties
 * @returns {Object}
 */
export function createMockSelection(instanceId = null, overrides = {}) {
  return {
    libraryAssetId: null,
    instanceId,
    partName: null,
    selectionType: instanceId ? 'instance' : null,
    selectLibraryAsset: vi.fn(),
    selectInstance: vi.fn(),
    selectPart: vi.fn(),
    clearPartSelection: vi.fn(),
    clear: vi.fn(),
    ...overrides
  }
}

// ================================
// Event Simulation
// ================================

/**
 * Simulate a keydown event
 * @param {string} key - Key value (e.g., 'Tab', 'Enter', 'a')
 * @param {Object} options - Event options
 * @returns {KeyboardEvent}
 */
export function simulateKeyDown(key, options = {}) {
  const {
    shiftKey = false,
    ctrlKey = false,
    metaKey = false,
    altKey = false,
    code = getKeyCode(key),
    target = document.body,
    preventDefault = vi.fn(),
    stopPropagation = vi.fn()
  } = options

  const event = new KeyboardEvent('keydown', {
    key,
    code,
    shiftKey,
    ctrlKey,
    metaKey,
    altKey,
    bubbles: true,
    cancelable: true
  })

  // Add target property (not settable in constructor)
  Object.defineProperty(event, 'target', {
    value: target,
    writable: false
  })

  // Override preventDefault/stopPropagation for testing
  event.preventDefault = preventDefault
  event.stopPropagation = stopPropagation

  window.dispatchEvent(event)
  return event
}

/**
 * Simulate a keyup event
 * @param {string} key - Key value
 * @param {Object} options - Event options
 * @returns {KeyboardEvent}
 */
export function simulateKeyUp(key, options = {}) {
  const {
    shiftKey = false,
    ctrlKey = false,
    metaKey = false,
    altKey = false,
    code = getKeyCode(key)
  } = options

  const event = new KeyboardEvent('keyup', {
    key,
    code,
    shiftKey,
    ctrlKey,
    metaKey,
    altKey,
    bubbles: true,
    cancelable: true
  })

  window.dispatchEvent(event)
  return event
}

/**
 * Get the code value for a key
 * @param {string} key
 * @returns {string}
 */
function getKeyCode(key) {
  const codeMap = {
    'Tab': 'Tab',
    'Enter': 'Enter',
    'Escape': 'Escape',
    'Space': 'Space',
    ' ': 'Space',
    'Shift': 'ShiftLeft',
    'Control': 'ControlLeft',
    'Alt': 'AltLeft',
    'Meta': 'MetaLeft',
    'Delete': 'Delete',
    'Backspace': 'Backspace',
    'Home': 'Home',
    'F5': 'F5',
    '?': 'Slash',
    '/': 'Slash'
  }

  if (codeMap[key]) return codeMap[key]
  if (key.length === 1) {
    if (/[a-z]/i.test(key)) return `Key${key.toUpperCase()}`
    if (/[0-9]/.test(key)) return `Digit${key}`
  }
  return key
}

// ================================
// Timer Helpers
// ================================

/**
 * Advance fake timers by specified milliseconds
 * @param {number} ms - Milliseconds to advance
 */
export async function advanceTimers(ms) {
  await vi.advanceTimersByTimeAsync(ms)
}

/**
 * Run all pending timers
 */
export async function runAllTimers() {
  await vi.runAllTimersAsync()
}

/**
 * Flush all pending promises
 */
export function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

// ================================
// Three.js Mocks
// ================================

/**
 * Create a mock THREE.Group
 * @returns {Object}
 */
export function createMockThreeGroup() {
  return {
    position: { set: vi.fn(), x: 0, y: 0, z: 0 },
    rotation: { set: vi.fn(), x: 0, y: 0, z: 0 },
    scale: { setScalar: vi.fn(), set: vi.fn() },
    add: vi.fn(),
    remove: vi.fn(),
    traverse: vi.fn(),
    userData: {},
    castShadow: false
  }
}

/**
 * Create a mock PlayerController
 * @returns {Object}
 */
export function createMockPlayerController() {
  return {
    setMesh: vi.fn(),
    setRenderer: vi.fn(),
    snapCameraToPosition: vi.fn(),
    update: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    resetKeys: vi.fn(),
    dispose: vi.fn()
  }
}

/**
 * Create a mock NPCController
 * @returns {Object}
 */
export function createMockNPCController() {
  return {
    setRenderer: vi.fn(),
    update: vi.fn(),
    clear: vi.fn()
  }
}

// ================================
// DOM Test Helpers
// ================================

/**
 * Create a mock input element target
 * @param {string} tagName - 'INPUT', 'TEXTAREA', or 'DIV'
 * @param {Object} options - Additional options
 * @returns {Object}
 */
export function createMockTarget(tagName, options = {}) {
  return {
    tagName,
    isContentEditable: options.contentEditable || false,
    focus: vi.fn(),
    blur: vi.fn()
  }
}

/**
 * Create a focusable element mock
 * @param {string} type - Element type
 * @returns {Object}
 */
export function createFocusableElement(type = 'button') {
  const element = document.createElement(type)
  element.setAttribute('tabindex', '0')
  return element
}
