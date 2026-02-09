/**
 * Model Comparison Validation
 *
 * Tests Gemini 3 Pro vs Flash for thinq Director use cases.
 * Run via: node src/director/validation/modelComparison.js
 *
 * Requires: GEMINI_API_KEY environment variable
 */

import { promises as fs } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const OUTPUT_DIR = join(__dirname, 'output')

const MODELS = {
  flash: 'gemini-3-flash-preview',
  pro: 'gemini-3-pro-preview'
}

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

// Gemini 3 Pricing (per 1M tokens) - February 2026
const PRICING = {
  'gemini-3-flash-preview': { input: 0.50, output: 3.00 },
  'gemini-3-pro-preview': { input: 2.00, output: 12.00 },  // <200k context
  'gemini-3-pro-preview-long': { input: 4.00, output: 18.00 }  // >200k context
}

/**
 * Calculate cost for a Gemini API call
 * @param {string} model - Model ID
 * @param {{ promptTokens: number, outputTokens: number }} usage - Token usage
 * @returns {{ inputCost: number, outputCost: number, totalCost: number }}
 */
function calculateCost(model, usage) {
  const pricing = PRICING[model] || PRICING['gemini-3-flash-preview']
  const inputCost = (usage.promptTokens / 1_000_000) * pricing.input
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.output
  return { inputCost, outputCost, totalCost: inputCost + outputCost }
}

/**
 * Save test output to JSON file for manual review
 * @param {string} testName - Name of the test
 * @param {string} model - Model used
 * @param {object} data - Full test data to save
 */
async function saveTestOutput(testName, model, data) {
  await fs.mkdir(OUTPUT_DIR, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const filename = `${timestamp}_${model.replace('gemini-3-', '').replace('-preview', '')}_${testName}.json`
  const filepath = join(OUTPUT_DIR, filename)
  await fs.writeFile(filepath, JSON.stringify(data, null, 2))
  return filepath
}

/**
 * Save summary report of all tests
 * @param {object} summary - Summary data
 * @param {Array} results - Full test results
 */
async function saveSummaryReport(summary, results) {
  await fs.mkdir(OUTPUT_DIR, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const report = {
    timestamp: new Date().toISOString(),
    summary,
    results,
    pricing: PRICING
  }
  const filepath = join(OUTPUT_DIR, `${timestamp}_summary.json`)
  await fs.writeFile(filepath, JSON.stringify(report, null, 2))
  return filepath
}

// Scene Planner system prompt (abbreviated for validation)
const SCENE_PLANNER_SYSTEM = `You are a cinematic scene director for a 3D animation tool.

Given a scene description, output a JSON plan with:
- shots: array of {beat, description, duration_seconds, subjects, spatial_relationship, camera_style, mood}
- assets_needed: array of {id, description}
- environment: {time_of_day, weather, terrain}
- soundtrack: {style, mood_progression, tempo}

Spatial relationships: approaching, facing_at_distance, circling, side_by_side, stationary, walking_away
Camera styles: tracking_behind, wide_establishing, close_up, dramatic_low_angle, orbit

Return ONLY valid JSON, no markdown.`

// Test prompts
const TEST_PROMPTS = [
  {
    name: 'simple_scene',
    prompt: 'A robot walks through a neon city at night',
    expectedAssets: ['robot', 'building'],
    expectedShots: 2
  },
  {
    name: 'complex_scene',
    prompt: 'A knight approaches a dragon cave at sunset. The dragon emerges and they face off. Dramatic orchestral music.',
    expectedAssets: ['knight', 'dragon', 'cave'],
    expectedShots: 3
  },
  {
    name: 'dialogue_scene',
    prompt: 'Two friends meet at a cafe and have a conversation about their dreams. Warm, nostalgic mood.',
    expectedAssets: ['character', 'cafe', 'table'],
    expectedShots: 2
  }
]

async function callGemini(model, prompt, systemInstruction, options = {}) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable required')
  }

  const { thinkingBudget = 0, temperature = 0.7, maxOutputTokens = 4096 } = options

  const requestBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: {
      temperature,
      maxOutputTokens,
      thinkingConfig: { thinkingBudget }
    }
  }

  const startTime = Date.now()

  const response = await fetch(`${BASE_URL}/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify(requestBody)
  })

  const latency = Date.now() - startTime

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`API error ${response.status}: ${error}`)
  }

  const data = await response.json()
  const candidate = data.candidates?.[0]
  const text = candidate?.content?.parts?.[0]?.text

  const usage = {
    promptTokens: data.usageMetadata?.promptTokenCount || 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
    thinkingTokens: data.usageMetadata?.thoughtsTokenCount || 0
  }

  return {
    text,
    latency,
    usage,
    cost: calculateCost(model, usage),
    finishReason: candidate?.finishReason
  }
}

function parseJSON(text) {
  try {
    // Try to extract JSON from markdown code blocks if present
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    const jsonStr = jsonMatch ? jsonMatch[1] : text
    return { success: true, data: JSON.parse(jsonStr.trim()) }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

function evaluateScenePlan(plan, expected) {
  const scores = {
    validJSON: 1,
    hasShots: plan.shots?.length > 0 ? 1 : 0,
    shotCount: plan.shots?.length >= expected.expectedShots ? 1 : 0.5,
    hasAssets: plan.assets_needed?.length > 0 ? 1 : 0,
    hasEnvironment: plan.environment ? 1 : 0,
    hasSoundtrack: plan.soundtrack ? 1 : 0,
    assetsMatch: 0
  }

  // Check if expected assets are roughly covered
  if (plan.assets_needed) {
    const assetDescs = plan.assets_needed.map(a => a.description?.toLowerCase() || a.id?.toLowerCase()).join(' ')
    const matchCount = expected.expectedAssets.filter(exp => assetDescs.includes(exp)).length
    scores.assetsMatch = matchCount / expected.expectedAssets.length
  }

  const total = Object.values(scores).reduce((a, b) => a + b, 0)
  const max = Object.keys(scores).length

  return { scores, total, max, percentage: Math.round((total / max) * 100) }
}

async function runComparison() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  GEMINI 3 MODEL COMPARISON: Pro vs Flash for thinq Director')
  console.log('═══════════════════════════════════════════════════════════════\n')

  const results = []

  for (const test of TEST_PROMPTS) {
    console.log(`\n▶ Test: ${test.name}`)
    console.log(`  Prompt: "${test.prompt.substring(0, 60)}..."`)
    console.log('─'.repeat(65))

    const testResult = { name: test.name, flash: null, pro: null }

    for (const [modelKey, modelId] of Object.entries(MODELS)) {
      process.stdout.write(`  ${modelKey.toUpperCase().padEnd(6)} ... `)

      try {
        const response = await callGemini(modelId, test.prompt, SCENE_PLANNER_SYSTEM, {
          thinkingBudget: modelKey === 'pro' ? 1024 : 0  // Pro gets thinking budget
        })

        const parsed = parseJSON(response.text)

        if (parsed.success) {
          const evaluation = evaluateScenePlan(parsed.data, test)
          testResult[modelKey] = {
            success: true,
            latency: response.latency,
            tokens: response.usage,
            cost: response.cost,
            quality: evaluation.percentage,
            evaluation: evaluation.scores,
            shots: parsed.data.shots?.length || 0,
            assets: parsed.data.assets_needed?.length || 0
          }
          console.log(`✓ ${response.latency}ms | ${evaluation.percentage}% quality | $${response.cost.totalCost.toFixed(4)}`)

          // Save detailed output for manual review
          await saveTestOutput(test.name, modelId, {
            timestamp: new Date().toISOString(),
            model: modelId,
            test: test.name,
            prompt: test.prompt,
            systemPrompt: SCENE_PLANNER_SYSTEM,
            rawResponse: response.text,
            parsedPlan: parsed.data,
            usage: response.usage,
            cost: response.cost,
            qualityScore: evaluation.percentage,
            qualityBreakdown: evaluation.scores,
            latencyMs: response.latency
          })
        } else {
          testResult[modelKey] = { success: false, error: 'JSON parse failed', latency: response.latency }
          console.log(`✗ JSON parse failed (${response.latency}ms)`)

          // Save failed output for debugging
          await saveTestOutput(test.name, modelId, {
            timestamp: new Date().toISOString(),
            model: modelId,
            test: test.name,
            prompt: test.prompt,
            rawResponse: response.text,
            parseError: parsed.error,
            latencyMs: response.latency
          })
        }
      } catch (e) {
        testResult[modelKey] = { success: false, error: e.message }
        console.log(`✗ ${e.message}`)
      }
    }

    results.push(testResult)
  }

  // Summary
  console.log('\n\n═══════════════════════════════════════════════════════════════')
  console.log('  SUMMARY')
  console.log('═══════════════════════════════════════════════════════════════\n')

  const summary = {
    flash: { successes: 0, avgLatency: 0, avgQuality: 0, totalTokens: 0, totalCost: 0 },
    pro: { successes: 0, avgLatency: 0, avgQuality: 0, totalTokens: 0, totalCost: 0 }
  }

  for (const r of results) {
    for (const model of ['flash', 'pro']) {
      if (r[model]?.success) {
        summary[model].successes++
        summary[model].avgLatency += r[model].latency
        summary[model].avgQuality += r[model].quality
        summary[model].totalTokens += r[model].tokens.outputTokens
        summary[model].totalCost += r[model].cost?.totalCost || 0
      }
    }
  }

  for (const model of ['flash', 'pro']) {
    const s = summary[model]
    if (s.successes > 0) {
      s.avgLatency = Math.round(s.avgLatency / s.successes)
      s.avgQuality = Math.round(s.avgQuality / s.successes)
    }
  }

  console.log('  Model   | Success | Avg Latency | Avg Quality | Total Cost')
  console.log('  --------|---------|-------------|-------------|------------')
  console.log(`  Flash   | ${summary.flash.successes}/${results.length}     | ${String(summary.flash.avgLatency).padEnd(4)}ms     | ${String(summary.flash.avgQuality).padEnd(3)}%        | $${summary.flash.totalCost.toFixed(4)}`)
  console.log(`  Pro     | ${summary.pro.successes}/${results.length}     | ${String(summary.pro.avgLatency).padEnd(4)}ms     | ${String(summary.pro.avgQuality).padEnd(3)}%        | $${summary.pro.totalCost.toFixed(4)}`)

  const grandTotal = summary.flash.totalCost + summary.pro.totalCost
  console.log(`\n  Total validation cost: $${grandTotal.toFixed(4)}`)
  console.log('\n  Pricing (per 1M tokens):')
  console.log('  Flash: $0.50 input, $3.00 output')
  console.log('  Pro:   $2.00 input, $12.00 output (<200k context)')
  console.log('  Pro is ~4x more expensive than Flash')

  // Recommendation
  console.log('\n  RECOMMENDATION:')
  if (summary.flash.avgQuality >= summary.pro.avgQuality * 0.9) {
    console.log('  → Use FLASH for iteration (good quality, much cheaper)')
    console.log('  → Use PRO only for final quality pass or complex reasoning')
  } else {
    console.log('  → PRO shows significantly better quality')
    console.log('  → Consider PRO for scene planning, FLASH for asset generation')
  }

  // Save summary report
  const summaryPath = await saveSummaryReport(summary, results)
  console.log(`\n  Outputs saved to: ${OUTPUT_DIR}/`)
  console.log(`  Summary report: ${summaryPath}`)

  return { results, summary, outputDir: OUTPUT_DIR }
}

// Run if executed directly (not imported)
const isMainModule = import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  runComparison().catch(console.error)
}

export {
  runComparison,
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
}
