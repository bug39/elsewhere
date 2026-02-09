/**
 * Spatial Reasoning Tests for Gemini
 *
 * PURPOSE: Determine if Gemini can reason about 3D spatial relationships.
 * This informs whether AI-directed placement is viable or if we need
 * to move placement intelligence into deterministic algorithms.
 *
 * TESTS:
 * 1. Coordinate Generation - Can it place items on a grid correctly?
 * 2. Relative Position Understanding - Does it understand cardinal directions?
 * 3. Spatial Critique - Can it identify layout problems?
 * 4. Relationship Resolution - Can it interpret "around", "behind", "flanking"?
 * 5. Scale Reasoning - Does it understand real-world distances?
 *
 * RUN: npm run test:gem
 *      node --test tests/gem/spatial-reasoning.test.js
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert'
import 'dotenv/config'

import {
  extractJSON,
  analyzeRingPattern,
  analyzeLinePattern,
  classifyDirection,
  isDirectionClose,
  scoreSpatialCritique,
  checkOverlaps,
  checkEdgePlacement,
  validateBehindRelationship,
  checkSymmetry,
  validateSpacingReasonableness,
  formatTestResults,
  distance2D
} from './spatial-utils.js'

// ============================================================================
// CONFIGURATION
// ============================================================================

const API_KEY = process.env.GEMINI_API_KEY
const MODEL = 'gemini-3-flash-preview'
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

// Rate limit protection (free tier is ~5 req/min)
const MIN_REQUEST_INTERVAL_MS = 13000
let lastRequestTime = 0

// Test results accumulator
const testResults = {}

// ============================================================================
// API HELPERS
// ============================================================================

async function waitForRateLimit() {
  const now = Date.now()
  const elapsed = now - lastRequestTime
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    const waitTime = MIN_REQUEST_INTERVAL_MS - elapsed
    console.log(`  [Rate limit] Waiting ${Math.ceil(waitTime / 1000)}s...`)
    await new Promise(resolve => setTimeout(resolve, waitTime))
  }
  lastRequestTime = Date.now()
}

async function callGemini(prompt, systemInstruction = '') {
  await waitForRateLimit()

  const requestBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,  // Low temperature for more deterministic spatial reasoning
      maxOutputTokens: 4096  // Increased to handle larger structured outputs
    }
  }

  if (systemInstruction) {
    requestBody.systemInstruction = { parts: [{ text: systemInstruction }] }
  }

  const response = await fetch(
    `${BASE_URL}/${MODEL}:generateContent?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Gemini API error ${response.status}: ${error}`)
  }

  const data = await response.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text

  if (!text) {
    throw new Error('No text in Gemini response: ' + JSON.stringify(data))
  }

  return text
}

// ============================================================================
// SYSTEM INSTRUCTION
// ============================================================================

const SPATIAL_SYSTEM = `You are a spatial reasoning assistant. You MUST output ONLY valid JSON - no markdown fences, no explanations, no text before or after the JSON.

Coordinate system:
- X axis: West (0) to East (max)
- Z axis: South (0) to North (max)
- Origin (0,0) is the southwest corner
- Higher Z values are more north
- Higher X values are more east

When placing items:
- Avoid exact coordinate overlaps
- Consider natural spacing between objects
- Think about how items relate spatially`

// ============================================================================
// TEST 1: Coordinate Generation (Grid Understanding)
// ============================================================================

describe('TEST 1: Coordinate Generation', () => {
  test('Place items on a 10x10 grid with specific patterns', async (t) => {
    if (!API_KEY) {
      t.skip('GEMINI_API_KEY not set')
      return
    }

    const prompt = `On a 10x10 grid (coordinates 0-9 for both X and Z), place:
- A well at the center
- 4 cottages arranged in a ring around the well at distance 2
- 6 trees along the north edge (Z=9 or Z=8)

Output JSON: { "assets": [{ "name": "well" | "cottage" | "tree", "x": number, "z": number }] }
Remember: Higher Z = more north. The well should be near coordinates (4,4) or (5,5).`

    console.log('\n  Calling Gemini for coordinate generation...')
    const response = await callGemini(prompt, SPATIAL_SYSTEM)
    console.log('  Raw response (first 300 chars):', response.slice(0, 300))
    console.log('  Response length:', response.length)

    const data = extractJSON(response)
    if (!data) {
      console.log('  FULL RESPONSE FOR DEBUG:')
      console.log(response)
      console.log('  END FULL RESPONSE')
    }
    assert.ok(data, 'Response should be valid JSON')
    assert.ok(Array.isArray(data.assets), 'Should have assets array')

    const wells = data.assets.filter(a => a.name === 'well' || a.name.includes('well'))
    const cottages = data.assets.filter(a => a.name === 'cottage' || a.name.includes('cottage'))
    const trees = data.assets.filter(a => a.name === 'tree' || a.name.includes('tree'))

    // Initialize test result
    const checks = {}

    // Check well placement (center)
    const well = wells[0]
    const wellCentered = well && well.x >= 3 && well.x <= 6 && well.z >= 3 && well.z <= 6
    checks['Well centered'] = {
      passed: wellCentered,
      detail: well ? `at (${well.x}, ${well.z})` : 'no well found'
    }

    // Check ring pattern for cottages
    if (cottages.length >= 4 && well) {
      const ringAnalysis = analyzeRingPattern(
        cottages.slice(0, 4),
        { x: well.x, z: well.z },
        2,
        1.5
      )
      checks['Cottages form ring'] = {
        passed: ringAnalysis.isRing,
        detail: ringAnalysis.isRing
          ? `avg distance ${ringAnalysis.avgDistance.toFixed(1)}`
          : `max deviation ${ringAnalysis.maxDeviation.toFixed(1)}, gap ${ringAnalysis.maxAngularGap?.toFixed(0)}deg`
      }

      // Check if cottages form a line (the failure mode we're looking for)
      const lineAnalysis = analyzeLinePattern(cottages.slice(0, 4))
      if (lineAnalysis.isLine) {
        checks['Cottages form ring'].detail += ` - WARNING: Forms a ${lineAnalysis.direction} line!`
      }
    } else {
      checks['Cottages form ring'] = { passed: false, detail: `only ${cottages.length} cottages found` }
    }

    // Check trees on north edge
    const treesOnNorthEdge = trees.filter(t => t.z >= 8)
    checks['Trees on north edge'] = {
      passed: treesOnNorthEdge.length >= 5,
      detail: `${treesOnNorthEdge.length}/${trees.length} trees at Z>=8`
    }

    // Check for overlaps
    const allPositions = data.assets.filter(a => typeof a.x === 'number' && typeof a.z === 'number')
    const overlapAnalysis = checkOverlaps(allPositions, 0.5)
    checks['No overlapping positions'] = {
      passed: !overlapAnalysis.hasOverlaps,
      detail: overlapAnalysis.hasOverlaps ? `${overlapAnalysis.overlaps.length} overlaps` : 'all clear'
    }

    // Calculate score
    const passed = Object.values(checks).filter(c => c.passed).length
    const total = Object.keys(checks).length

    testResults['1'] = {
      title: 'Coordinate Generation',
      checks,
      score: passed,
      possible: total,
      rawResponse: response,
      parsedData: data
    }

    // Log results
    console.log('\n  Results:')
    for (const [name, check] of Object.entries(checks)) {
      console.log(`    ${check.passed ? 'PASS' : 'FAIL'}: ${name} - ${check.detail}`)
    }
    console.log(`  Score: ${passed}/${total}`)

    assert.ok(passed >= 2, `Should pass at least 2/4 checks (got ${passed})`)
  })
})

// ============================================================================
// TEST 2: Relative Position Understanding
// ============================================================================

describe('TEST 2: Relative Position Understanding', () => {
  test('Describe spatial relationships between items', async (t) => {
    if (!API_KEY) {
      t.skip('GEMINI_API_KEY not set')
      return
    }

    const prompt = `Given these positions on a 10x10 grid:
- Well at (5, 5)
- Cottage at (7, 5)
- Tree at (5, 8)
- Rock at (3, 3)

Describe the spatial relationship of each item relative to the well.
Remember: Higher Z = more north, Higher X = more east.

Output JSON: { "relationships": [{ "item": string, "direction": "north"|"south"|"east"|"west"|"northeast"|"northwest"|"southeast"|"southwest", "distance": number }] }`

    console.log('\n  Calling Gemini for relationship understanding...')
    const response = await callGemini(prompt, SPATIAL_SYSTEM)
    console.log('  Raw response:', response.slice(0, 200) + (response.length > 200 ? '...' : ''))

    const data = extractJSON(response)
    assert.ok(data, 'Response should be valid JSON')
    assert.ok(Array.isArray(data.relationships), 'Should have relationships array')

    const checks = {}

    // Expected relationships
    const expected = {
      cottage: { direction: 'east', distance: 2 },
      tree: { direction: 'north', distance: 3 },
      rock: { direction: 'southwest', distance: Math.sqrt(8) } // ~2.83
    }

    for (const [item, exp] of Object.entries(expected)) {
      const found = data.relationships.find(r =>
        r.item.toLowerCase().includes(item)
      )

      if (found) {
        const directionCorrect = isDirectionClose(found.direction, exp.direction)
        const distanceCorrect = Math.abs(found.distance - exp.distance) < 1

        checks[`${item} direction`] = {
          passed: directionCorrect,
          detail: `expected ${exp.direction}, got ${found.direction}`
        }
        checks[`${item} distance`] = {
          passed: distanceCorrect,
          detail: `expected ~${exp.distance.toFixed(1)}, got ${found.distance}`
        }
      } else {
        checks[`${item} direction`] = { passed: false, detail: 'not found in response' }
        checks[`${item} distance`] = { passed: false, detail: 'not found in response' }
      }
    }

    const passed = Object.values(checks).filter(c => c.passed).length
    const total = Object.keys(checks).length

    testResults['2'] = {
      title: 'Relative Position Understanding',
      checks,
      score: passed,
      possible: total,
      rawResponse: response,
      parsedData: data
    }

    console.log('\n  Results:')
    for (const [name, check] of Object.entries(checks)) {
      console.log(`    ${check.passed ? 'PASS' : 'FAIL'}: ${name} - ${check.detail}`)
    }
    console.log(`  Score: ${passed}/${total}`)

    assert.ok(passed >= 4, `Should pass at least 4/6 checks (got ${passed})`)
  })
})

// ============================================================================
// TEST 3: Spatial Critique (Bad Layout Detection)
// ============================================================================

describe('TEST 3: Spatial Critique', () => {
  test('Identify problems in a poor scene layout', async (t) => {
    if (!API_KEY) {
      t.skip('GEMINI_API_KEY not set')
      return
    }

    const prompt = `Analyze this scene layout on a 10x10 grid:
- Tree at (0,0)
- Tree at (1,0)
- Tree at (2,0)
- Tree at (3,0)
- Tree at (4,0)
- Cottage at (9,9)
- Well at (9,8)

What spatial problems exist? Consider:
- Natural vs unnatural arrangements
- Use of space
- Relationship between different asset types

Output JSON: { "problems": [{ "issue": string, "severity": "high"|"medium"|"low", "suggestion": string }] }`

    console.log('\n  Calling Gemini for spatial critique...')
    const response = await callGemini(prompt, SPATIAL_SYSTEM)
    console.log('  Raw response:', response.slice(0, 300) + (response.length > 300 ? '...' : ''))

    const data = extractJSON(response)
    assert.ok(data, 'Response should be valid JSON')
    assert.ok(Array.isArray(data.problems), 'Should have problems array')

    // Expected problems to identify
    const expectedProblems = [
      { keyword: 'line', description: 'Trees in a line (unnatural)' },
      { keyword: 'isol', description: 'Cottage/well isolated from trees' },
      { keyword: 'center', description: 'Poor use of center space' },
      { keyword: 'cluster', description: 'Assets clustered in corners' }
    ]

    const critiqueScore = scoreSpatialCritique(data.problems, expectedProblems)

    const checks = {
      'Identifies line pattern': {
        passed: critiqueScore.found.includes('Trees in a line (unnatural)'),
        detail: data.problems.find(p => p.issue.toLowerCase().includes('line'))?.issue || 'not mentioned'
      },
      'Identifies isolation': {
        passed: critiqueScore.found.includes('Cottage/well isolated from trees'),
        detail: data.problems.find(p => p.issue.toLowerCase().includes('isol'))?.issue || 'not mentioned'
      },
      'Identifies empty center': {
        passed: critiqueScore.found.includes('Poor use of center space'),
        detail: data.problems.find(p => p.issue.toLowerCase().includes('center'))?.issue || 'not mentioned'
      }
    }

    const passed = Object.values(checks).filter(c => c.passed).length
    const total = Object.keys(checks).length

    testResults['3'] = {
      title: 'Spatial Critique',
      checks,
      score: passed,
      possible: total,
      rawResponse: response,
      parsedData: data,
      allProblemsIdentified: data.problems.map(p => p.issue)
    }

    console.log('\n  Results:')
    for (const [name, check] of Object.entries(checks)) {
      console.log(`    ${check.passed ? 'PASS' : 'FAIL'}: ${name} - ${check.detail}`)
    }
    console.log(`  Score: ${passed}/${total}`)
    console.log('  All problems identified:', data.problems.map(p => p.issue).join('; '))

    assert.ok(passed >= 1, `Should pass at least 1/3 checks (got ${passed})`)
  })
})

// ============================================================================
// TEST 4: Relationship Resolution
// ============================================================================

describe('TEST 4: Relationship Resolution', () => {
  test('Interpret spatial relationship words', async (t) => {
    if (!API_KEY) {
      t.skip('GEMINI_API_KEY not set')
      return
    }

    // Simplified prompt to reduce output length
    const prompt = `Place assets on a 10x10 grid:
- fountain at center (5,5)
- 3 benches "around" the fountain (ring pattern, NOT a line)
- 2 trees "behind" the benches (further from fountain)

Coordinate system: Z=0 south, Z=9 north, X=0 west, X=9 east.
"Around" = ring/arc pattern, NOT straight line.

Output compact JSON: {"assets":[{"name":"fountain"|"bench"|"tree","x":N,"z":N}]}`

    console.log('\n  Calling Gemini for relationship resolution...')
    const response = await callGemini(prompt, SPATIAL_SYSTEM)
    console.log('  Raw response (first 400 chars):', response.slice(0, 400))
    console.log('  Response length:', response.length)

    const data = extractJSON(response)
    if (!data) {
      console.log('  FULL RESPONSE FOR DEBUG:')
      console.log(response)
      console.log('  END FULL RESPONSE')
    }
    assert.ok(data, 'Response should be valid JSON')
    assert.ok(Array.isArray(data.assets), 'Should have assets array')

    const fountain = data.assets.find(a => a.name === 'fountain' || a.name.includes('fountain'))
    const benches = data.assets.filter(a => a.name === 'bench' || a.name.includes('bench'))
    const trees = data.assets.filter(a => a.name === 'tree' || a.name.includes('tree'))

    const checks = {}

    // Check fountain at center
    checks['Fountain at center'] = {
      passed: fountain && fountain.x >= 4 && fountain.x <= 6 && fountain.z >= 4 && fountain.z <= 6,
      detail: fountain ? `at (${fountain.x}, ${fountain.z})` : 'not found'
    }

    // Check "around" interpretation - benches should form ring, not line
    if (benches.length >= 3 && fountain) {
      const ringAnalysis = analyzeRingPattern(benches, fountain, 2, 2)
      const lineAnalysis = analyzeLinePattern(benches)

      checks['"Around" = ring pattern'] = {
        passed: ringAnalysis.isRing || !lineAnalysis.isLine,
        detail: lineAnalysis.isLine
          ? `FAIL: Forms a ${lineAnalysis.direction} line (AI failure mode)`
          : `Ring pattern, max deviation ${ringAnalysis.maxDeviation.toFixed(1)}, angular gap ${ringAnalysis.maxAngularGap?.toFixed(0) || 'N/A'}deg`
      }
    } else {
      checks['"Around" = ring pattern'] = { passed: false, detail: `only ${benches.length} benches` }
    }

    // Check "behind" interpretation - trees should be further from fountain than benches
    if (trees.length >= 2 && benches.length >= 2 && fountain) {
      const behindAnalysis = validateBehindRelationship(trees, benches, fountain)
      checks['"Behind" = further from center'] = {
        passed: behindAnalysis.isValid,
        detail: `trees min dist: ${behindAnalysis.minBehindDistance.toFixed(1)}, benches max dist: ${behindAnalysis.maxFrontDistance.toFixed(1)}`
      }
    } else {
      checks['"Behind" = further from center'] = { passed: false, detail: `insufficient items (${trees.length} trees, ${benches.length} benches)` }
    }

    const passed = Object.values(checks).filter(c => c.passed).length
    const total = Object.keys(checks).length

    testResults['4'] = {
      title: 'Relationship Resolution',
      checks,
      score: passed,
      possible: total,
      rawResponse: response,
      parsedData: data
    }

    console.log('\n  Results:')
    for (const [name, check] of Object.entries(checks)) {
      console.log(`    ${check.passed ? 'PASS' : 'FAIL'}: ${name} - ${check.detail}`)
    }
    console.log(`  Score: ${passed}/${total}`)

    // This test is particularly important - "around" interpretation is a known failure mode
    if (!checks['"Around" = ring pattern'].passed) {
      console.log('\n  *** CRITICAL: AI interprets "around" as a line, not a ring ***')
      console.log('  *** This is a fundamental spatial reasoning limitation ***')
    }

    assert.ok(passed >= 2, `Should pass at least 2/3 checks (got ${passed})`)
  })
})

// ============================================================================
// TEST 5: Scale Reasoning
// ============================================================================

describe('TEST 5: Scale Reasoning', () => {
  test('Suggest appropriate spacing for real-world scale', async (t) => {
    if (!API_KEY) {
      t.skip('GEMINI_API_KEY not set')
      return
    }

    const prompt = `On a 60x60 meter area, suggest appropriate spacing for:
- 1 central well (2m diameter)
- 5 cottages (8m x 6m footprint each)
- 10 trees (3m canopy diameter)

What minimum distances should exist between:
- Cottage to cottage (considering they're 8m wide)?
- Tree to tree (considering 3m canopies)?
- Cottage to well (considering people need to walk between)?

Think about real-world proportions and practical spacing.

Output JSON: { "spacing": { "cottageToCollage": number, "treeToTree": number, "cottageToWell": number } }
(Note: all values in meters)`

    console.log('\n  Calling Gemini for scale reasoning...')
    const response = await callGemini(prompt, SPATIAL_SYSTEM)
    console.log('  Raw response:', response.slice(0, 200) + (response.length > 200 ? '...' : ''))

    const data = extractJSON(response)
    assert.ok(data, 'Response should be valid JSON')
    assert.ok(data.spacing, 'Should have spacing object')

    const spacing = data.spacing

    const sizes = {
      cottage: { width: 8, depth: 6 },
      tree: { canopy: 3 },
      well: { diameter: 2 }
    }

    const reasonableness = validateSpacingReasonableness(spacing, sizes)

    const checks = {}

    // Cottage spacing (should be > 10m for 8m buildings)
    checks['Cottage spacing reasonable'] = {
      passed: spacing.cottageToCollage >= 10 && spacing.cottageToCollage <= 60,
      detail: `${spacing.cottageToCollage}m (expected 10-60m)`
    }

    // Tree spacing (should be > 4m for 3m canopies)
    checks['Tree spacing reasonable'] = {
      passed: spacing.treeToTree >= 4 && spacing.treeToTree <= 30,
      detail: `${spacing.treeToTree}m (expected 4-30m)`
    }

    // Cottage to well (should be > 8m for paths)
    checks['Cottage-to-well reasonable'] = {
      passed: spacing.cottageToWell >= 8 && spacing.cottageToWell <= 40,
      detail: `${spacing.cottageToWell}m (expected 8-40m)`
    }

    // Internal consistency - cottages should have larger spacing than trees
    checks['Relative spacing consistent'] = {
      passed: spacing.cottageToCollage >= spacing.treeToTree,
      detail: `cottages ${spacing.cottageToCollage}m vs trees ${spacing.treeToTree}m`
    }

    const passed = Object.values(checks).filter(c => c.passed).length
    const total = Object.keys(checks).length

    testResults['5'] = {
      title: 'Scale Reasoning',
      checks,
      score: passed,
      possible: total,
      rawResponse: response,
      parsedData: data,
      reasonablenessIssues: reasonableness.issues
    }

    console.log('\n  Results:')
    for (const [name, check] of Object.entries(checks)) {
      console.log(`    ${check.passed ? 'PASS' : 'FAIL'}: ${name} - ${check.detail}`)
    }
    console.log(`  Score: ${passed}/${total}`)

    if (reasonableness.issues.length > 0) {
      console.log('  Reasonableness issues:', reasonableness.issues.join('; '))
    }

    assert.ok(passed >= 2, `Should pass at least 2/4 checks (got ${passed})`)
  })
})

// ============================================================================
// SUMMARY OUTPUT
// ============================================================================

after(() => {
  if (Object.keys(testResults).length > 0) {
    console.log(formatTestResults(testResults))

    // Specific recommendations based on results
    console.log('\n=== SPECIFIC FINDINGS ===\n')

    const test1 = testResults['1']
    if (test1 && !test1.checks?.['Cottages form ring']?.passed) {
      console.log('- TEST 1: Ring placement FAILED - AI produces lines instead of rings')
      console.log('  -> Use deterministic ringPlacement() algorithm for "around" relationships')
    }

    const test4 = testResults['4']
    if (test4 && !test4.checks?.['"Around" = ring pattern']?.passed) {
      console.log('- TEST 4: "Around" interpretation FAILED - confirms ring placement limitation')
      console.log('  -> Do NOT trust AI to interpret "around" - always use algorithm')
    }

    const test3 = testResults['3']
    if (test3 && test3.score >= 2) {
      console.log('- TEST 3: Spatial critique capability is ADEQUATE')
      console.log('  -> AI can evaluate layouts; use for quality feedback loop')
    }

    const test2 = testResults['2']
    if (test2 && test2.score >= 4) {
      console.log('- TEST 2: Direction/distance understanding is GOOD')
      console.log('  -> AI can describe positions; use for semantic location parsing')
    }

    const test5 = testResults['5']
    if (test5 && test5.score >= 3) {
      console.log('- TEST 5: Scale reasoning is REASONABLE')
      console.log('  -> AI understands real-world scale; use for spacing suggestions')
    }
  }
})
