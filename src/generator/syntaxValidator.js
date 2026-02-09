/**
 * String-aware syntax validation for generated code.
 *
 * Validates delimiter balance (parens, brackets, braces) while ignoring
 * delimiters inside strings, template literals, and comments.
 */

/**
 * Count balanced delimiters, ignoring those inside strings/comments.
 *
 * @param {string} code - The code to analyze
 * @returns {{ parens: { open: number, close: number }, brackets: { open: number, close: number }, braces: { open: number, close: number } }}
 */
export function countDelimiters(code) {
  const counts = {
    parens: { open: 0, close: 0 },
    brackets: { open: 0, close: 0 },
    braces: { open: 0, close: 0 }
  }

  let i = 0
  const len = code.length

  while (i < len) {
    const char = code[i]
    const next = code[i + 1]

    // Single-line comment: skip to end of line
    if (char === '/' && next === '/') {
      i += 2
      while (i < len && code[i] !== '\n') i++
      continue
    }

    // Multi-line comment: skip to */
    if (char === '/' && next === '*') {
      i += 2
      while (i < len - 1 && !(code[i] === '*' && code[i + 1] === '/')) i++
      i += 2
      continue
    }

    // Single or double quoted string: skip to closing quote
    if (char === '"' || char === "'") {
      const quote = char
      i++
      while (i < len) {
        if (code[i] === '\\') {
          i += 2 // Skip escaped character
          continue
        }
        if (code[i] === quote) {
          i++
          break
        }
        i++
      }
      continue
    }

    // Template literal: skip, handling nested ${...}
    if (char === '`') {
      i++
      let templateDepth = 1
      while (i < len && templateDepth > 0) {
        if (code[i] === '\\') {
          i += 2
          continue
        }
        if (code[i] === '`') {
          templateDepth--
          i++
          continue
        }
        // Handle ${...} interpolation - we need to track brace depth within
        if (code[i] === '$' && code[i + 1] === '{') {
          i += 2
          let braceDepth = 1
          while (i < len && braceDepth > 0) {
            if (code[i] === '\\') {
              i += 2
              continue
            }
            // Handle nested strings within interpolation
            if (code[i] === '"' || code[i] === "'") {
              const q = code[i]
              i++
              while (i < len) {
                if (code[i] === '\\') {
                  i += 2
                  continue
                }
                if (code[i] === q) {
                  i++
                  break
                }
                i++
              }
              continue
            }
            // Handle nested template literals
            if (code[i] === '`') {
              i++
              let nestedTemplate = 1
              while (i < len && nestedTemplate > 0) {
                if (code[i] === '\\') {
                  i += 2
                  continue
                }
                if (code[i] === '`') nestedTemplate--
                i++
              }
              continue
            }
            if (code[i] === '{') braceDepth++
            if (code[i] === '}') braceDepth--
            i++
          }
          continue
        }
        i++
      }
      continue
    }

    // Count actual delimiters
    switch (char) {
      case '(': counts.parens.open++; break
      case ')': counts.parens.close++; break
      case '[': counts.brackets.open++; break
      case ']': counts.brackets.close++; break
      case '{': counts.braces.open++; break
      case '}': counts.braces.close++; break
    }

    i++
  }

  return counts
}

/**
 * Validate delimiter balance.
 *
 * @param {string} code - The code to validate
 * @returns {{ valid: boolean, errors: string[], counts: object }}
 */
export function validateDelimiterBalance(code) {
  if (!code || typeof code !== 'string') {
    return { valid: false, errors: ['Code must be a non-empty string'], counts: null }
  }

  const counts = countDelimiters(code)
  const errors = []

  const parenDiff = counts.parens.open - counts.parens.close
  const bracketDiff = counts.brackets.open - counts.brackets.close
  const braceDiff = counts.braces.open - counts.braces.close

  if (parenDiff > 0) {
    errors.push(`Code truncated: missing ${parenDiff} closing parenthes${parenDiff === 1 ? 'is' : 'es'}`)
  } else if (parenDiff < 0) {
    errors.push(`Malformed code: ${-parenDiff} extra closing parenthes${parenDiff === -1 ? 'is' : 'es'}`)
  }

  if (bracketDiff > 0) {
    errors.push(`Code truncated: missing ${bracketDiff} closing bracket${bracketDiff === 1 ? '' : 's'}`)
  } else if (bracketDiff < 0) {
    errors.push(`Malformed code: ${-bracketDiff} extra closing bracket${bracketDiff === -1 ? '' : 's'}`)
  }

  if (braceDiff > 0) {
    errors.push(`Code truncated: missing ${braceDiff} closing brace${braceDiff === 1 ? '' : 's'}`)
  } else if (braceDiff < 0) {
    errors.push(`Malformed code: ${-braceDiff} extra closing brace${braceDiff === -1 ? '' : 's'}`)
  }

  return {
    valid: errors.length === 0,
    errors,
    counts
  }
}

/**
 * Assert delimiter balance, throwing with retry-triggering message if invalid.
 *
 * @param {string} code - The code to validate
 * @throws {Error} If delimiters are not balanced
 */
export function assertDelimiterBalance(code) {
  const result = validateDelimiterBalance(code)
  if (!result.valid) {
    // Use a user-friendly message for truncation errors
    const error = result.errors[0]
    if (error.includes('truncated')) {
      throw new Error('The AI response was cut short. Try a simpler description.')
    }
    throw new Error('The AI generated an incomplete response. Please try again.')
  }
}
