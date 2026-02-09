/**
 * thinq Director Validation Suite
 *
 * Run all validations: node src/director/validation/index.js
 * Run specific test: node src/director/validation/index.js --test=models
 *
 * Tests:
 * - models: Compare Gemini 3 Pro vs Flash quality/cost
 * - audio: Test Lyria and TTS API access
 * - spatial: Validate spatial resolver templates
 * - e2e: End-to-end scene generation (requires running app)
 */

import { runComparison } from './modelComparison.js'

const VALIDATIONS = {
  models: {
    name: 'Model Comparison (Pro vs Flash)',
    run: runComparison,
    critical: true
  },
  audio: {
    name: 'Audio APIs (Lyria + TTS)',
    run: () => import('./audioValidation.js').then(m => m.runAudioValidation()),
    critical: false
  },
  spatial: {
    name: 'Spatial Resolver Templates',
    run: () => import('./spatialValidation.js').then(m => m.runSpatialValidation()),
    critical: true
  }
}

async function runAllValidations() {
  console.log('\n╔═══════════════════════════════════════════════════════════════╗')
  console.log('║          thinq Director - Validation Suite                    ║')
  console.log('╚═══════════════════════════════════════════════════════════════╝\n')

  const args = process.argv.slice(2)
  const testArg = args.find(a => a.startsWith('--test='))
  const specificTest = testArg?.split('=')[1]

  const results = {}
  const testsToRun = specificTest ? [specificTest] : Object.keys(VALIDATIONS)

  for (const key of testsToRun) {
    const validation = VALIDATIONS[key]
    if (!validation) {
      console.log(`Unknown test: ${key}`)
      continue
    }

    console.log(`\n${'═'.repeat(65)}`)
    console.log(`  Running: ${validation.name}`)
    console.log(`${'═'.repeat(65)}\n`)

    try {
      results[key] = await validation.run()
      console.log(`\n  ✓ ${validation.name} completed`)
    } catch (e) {
      console.error(`\n  ✗ ${validation.name} failed: ${e.message}`)
      results[key] = { error: e.message }

      if (validation.critical) {
        console.error('\n  ⚠ CRITICAL VALIDATION FAILED - Cannot proceed with build')
      }
    }
  }

  // Summary
  console.log('\n\n╔═══════════════════════════════════════════════════════════════╗')
  console.log('║                    Validation Summary                         ║')
  console.log('╚═══════════════════════════════════════════════════════════════╝\n')

  let allPassed = true
  for (const [key, result] of Object.entries(results)) {
    const status = result?.error ? '✗ FAILED' : '✓ PASSED'
    const critical = VALIDATIONS[key]?.critical ? ' [CRITICAL]' : ''
    console.log(`  ${status} ${VALIDATIONS[key]?.name}${critical}`)
    if (result?.error) allPassed = false
  }

  console.log('\n' + (allPassed ? '  All validations passed!' : '  Some validations failed - review before proceeding'))

  return results
}

runAllValidations().catch(console.error)

export { runAllValidations, VALIDATIONS }
