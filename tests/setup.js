/**
 * Test setup file for Vitest
 *
 * Configures mocks and global test utilities:
 * - fake-indexeddb for IndexedDB mocking
 * - localStorage mock
 * - WebGL context mock
 * - Performance API mock
 */

import { beforeAll, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'

// Mock localStorage
const localStorageMock = (() => {
  let store = {}
  return {
    getItem: vi.fn((key) => store[key] ?? null),
    setItem: vi.fn((key, value) => {
      store[key] = String(value)
    }),
    removeItem: vi.fn((key) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
    get length() {
      return Object.keys(store).length
    },
    key: vi.fn((index) => {
      return Object.keys(store)[index] ?? null
    })
  }
})()

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true
})

// Mock sessionStorage (same implementation)
Object.defineProperty(globalThis, 'sessionStorage', {
  value: localStorageMock,
  writable: true
})

// Mock navigator.storage for quota checking
Object.defineProperty(globalThis, 'navigator', {
  value: {
    ...globalThis.navigator,
    storage: {
      estimate: vi.fn().mockResolvedValue({
        usage: 1000000,
        quota: 100000000
      }),
      persist: vi.fn().mockResolvedValue(true),
      persisted: vi.fn().mockResolvedValue(false)
    },
    sendBeacon: vi.fn().mockReturnValue(true)
  },
  writable: true
})

// Mock requestAnimationFrame
globalThis.requestAnimationFrame = vi.fn((callback) => {
  return setTimeout(() => callback(performance.now()), 16)
})

globalThis.cancelAnimationFrame = vi.fn((id) => {
  clearTimeout(id)
})

// Mock ResizeObserver
globalThis.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn()
}))

// Mock IntersectionObserver
globalThis.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn()
}))

// Mock WebGL context for Three.js tests
const mockWebGLContext = {
  getParameter: vi.fn().mockReturnValue('Mock WebGL'),
  getExtension: vi.fn().mockReturnValue(null),
  createShader: vi.fn().mockReturnValue({}),
  shaderSource: vi.fn(),
  compileShader: vi.fn(),
  getShaderParameter: vi.fn().mockReturnValue(true),
  createProgram: vi.fn().mockReturnValue({}),
  attachShader: vi.fn(),
  linkProgram: vi.fn(),
  getProgramParameter: vi.fn().mockReturnValue(true),
  useProgram: vi.fn(),
  createBuffer: vi.fn().mockReturnValue({}),
  bindBuffer: vi.fn(),
  bufferData: vi.fn(),
  createTexture: vi.fn().mockReturnValue({}),
  bindTexture: vi.fn(),
  texImage2D: vi.fn(),
  texParameteri: vi.fn(),
  viewport: vi.fn(),
  clear: vi.fn(),
  clearColor: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  blendFunc: vi.fn(),
  depthFunc: vi.fn(),
  cullFace: vi.fn(),
  frontFace: vi.fn(),
  drawArrays: vi.fn(),
  drawElements: vi.fn(),
  getUniformLocation: vi.fn().mockReturnValue({}),
  getAttribLocation: vi.fn().mockReturnValue(0),
  enableVertexAttribArray: vi.fn(),
  vertexAttribPointer: vi.fn(),
  uniform1f: vi.fn(),
  uniform1i: vi.fn(),
  uniform2f: vi.fn(),
  uniform3f: vi.fn(),
  uniform4f: vi.fn(),
  uniformMatrix4fv: vi.fn(),
  createFramebuffer: vi.fn().mockReturnValue({}),
  bindFramebuffer: vi.fn(),
  framebufferTexture2D: vi.fn(),
  checkFramebufferStatus: vi.fn().mockReturnValue(36053), // FRAMEBUFFER_COMPLETE
  deleteShader: vi.fn(),
  deleteProgram: vi.fn(),
  deleteBuffer: vi.fn(),
  deleteTexture: vi.fn(),
  deleteFramebuffer: vi.fn(),
  getError: vi.fn().mockReturnValue(0),
  pixelStorei: vi.fn(),
  activeTexture: vi.fn(),
  generateMipmap: vi.fn(),
  isContextLost: vi.fn().mockReturnValue(false),
  canvas: { width: 800, height: 600 }
}

// Mock canvas getContext
HTMLCanvasElement.prototype.getContext = vi.fn(function(type) {
  if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
    return mockWebGLContext
  }
  if (type === '2d') {
    return {
      fillRect: vi.fn(),
      clearRect: vi.fn(),
      getImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(4) }),
      putImageData: vi.fn(),
      createImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(4) }),
      setTransform: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      rotate: vi.fn(),
      translate: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn().mockReturnValue({ width: 10 }),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      arc: vi.fn(),
      rect: vi.fn()
    }
  }
  return null
})

// Mock URL.createObjectURL and revokeObjectURL
globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url')
globalThis.URL.revokeObjectURL = vi.fn()

// Mock fetch for API tests
globalThis.fetch = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  json: vi.fn().mockResolvedValue({}),
  text: vi.fn().mockResolvedValue(''),
  blob: vi.fn().mockResolvedValue(new Blob())
})

// Mock console methods for cleaner test output (but still capture calls)
const originalConsole = { ...console }
beforeAll(() => {
  // Keep console methods but spy on them
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

// Clear mocks after each test
afterEach(() => {
  vi.clearAllMocks()
  localStorageMock.clear()
})

// Export utilities for tests
export const mockUtils = {
  localStorage: localStorageMock,
  webglContext: mockWebGLContext,
  originalConsole
}
