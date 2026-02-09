#!/usr/bin/env node
/**
 * thinq Director Validation Runner
 *
 * Executes validation tests with cost tracking, output logging, and approval workflow.
 *
 * Usage:
 *   node --env-file=.env src/director/validation/runValidation.js
 *   node --env-file=.env src/director/validation/runValidation.js --include-pro
 *
 * Or with explicit key:
 *   GEMINI_API_KEY=<key> node src/director/validation/runValidation.js
 *
 * Flags:
 *   --include-pro    Include Pro model tests (default: Flash only)
 *   --skip-api       Skip API tests (run offline tests only)
 *   --verbose        Show detailed output
 */

import { promises as fs } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import {
  callGemini,
  calculateCost,
  parseJSON,
  evaluateScenePlan,
  saveTestOutput,
  saveSummaryReport,
  MODELS,
  PRICING,
  TEST_PROMPTS,
  SCENE_PLANNER_SYSTEM,
  OUTPUT_DIR
} from './modelComparison.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Cost approval threshold
const COST_APPROVAL_THRESHOLD = 1.00

// Parse CLI args
const args = process.argv.slice(2)
const includePro = args.includes('--include-pro')
const skipApi = args.includes('--skip-api')
const verbose = args.includes('--verbose')

// Track cumulative cost across all tests
let cumulativeCost = 0
const testResults = []

/**
 * Check if estimated cost requires approval
 */
function checkCostApproval(estimatedCost, testName) {
  if (estimatedCost > COST_APPROVAL_THRESHOLD) {
    console.log(`\n⚠️  Test "${testName}" estimated cost: $${estimatedCost.toFixed(2)}`)
    console.log(`   This exceeds $${COST_APPROVAL_THRESHOLD.toFixed(2)} threshold.`)
    console.log('   Skipping test. Use --force to override.')
    return false
  }
  return true
}

/**
 * Phase 1: API Access Test
 * Simple "hello" request to verify API connectivity
 */
async function runApiAccessTest() {
  console.log('\n─────────────────────────────────────────────────────────────────')
  console.log('  Phase 1: API Access Test')
  console.log('─────────────────────────────────────────────────────────────────')

  const result = { name: 'api_access', passed: false, cost: 0 }

  try {
    process.stdout.write('  Testing Flash API access... ')

    const response = await callGemini(
      MODELS.flash,
      'Say "API working" in exactly 2 words.',
      'You are a helpful assistant.',
      { maxOutputTokens: 50 }
    )

    result.cost = response.cost.totalCost
    cumulativeCost += result.cost

    if (response.text && response.text.toLowerCase().includes('api') && response.text.toLowerCase().includes('working')) {
      result.passed = true
      console.log(`✓ OK ($${result.cost.toFixed(4)})`)
    } else {
      console.log(`✓ Connected (unexpected response: "${response.text.slice(0, 30)}...")`)
      result.passed = true // Still passed - API is working
    }

    if (verbose) {
      console.log(`    Tokens: ${response.usage.promptTokens} in / ${response.usage.outputTokens} out`)
      console.log(`    Latency: ${response.latency}ms`)
    }
  } catch (e) {
    console.log(`✗ FAILED: ${e.message}`)
    result.error = e.message
  }

  testResults.push(result)
  return result.passed
}

/**
 * Phase 2: Scene Planner Quality Tests
 */
async function runScenePlannerTests(model, modelKey) {
  const modelLabel = modelKey.toUpperCase()
  console.log(`\n─────────────────────────────────────────────────────────────────`)
  console.log(`  Phase 2${modelKey === 'pro' ? 'b' : ''}: Scene Planner (${modelLabel})`)
  console.log(`─────────────────────────────────────────────────────────────────`)

  const results = []

  for (const test of TEST_PROMPTS) {
    process.stdout.write(`  ${test.name.padEnd(20)} ... `)

    const result = {
      name: `${modelKey}_${test.name}`,
      model: modelKey,
      passed: false,
      cost: 0,
      quality: 0
    }

    try {
      const response = await callGemini(model, test.prompt, SCENE_PLANNER_SYSTEM, {
        thinkingBudget: modelKey === 'pro' ? 1024 : 0
      })

      result.cost = response.cost.totalCost
      cumulativeCost += result.cost

      const parsed = parseJSON(response.text)

      if (parsed.success) {
        const evaluation = evaluateScenePlan(parsed.data, test)
        result.passed = evaluation.percentage >= 70
        result.quality = evaluation.percentage

        console.log(`${result.passed ? '✓' : '⚠'} ${evaluation.percentage}% quality | $${result.cost.toFixed(4)}`)

        // Save detailed output
        await saveTestOutput(test.name, model, {
          timestamp: new Date().toISOString(),
          model,
          test: test.name,
          prompt: test.prompt,
          rawResponse: response.text,
          parsedPlan: parsed.data,
          usage: response.usage,
          cost: response.cost,
          qualityScore: evaluation.percentage,
          qualityBreakdown: evaluation.scores,
          latencyMs: response.latency
        })
      } else {
        console.log(`✗ JSON parse failed`)
        result.error = parsed.error
      }

      if (verbose) {
        console.log(`    Tokens: ${response.usage.promptTokens} in / ${response.usage.outputTokens} out`)
        console.log(`    Latency: ${response.latency}ms`)
      }
    } catch (e) {
      console.log(`✗ ${e.message}`)
      result.error = e.message
    }

    results.push(result)
    testResults.push(result)
  }

  return results
}

/**
 * Phase 3: Spatial Resolver Tests (offline, no API calls)
 */
async function runSpatialResolverTests() {
  console.log('\n─────────────────────────────────────────────────────────────────')
  console.log('  Phase 3: Spatial Resolver (offline)')
  console.log('─────────────────────────────────────────────────────────────────')

  // Test spatial relationship vocabulary
  const SPATIAL_RELATIONSHIPS = ['approaching', 'facing_at_distance', 'circling', 'side_by_side', 'stationary', 'walking_away']
  const CAMERA_STYLES = ['tracking_behind', 'wide_establishing', 'close_up', 'dramatic_low_angle', 'orbit']

  const result = {
    name: 'spatial_resolver',
    passed: true,
    cost: 0,
    details: {
      relationships: SPATIAL_RELATIONSHIPS.length,
      cameras: CAMERA_STYLES.length
    }
  }

  process.stdout.write(`  Checking vocabulary... `)
  console.log(`✓ ${SPATIAL_RELATIONSHIPS.length} relationships, ${CAMERA_STYLES.length} camera styles`)

  // Validate that scene planner prompts reference valid vocabulary
  process.stdout.write(`  Checking prompt alignment... `)
  const promptText = SCENE_PLANNER_SYSTEM.toLowerCase()
  const missingRelationships = SPATIAL_RELATIONSHIPS.filter(r => !promptText.includes(r))
  const missingCameras = CAMERA_STYLES.filter(c => !promptText.includes(c))

  if (missingRelationships.length > 0 || missingCameras.length > 0) {
    result.passed = false
    console.log(`✗ Missing vocabulary in prompt`)
    if (missingRelationships.length > 0) {
      console.log(`    Missing relationships: ${missingRelationships.join(', ')}`)
    }
    if (missingCameras.length > 0) {
      console.log(`    Missing cameras: ${missingCameras.join(', ')}`)
    }
  } else {
    console.log(`✓ All vocabulary defined in prompt`)
  }

  testResults.push(result)
  return result.passed
}

/**
 * Generate final summary report
 */
async function generateSummary() {
  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('  VALIDATION SUMMARY')
  console.log('═══════════════════════════════════════════════════════════════\n')

  const passed = testResults.filter(t => t.passed).length
  const total = testResults.length

  console.log(`  Tests: ${passed}/${total} passed`)
  console.log(`  Total cost: $${cumulativeCost.toFixed(4)}`)

  // Group by phase
  const apiTests = testResults.filter(t => t.name === 'api_access')
  const flashTests = testResults.filter(t => t.model === 'flash')
  const proTests = testResults.filter(t => t.model === 'pro')
  const offlineTests = testResults.filter(t => t.cost === 0 && t.name !== 'api_access')

  console.log('\n  By Phase:')
  if (apiTests.length > 0) {
    const apiPassed = apiTests.filter(t => t.passed).length
    console.log(`    API Access:     ${apiPassed}/${apiTests.length} passed`)
  }
  if (flashTests.length > 0) {
    const flashPassed = flashTests.filter(t => t.passed).length
    const flashCost = flashTests.reduce((sum, t) => sum + t.cost, 0)
    const flashAvgQuality = flashTests.filter(t => t.quality).reduce((sum, t) => sum + t.quality, 0) / flashTests.filter(t => t.quality).length || 0
    console.log(`    Flash:          ${flashPassed}/${flashTests.length} passed | avg quality ${Math.round(flashAvgQuality)}% | $${flashCost.toFixed(4)}`)
  }
  if (proTests.length > 0) {
    const proPassed = proTests.filter(t => t.passed).length
    const proCost = proTests.reduce((sum, t) => sum + t.cost, 0)
    const proAvgQuality = proTests.filter(t => t.quality).reduce((sum, t) => sum + t.quality, 0) / proTests.filter(t => t.quality).length || 0
    console.log(`    Pro:            ${proPassed}/${proTests.length} passed | avg quality ${Math.round(proAvgQuality)}% | $${proCost.toFixed(4)}`)
  }
  if (offlineTests.length > 0) {
    const offlinePassed = offlineTests.filter(t => t.passed).length
    console.log(`    Offline:        ${offlinePassed}/${offlineTests.length} passed`)
  }

  // Save summary
  const summary = {
    timestamp: new Date().toISOString(),
    passed,
    total,
    cumulativeCost,
    includedPro: includePro,
    tests: testResults
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true })
  const summaryPath = join(OUTPUT_DIR, 'summary.json')
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2))

  console.log(`\n  Outputs: ${OUTPUT_DIR}/`)
  console.log(`  Summary: ${summaryPath}`)

  // Final status
  console.log('\n───────────────────────────────────────────────────────────────')
  if (passed === total) {
    console.log('  ✓ All validations PASSED')
  } else {
    console.log(`  ⚠ ${total - passed} validation(s) FAILED - review before proceeding`)
  }
  console.log('───────────────────────────────────────────────────────────────\n')

  return passed === total
}

/**
 * Main entry point
 */
async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════════════╗')
  console.log('║         thinq Director - Validation Runner                    ║')
  console.log('╚═══════════════════════════════════════════════════════════════╝')

  console.log(`\n  Mode: ${includePro ? 'Flash + Pro comparison' : 'Flash only (use --include-pro for comparison)'}`)
  console.log(`  Estimated cost: ${includePro ? '~$0.26' : '~$0.05'}`)

  // Check API key
  if (!process.env.GEMINI_API_KEY && !skipApi) {
    console.error('\n  ✗ GEMINI_API_KEY environment variable required')
    console.error('  Run with: node --env-file=.env src/director/validation/runValidation.js')
    process.exit(1)
  }

  // Phase 1: API Access
  if (!skipApi) {
    const apiOk = await runApiAccessTest()
    if (!apiOk) {
      console.error('\n  ✗ API access failed - cannot continue')
      process.exit(1)
    }
  }

  // Phase 2: Scene Planner - Flash
  if (!skipApi) {
    await runScenePlannerTests(MODELS.flash, 'flash')
  }

  // Phase 2b: Scene Planner - Pro (optional)
  if (includePro && !skipApi) {
    await runScenePlannerTests(MODELS.pro, 'pro')
  }

  // Phase 3: Spatial Resolver (offline)
  await runSpatialResolverTests()

  // Summary
  const allPassed = await generateSummary()

  process.exit(allPassed ? 0 : 1)
}

main().catch(e => {
  console.error(`\n  ✗ Validation error: ${e.message}`)
  if (verbose) {
    console.error(e.stack)
  }
  process.exit(1)
})
