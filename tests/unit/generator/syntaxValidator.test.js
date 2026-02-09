/**
 * Tests for syntaxValidator - string-aware delimiter balance checking
 */
import { describe, it, expect } from 'vitest'
import {
  countDelimiters,
  validateDelimiterBalance,
  assertDelimiterBalance
} from '../../../src/generator/syntaxValidator.js'

describe('countDelimiters', () => {
  describe('basic counting', () => {
    it('counts parentheses', () => {
      const result = countDelimiters('fn(a, b)')
      expect(result.parens.open).toBe(1)
      expect(result.parens.close).toBe(1)
    })

    it('counts brackets', () => {
      const result = countDelimiters('arr[0][1]')
      expect(result.brackets.open).toBe(2)
      expect(result.brackets.close).toBe(2)
    })

    it('counts braces', () => {
      const result = countDelimiters('{ a: { b: 1 } }')
      expect(result.braces.open).toBe(2)
      expect(result.braces.close).toBe(2)
    })

    it('counts all delimiter types', () => {
      const result = countDelimiters('fn({ arr: [1] })')
      expect(result.parens.open).toBe(1)
      expect(result.parens.close).toBe(1)
      expect(result.brackets.open).toBe(1)
      expect(result.brackets.close).toBe(1)
      expect(result.braces.open).toBe(1)
      expect(result.braces.close).toBe(1)
    })
  })

  describe('string awareness', () => {
    it('ignores delimiters inside single-quoted strings', () => {
      const result = countDelimiters("const s = '({[]})'")
      expect(result.parens.open).toBe(0)
      expect(result.parens.close).toBe(0)
      expect(result.brackets.open).toBe(0)
      expect(result.brackets.close).toBe(0)
      expect(result.braces.open).toBe(0)
      expect(result.braces.close).toBe(0)
    })

    it('ignores delimiters inside double-quoted strings', () => {
      const result = countDelimiters('const s = "({[]})"')
      expect(result.parens.open).toBe(0)
      expect(result.braces.open).toBe(0)
    })

    it('handles escaped quotes in strings', () => {
      const result = countDelimiters("const s = 'it\\'s (fine)'")
      expect(result.parens.open).toBe(0)
    })

    it('handles empty strings', () => {
      const result = countDelimiters("const s = ''")
      expect(result.parens.open).toBe(0)
    })

    it('handles strings with only escape sequences', () => {
      const result = countDelimiters("const s = '\\n\\t'")
      expect(result.parens.open).toBe(0)
    })
  })

  describe('template literal awareness', () => {
    it('ignores delimiters inside template literals', () => {
      const result = countDelimiters('const s = `({[]})`')
      expect(result.parens.open).toBe(0)
      expect(result.braces.open).toBe(0)
    })

    it('handles template literals with interpolation', () => {
      const result = countDelimiters('const s = `${fn(x)}`')
      // The implementation skips entire template literals including interpolations
      expect(result.parens.open).toBe(0)
      expect(result.parens.close).toBe(0)
    })

    it('handles nested braces in interpolation', () => {
      const result = countDelimiters('const s = `${({ a: 1 })}`')
      // The implementation tracks braces inside ${} interpolation
      // The outer ${} braces are part of template syntax, not counted
      // Inside we have ({ a: 1 }) - 1 paren pair and 1 brace pair
      // But implementation skips the whole interpolation, so counts should be 0
      expect(result.parens.open).toBe(0)
      expect(result.parens.close).toBe(0)
      expect(result.braces.open).toBe(0)
      expect(result.braces.close).toBe(0)
    })

    it('handles strings inside interpolation', () => {
      const result = countDelimiters('const s = `${fn("()")}`')
      // The "()" is inside a string inside interpolation
      // The implementation skips the whole template literal including interpolations
      expect(result.parens.open).toBe(0)
      expect(result.parens.close).toBe(0)
    })

    it('handles nested template literals', () => {
      const result = countDelimiters('const s = `outer ${`inner`} end`')
      expect(result.parens.open).toBe(0)
    })
  })

  describe('comment awareness', () => {
    it('ignores delimiters in single-line comments', () => {
      const result = countDelimiters('fn() // (ignored)')
      expect(result.parens.open).toBe(1)
      expect(result.parens.close).toBe(1)
    })

    it('ignores delimiters in multi-line comments', () => {
      const result = countDelimiters('fn() /* (ignored) */')
      expect(result.parens.open).toBe(1)
      expect(result.parens.close).toBe(1)
    })

    it('handles multi-line comment spanning lines', () => {
      const code = `fn()
/* start
  (ignored)
end */
after()`
      const result = countDelimiters(code)
      expect(result.parens.open).toBe(2)
      expect(result.parens.close).toBe(2)
    })

    it('handles comment at end of code', () => {
      const result = countDelimiters('fn() //')
      expect(result.parens.open).toBe(1)
      expect(result.parens.close).toBe(1)
    })
  })

  describe('complex cases', () => {
    it('handles real function code', () => {
      const code = `
function createAsset(THREE) {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xff0000 })
  );
  group.add(mesh);
  return group;
}
`
      const result = countDelimiters(code)
      expect(result.parens.open).toBe(result.parens.close)
      expect(result.braces.open).toBe(result.braces.close)
    })

    it('handles regex-like patterns in strings', () => {
      const result = countDelimiters("const re = '/test()/g'")
      expect(result.parens.open).toBe(0)
    })

    it('handles mixed delimiters', () => {
      const code = 'arr.map(x => ({ key: x[0] }))'
      const result = countDelimiters(code)
      expect(result.parens.open).toBe(2)
      expect(result.parens.close).toBe(2)
      expect(result.brackets.open).toBe(1)
      expect(result.brackets.close).toBe(1)
      expect(result.braces.open).toBe(1)
      expect(result.braces.close).toBe(1)
    })
  })
})

describe('validateDelimiterBalance', () => {
  describe('valid code', () => {
    it('returns valid for balanced delimiters', () => {
      const result = validateDelimiterBalance('fn(a, b)')
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('returns valid for complex balanced code', () => {
      const code = `
export function createAsset(THREE) {
  const arr = [1, 2, [3, 4]];
  return { a: fn(x) };
}
`
      const result = validateDelimiterBalance(code)
      expect(result.valid).toBe(true)
    })
  })

  describe('missing closing delimiters (truncation)', () => {
    it('detects missing closing parenthesis', () => {
      const result = validateDelimiterBalance('fn(a, b')
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('missing')
      expect(result.errors[0]).toContain('closing parenthes')
    })

    it('detects missing closing bracket', () => {
      const result = validateDelimiterBalance('arr[0][1')
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('missing')
      expect(result.errors[0]).toContain('closing bracket')
    })

    it('detects missing closing brace', () => {
      const result = validateDelimiterBalance('{ a: { b: 1 }')
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('missing')
      expect(result.errors[0]).toContain('closing brace')
    })

    it('reports count of missing delimiters', () => {
      const result = validateDelimiterBalance('fn((((')
      expect(result.errors[0]).toContain('4')
    })

    it('uses singular for single missing delimiter', () => {
      const result = validateDelimiterBalance('fn(')
      expect(result.errors[0]).toContain('parenthesis')
      expect(result.errors[0]).not.toContain('parentheses')
    })

    it('uses plural for multiple missing delimiters', () => {
      const result = validateDelimiterBalance('fn((')
      expect(result.errors[0]).toContain('parentheses')
    })
  })

  describe('extra closing delimiters (malformed)', () => {
    it('detects extra closing parenthesis', () => {
      const result = validateDelimiterBalance('fn())')
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('extra')
      expect(result.errors[0]).toContain('closing parenthes')
    })

    it('detects extra closing bracket', () => {
      const result = validateDelimiterBalance('arr[0]]')
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('extra')
      expect(result.errors[0]).toContain('closing bracket')
    })

    it('detects extra closing brace', () => {
      const result = validateDelimiterBalance('{ a: 1 }}')
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('extra')
      expect(result.errors[0]).toContain('closing brace')
    })
  })

  describe('multiple errors', () => {
    it('reports multiple types of errors', () => {
      const result = validateDelimiterBalance('fn([{')
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBe(3)
    })
  })

  describe('edge cases', () => {
    it('returns invalid for empty string', () => {
      const result = validateDelimiterBalance('')
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('non-empty string')
    })

    it('returns invalid for null', () => {
      const result = validateDelimiterBalance(null)
      expect(result.valid).toBe(false)
    })

    it('returns invalid for undefined', () => {
      const result = validateDelimiterBalance(undefined)
      expect(result.valid).toBe(false)
    })

    it('returns invalid for non-string', () => {
      const result = validateDelimiterBalance(123)
      expect(result.valid).toBe(false)
    })
  })

  describe('counts object', () => {
    it('includes counts in result', () => {
      const result = validateDelimiterBalance('fn([{}])')
      expect(result.counts).toBeDefined()
      expect(result.counts.parens.open).toBe(1)
      expect(result.counts.brackets.open).toBe(1)
      expect(result.counts.braces.open).toBe(1)
    })

    it('returns null counts for invalid input', () => {
      const result = validateDelimiterBalance(null)
      expect(result.counts).toBeNull()
    })
  })
})

describe('assertDelimiterBalance', () => {
  describe('valid code', () => {
    it('does not throw for balanced code', () => {
      expect(() => assertDelimiterBalance('fn()')).not.toThrow()
    })

    it('does not throw for complex balanced code', () => {
      const code = 'export function test() { return [1, { a: fn(x) }]; }'
      expect(() => assertDelimiterBalance(code)).not.toThrow()
    })
  })

  describe('truncation errors', () => {
    it('throws user-friendly message for truncated code', () => {
      expect(() => assertDelimiterBalance('fn(')).toThrow(
        'The AI response was cut short. Try a simpler description.'
      )
    })

    it('throws user-friendly message for missing braces', () => {
      expect(() => assertDelimiterBalance('function test() {')).toThrow(
        'The AI response was cut short. Try a simpler description.'
      )
    })
  })

  describe('malformed errors', () => {
    it('throws generic message for extra delimiters', () => {
      expect(() => assertDelimiterBalance('fn())')).toThrow(
        'The AI generated an incomplete response. Please try again.'
      )
    })
  })

  describe('empty input', () => {
    it('throws for empty string', () => {
      expect(() => assertDelimiterBalance('')).toThrow()
    })
  })
})

describe('real-world code patterns', () => {
  it('handles Three.js mesh creation', () => {
    const code = `
const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({
    color: 0xff0000,
    roughness: 0.5,
    metalness: 0.2
  })
);
`
    const result = validateDelimiterBalance(code)
    expect(result.valid).toBe(true)
  })

  it('handles arrow functions', () => {
    const code = 'const fn = (x) => ({ key: x.map(y => y[0]) })'
    const result = validateDelimiterBalance(code)
    expect(result.valid).toBe(true)
  })

  it('handles template strings with complex interpolation', () => {
    const code = 'const s = `Value: ${arr.map(x => `${x.name}: ${fn(x)}`).join(", ")}`'
    const result = validateDelimiterBalance(code)
    expect(result.valid).toBe(true)
  })

  it('handles createAsset function', () => {
    const code = `
export function createAsset(THREE) {
  const group = new THREE.Group();

  // Materials
  const mats = [
    new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.7 }),
    new THREE.MeshStandardMaterial({ color: 0xff0000, roughness: 0.5 })
  ];

  // Create body
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1, 2, 0.5),
    mats[0]
  );
  group.add(body);

  // Normalization
  const box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(new THREE.Vector3());
  group.position.set(-center.x, -box.min.y, -center.z);

  return group;
}
`
    const result = validateDelimiterBalance(code)
    expect(result.valid).toBe(true)
  })

  it('handles animate function with string templates', () => {
    const code = `
group.userData.animate = function(dt) {
  const t = performance.now() * 0.001;
  group.rotation.y = Math.sin(t) * 0.1;
  console.log(\`Time: \${t.toFixed(2)}\`);
};
`
    const result = validateDelimiterBalance(code)
    expect(result.valid).toBe(true)
  })

  it('detects truncated createAsset', () => {
    const code = `
export function createAsset(THREE) {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
`
    const result = validateDelimiterBalance(code)
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('truncated')
  })
})
