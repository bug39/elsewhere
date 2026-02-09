/**
 * Centralized safe asset code execution.
 * 
 * Combines static analysis (validateCodeSafety) with timeout protection.
 * Use this for ALL preview/execution of generated asset code.
 */

import { validateCodeSafety, executeWithTimeout } from '../generator/CodeSandbox.js'

const DEFAULT_TIMEOUT_MS = 5000

/**
 * Safely execute asset code and return a THREE.Group.
 * 
 * @param {string} code - Generated asset code with createAsset function
 * @param {object} THREE - Three.js library object
 * @param {object} options - Execution options
 * @param {number} options.timeoutMs - Timeout in milliseconds (default: 5000)
 * @returns {Promise<{success: boolean, asset?: THREE.Group, error?: string}>}
 */
export async function executeAssetCode(code, THREE, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS } = options

  // Step 1: Static analysis
  const safetyResult = validateCodeSafety(code)
  if (!safetyResult.valid) {
    return { success: false, error: safetyResult.error }
  }

  // Step 2: Prepare executable - strip export keyword anywhere in code
  const cleanCode = code.replace(/\bexport\s+(function|const|let|var|class|default)\b/g, '$1')
  const wrappedCode = `
    return (function(THREE) {
      ${cleanCode}
      return typeof createAsset === 'function' ? createAsset : null;
    })
  `

  // Step 3: Execute with timeout
  try {
    const asset = await executeWithTimeout(() => {
      const createModule = new Function(wrappedCode)()
      const createAsset = createModule(THREE)
      if (typeof createAsset !== 'function') {
        throw new Error('createAsset function not found')
      }
      const result = createAsset(THREE)
      if (!result || typeof result !== 'object' || typeof result.isObject3D === 'undefined') {
        throw new Error('createAsset must return a THREE.Object3D')
      }
      return result
    }, timeoutMs)

    return { success: true, asset }
  } catch (err) {
    return { success: false, error: err.message }
  }
}
