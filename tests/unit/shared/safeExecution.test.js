// tests/unit/shared/safeExecution.test.js
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'

describe('safeExecution', () => {
  describe('executeAssetCode', () => {
    it('returns THREE.Group for valid asset code', async () => {
      const { executeAssetCode } = await import('../../../src/shared/safeExecution.js')
      const validCode = `
        export function createAsset(THREE) {
          const group = new THREE.Group()
          group.add(new THREE.Mesh(
            new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshStandardMaterial({ color: 0xff0000 })
          ))
          return group
        }
      `
      const result = await executeAssetCode(validCode, THREE)
      expect(result.success).toBe(true)
      expect(result.asset).toBeInstanceOf(THREE.Group)
    })

    it('rejects unsafe code with localStorage access', async () => {
      const { executeAssetCode } = await import('../../../src/shared/safeExecution.js')
      const unsafeCode = `
        export function createAsset(THREE) {
          localStorage.setItem('stolen', 'data')
          return new THREE.Group()
        }
      `
      const result = await executeAssetCode(unsafeCode, THREE)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Storage access not allowed')
    })

    it('rejects code with infinite loop via static analysis', async () => {
      const { executeAssetCode } = await import('../../../src/shared/safeExecution.js')
      const slowCode = `
        export function createAsset(THREE) {
          while(true) {} // Infinite loop
          return new THREE.Group()
        }
      `
      const result = await executeAssetCode(slowCode, THREE, { timeoutMs: 50 })
      expect(result.success).toBe(false)
      expect(result.error).toContain('Infinite loop')
    })

    it('rejects code with fetch calls', async () => {
      const { executeAssetCode } = await import('../../../src/shared/safeExecution.js')
      const networkCode = `
        export function createAsset(THREE) {
          fetch('https://evil.com')
          return new THREE.Group()
        }
      `
      const result = await executeAssetCode(networkCode, THREE)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Network')
    })

    it('rejects code that returns null', async () => {
      const { executeAssetCode } = await import('../../../src/shared/safeExecution.js')
      const nullCode = `
        function createAsset(THREE) {
          return null
        }
      `
      const result = await executeAssetCode(nullCode, THREE)
      expect(result.success).toBe(false)
      expect(result.error).toContain('must return a THREE.Object3D')
    })

    it('rejects code missing createAsset function', async () => {
      const { executeAssetCode } = await import('../../../src/shared/safeExecution.js')
      const missingCode = `
        function someOtherFunction(THREE) {
          return new THREE.Group()
        }
      `
      const result = await executeAssetCode(missingCode, THREE)
      expect(result.success).toBe(false)
      expect(result.error).toContain('createAsset function not found')
    })

    it('handles export with leading comments', async () => {
      const { executeAssetCode } = await import('../../../src/shared/safeExecution.js')
      const codeWithComments = `
        // This is a comment
        /* Multi-line
           comment */
        export function createAsset(THREE) {
          return new THREE.Group()
        }
      `
      const result = await executeAssetCode(codeWithComments, THREE)
      expect(result.success).toBe(true)
      expect(result.asset).toBeInstanceOf(THREE.Group)
    })
  })
})
