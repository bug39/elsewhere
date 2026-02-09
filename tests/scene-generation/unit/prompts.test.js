/**
 * Unit tests for scene prompts and parsing
 */

import { describe, it, expect } from 'vitest'
import {
  SCENE_PLANNING_PROMPT,
  SCENE_EVALUATION_PROMPT,
  buildScenePlanningPrompt,
  buildSceneEvaluationSystemPrompt,
  buildRefinementPrompt,
  parseScenePlan,
  parseSceneEvaluation,
  validateV2Structures,
  LAYER_SPACING_DEFAULTS,
  MAX_REASONABLE_RADIUS
} from '../../../src/generator/scenePrompts'
import { SCENE_GENERATION } from '../../../src/shared/constants'

describe('SCENE_PLANNING_PROMPT', () => {
  it('includes scene zone size information', () => {
    // Scene generation uses a 380m × 380m zone (95% of 400m world)
    expect(SCENE_PLANNING_PROMPT).toContain('380m')
    expect(SCENE_PLANNING_PROMPT).toContain('380')
  })

  it('includes placement types', () => {
    expect(SCENE_PLANNING_PROMPT).toContain('focal')
    expect(SCENE_PLANNING_PROMPT).toContain('scatter')
    expect(SCENE_PLANNING_PROMPT).toContain('cluster')
    expect(SCENE_PLANNING_PROMPT).toContain('ring')
  })

  it('includes biome options', () => {
    expect(SCENE_PLANNING_PROMPT).toContain('grass')
    expect(SCENE_PLANNING_PROMPT).toContain('forest')
    expect(SCENE_PLANNING_PROMPT).toContain('desert')
  })

  it('includes JSON output format', () => {
    expect(SCENE_PLANNING_PROMPT).toContain('"terrain"')
    expect(SCENE_PLANNING_PROMPT).toContain('"assets"')
    expect(SCENE_PLANNING_PROMPT).toContain('"npcs"')
  })
})

describe('SCENE_EVALUATION_PROMPT', () => {
  it('includes scoring criteria', () => {
    expect(SCENE_EVALUATION_PROMPT).toContain('COMPOSITION')
    expect(SCENE_EVALUATION_PROMPT).toContain('DENSITY')
    expect(SCENE_EVALUATION_PROMPT).toContain('THEME_CONSISTENCY')
    expect(SCENE_EVALUATION_PROMPT).toContain('SPATIAL_BALANCE')
  })

  it('includes score range', () => {
    expect(SCENE_EVALUATION_PROMPT).toContain('0-100')
  })

  it('includes satisfactory threshold', () => {
    expect(SCENE_EVALUATION_PROMPT).toContain('75')
  })
})

describe('buildScenePlanningPrompt', () => {
  it('includes user description', () => {
    const result = buildScenePlanningPrompt('A medieval village')
    expect(result).toContain('A medieval village')
  })

  it('adds zone mode note for zone generation', () => {
    const result = buildScenePlanningPrompt('A forest corner', {
      mode: 'zone',
      existingAssetCount: 5
    })
    expect(result).toContain('ZONE/AREA')
    expect(result).toContain('5 assets')
  })

  it('handles full mode without extra notes', () => {
    const result = buildScenePlanningPrompt('A full world', { mode: 'full' })
    expect(result).not.toContain('ZONE')
  })
})

describe('buildSceneEvaluationSystemPrompt', () => {
  it('includes base evaluation prompt', () => {
    const result = buildSceneEvaluationSystemPrompt('A test scene')
    expect(result).toContain('COMPOSITION')
    expect(result).toContain('overallScore')
  })

  it('includes original request', () => {
    const result = buildSceneEvaluationSystemPrompt('A medieval village with cottages')
    expect(result).toContain('A medieval village with cottages')
    expect(result).toContain('ORIGINAL REQUEST')
  })
})

describe('buildRefinementPrompt', () => {
  it('includes evaluation results', () => {
    const evaluation = { overallScore: 65, actionItems: [] }
    const plan = { assets: [] }

    const result = buildRefinementPrompt(evaluation, plan)
    expect(result).toContain('65')
    expect(result).toContain('EVALUATION')
  })

  it('includes current plan', () => {
    const evaluation = { overallScore: 70, actionItems: [] }
    const plan = { assets: [{ prompt: 'test asset' }] }

    const result = buildRefinementPrompt(evaluation, plan)
    expect(result).toContain('test asset')
    expect(result).toContain('CURRENT SCENE')
  })
})

describe('parseScenePlan', () => {
  it('parses valid JSON', () => {
    const input = JSON.stringify({
      terrain: { biome: 'grass', modifications: [] },
      assets: [{ prompt: 'test', category: 'props', count: 1 }]
    })

    const result = parseScenePlan(input)
    expect(result).toBeTruthy()
    expect(result.terrain.biome).toBe('grass')
    expect(result.assets.length).toBe(1)
  })

  it('handles markdown code blocks', () => {
    const input = '```json\n{"terrain": {"biome": "forest"}, "assets": []}\n```'

    const result = parseScenePlan(input)
    expect(result).toBeTruthy()
    expect(result.terrain.biome).toBe('forest')
  })

  it('returns null for invalid JSON', () => {
    const result = parseScenePlan('not valid json {{{')
    expect(result).toBeNull()
  })

  it('returns null for missing required sections', () => {
    const result = parseScenePlan('{"randomKey": 123}')
    expect(result).toBeNull()
  })

  it('clamps asset count to valid range', () => {
    const input = JSON.stringify({
      terrain: { biome: 'grass' },
      assets: [{ prompt: 'test', count: 100 }]
    })

    const result = parseScenePlan(input)
    expect(result.assets[0].count).toBeLessThanOrEqual(20)
  })

  it('clamps scale via size invariants system', () => {
    // With universal baseline: scale 500 × 2m baseline = 1000m (way over max)
    // Props max is 5m, so realWorldSize clamps to 5m
    // Scale = (5m / 2m) × 8 = 20
    const input = JSON.stringify({
      terrain: { biome: 'grass' },
      assets: [{ prompt: 'test', category: 'props', scale: 500 }]
    })

    const result = parseScenePlan(input)
    expect(result.assets[0].realWorldSize).toBe(5) // Props max
    expect(result.assets[0].scale).toBeCloseTo(20) // (5m / 2m) × 8 GAME_SCALE_FACTOR
  })

  it('provides default values for missing optional fields', () => {
    // With universal baseline + GAME_SCALE_FACTOR:
    // no size specified → uses category default (1.5m for props)
    // Scale = (1.5m / 2m) × 8 = 6
    const input = JSON.stringify({
      terrain: { biome: 'grass' },
      assets: [{ prompt: 'test', category: 'props' }]
    })

    const result = parseScenePlan(input)
    expect(result.assets[0].count).toBe(1)
    expect(result.assets[0].realWorldSize).toBe(1.5) // Default for props
    expect(result.assets[0].scale).toBeCloseTo(6) // (1.5m / 2m) × 8 GAME_SCALE_FACTOR
    expect(result.assets[0].radius).toBe(30)
  })

  it('ensures arrays exist even if empty', () => {
    const input = JSON.stringify({
      terrain: { biome: 'grass' }
    })

    const result = parseScenePlan(input)
    expect(Array.isArray(result.assets)).toBe(true)
    expect(Array.isArray(result.npcs)).toBe(true)
  })
})

describe('parseSceneEvaluation', () => {
  it('parses valid evaluation JSON', () => {
    const input = JSON.stringify({
      overallScore: 75,
      composition: { score: 80, issues: [], suggestions: [] },
      density: { score: 70, tooSparse: [], tooCrowded: [] },
      themeConsistency: { score: 75, outliers: [], missing: [] },
      spatialBalance: { score: 75, emptyQuadrants: [], cluttered: [] },
      terrainFit: { score: 75, issues: [] },
      actionItems: [],
      satisfactory: true
    })

    const result = parseSceneEvaluation(input)
    expect(result).toBeTruthy()
    expect(result.overallScore).toBe(75)
    expect(result.satisfactory).toBe(true)
  })

  it('handles markdown code blocks', () => {
    const input = '```json\n{"overallScore": 80, "satisfactory": true}\n```'

    const result = parseSceneEvaluation(input)
    expect(result).toBeTruthy()
    expect(result.overallScore).toBe(80)
  })

  it('returns null for missing overallScore', () => {
    const result = parseSceneEvaluation('{"satisfactory": true}')
    expect(result).toBeNull()
  })

  it('calculates satisfactory if not provided', () => {
    const highScore = JSON.stringify({
      overallScore: 80,
      actionItems: []
    })

    const result = parseSceneEvaluation(highScore)
    expect(result.satisfactory).toBe(true)
  })

  it('sets satisfactory false for low score', () => {
    const lowScore = JSON.stringify({
      overallScore: 60,
      actionItems: []
    })

    const result = parseSceneEvaluation(lowScore)
    expect(result.satisfactory).toBe(false)
  })

  it('sets satisfactory false for critical action items', () => {
    const critical = JSON.stringify({
      overallScore: 80,
      actionItems: [{ priority: 1, action: 'add', target: 'missing element' }]
    })

    const result = parseSceneEvaluation(critical)
    expect(result.satisfactory).toBe(false)
  })

  it('ensures actionItems array exists', () => {
    const input = JSON.stringify({ overallScore: 70 })

    const result = parseSceneEvaluation(input)
    expect(Array.isArray(result.actionItems)).toBe(true)
  })

  it('returns null for invalid JSON', () => {
    const result = parseSceneEvaluation('not valid json')
    expect(result).toBeNull()
  })
})

describe('LAYER_SPACING_DEFAULTS', () => {
  it('has defaults for all composition layers', () => {
    expect(LAYER_SPACING_DEFAULTS).toHaveProperty('focal')
    expect(LAYER_SPACING_DEFAULTS).toHaveProperty('anchors')
    expect(LAYER_SPACING_DEFAULTS).toHaveProperty('frame')
    expect(LAYER_SPACING_DEFAULTS).toHaveProperty('fill')
  })

  it('frame layer has larger minDistance than fill layer', () => {
    expect(LAYER_SPACING_DEFAULTS.frame.minDistance).toBeGreaterThan(LAYER_SPACING_DEFAULTS.fill.minDistance)
  })

  it('fill layer has smaller minDistance than frame layer', () => {
    // Fill uses smaller spacing than frame, but not too small for 380m zone
    expect(LAYER_SPACING_DEFAULTS.fill.minDistance).toBeLessThan(LAYER_SPACING_DEFAULTS.frame.minDistance)
  })
})

describe('MAX_REASONABLE_RADIUS', () => {
  it('is based on scene zone size', () => {
    expect(MAX_REASONABLE_RADIUS).toBe(SCENE_GENERATION.SIZE / 2 - 10)
  })

  it('prevents placement outside scene zone', () => {
    expect(MAX_REASONABLE_RADIUS).toBeLessThan(SCENE_GENERATION.SIZE / 2)
  })
})

describe('parseScenePlan with layered format', () => {
  it('applies layer-specific spacing defaults', () => {
    const layeredInput = JSON.stringify({
      terrain: { biome: 'grass' },
      layers: {
        focal: {
          asset: { prompt: 'ancient well', category: 'props', realWorldSize: 5 },
          position: 'center'
        },
        anchors: [{
          asset: { prompt: 'cottage', category: 'buildings', realWorldSize: 10 },
          placement: 'ring',
          reference: 'focal',
          distance: 25,
          count: 3
        }],
        frame: [{
          asset: { prompt: 'oak tree', category: 'nature', realWorldSize: 15 },
          placement: 'background',
          count: 5
        }],
        fill: [{
          asset: { prompt: 'rock', category: 'props', realWorldSize: 1 },
          placement: 'scatter',
          count: 10
        }]
      }
    })

    const result = parseScenePlan(layeredInput)

    // Check that layer-specific defaults were applied
    expect(result._isLayered).toBe(true)
    expect(result.assets.length).toBe(4)  // focal + 1 anchor + 1 frame + 1 fill

    // Frame assets should have minDistance >= 40
    const frameAsset = result.assets.find(a => a._layer === 'frame')
    expect(frameAsset.minDistance).toBeGreaterThanOrEqual(40)

    // Fill assets should have default density gradient
    const fillAsset = result.assets.find(a => a._layer === 'fill')
    expect(fillAsset.densityGradient).toBeDefined()
  })

  it('clamps radius to MAX_REASONABLE_RADIUS', () => {
    const layeredInput = JSON.stringify({
      terrain: { biome: 'grass' },
      layers: {
        focal: {
          asset: { prompt: 'well', category: 'props', realWorldSize: 3 },
          position: 'center'
        },
        anchors: [{
          asset: { prompt: 'cottage', category: 'buildings', realWorldSize: 8 },
          radius: 200,  // Excessive radius
          count: 3
        }],
        frame: [],
        fill: []
      }
    })

    const result = parseScenePlan(layeredInput)
    const anchorAsset = result.assets.find(a => a._layer === 'anchors')

    // Radius should be clamped to MAX_REASONABLE_RADIUS
    expect(anchorAsset.radius).toBeLessThanOrEqual(MAX_REASONABLE_RADIUS)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// V2 SOFT VALIDATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('validateV2Structures', () => {
  it('passes through valid positions unchanged', () => {
    const structures = [
      { id: 'house', position: [200, 200] },
      { id: 'tree', position: [100, 80] }  // 134m apart — well beyond 40m threshold
    ]

    const result = validateV2Structures(structures)

    expect(result.warnings).toHaveLength(0)
    expect(structures[0].position).toEqual([200, 200])
    expect(structures[1].position).toEqual([100, 80])
  })

  it('clamps out-of-bounds positions to [20, 380]', () => {
    const structures = [
      { id: 'edge_left', position: [5, 200] },
      { id: 'edge_top', position: [200, -10] },
      { id: 'edge_right', position: [450, 200] },
      { id: 'edge_bottom', position: [200, 500] }
    ]

    const result = validateV2Structures(structures)

    expect(result.warnings.length).toBeGreaterThanOrEqual(4)
    expect(structures[0].position).toEqual([20, 200])
    expect(structures[1].position).toEqual([200, 20])
    expect(structures[2].position).toEqual([380, 200])
    expect(structures[3].position).toEqual([200, 380])
  })

  it('nudges overlapping structures apart by 70m', () => {
    const structures = [
      { id: 'building_a', position: [200, 200] },
      { id: 'building_b', position: [200, 200] }  // Exact same position
    ]

    const result = validateV2Structures(structures)

    expect(result.warnings.length).toBeGreaterThanOrEqual(1)
    // First structure stays in place
    expect(structures[0].position).toEqual([200, 200])
    // Second structure should be nudged ~70m away
    const [bx, bz] = structures[1].position
    const dist = Math.sqrt((bx - 200) ** 2 + (bz - 200) ** 2)
    expect(dist).toBeGreaterThanOrEqual(60)  // At least 60m away
  })

  it('nudges structures that are within 40m threshold', () => {
    const structures = [
      { id: 'building_a', position: [200, 200] },
      { id: 'building_b', position: [220, 210] }  // ~22m apart — within 40m threshold
    ]

    const result = validateV2Structures(structures)

    expect(result.warnings.length).toBeGreaterThanOrEqual(1)
    // Second structure should be nudged away
    const [bx, bz] = structures[1].position
    const dist = Math.sqrt((bx - 200) ** 2 + (bz - 200) ** 2)
    expect(dist).toBeGreaterThanOrEqual(60)
  })

  it('does not nudge structures that are far enough apart', () => {
    const structures = [
      { id: 'building_a', position: [200, 200] },
      { id: 'building_b', position: [300, 200] }  // 100m apart — well beyond 40m
    ]

    const result = validateV2Structures(structures)

    // No overlap warnings
    const nudgeWarnings = result.warnings.filter(w => w.includes('Nudged'))
    expect(nudgeWarnings).toHaveLength(0)
    expect(structures[1].position).toEqual([300, 200])
  })

  it('warns about clustering when >2 structures within 80m', () => {
    // After nudging, structures may still cluster — check pre-nudge positions far enough
    // Use 3 structures spaced 50m apart (within 80m cluster threshold)
    const structures = [
      { id: 'a', position: [200, 200] },
      { id: 'b', position: [250, 200] },  // 50m from a — nudged but still within 80m after
      { id: 'c', position: [200, 250] }   // 50m from a — nudged but still within 80m after
    ]

    const result = validateV2Structures(structures)

    const clusterWarnings = result.warnings.filter(w => w.includes('Cluster'))
    expect(clusterWarnings.length).toBeGreaterThanOrEqual(1)
  })

  it('does not warn about clustering for spread structures', () => {
    const structures = [
      { id: 'a', position: [50, 50] },
      { id: 'b', position: [200, 200] },
      { id: 'c', position: [350, 350] }   // Each pair > 80m apart
    ]

    const result = validateV2Structures(structures)

    const clusterWarnings = result.warnings.filter(w => w.includes('Cluster'))
    expect(clusterWarnings).toHaveLength(0)
  })

  it('handles structures with missing position gracefully', () => {
    const structures = [
      { id: 'valid', position: [200, 200] },
      { id: 'missing_pos' }  // No position
    ]

    // Should not throw
    const result = validateV2Structures(structures)
    expect(result.structures).toHaveLength(2)
  })

  it('clamps nudged positions to bounds', () => {
    // Two structures overlapping near the edge
    const structures = [
      { id: 'a', position: [380, 380] },
      { id: 'b', position: [380, 380] }  // Same position, at edge
    ]

    const result = validateV2Structures(structures)

    // Nudged structure should still be within bounds
    const [bx, bz] = structures[1].position
    expect(bx).toBeGreaterThanOrEqual(20)
    expect(bx).toBeLessThanOrEqual(380)
    expect(bz).toBeGreaterThanOrEqual(20)
    expect(bz).toBeLessThanOrEqual(380)
  })
})
