/**
 * Static analysis sandbox for validating generated code before execution.
 *
 * This provides a basic security layer by rejecting code that contains
 * known dangerous patterns. Note: This is static analysis only and can
 * be bypassed with obfuscation - suitable for demo scope.
 */

/**
 * Normalize code by decoding unicode and hex escapes for pattern matching.
 * This prevents bypass via `\u006c\u006f\u0063\u0061\u006c` etc.
 */
function normalizeCode(code) {
  if (!code || typeof code !== 'string') return ''

  // Decode unicode escapes (\uXXXX)
  let normalized = code.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  )

  // P1-002 FIX: Decode extended unicode escapes (\u{XXXXX})
  normalized = normalized.replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, hex) =>
    String.fromCodePoint(parseInt(hex, 16))
  )

  // Decode hex escapes (\xXX)
  normalized = normalized.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  )

  // Remove whitespace between string concatenation to detect 'local'+'Storage'
  // This transforms `'lo' + 'cal' + 'Sto' + 'rage'` to `'lo'+'cal'+'Sto'+'rage'`
  normalized = normalized.replace(/['"`]\s*\+\s*['"`]/g, match =>
    match.replace(/\s+/g, '')
  )

  return normalized
}

/**
 * Check for string concatenation that builds dangerous identifiers.
 * Detects patterns like 'local'+'Storage' or multi-part 'lo'+'ca'+'l'+'Storage'
 *
 * H4 FIX: Now detects 3+ part string concatenation, not just 2-part splits.
 */
function checkStringConcatenation(code) {
  const dangerousNames = [
    'localStorage', 'sessionStorage', 'document', 'window', 'eval',
    'Function', 'globalThis', 'fetch', 'XMLHttpRequest', 'WebSocket',
    'importScripts', 'constructor', 'prototype', '__proto__'
  ]

  // Remove all whitespace around + operators between strings
  const condensed = code.replace(/['"`]\s*\+\s*['"`]/g, "'+'" )

  // H4 FIX: Extract all string concatenation chains and check if they form dangerous names
  // Match sequences of quoted strings connected by +
  // Pattern: captures chains like 'a'+'b'+'c' or "a"+"b"+"c"
  const concatChainRegex = /(['"`])([^'"`]*)\1(?:\s*\+\s*(['"`])([^'"`]*)\3)+/g
  let match
  while ((match = concatChainRegex.exec(condensed)) !== null) {
    // Extract all parts from the chain
    const chainStr = match[0]
    const parts = []
    const partRegex = /(['"`])([^'"`]*)\1/g
    let partMatch
    while ((partMatch = partRegex.exec(chainStr)) !== null) {
      parts.push(partMatch[2])
    }

    // Concatenate all parts and check against dangerous names
    const assembled = parts.join('')
    for (const name of dangerousNames) {
      if (assembled === name || assembled.toLowerCase() === name.toLowerCase()) {
        return { blocked: true, reason: `String concatenation builds dangerous identifier: ${name}` }
      }
    }
  }

  // Also check single 2-part splits (original logic, for simple cases)
  for (const name of dangerousNames) {
    for (let splitPoint = 1; splitPoint < name.length; splitPoint++) {
      const part1 = name.slice(0, splitPoint)
      const part2 = name.slice(splitPoint)
      const patterns = [
        `'${part1}'+'${part2}'`,
        `"${part1}"+"${part2}"`,
        `'${part1}'+"${part2}"`,
        `"${part1}"+'${part2}'`
      ]
      for (const pattern of patterns) {
        if (condensed.includes(pattern)) {
          return { blocked: true, reason: `String concatenation builds dangerous identifier: ${name}` }
        }
      }
    }
  }

  return { blocked: false }
}

/**
 * P1-002 FIX: Check for template literals that build dangerous identifiers.
 * Detects patterns like `${'local'}${'Storage'}` or `${"eval"}`
 */
function checkTemplateLiterals(code) {
  const dangerousNames = [
    'localStorage', 'sessionStorage', 'document', 'window', 'eval',
    'Function', 'globalThis', 'fetch', 'XMLHttpRequest', 'WebSocket'
  ]

  // Match template literals containing interpolations
  const templateRegex = /`[^`]*\$\{[^}]+\}[^`]*`/g
  const templates = code.match(templateRegex) || []

  for (const template of templates) {
    // Extract string literals from interpolation expressions: ${'str'} or ${"str"}
    const exprRegex = /\$\{\s*(['"`])([^'"`]*)\1\s*\}/g
    const parts = []
    let match
    while ((match = exprRegex.exec(template)) !== null) {
      parts.push(match[2])
    }

    // Also extract literal parts between interpolations
    const literalParts = template.replace(/\$\{[^}]+\}/g, '|SPLIT|').split('|SPLIT|')
    const allParts = []
    for (let i = 0; i < literalParts.length; i++) {
      // Remove backticks from first/last parts
      let lit = literalParts[i].replace(/^`|`$/g, '')
      if (lit) allParts.push(lit)
      if (i < parts.length) allParts.push(parts[i])
    }

    const assembled = allParts.join('')
    for (const name of dangerousNames) {
      if (assembled.toLowerCase() === name.toLowerCase()) {
        return { blocked: true, reason: `Template literal builds dangerous identifier: ${name}` }
      }
    }
  }
  return { blocked: false }
}

const DANGEROUS_PATTERNS = [
  { pattern: /\bfetch\s*\(/, reason: 'Network requests not allowed' },
  { pattern: /\bXMLHttpRequest\b/, reason: 'Network requests not allowed' },
  { pattern: /\blocalStorage\b/, reason: 'Storage access not allowed' },
  { pattern: /\bsessionStorage\b/, reason: 'Storage access not allowed' },
  { pattern: /\bdocument\s*\./, reason: 'DOM access not allowed' },
  { pattern: /\bwindow\s*\./, reason: 'Window access not allowed' },
  { pattern: /\beval\s*\(/, reason: 'eval not allowed' },
  { pattern: /\bFunction\s*\(/, reason: 'Function constructor not allowed' },
  { pattern: /\bimport\s*\(/, reason: 'Dynamic import not allowed' },
  { pattern: /\bwhile\s*\(\s*true\s*\)/, reason: 'Infinite loop detected' },
  { pattern: /\bfor\s*\(\s*;\s*;\s*\)/, reason: 'Infinite loop detected' },
  { pattern: /\bsetInterval\s*\(/, reason: 'setInterval not allowed' },
  { pattern: /\bsetTimeout\s*\(/, reason: 'setTimeout not allowed' },
  { pattern: /\bglobalThis\b/, reason: 'globalThis access not allowed' },
  { pattern: /\bself\b/, reason: 'self access not allowed' },
  { pattern: /\bimportScripts\s*\(/, reason: 'importScripts not allowed' },
  { pattern: /\bWebSocket\b/, reason: 'WebSocket not allowed' },
  { pattern: /\bWorker\s*\(/, reason: 'Web Workers not allowed' },
  { pattern: /\bSharedWorker\s*\(/, reason: 'SharedWorker not allowed' },
  { pattern: /\bServiceWorker\b/, reason: 'ServiceWorker not allowed' },
  { pattern: /\bIndexedDB\b/, reason: 'IndexedDB not allowed' },
  { pattern: /\bcookies?\b/i, reason: 'Cookie access not allowed' },
  // Prevent array assignment to transform properties (causes performance issues)
  { pattern: /\.rotation\s*=\s*\[/, reason: 'Array assigned to rotation - use .set() or .y = value' },
  { pattern: /\.scale\s*=\s*\[/, reason: 'Array assigned to scale - use .set() or .setScalar()' },
  // Prototype chain and constructor access (bypass prevention)
  { pattern: /\bconstructor\s*\[/, reason: 'Constructor bracket access not allowed' },
  { pattern: /\[\s*['"`]constructor['"`]\s*\]/, reason: 'Constructor property access not allowed' },
  { pattern: /\.__proto__\b/, reason: '__proto__ access not allowed' },
  { pattern: /\[\s*['"`]__proto__['"`]\s*\]/, reason: '__proto__ access not allowed' },
  { pattern: /\.prototype\s*\[/, reason: 'Prototype bracket access not allowed' },
  { pattern: /\[\s*['"`]prototype['"`]\s*\]/, reason: 'Prototype property access not allowed' },
  // Bracket notation access to dangerous globals
  { pattern: /\[\s*['"`]localStorage['"`]\s*\]/, reason: 'localStorage bracket access not allowed' },
  { pattern: /\[\s*['"`]sessionStorage['"`]\s*\]/, reason: 'sessionStorage bracket access not allowed' },
  { pattern: /\[\s*['"`]eval['"`]\s*\]/, reason: 'eval bracket access not allowed' },
  { pattern: /\[\s*['"`]Function['"`]\s*\]/, reason: 'Function bracket access not allowed' },
  { pattern: /\[\s*['"`]fetch['"`]\s*\]/, reason: 'fetch bracket access not allowed' },
  // this.constructor chain (common sandbox escape)
  { pattern: /this\s*\.\s*constructor\s*\.\s*constructor/, reason: 'Constructor chain access not allowed' },
  // Reflect API (can bypass proxies)
  { pattern: /\bReflect\s*\./, reason: 'Reflect API not allowed' },
  { pattern: /\bProxy\s*\(/, reason: 'Proxy constructor not allowed' },
  // Object property manipulation
  { pattern: /Object\s*\.\s*defineProperty/, reason: 'Object.defineProperty not allowed' },
  { pattern: /Object\s*\.\s*setPrototypeOf/, reason: 'Object.setPrototypeOf not allowed' },
  { pattern: /Object\s*\.\s*getOwnPropertyDescriptor/, reason: 'Object.getOwnPropertyDescriptor not allowed' },
  // P1-002 FIX: Block character code methods (used to build dangerous identifiers)
  { pattern: /String\s*\.\s*fromCharCode\s*\(/, reason: 'String.fromCharCode not allowed' },
  { pattern: /String\s*\.\s*fromCodePoint\s*\(/, reason: 'String.fromCodePoint not allowed' },
]

/**
 * Validate code safety by checking for dangerous patterns.
 *
 * @param {string} code - The code to validate
 * @returns {{ valid: boolean, error?: string }} Validation result
 */
export function validateCodeSafety(code) {
  if (!code || typeof code !== 'string') {
    return { valid: false, error: 'Code must be a non-empty string' }
  }

  // Normalize code to catch unicode/hex escape bypasses
  const normalized = normalizeCode(code)

  // Check each dangerous pattern against both original and normalized code
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(code) || pattern.test(normalized)) {
      return {
        valid: false,
        error: `Unsafe code detected: ${reason}`
      }
    }
  }

  // Check for string concatenation bypasses
  const concatCheck = checkStringConcatenation(code)
  if (concatCheck.blocked) {
    return {
      valid: false,
      error: `Unsafe code detected: ${concatCheck.reason}`
    }
  }

  // Also check normalized version for concatenation
  const normalizedConcatCheck = checkStringConcatenation(normalized)
  if (normalizedConcatCheck.blocked) {
    return {
      valid: false,
      error: `Unsafe code detected: ${normalizedConcatCheck.reason}`
    }
  }

  // P1-002 FIX: Check for template literal bypasses
  const templateCheck = checkTemplateLiterals(code)
  if (templateCheck.blocked) {
    return { valid: false, error: `Unsafe code detected: ${templateCheck.reason}` }
  }

  // Also check normalized version for template literals
  const normalizedTemplateCheck = checkTemplateLiterals(normalized)
  if (normalizedTemplateCheck.blocked) {
    return { valid: false, error: `Unsafe code detected: ${normalizedTemplateCheck.reason}` }
  }

  return { valid: true }
}

/**
 * Assert that code is safe, throwing an error if not.
 *
 * @param {string} code - The code to validate
 * @throws {Error} If the code fails safety validation
 */
export function assertCodeSafety(code) {
  const result = validateCodeSafety(code)
  if (!result.valid) {
    throw new Error(result.error)
  }
}

/**
 * Default timeout for code execution (5 seconds)
 */
const EXECUTION_TIMEOUT_MS = 5000

/**
 * Execute a function with a timeout. If the function doesn't complete
 * within the timeout, the promise rejects with a timeout error.
 *
 * Note: This cannot actually interrupt running JavaScript - it only
 * rejects the promise after the timeout. For true cancellation of
 * synchronous code, a Web Worker would be needed. This is sufficient
 * for detecting slow code and showing an error to the user.
 *
 * @param {Function} fn - The function to execute (should be synchronous)
 * @param {number} [timeoutMs=5000] - Timeout in milliseconds
 * @returns {Promise<any>} Resolves with the function result or rejects on timeout/error
 */
export function executeWithTimeout(fn, timeoutMs = EXECUTION_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let completed = false

    const timeoutId = setTimeout(() => {
      if (!completed) {
        completed = true
        reject(new Error('The generated model is too complex. Try a simpler description.'))
      }
    }, timeoutMs)

    // Use setTimeout(0) to allow the timeout to be set up before execution
    // This gives the timeout a chance to fire if the sync code blocks
    setTimeout(() => {
      if (completed) return

      try {
        const result = fn()
        if (!completed) {
          completed = true
          clearTimeout(timeoutId)
          resolve(result)
        }
      } catch (err) {
        if (!completed) {
          completed = true
          clearTimeout(timeoutId)
          reject(err)
        }
      }
    }, 0)
  })
}
