#!/usr/bin/env node
/**
 * Test harness for relationship-based scene planning prompt
 * 
 * Sends diverse prompts to Gemini and validates the output schema.
 * Run with: node tools/test-relationship-prompt.js
 * 
 * Requires GEMINI_API_KEY environment variable or .env file
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Load .env if exists
const envPath = path.join(__dirname, '..', '.env')
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^=]+)=["']?(.+?)["']?$/)
    if (match) {
      process.env[match[1].trim()] = match[2].trim()
    }
  }
}

const API_KEY = process.env.GEMINI_API_KEY
if (!API_KEY) {
  console.error('❌ GEMINI_API_KEY not set. Export it or add to .env')
  process.exit(1)
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST PROMPTS - Diverse scenarios to stress test the schema
// ═══════════════════════════════════════════════════════════════════════════

const TEST_PROMPTS = [
  // Standard scenes
  { name: 'surf_diner', prompt: '60s Hollywood surf themed diner' },
  { name: 'medieval_village', prompt: 'Medieval village with central well' },
  { name: 'haunted_cemetery', prompt: 'Haunted Victorian cemetery at night' },
  
  // Edge cases
  { name: 'abstract', prompt: 'A feeling of loneliness' },
  { name: 'minimal', prompt: 'Forest' },
  { name: 'dense_urban', prompt: 'Busy Tokyo street corner at night with neon signs' },
  { name: 'single_focus', prompt: 'A dragon' },
  
  // Relationship-heavy
  { name: 'marketplace', prompt: 'Medieval marketplace with stalls and merchants' },
  { name: 'gas_station', prompt: 'Abandoned 1950s gas station in desert' },
  { name: 'zen_garden', prompt: 'Japanese zen garden with tea house' },
  
  // Scale challenges
  { name: 'tiny_world', prompt: 'Tiny fairy village in a mushroom forest' },
  { name: 'giant_scale', prompt: 'Ancient ruins with colossal statues' },
  
  // Unusual themes
  { name: 'underwater', prompt: 'Underwater coral reef scene' },
  { name: 'space', prompt: 'Moon base with astronauts' },
  { name: 'steampunk', prompt: 'Steampunk airship dock' },
]

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMA VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

const VALID_RELATIONSHIP_TYPES = [
  'attached_to', 'adjacent_to', 'leaning_against', 'hanging_from', 'on_top_of',
  'flanking', 'along', 'scattered', 'framing'
]

const VALID_PATTERNS = ['cluster', 'grid', 'row', 'circle']
const VALID_BIOMES = ['grass', 'desert', 'snow', 'forest', 'sand', 'volcanic']
const VALID_CATEGORIES = ['buildings', 'props', 'nature', 'characters', 'vehicles']

function validateSchema(plan, promptName) {
  const errors = []
  const warnings = []
  
  // Check top-level structure
  if (!plan.terrain?.biome) {
    errors.push('Missing terrain.biome')
  } else if (!VALID_BIOMES.includes(plan.terrain.biome)) {
    warnings.push(`Unknown biome: ${plan.terrain.biome}`)
  }
  
  // Check structures
  if (!plan.structures || plan.structures.length === 0) {
    errors.push('No structures defined (need at least 1)')
  } else {
    const ids = new Set()
    for (const s of plan.structures) {
      if (!s.id) errors.push('Structure missing id')
      if (ids.has(s.id)) errors.push(`Duplicate structure id: ${s.id}`)
      ids.add(s.id)
      if (!s.asset?.prompt) errors.push(`Structure ${s.id} missing asset.prompt`)
      if (!s.asset?.realWorldSize) warnings.push(`Structure ${s.id} missing realWorldSize`)
      if (!s.placement) errors.push(`Structure ${s.id} missing placement`)
    }
  }
  
  // Check decorations
  const structureIds = new Set((plan.structures || []).map(s => s.id))
  
  if (plan.decorations) {
    for (let i = 0; i < plan.decorations.length; i++) {
      const d = plan.decorations[i]
      if (!d.asset?.prompt) errors.push(`Decoration ${i} missing asset.prompt`)
      if (!d.relationship) {
        errors.push(`Decoration ${i} missing relationship (this is the key problem we're solving!)`)
      } else {
        if (!VALID_RELATIONSHIP_TYPES.includes(d.relationship.type)) {
          warnings.push(`Decoration ${i} has unknown relationship type: ${d.relationship.type}`)
        }
        if (d.relationship.target && !structureIds.has(d.relationship.target)) {
          // Could be referencing an arrangement, check later
          if (!d.relationship.target.includes('.')) {
            warnings.push(`Decoration ${i} references unknown target: ${d.relationship.target}`)
          }
        }
      }
    }
  }
  
  // Check arrangements
  if (plan.arrangements) {
    for (const arr of plan.arrangements) {
      if (!arr.name) warnings.push('Arrangement missing name')
      if (!arr.items || arr.items.length === 0) {
        errors.push(`Arrangement ${arr.name || '?'} has no items`)
      }
      if (!arr.placement) {
        warnings.push(`Arrangement ${arr.name || '?'} missing placement`)
      }
      if (arr.pattern && !VALID_PATTERNS.includes(arr.pattern)) {
        warnings.push(`Unknown arrangement pattern: ${arr.pattern}`)
      }
    }
  }
  
  // Check atmosphere
  if (plan.atmosphere) {
    let scatteredCount = 0
    let relationshipCount = 0
    
    for (let i = 0; i < plan.atmosphere.length; i++) {
      const a = plan.atmosphere[i]
      if (!a.asset?.prompt) errors.push(`Atmosphere ${i} missing asset.prompt`)
      if (a.relationship) {
        relationshipCount++
        if (a.relationship.type === 'scattered') scatteredCount++
      }
    }
    
    // It's okay if atmosphere uses scattered, but should have some relationships
    if (relationshipCount === 0 && plan.atmosphere.length > 0) {
      warnings.push('Atmosphere has no relationship definitions')
    }
  }
  
  // Check NPCs
  if (plan.npcs) {
    for (const npc of plan.npcs) {
      if (!npc.asset?.prompt) errors.push('NPC missing asset.prompt')
      if (!npc.placement) warnings.push('NPC missing placement context')
    }
  }
  
  // Count totals
  const counts = {
    structures: plan.structures?.length || 0,
    decorations: plan.decorations?.length || 0,
    arrangements: plan.arrangements?.length || 0,
    atmosphereTypes: plan.atmosphere?.length || 0,
    atmosphereTotal: (plan.atmosphere || []).reduce((sum, a) => sum + (a.count || 1), 0),
    npcs: plan.npcs?.length || 0
  }
  
  // Density checks
  if (counts.structures === 0) {
    errors.push('No structures - everything needs an anchor')
  }
  if (counts.decorations === 0 && counts.atmosphereTotal < 10) {
    warnings.push('Very sparse scene - consider more decorations or atmosphere')
  }
  
  return { errors, warnings, counts }
}

// ═══════════════════════════════════════════════════════════════════════════
// RELATIONSHIP QUALITY METRICS
// ═══════════════════════════════════════════════════════════════════════════

function analyzeRelationshipQuality(plan) {
  const metrics = {
    hasAttachments: false,      // Things attached to structures
    hasAdjacencies: false,      // Things adjacent to structures
    hasFlanking: false,         // Symmetric pairs
    hasScatter: false,          // Distributed fill
    hasArrangements: false,     // Functional groups
    groundedDecorations: 0,     // Decorations with proper relationships
    floatingDecorations: 0,     // Decorations without relationships (BAD)
    relationshipDiversity: 0,   // Unique relationship types used
  }
  
  const typesUsed = new Set()
  
  // Analyze decorations
  for (const d of (plan.decorations || [])) {
    if (d.relationship?.type) {
      typesUsed.add(d.relationship.type)
      metrics.groundedDecorations++
      
      if (d.relationship.type === 'attached_to') metrics.hasAttachments = true
      if (d.relationship.type === 'adjacent_to') metrics.hasAdjacencies = true
    } else {
      metrics.floatingDecorations++
    }
  }
  
  // Analyze atmosphere
  for (const a of (plan.atmosphere || [])) {
    if (a.relationship?.type) {
      typesUsed.add(a.relationship.type)
      
      if (a.relationship.type === 'flanking') metrics.hasFlanking = true
      if (a.relationship.type === 'scattered') metrics.hasScatter = true
    }
  }
  
  // Check arrangements
  if (plan.arrangements && plan.arrangements.length > 0) {
    metrics.hasArrangements = true
  }
  
  metrics.relationshipDiversity = typesUsed.size
  
  // Calculate quality score (0-100)
  let score = 0
  if (metrics.hasAttachments) score += 20  // Key for signs, mounted items
  if (metrics.hasAdjacencies) score += 15  // Key for furniture, equipment
  if (metrics.hasFlanking) score += 15     // Key for framing
  if (metrics.hasScatter) score += 10      // Good for fill
  if (metrics.hasArrangements) score += 20 // Key for functional groups
  score += Math.min(20, metrics.relationshipDiversity * 4)  // Diversity bonus
  
  // Penalty for floating decorations
  if (metrics.floatingDecorations > 0) {
    score -= metrics.floatingDecorations * 5
  }
  
  metrics.score = Math.max(0, Math.min(100, score))
  
  return metrics
}

// ═══════════════════════════════════════════════════════════════════════════
// GEMINI API CALL
// ═══════════════════════════════════════════════════════════════════════════

async function callGemini(userPrompt, systemPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        { role: 'user', parts: [{ text: userPrompt }] }
      ],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 8192
      }
    })
  })
  
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Gemini API error: ${response.status} - ${error}`)
  }
  
  const data = await response.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
}

function parseJSON(text) {
  // Remove markdown fences
  let json = text.trim()
  if (json.startsWith('```json')) json = json.slice(7)
  else if (json.startsWith('```')) json = json.slice(3)
  if (json.endsWith('```')) json = json.slice(0, -3)
  
  return JSON.parse(json.trim())
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN TEST RUNNER
// ═══════════════════════════════════════════════════════════════════════════

async function runTests(promptsToRun = TEST_PROMPTS) {
  // Load the system prompt
  const promptPath = path.join(__dirname, '..', 'src', 'generator', 'prompts', 'relationshipScenePlanning.txt')
  const systemPrompt = fs.readFileSync(promptPath, 'utf-8')
  
  console.log('═══════════════════════════════════════════════════════════════════')
  console.log('RELATIONSHIP SCENE PLANNING - PROMPT VALIDATION TEST')
  console.log('═══════════════════════════════════════════════════════════════════')
  console.log(`Testing ${promptsToRun.length} prompts...\n`)
  
  const results = []
  
  for (const test of promptsToRun) {
    process.stdout.write(`Testing: ${test.name.padEnd(20)} `)
    
    try {
      const startTime = Date.now()
      const rawResponse = await callGemini(test.prompt, systemPrompt)
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      
      // Try to parse
      let plan
      try {
        plan = parseJSON(rawResponse)
      } catch (parseError) {
        console.log(`❌ JSON PARSE FAILED (${elapsed}s)`)
        results.push({
          name: test.name,
          prompt: test.prompt,
          success: false,
          error: `JSON parse: ${parseError.message}`,
          rawResponse: rawResponse.slice(0, 500)
        })
        continue
      }
      
      // Validate schema
      const validation = validateSchema(plan, test.name)
      const quality = analyzeRelationshipQuality(plan)
      
      if (validation.errors.length > 0) {
        console.log(`⚠️  SCHEMA ERRORS (${elapsed}s) - Quality: ${quality.score}/100`)
        results.push({
          name: test.name,
          prompt: test.prompt,
          success: false,
          errors: validation.errors,
          warnings: validation.warnings,
          counts: validation.counts,
          quality,
          plan
        })
      } else {
        console.log(`✅ OK (${elapsed}s) - Quality: ${quality.score}/100`)
        results.push({
          name: test.name,
          prompt: test.prompt,
          success: true,
          warnings: validation.warnings,
          counts: validation.counts,
          quality,
          plan
        })
      }
      
    } catch (error) {
      console.log(`❌ API ERROR: ${error.message}`)
      results.push({
        name: test.name,
        prompt: test.prompt,
        success: false,
        error: error.message
      })
    }
    
    // Rate limiting pause
    await new Promise(r => setTimeout(r, 1000))
  }
  
  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════════')
  console.log('SUMMARY')
  console.log('═══════════════════════════════════════════════════════════════════')
  
  const passed = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length
  const avgQuality = results
    .filter(r => r.quality)
    .reduce((sum, r) => sum + r.quality.score, 0) / Math.max(1, results.filter(r => r.quality).length)
  
  console.log(`Passed: ${passed}/${results.length}`)
  console.log(`Failed: ${failed}/${results.length}`)
  console.log(`Average Quality Score: ${avgQuality.toFixed(0)}/100`)
  
  // Detailed failure report
  const failures = results.filter(r => !r.success)
  if (failures.length > 0) {
    console.log('\n─── FAILURES ───')
    for (const f of failures) {
      console.log(`\n${f.name}: "${f.prompt}"`)
      if (f.error) console.log(`  Error: ${f.error}`)
      if (f.errors) {
        for (const e of f.errors) console.log(`  ❌ ${e}`)
      }
    }
  }
  
  // Quality breakdown
  console.log('\n─── QUALITY BREAKDOWN ───')
  for (const r of results.filter(r => r.quality)) {
    const q = r.quality
    const flags = [
      q.hasAttachments ? '📌attach' : '',
      q.hasAdjacencies ? '🔗adjacent' : '',
      q.hasFlanking ? '🎋flank' : '',
      q.hasScatter ? '✨scatter' : '',
      q.hasArrangements ? '📦arrange' : ''
    ].filter(Boolean).join(' ')
    
    console.log(`${r.name.padEnd(20)} Score: ${String(q.score).padStart(3)}/100  ${flags}`)
  }
  
  // Save full results
  const outputPath = path.join(__dirname, '..', `relationship-prompt-test-${Date.now()}.json`)
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2))
  console.log(`\nFull results saved to: ${outputPath}`)
  
  return results
}

// Run specific tests from command line args, or all
const args = process.argv.slice(2)
if (args.length > 0) {
  const filtered = TEST_PROMPTS.filter(t => args.includes(t.name))
  if (filtered.length === 0) {
    console.log('Available tests:', TEST_PROMPTS.map(t => t.name).join(', '))
    process.exit(1)
  }
  runTests(filtered)
} else {
  runTests()
}
