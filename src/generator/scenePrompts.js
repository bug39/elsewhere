/**
 * System prompts for scene generation
 *
 * Main prompts (loaded from ./prompts/ to reduce source file size):
 * 1. LAYERED_SCENE_PLANNING_PROMPT - New layered composition approach (focal → anchors → frame → fill)
 * 2. SCENE_PLANNING_PROMPT - Legacy zone-based approach (kept for backward compatibility)
 * 3. Scene Evaluation - Analyzes screenshot to provide quality scores and refinement suggestions
 */

import { WORLD_SIZE, GRID_SIZE, TILE_SIZE, SCENE_GENERATION } from '../shared/constants'
import { processScenePlan as processSizeInvariants, computeScaleFromSize } from './sizeInvariants'
import { CATEGORY_MIN_DISTANCE } from './placementAlgorithms'

/**
 * Keywords that indicate interior placement (which this system cannot handle).
 * Items with these keywords in their description will be filtered out.
 */
const INTERIOR_KEYWORDS = [
  'inside', 'interior', 'indoor', 'indoors',
  'within building', 'in the building', 'in the room',
  'inside the', 'within the'
]

/**
 * Check if a decoration/asset description suggests interior placement.
 * Interior items would spawn at y=0 on the ground, not inside buildings.
 *
 * @param {Object} decoration - Decoration specification
 * @returns {boolean} True if this appears to be interior placement
 */
function isInteriorPlacement(decoration) {
  const desc = (decoration.asset?.prompt || '').toLowerCase()
  const relDesc = (decoration.relationship?.description || '').toLowerCase()
  const combined = desc + ' ' + relDesc

  return INTERIOR_KEYWORDS.some(kw => combined.includes(kw))
}

/**
 * Layer-specific spacing defaults for composition-aware placement.
 * These values are tuned for a 380m × 380m scene zone.
 *
 * CRITICAL: Do NOT overwrite these with generic defaults (radius=30, minDistance=10)
 * as that destroys the per-layer composition intent.
 */
export const LAYER_SPACING_DEFAULTS = {
  focal: {
    radius: 0,          // Focal is placed at a single point
    minDistance: 0      // N/A for single placement
  },
  anchors: {
    radius: 80,         // Distance from focal for ring/cluster (larger zone = more spread)
    minDistance: 15     // Anchors need room (buildings, large props)
  },
  frame: {
    radius: 150,        // Far from center, near edges
    minDistance: 25     // Large background elements need spacing
  },
  fill: {
    radius: 180,        // Can spread across entire zone
    minDistance: 5      // Small props - some spacing to avoid clumping
  }
}

/**
 * Maximum reasonable radius for any placement.
 * Prevents assets from being placed outside the scene zone.
 */
export const MAX_REASONABLE_RADIUS = SCENE_GENERATION.SIZE / 2 - 10  // 180m for 380m zone

// Import prompts from external files (reduces source token count by ~6,000)
import {
  LAYERED_SCENE_PLANNING_PROMPT,
  SCENE_PLANNING_PROMPT,
  RELATIONSHIP_SCENE_PLANNING_PROMPT,
  VIGNETTE_SCENE_PLANNING_PROMPT,
  SCENE_EVALUATION_PROMPT,
  SCENE_EVALUATION_WITH_REFERENCE_PROMPT,
  SCENE_REFINEMENT_PROMPT,
  SCENE_PLANNING_PROMPT_V2,
  SCENE_EVALUATION_PROMPT_V2,
  SCENE_REFINEMENT_PROMPT_V2
} from './prompts/index.js'

// Re-export prompts for backward compatibility
export {
  LAYERED_SCENE_PLANNING_PROMPT,
  SCENE_PLANNING_PROMPT,
  RELATIONSHIP_SCENE_PLANNING_PROMPT,
  VIGNETTE_SCENE_PLANNING_PROMPT,
  SCENE_EVALUATION_PROMPT,
  SCENE_EVALUATION_WITH_REFERENCE_PROMPT,
  SCENE_REFINEMENT_PROMPT,
  SCENE_PLANNING_PROMPT_V2,
  SCENE_EVALUATION_PROMPT_V2,
  SCENE_REFINEMENT_PROMPT_V2
}

/**
 * Helper to build the user prompt for scene planning
 * @param {string} userDescription - The user's scene description
 * @param {Object} options - Additional options
 * @returns {string} The formatted prompt
 */
export function buildScenePlanningPrompt(userDescription, options = {}) {
  const { mode = 'full', existingAssetCount = 0 } = options

  let prompt = userDescription

  if (mode === 'zone') {
    prompt += `\n\nNOTE: This is a ZONE/AREA generation request. Preserve existing content and only add to the specified area. There are already ${existingAssetCount} assets in the world.`
  }

  return prompt
}

/**
 * Get the appropriate system prompt for scene planning
 *
 * Prompt selection priority:
 * 1. 'v2' mode - New explicit coordinate system (schemaVersion 2)
 * 2. 'relationship' mode - Uses relationship-based prompt (signs on buildings, not ground)
 * 3. 'zone' mode - Legacy zone-based prompt for adding to existing scenes
 * 4. 'full' mode (default) - Relationship-based for best scene composition
 *
 * @param {Object} options - Options for prompt selection
 * @param {string} [options.mode='full'] - 'full' | 'v2' | 'vignette' | 'relationship' | 'zone' | 'layered'
 * @returns {string} The system prompt to use
 */
export function getScenePlanningSystemPrompt(options = {}) {
  const { mode = 'full' } = options

  // V2: Explicit coordinates, simplified schema (experimental)
  if (mode === 'v2') {
    return SCENE_PLANNING_PROMPT_V2
  }

  // Vignette: Narrative-based scene planning (experimental)
  // Organizes scenes as zones containing micro-narrative vignettes
  if (mode === 'vignette') {
    return VIGNETTE_SCENE_PLANNING_PROMPT
  }

  // Use legacy prompt for zone mode (adding to existing scene)
  if (mode === 'zone') {
    return SCENE_PLANNING_PROMPT
  }

  // Explicit layered mode for backward compatibility
  if (mode === 'layered') {
    return LAYERED_SCENE_PLANNING_PROMPT
  }

  // Default to relationship-based prompt for full scene generation
  // This produces intentional scenes where signs mount on buildings, not ground
  return RELATIONSHIP_SCENE_PLANNING_PROMPT
}

/**
 * Helper to build the evaluation prompt with original request context
 * @param {string} originalRequest - The original scene description
 * @param {string} [sceneStateSummary=''] - Optional summary of placed assets
 * @param {Object} [options={}] - Additional options
 * @param {string} [options.mode='full'] - 'v2' uses V2 evaluation prompt
 * @param {Object} [options.scenePlan=null] - Scene plan for V2 (includes structure IDs)
 * @returns {string} The formatted system prompt
 */
export function buildSceneEvaluationSystemPrompt(originalRequest, sceneStateSummary = '', options = {}) {
  const { mode = 'full', scenePlan = null } = options

  // V2 mode: binary verdict with semantic issue descriptions
  if (mode === 'v2') {
    let prompt = SCENE_EVALUATION_PROMPT_V2
    prompt += `\n\nORIGINAL REQUEST: "${originalRequest}"`

    // Include the scene plan so evaluator can reference structure IDs
    if (scenePlan) {
      prompt += `\n\nSCENE PLAN:\n${JSON.stringify(scenePlan, null, 2)}`
    }

    return prompt
  }

  // Legacy mode
  let prompt = SCENE_EVALUATION_PROMPT
  prompt += `\n\nORIGINAL REQUEST: "${originalRequest}"`

  if (sceneStateSummary) {
    prompt += `\n\n${sceneStateSummary}`
  }

  prompt += '\n\nEvaluate how well the scene fulfills this request.'
  return prompt
}

/**
 * Helper to build refinement prompt with current state
 * @param {Object} evaluation - The evaluation results
 * @param {Object} currentPlan - The current scene plan
 * @param {string} [sceneStateSummary=''] - Summary of placed assets with IDs for targeting
 * @returns {string} The formatted prompt
 */
export function buildRefinementPrompt(evaluation, currentPlan, sceneStateSummary = '') {
  let prompt = `EVALUATION RESULTS:
${JSON.stringify(evaluation, null, 2)}

CURRENT SCENE PLAN:
${JSON.stringify(currentPlan, null, 2)}`

  if (sceneStateSummary) {
    prompt += `\n\nCURRENT PLACED ASSETS:\n${sceneStateSummary}`
  }

  prompt += `\n\nBased on the evaluation, output refinements. Use instanceId or structureId from PLACED ASSETS when targeting specific assets.`
  return prompt
}

/**
 * Build V2 refinement prompt - expects complete revised plan output
 * @param {Object} v2Evaluation - V2 evaluation with verdict/issues
 * @param {Object} currentPlan - The current V2 scene plan
 * @returns {string} The formatted prompt
 */
export function buildV2RefinementPrompt(v2Evaluation, currentPlan) {
  return `ORIGINAL SCENE PLAN:
${JSON.stringify(currentPlan, null, 2)}

EVALUATION FEEDBACK:
${v2Evaluation.issues?.map(issue =>
    `- ${issue.type.toUpperCase()}: ${issue.description}${issue.affected?.length ? ` (affects: ${issue.affected.join(', ')})` : ''}. ${issue.suggestion}`
  ).join('\n') || 'No specific issues identified.'}

Revise the plan to address these issues. Output the complete revised plan.`
}

/**
 * Ground cover patterns that should be filtered out
 * These are handled by biome selection, not as placeable assets
 */
const GROUND_COVER_PATTERNS = [
  /\bground\s*cover/i,
  /\bgrass(y)?\s*(cover|carpet|field|meadow|lawn|area|patch|plane)/i,
  /\b(soil|dirt|sand|earth)\s*(cover|carpet|floor|ground)/i,
  /\bfloor\s*(cover|texture|surface)/i,
  /\b(moss|lichen)\s*(carpet|cover|floor)/i,
  /\b(dead|dry|brown)\s*grass/i,
  /\bterrain\s*surface/i,
  /\bmeadow\b/i,
  /\blawn\b/i,
  /\bfield\s*of\s*(grass|flowers)/i,
  /\bcarpet\s*of/i,
  /\bsnow\s*(cover|blanket|ground)/i,
  /\b(grassy|grass)\s+field\b/i,  // Explicit "grassy field" match
  /\bopen\s+field\b/i,            // "open field" is usually ground
  /\bflat\s+(ground|terrain|area)\b/i
]

/**
 * Check if an asset prompt describes ground cover
 * @param {string} prompt - Asset prompt to check
 * @returns {boolean} True if this is a ground cover asset
 */
function isGroundCoverAsset(prompt) {
  return GROUND_COVER_PATTERNS.some(pattern => pattern.test(prompt))
}

/**
 * Parse and validate scene plan JSON from LLM response.
 * Tries formats in order: RELATIONSHIP → LAYERED → LEGACY
 *
 * Detection priority:
 * 1. RELATIONSHIP format: has `structures` array (relationship-aware placement)
 * 2. LAYERED format: has `layers` object with focal/anchors/frame/fill
 * 3. LEGACY format: has `assets` array (zone-based placement)
 *
 * @param {string} response - Raw LLM response
 * @returns {Object|null} Parsed plan or null if invalid
 */
export function parseScenePlan(response) {
  try {
    // Try to extract JSON from the response
    let jsonStr = response.trim()

    // Remove markdown code blocks if present
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7)
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3)
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3)
    }

    const plan = JSON.parse(jsonStr.trim())

    // Detect V2 format: has schemaVersion 2 with explicit coordinates
    if (plan.schemaVersion === 2) {
      console.log('[ScenePlan] Detected V2 format (explicit coordinates)')
      return parseV2Plan(plan)
    }

    // Detect VIGNETTE format: has zones array with vignettes
    // Vignettes are narrative scene descriptions that convert to relationship format
    const isVignetteFormat = Array.isArray(plan.zones) && plan.zones.length > 0 &&
      plan.zones.some(z => Array.isArray(z.vignettes))

    if (isVignetteFormat) {
      console.log('[ScenePlan] Detected VIGNETTE format, converting to relationship schema')
      return parseVignettePlan(plan)
    }

    // Detect RELATIONSHIP format: has structures array
    // This is the new intentional placement system where signs go on buildings
    const isRelationshipFormat = Array.isArray(plan.structures) && plan.structures.length > 0

    if (isRelationshipFormat) {
      console.log('[ScenePlan] Detected RELATIONSHIP format, using relationship-aware placement')
      return parseRelationshipPlan(response)
    }

    // Detect LAYERED format: has layers object
    const isLayeredFormat = plan.layers && (plan.layers.focal || plan.layers.anchors || plan.layers.frame || plan.layers.fill)

    if (isLayeredFormat) {
      console.log('[ScenePlan] Detected LAYERED format, converting to flat asset list')
      return parseLayeredPlan(plan)
    }

    // LEGACY FORMAT: Validate required structure
    if (!plan.assets && !plan.npcs && !plan.terrain) {
      console.warn('Scene plan missing all major sections')
      return null
    }

    console.log('[ScenePlan] Detected LEGACY format (zone-based)')

    // Ensure assets array exists
    plan.assets = plan.assets || []
    plan.npcs = plan.npcs || []
    plan.terrain = plan.terrain || { biome: 'grass', modifications: [] }

    // Filter out ground cover assets (handled by biome, not as 3D objects)
    const originalCount = plan.assets.length
    plan.assets = plan.assets.filter(asset => {
      if (isGroundCoverAsset(asset.prompt)) {
        console.log(`[ScenePlan] Filtered ground cover asset: "${asset.prompt}"`)
        return false
      }
      return true
    })
    if (plan.assets.length < originalCount) {
      console.log(`[ScenePlan] Filtered ${originalCount - plan.assets.length} ground cover asset(s)`)
    }

    // Validate and set defaults for count, radius, minDistance
    for (const asset of plan.assets) {
      asset.count = Math.min(Math.max(asset.count || 1, 1), 20)
      asset.radius = asset.radius || 30
      asset.minDistance = asset.minDistance || 10
    }

    for (const npc of plan.npcs) {
      npc.wanderRadius = npc.wanderRadius || 20
    }

    // Process through size invariants system
    // This converts realWorldSize → scale, enforces limits, handles legacy scale field
    const processedPlan = processSizeInvariants(plan)

    // Log warnings for debugging
    if (processedPlan._sizeWarnings?.length > 0) {
      console.log('[ScenePlan] Size warnings:', processedPlan._sizeWarnings)
    }

    return processedPlan
  } catch (e) {
    console.error('Failed to parse scene plan:', e)
    return null
  }
}

/**
 * Estimate bounding box dimensions from real-world size and category.
 * Buildings are taller than wide, trees are narrow, etc.
 *
 * Supports optional aspect hints for non-standard proportions:
 * - Flat assets (parking lots, ponds): { widthRatio: 1.0, heightRatio: 0.05, depthRatio: 1.0 }
 * - Wide assets: { widthRatio: 2.0, heightRatio: 0.5, depthRatio: 1.0 }
 *
 * @param {number} realWorldSize - The real-world size in meters (largest dimension)
 * @param {string} category - Asset category (buildings, nature, characters, props, vehicles)
 * @param {Object} [aspectHint] - Optional aspect ratio override { widthRatio, heightRatio, depthRatio }
 * @returns {{ width: number, height: number, depth: number }}
 */
export function estimateBoundsFromSize(realWorldSize, category, aspectHint = null) {
  const size = realWorldSize || 2

  // If aspect hint provided, use it directly
  if (aspectHint && typeof aspectHint === 'object') {
    return {
      width: size * (aspectHint.widthRatio ?? 1),
      height: size * (aspectHint.heightRatio ?? 1),
      depth: size * (aspectHint.depthRatio ?? 1)
    }
  }

  switch (category) {
    case 'buildings':
      return { width: size * 0.8, height: size, depth: size * 0.6 }
    case 'nature':
      return { width: size * 0.4, height: size, depth: size * 0.4 }
    case 'characters':
    case 'creatures':
      return { width: size * 0.4, height: size, depth: size * 0.3 }
    case 'props':
    case 'vehicles':
      return { width: size, height: size * 0.6, depth: size * 0.8 }
    default:
      return { width: size, height: size, depth: size }
  }
}

/**
 * Soft-validate V2 structure positions.
 * Repairs common LLM coordinate errors without rejecting the plan.
 *
 * Checks performed:
 * 1. Clamp out-of-bounds positions to [20, 380]
 * 2. Nudge overlapping structures (same or very close positions) by 25m
 * 3. Log clustering warnings when >3 structures within 30m
 *
 * @param {Array} structures - Array of raw V2 structure objects with position: [x, z]
 * @returns {{ structures: Array, warnings: string[] }} Repaired structures + warnings
 */
export function validateV2Structures(structures) {
  const warnings = []
  const BOUNDS_MIN = 20
  const BOUNDS_MAX = 380
  const OVERLAP_THRESHOLD = 40   // Structures within 40m are too close (they render large)
  const NUDGE_DISTANCE = 70      // Push overlapping structures 70m apart
  const CLUSTER_THRESHOLD = 80   // Distance for clustering check
  const CLUSTER_MAX = 2          // Max structures in a cluster before warning

  // Step 1: Clamp out-of-bounds positions
  for (const struct of structures) {
    if (!Array.isArray(struct.position)) continue
    const [x, z] = struct.position
    const clampedX = Math.max(BOUNDS_MIN, Math.min(BOUNDS_MAX, x))
    const clampedZ = Math.max(BOUNDS_MIN, Math.min(BOUNDS_MAX, z))

    if (clampedX !== x || clampedZ !== z) {
      warnings.push(`[V2Validate] Clamped ${struct.id} from [${x}, ${z}] to [${clampedX}, ${clampedZ}] (out of bounds)`)
      struct.position = [clampedX, clampedZ]
    }
  }

  // Step 2: Nudge overlapping structures
  for (let i = 0; i < structures.length; i++) {
    if (!Array.isArray(structures[i].position)) continue

    for (let j = i + 1; j < structures.length; j++) {
      if (!Array.isArray(structures[j].position)) continue

      const [ax, az] = structures[i].position
      const [bx, bz] = structures[j].position
      const dist = Math.sqrt((bx - ax) ** 2 + (bz - az) ** 2)

      if (dist < OVERLAP_THRESHOLD) {
        // Nudge the later structure by 25m in a direction away from the first
        const angle = dist > 0.1
          ? Math.atan2(bz - az, bx - ax)
          : (j * Math.PI / 4)  // Spread evenly if exactly overlapping
        const newX = Math.max(BOUNDS_MIN, Math.min(BOUNDS_MAX, ax + Math.cos(angle) * NUDGE_DISTANCE))
        const newZ = Math.max(BOUNDS_MIN, Math.min(BOUNDS_MAX, az + Math.sin(angle) * NUDGE_DISTANCE))

        warnings.push(`[V2Validate] Nudged ${structures[j].id} from [${bx}, ${bz}] to [${newX.toFixed(0)}, ${newZ.toFixed(0)}] (overlapping with ${structures[i].id})`)
        structures[j].position = [newX, newZ]
      }
    }
  }

  // Step 3: Log clustering warnings
  for (let i = 0; i < structures.length; i++) {
    if (!Array.isArray(structures[i].position)) continue
    const [ax, az] = structures[i].position
    let neighborCount = 0

    for (let j = 0; j < structures.length; j++) {
      if (i === j || !Array.isArray(structures[j].position)) continue
      const [bx, bz] = structures[j].position
      const dist = Math.sqrt((bx - ax) ** 2 + (bz - az) ** 2)
      if (dist < CLUSTER_THRESHOLD) neighborCount++
    }

    if (neighborCount >= CLUSTER_MAX) {
      warnings.push(`[V2Validate] Cluster warning: ${structures[i].id} has ${neighborCount} structures within ${CLUSTER_THRESHOLD}m`)
    }
  }

  // Log all warnings
  for (const w of warnings) {
    console.warn(w)
  }

  return { structures, warnings }
}

/**
 * Parse V2 scene plan with explicit coordinates.
 * Converts to the format expected by the relationship placement system.
 *
 * V2 Schema:
 * - structures: have position: [x, z] instead of position keywords
 * - attachments: unified attachment system (replaces decorations/arrangements/atmosphere)
 * - npcs: same as V1
 *
 * @param {Object} plan - Parsed V2 plan object
 * @returns {Object|null} Normalized plan compatible with relationship placement
 */
export function parseV2Plan(plan) {
  try {
    // Validate minimum required content
    if (!plan.structures || !Array.isArray(plan.structures) || plan.structures.length === 0) {
      console.warn('[V2Plan] Plan must have at least one structure')
      return null
    }

    console.log('[V2Plan] Converting V2 schema to placement format')
    console.log('[V2Plan] Structures:', plan.structures.length)
    console.log('[V2Plan] Attachments:', plan.attachments?.length || 0)
    console.log('[V2Plan] NPCs:', plan.npcs?.length || 0)

    // Log structure positions for debugging
    for (const struct of plan.structures) {
      const pos = Array.isArray(struct.position) ? struct.position : 'missing'
      console.log(`[V2Plan]   ${struct.id}: position ${JSON.stringify(pos)}, facing ${struct.facing}`)
    }

    // Soft validation: clamp bounds, nudge overlaps, warn clusters
    const validation = validateV2Structures(plan.structures)
    if (validation.warnings.length > 0) {
      console.log(`[V2Plan] Soft validation applied ${validation.warnings.length} repair(s)`)
    }

    // Initialize normalized format (compatible with relationship placement)
    const normalized = {
      theme: plan.theme || '',
      terrain: { biome: plan.terrain?.biome || 'grass' },
      structures: [],
      decorations: [],  // V2 attachments → V1 decorations
      arrangements: [], // Empty for V2 (handled by attachment arrangements)
      atmosphere: [],   // Empty for V2 (handled by attachments)
      npcs: [],
      _isRelationshipPlan: true,
      _isV2Plan: true
    }

    // Process structures with explicit coordinates
    for (const structure of plan.structures) {
      if (!structure.prompt) continue

      const category = structure.category || 'buildings'
      const realWorldSize = structure.realWorldSize || 10

      // V2 uses position: [x, z] directly
      const position = Array.isArray(structure.position)
        ? { explicit: structure.position }
        : { explicit: [200, 200] }  // Default to center if missing

      normalized.structures.push({
        id: structure.id || `structure_${normalized.structures.length}`,
        asset: {
          prompt: structure.prompt,
          category,
          realWorldSize,
          scale: computeScaleFromSize(realWorldSize, category)
        },
        placement: {
          position: position,  // Will be handled specially in placement code
          facing: structure.facing || 'south'
        },
        _estimatedBounds: estimateBoundsFromSize(realWorldSize, category)
      })
    }

    // Process attachments → decorations
    // V2 attachments use anchor+offset+facing system
    if (Array.isArray(plan.attachments)) {
      for (const attachment of plan.attachments) {
        if (!attachment.prompt) continue

        const category = attachment.category || 'props'
        const realWorldSize = attachment.realWorldSize || 1

        // Convert V2 attachment to V1 decoration format
        normalized.decorations.push({
          asset: {
            prompt: attachment.prompt,
            category,
            realWorldSize,
            scale: computeScaleFromSize(realWorldSize, category)
          },
          relationship: {
            // V2 anchor maps to V1 surface (with some adaptation)
            type: 'v2_attachment',  // Special marker for V2 handling
            target: attachment.attached_to || normalized.structures[0]?.id,
            anchor: attachment.anchor || 'front',
            offset: attachment.offset || [0, 0],
            height_ratio: attachment.height_ratio,
            facing: attachment.facing || 'toward_parent'
          },
          count: attachment.count || 1,
          arrangement: attachment.arrangement || 'single',
          spacing: attachment.spacing || realWorldSize * 1.5,
          gridSize: attachment.gridSize || null,
          _isV2Attachment: true
        })
      }
    }

    // Process NPCs (similar format to V1)
    if (Array.isArray(plan.npcs)) {
      for (const npc of plan.npcs) {
        if (!npc.prompt) continue

        normalized.npcs.push({
          asset: {
            prompt: npc.prompt,
            category: 'characters',
            realWorldSize: npc.realWorldSize || 1.8,
            scale: computeScaleFromSize(npc.realWorldSize || 1.8, 'characters')
          },
          placement: {
            relative_to: npc.near || normalized.structures[0]?.id,
            position: 'near'
          },
          behavior: npc.behavior || 'idle',
          wanderRadius: npc.wanderRadius || 10
        })
      }
    }

    console.log('[V2Plan] Conversion complete')
    return normalized
  } catch (e) {
    console.error('[V2Plan] Failed to parse V2 plan:', e)
    return null
  }
}

/**
 * Parse and validate relationship-based scene plan JSON from LLM response.
 * Handles the relationship-aware schema with structures, decorations, arrangements, atmosphere, npcs.
 *
 * Schema sections:
 * - structures: Anchor points placed first, others position relative to these
 * - decorations: Attached/adjacent/leaning objects with relationship to structures
 * - arrangements: Functional groups (seating areas, parking lots) with patterns
 * - atmosphere: Framing and filling (flanking, scattered, framing)
 * - npcs: Characters with placement context and behavior
 *
 * @param {string} response - Raw LLM response
 * @returns {Object|null} Parsed and normalized plan or null if invalid
 */
export function parseRelationshipPlan(response) {
  try {
    let jsonStr = response.trim()

    // Remove markdown code blocks if present
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7)
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3)
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3)
    }

    const plan = JSON.parse(jsonStr.trim())

    // Validate minimum required content - must have at least one structure
    if (!plan.structures || !Array.isArray(plan.structures) || plan.structures.length === 0) {
      console.warn('[RelationshipPlan] Plan must have at least one structure as anchor point')
      return null
    }

    // Initialize sections with defaults
    const normalized = {
      theme: plan.theme || '',
      terrain: { biome: plan.terrain?.biome || 'grass' },
      structures: [],
      decorations: [],
      arrangements: [],
      atmosphere: [],
      npcs: [],
      _isRelationshipPlan: true
    }

    // Process structures - these become anchor points for everything else
    for (const structure of plan.structures) {
      if (!structure.asset?.prompt) continue

      const category = structure.asset.category || 'buildings'
      const realWorldSize = structure.asset.realWorldSize || 10
      const aspectHint = structure.asset.aspectHint || null

      normalized.structures.push({
        id: structure.id || `structure_${normalized.structures.length}`,
        asset: {
          prompt: structure.asset.prompt,
          category,
          realWorldSize,
          aspectHint,
          scale: computeScaleFromSize(realWorldSize, category)
        },
        placement: {
          position: structure.placement?.position || 'center',
          facing: structure.placement?.facing || 'south',
          relative_to: structure.placement?.relative_to || null,
          side: structure.placement?.side || null,
          distance: structure.placement?.distance || null
        },
        _estimatedBounds: estimateBoundsFromSize(realWorldSize, category, aspectHint)
      })
    }

    // Process decorations - attached/adjacent/leaning objects
    if (Array.isArray(plan.decorations)) {
      for (const decoration of plan.decorations) {
        if (!decoration.asset?.prompt) continue

        // Filter out interior placements - they would spawn at y=0 outside buildings
        if (isInteriorPlacement(decoration)) {
          const prompt = decoration.asset.prompt.slice(0, 40)
          console.warn(`[SceneGen] Skipping interior decoration: "${prompt}..." - ` +
            'Interior items cannot be placed inside buildings in this system.')
          continue
        }

        const category = decoration.asset.category || 'props'
        const realWorldSize = decoration.asset.realWorldSize || 1
        const aspectHint = decoration.asset.aspectHint || null

        normalized.decorations.push({
          asset: {
            prompt: decoration.asset.prompt,
            category,
            realWorldSize,
            aspectHint,
            scale: computeScaleFromSize(realWorldSize, category)
          },
          relationship: {
            type: decoration.relationship?.type || 'adjacent_to',
            target: decoration.relationship?.target || normalized.structures[0]?.id,
            surface: decoration.relationship?.surface || 'front',
            position: decoration.relationship?.position || { horizontal: 0.5, vertical: 0.5 },
            offset: decoration.relationship?.offset || { out: 0.1 },
            side: decoration.relationship?.side || null,
            distance: decoration.relationship?.distance || 1,
            angle: decoration.relationship?.angle || 15
          },
          count: decoration.count || 1,
          spacing: decoration.spacing || realWorldSize * 1.2,
          mirror: decoration.mirror || false,
          _estimatedBounds: estimateBoundsFromSize(realWorldSize, category, aspectHint)
        })
      }
    }

    // Process arrangements - functional groupings
    if (Array.isArray(plan.arrangements)) {
      for (const arrangement of plan.arrangements) {
        if (!arrangement.items || !Array.isArray(arrangement.items)) continue

        const normalizedArr = {
          name: arrangement.name || `arrangement_${normalized.arrangements.length}`,
          placement: {
            relative_to: arrangement.placement?.relative_to || normalized.structures[0]?.id,
            side: arrangement.placement?.side || 'front',
            distance: arrangement.placement?.distance || 8,
            position: arrangement.placement?.position || null
          },
          pattern: arrangement.pattern || 'cluster',
          radius: arrangement.radius || 5,
          gridSize: arrangement.gridSize || null,
          items: []
        }

        for (const item of arrangement.items) {
          if (!item.asset?.prompt) continue

          const category = item.asset.category || 'props'
          const realWorldSize = item.asset.realWorldSize || 2
          const aspectHint = item.asset.aspectHint || null

          normalizedArr.items.push({
            asset: {
              prompt: item.asset.prompt,
              category,
              realWorldSize,
              aspectHint,
              scale: computeScaleFromSize(realWorldSize, category)
            },
            count: item.count || 1,
            role: item.role || 'fill',
            facing: item.facing || null,
            _estimatedBounds: estimateBoundsFromSize(realWorldSize, category, aspectHint)
          })
        }

        if (normalizedArr.items.length > 0) {
          normalized.arrangements.push(normalizedArr)
        }
      }
    }

    // Process atmosphere - framing and filling
    if (Array.isArray(plan.atmosphere)) {
      for (const atmo of plan.atmosphere) {
        if (!atmo.asset?.prompt) continue

        const category = atmo.asset.category || 'nature'
        const realWorldSize = atmo.asset.realWorldSize || 8
        const aspectHint = atmo.asset.aspectHint || null

        normalized.atmosphere.push({
          asset: {
            prompt: atmo.asset.prompt,
            category,
            realWorldSize,
            aspectHint,
            scale: computeScaleFromSize(realWorldSize, category)
          },
          relationship: {
            type: atmo.relationship?.type || 'scattered',
            target: atmo.relationship?.target || null,
            side: atmo.relationship?.side || null,
            spacing: atmo.relationship?.spacing || realWorldSize * 1.5,
            distance: atmo.relationship?.distance || 5,
            zone: atmo.relationship?.zone || 'everywhere',
            density: atmo.relationship?.density || 'medium',
            avoid: atmo.relationship?.avoid || ['structures'],
            cameraAware: atmo.relationship?.cameraAware || false,
            path: atmo.relationship?.path || null
          },
          count: atmo.count || 5,
          _estimatedBounds: estimateBoundsFromSize(realWorldSize, category, aspectHint)
        })
      }
    }

    // Process NPCs - characters with context
    if (Array.isArray(plan.npcs)) {
      for (const npc of plan.npcs) {
        if (!npc.asset?.prompt) continue

        const category = 'characters'
        const realWorldSize = npc.asset.realWorldSize || 1.8

        normalized.npcs.push({
          asset: {
            prompt: npc.asset.prompt,
            category,
            realWorldSize,
            scale: computeScaleFromSize(realWorldSize, category)
          },
          placement: {
            context: npc.placement?.context || 'casual',
            relative_to: npc.placement?.relative_to || normalized.structures[0]?.id,
            position: npc.placement?.position || 'near',
            surface: npc.placement?.surface || null,
            distance: npc.placement?.distance || 3
          },
          behavior: npc.behavior || 'idle',
          wanderRadius: npc.wanderRadius || 10,
          _estimatedBounds: estimateBoundsFromSize(realWorldSize, category)
        })
      }
    }

    console.log('[RelationshipPlan] ═══════════════════════════════════════════════════')
    console.log(`[RelationshipPlan] Theme: "${normalized.theme}"`)
    console.log(`[RelationshipPlan] Biome: ${normalized.terrain.biome}`)
    console.log(`[RelationshipPlan] Structures: ${normalized.structures.length}`)
    for (const s of normalized.structures) {
      console.log(`[RelationshipPlan]   - ${s.id}: "${s.asset?.prompt?.slice(0, 40) || 'no prompt'}..." (${s.asset?.realWorldSize}m)`)
    }
    console.log(`[RelationshipPlan] Decorations: ${normalized.decorations.length}`)
    console.log(`[RelationshipPlan] Arrangements: ${normalized.arrangements.length} (${normalized.arrangements.reduce((n, a) => n + a.items.reduce((m, i) => m + i.count, 0), 0)} items)`)
    console.log(`[RelationshipPlan] Atmosphere: ${normalized.atmosphere.length} types (${normalized.atmosphere.reduce((n, a) => n + a.count, 0)} total)`)
    console.log(`[RelationshipPlan] NPCs: ${normalized.npcs.length}`)
    console.log('[RelationshipPlan] ═══════════════════════════════════════════════════')

    return normalized
  } catch (e) {
    console.error('Failed to parse relationship plan:', e)
    return null
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIGNETTE PLAN PARSING
// Converts narrative vignette format → relationship format for placement
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Spatial pattern heuristics for parsing natural language spatial descriptions
 * Maps common phrases to relationship parameters
 */
const SPATIAL_PATTERNS = [
  // Wall/surface attachments
  { pattern: /against\s+(the\s+)?(building\s+)?wall/i, type: 'adjacent_to', side: 'front', distance: 0.5 },
  { pattern: /against\s+wall/i, type: 'adjacent_to', side: 'front', distance: 0.5 },
  { pattern: /mounted\s+on/i, type: 'attached_to', surface: 'front' },
  { pattern: /hanging\s+(from|on)/i, type: 'attached_to', surface: 'front' },
  { pattern: /on\s+(the\s+)?facade/i, type: 'attached_to', surface: 'front' },

  // Positional relationships
  { pattern: /in\s+front\s+of/i, type: 'adjacent_to', side: 'front', distance: 2 },
  { pattern: /beside|next\s+to/i, type: 'adjacent_to', side: 'front', distance: 1.5 },
  { pattern: /near\s+(the\s+)?entrance/i, type: 'adjacent_to', side: 'front', distance: 3 },
  { pattern: /at\s+(the\s+)?entrance/i, type: 'adjacent_to', side: 'front', distance: 2 },
  { pattern: /under\s+(the\s+)?awning/i, type: 'adjacent_to', side: 'front', distance: 2 },
  { pattern: /on\s+(the\s+)?patio/i, type: 'adjacent_to', side: 'front', distance: 4 },
  { pattern: /on\s+(the\s+)?sidewalk/i, type: 'adjacent_to', side: 'front', distance: 5 },

  // Distribution patterns
  { pattern: /scattered/i, type: 'scattered', zone: 'everywhere' },
  { pattern: /clustered/i, type: 'scattered', zone: 'everywhere', density: 'high' },
  { pattern: /evenly\s+spaced/i, type: 'along', spacing: 8 },
  { pattern: /flanking/i, type: 'flanking' },
  { pattern: /perimeter|boundary/i, type: 'scattered', zone: 'edges' },

  // Relative positions
  { pattern: /side.by.side/i, type: 'adjacent_to', side: 'front', distance: 1, arrangement: 'row' },
  { pattern: /in\s+a?\s*row/i, type: 'adjacent_to', side: 'front', distance: 1, arrangement: 'row' }
]

/**
 * Parse spatial description to extract relationship parameters
 * @param {string} spatial - Natural language spatial description
 * @returns {Object} Relationship parameters { type, side, distance, ... }
 */
function parseSpatialDescription(spatial) {
  if (!spatial) return { type: 'adjacent_to', side: 'front', distance: 2 }

  const lowerSpatial = spatial.toLowerCase()

  for (const { pattern, ...params } of SPATIAL_PATTERNS) {
    if (pattern.test(lowerSpatial)) {
      return { ...params }
    }
  }

  // Default: adjacent in front of structure
  return { type: 'adjacent_to', side: 'front', distance: 2 }
}

/**
 * Estimate category from asset description
 * @param {string} prompt - Asset prompt
 * @returns {string} Category name
 */
function estimateCategoryFromPrompt(prompt) {
  const lower = prompt.toLowerCase()

  if (/\b(building|arcade|diner|store|shop|booth|cart|stall|house|cabin)\b/.test(lower)) return 'buildings'
  if (/\b(tree|bush|flower|plant|palm|grass)\b/.test(lower)) return 'nature'
  if (/\b(car|truck|van|vehicle|camaro|sedan|bike|motorcycle)\b/.test(lower)) return 'vehicles'
  if (/\b(person|man|woman|boy|girl|teen|child|adult|human)\b/.test(lower)) return 'characters'
  if (/\b(creature|animal|dog|cat|bird|crow)\b/.test(lower)) return 'creatures'

  return 'props' // Default for objects
}

/**
 * Map NPC action description to behavior enum
 * @param {string} action - Action description from vignette
 * @returns {string} Behavior ID ('idle' or 'wander')
 */
function mapActionToBehavior(action) {
  if (!action) return 'idle'

  const lower = action.toLowerCase()

  // Actions that suggest standing still
  if (/\b(playing|watching|seated|sitting|leaning|standing|waiting|looking|admiring|counting|cheering)\b/.test(lower)) {
    return 'idle'
  }

  // Actions that suggest movement
  if (/\b(walking|moving|wandering|strolling|pacing|browsing)\b/.test(lower)) {
    return 'wander'
  }

  return 'idle' // Default
}

/**
 * Convert zone position keyword to structure placement position
 * @param {string} zonePosition - Zone position like "south side of anchor"
 * @returns {string} Placement position keyword
 */
function mapZonePositionToPlacement(zonePosition) {
  if (!zonePosition) return 'center'

  const lower = zonePosition.toLowerCase()

  if (/\bnorth\b/.test(lower)) return 'north'
  if (/\bsouth\b/.test(lower)) return 'south'
  if (/\beast\b/.test(lower)) return 'east'
  if (/\bwest\b/.test(lower)) return 'west'
  if (/\bcenter\b/.test(lower)) return 'center'

  // "south side of anchor" → 'south', "center of carnival grounds" → 'center'
  return 'center'
}

/**
 * Parse vignette-based scene plan and convert to relationship format.
 *
 * Conversion rules:
 * - zones[].anchor → structures[]
 * - zones[].vignettes[].elements[type=prop] → decorations[]
 * - zones[].vignettes[].elements[type=npc] → npcs[]
 * - atmosphere[] → atmosphere[]
 *
 * @param {Object} plan - Parsed vignette plan object
 * @returns {Object|null} Normalized plan compatible with relationship placement
 */
export function parseVignettePlan(plan) {
  try {
    if (!Array.isArray(plan.zones) || plan.zones.length === 0) {
      console.warn('[VignettePlan] Plan must have at least one zone')
      return null
    }

    console.log('[VignettePlan] ═══════════════════════════════════════════════════════')
    console.log(`[VignettePlan] Converting vignette plan with ${plan.zones.length} zones`)

    // Initialize normalized relationship format
    const normalized = {
      theme: plan.theme || '',
      terrain: { biome: plan.terrain?.biome || 'grass' },
      structures: [],
      decorations: [],
      arrangements: [],
      atmosphere: [],
      npcs: [],
      _isRelationshipPlan: true,
      _convertedFromVignette: true
    }

    // Track structure IDs for decoration references
    const structureIds = new Map() // zone.id → structure.id

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: Convert zone anchors → structures
    // Structures are spread apart using relative positioning
    // ═══════════════════════════════════════════════════════════════════════
    console.log('[VignettePlan] Step 1: Converting zone anchors to structures')

    // Directional offsets for spreading structures (used when no explicit position)
    const STRUCTURE_SPREAD_DIRECTIONS = ['east', 'west', 'NE', 'NW', 'SE', 'SW', 'north', 'south']
    let firstStructureId = null

    for (let zoneIndex = 0; zoneIndex < plan.zones.length; zoneIndex++) {
      const zone = plan.zones[zoneIndex]
      if (!zone.anchor) continue

      const structureId = zone.id || `zone_${normalized.structures.length}`
      structureIds.set(zone.id, structureId)

      // Estimate size from anchor description
      const realWorldSize = estimateSizeFromPrompt(zone.anchor, 'buildings')
      const category = estimateCategoryFromPrompt(zone.anchor)

      // Build placement - first structure at center, others spread around it
      let placement
      if (zoneIndex === 0) {
        // First structure: use zone position or default to center
        firstStructureId = structureId
        placement = {
          position: mapZonePositionToPlacement(zone.position) || 'center',
          facing: 'south'
        }
      } else {
        // Subsequent structures: position relative to first, spread apart
        // Use directional spread to avoid overlap
        const spreadDir = STRUCTURE_SPREAD_DIRECTIONS[(zoneIndex - 1) % STRUCTURE_SPREAD_DIRECTIONS.length]
        const spreadDistance = 40 + realWorldSize // Base distance + structure size

        placement = {
          relative_to: firstStructureId,
          side: spreadDir.includes('E') ? 'right' : spreadDir.includes('W') ? 'left' : 'front',
          distance: spreadDistance,
          facing: 'south'
        }
        console.log(`[VignettePlan]   Spreading ${structureId} ${spreadDir} of ${firstStructureId} by ${spreadDistance}m`)
      }

      normalized.structures.push({
        id: structureId,
        asset: {
          prompt: zone.anchor,
          category,
          realWorldSize,
          scale: computeScaleFromSize(realWorldSize, category)
        },
        placement,
        _estimatedBounds: estimateBoundsFromSize(realWorldSize, category),
        _fromVignette: true,
        _zoneSurface: zone.surface || 'concrete'
      })

      console.log(`[VignettePlan]   ${structureId}: "${zone.anchor.slice(0, 40)}..." (${realWorldSize}m)`)
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: Convert vignette elements → decorations and npcs
    // ═══════════════════════════════════════════════════════════════════════
    console.log('[VignettePlan] Step 2: Converting vignette elements')

    for (const zone of plan.zones) {
      const targetStructureId = structureIds.get(zone.id) || normalized.structures[0]?.id

      if (!Array.isArray(zone.vignettes)) continue

      for (const vignette of zone.vignettes) {
        if (!Array.isArray(vignette.elements)) continue

        // Parse spatial description for this vignette
        const spatialParams = parseSpatialDescription(vignette.spatial)

        console.log(`[VignettePlan]   Vignette "${vignette.name}": ${vignette.elements.length} elements`)

        // Track element positions within vignette for spreading
        // Props get spread horizontally along the building face
        const propsInVignette = vignette.elements.filter(e => e.type === 'prop')
        const npcsInVignette = vignette.elements.filter(e => e.type === 'npc')
        let propIndex = 0
        let npcIndex = 0

        for (const element of vignette.elements) {
          if (!element.asset) continue

          const realWorldSize = element.realWorldSize || estimateSizeFromPrompt(element.asset, element.type)

          if (element.type === 'prop') {
            // Convert prop → decoration
            const category = estimateCategoryFromPrompt(element.asset)

            // Build asset prompt including state if provided
            let assetPrompt = element.asset
            if (element.state) {
              assetPrompt = `${element.asset}, ${element.state}`
            }

            // Calculate horizontal position to spread props along building face
            // Spread from 0.2 to 0.8 of the surface width
            const horizontalSpread = propsInVignette.length > 1
              ? 0.2 + (propIndex / (propsInVignette.length - 1)) * 0.6
              : 0.5  // Single prop at center

            // Calculate distance offset - stagger props slightly in depth
            const distanceOffset = (propIndex % 2) * 1.5  // Alternate 0 and 1.5m

            normalized.decorations.push({
              asset: {
                prompt: assetPrompt,
                category,
                realWorldSize,
                scale: computeScaleFromSize(realWorldSize, category)
              },
              relationship: {
                type: spatialParams.type || 'adjacent_to',
                target: targetStructureId,
                surface: spatialParams.surface || 'front',
                side: spatialParams.side || 'front',
                distance: (spatialParams.distance || 2) + distanceOffset,
                zone: spatialParams.zone || null,
                // Add horizontal position for spreading along surface
                position: { horizontal: horizontalSpread, vertical: 0.5 }
              },
              count: 1,
              spacing: realWorldSize * 1.2,
              _estimatedBounds: estimateBoundsFromSize(realWorldSize, category),
              _fromVignette: vignette.name,
              _vignetteIndex: propIndex
            })

            propIndex++
          } else if (element.type === 'npc') {
            // Convert NPC → npc placement
            const behavior = mapActionToBehavior(element.action)

            // Build NPC prompt including action context
            let npcPrompt = element.asset
            if (element.action) {
              npcPrompt = `${element.asset}, ${element.action}`
            }

            // Calculate lateral offset for multiple NPCs in same vignette
            // Spread them 2m apart, centered on the vignette location
            const lateralOffset = npcsInVignette.length > 1
              ? (npcIndex - (npcsInVignette.length - 1) / 2) * 2
              : 0

            normalized.npcs.push({
              asset: {
                prompt: npcPrompt,
                category: 'characters',
                realWorldSize,
                scale: computeScaleFromSize(realWorldSize, 'characters')
              },
              placement: {
                context: vignette.story || 'casual',
                relative_to: targetStructureId,
                position: 'near',
                distance: spatialParams.distance || 3,
                lateralOffset  // Used by resolver for spreading
              },
              behavior,
              wanderRadius: behavior === 'wander' ? 10 : 5,
              _estimatedBounds: estimateBoundsFromSize(realWorldSize, 'characters'),
              _fromVignette: vignette.name,
              _vignetteIndex: npcIndex
            })

            npcIndex++
          }
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: Convert atmosphere → atmosphere
    // ═══════════════════════════════════════════════════════════════════════
    console.log('[VignettePlan] Step 3: Converting atmosphere elements')

    if (Array.isArray(plan.atmosphere)) {
      for (const atmo of plan.atmosphere) {
        if (!atmo.asset) continue

        const realWorldSize = atmo.realWorldSize || estimateSizeFromPrompt(atmo.asset, 'props')
        const category = estimateCategoryFromPrompt(atmo.asset)

        // Map vignette zone references to relationship format
        let relationshipZone = 'everywhere'
        let targetStructure = null

        if (atmo.zone) {
          if (atmo.zone === 'edges' || atmo.zone === 'perimeter') {
            relationshipZone = 'edges'
          } else if (atmo.zone === 'sidewalk') {
            relationshipZone = 'everywhere'
          } else if (structureIds.has(atmo.zone)) {
            // Zone references a specific structure
            targetStructure = structureIds.get(atmo.zone)
            relationshipZone = { around: targetStructure, radius: 15 }
          }
        }

        // Map placement style to relationship type
        let relationshipType = 'scattered'
        if (atmo.placement) {
          const lowerPlacement = atmo.placement.toLowerCase()
          if (/evenly\s+spaced|along/.test(lowerPlacement)) {
            relationshipType = 'along'
          } else if (/flanking/.test(lowerPlacement)) {
            relationshipType = 'flanking'
          } else if (/perimeter|edge/.test(lowerPlacement)) {
            relationshipType = 'scattered'
            relationshipZone = 'edges'
          }
        }

        normalized.atmosphere.push({
          asset: {
            prompt: atmo.asset,
            category,
            realWorldSize,
            scale: computeScaleFromSize(realWorldSize, category)
          },
          relationship: {
            type: relationshipType,
            target: targetStructure,
            zone: relationshipZone,
            spacing: realWorldSize * 1.5,
            density: 'medium',
            avoid: ['structures']
          },
          count: atmo.count || 1,
          _estimatedBounds: estimateBoundsFromSize(realWorldSize, category),
          _fromVignette: true
        })

        console.log(`[VignettePlan]   Atmosphere: ${atmo.count || 1}× "${atmo.asset.slice(0, 30)}..."`)
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Summary
    // ═══════════════════════════════════════════════════════════════════════
    console.log('[VignettePlan] ═══════════════════════════════════════════════════════')
    console.log(`[VignettePlan] Theme: "${normalized.theme}"`)
    console.log(`[VignettePlan] Biome: ${normalized.terrain.biome}`)
    console.log(`[VignettePlan] Structures: ${normalized.structures.length} (from zone anchors)`)
    console.log(`[VignettePlan] Decorations: ${normalized.decorations.length} (from vignette props)`)
    console.log(`[VignettePlan] Atmosphere: ${normalized.atmosphere.length} types (${normalized.atmosphere.reduce((n, a) => n + a.count, 0)} total)`)
    console.log(`[VignettePlan] NPCs: ${normalized.npcs.length} (from vignette actors)`)
    console.log('[VignettePlan] ═══════════════════════════════════════════════════════')

    return normalized
  } catch (e) {
    console.error('[VignettePlan] Failed to parse vignette plan:', e)
    return null
  }
}

/**
 * Estimate real-world size from asset description
 * @param {string} prompt - Asset prompt
 * @param {string} type - Element type ('prop', 'npc', or category)
 * @returns {number} Estimated size in meters
 */
function estimateSizeFromPrompt(prompt, type) {
  const lower = prompt.toLowerCase()

  // Character sizes
  if (type === 'npc' || type === 'characters') {
    if (/\b(child|kid|boy|girl)\b/.test(lower) && /\b(young|little|small|around\s+\d)\b/.test(lower)) {
      return 1.2 // Young child
    }
    if (/\bteen/i.test(lower)) return 1.7
    return 1.8 // Default adult
  }

  // Building sizes
  if (type === 'buildings' || /\b(building|arcade|diner|store|shop|house)\b/.test(lower)) {
    if (/\b(booth|cart|stall)\b/.test(lower)) return 3
    if (/\b(small|tiny)\b/.test(lower)) return 8
    if (/\b(large|big)\b/.test(lower)) return 20
    return 12 // Default building
  }

  // Vehicle sizes
  if (/\b(car|sedan|camaro|mustang)\b/.test(lower)) return 4.5
  if (/\b(truck|van)\b/.test(lower)) return 6
  if (/\b(motorcycle|bike)\b/.test(lower)) return 2

  // Furniture/props
  if (/\b(table|desk)\b/.test(lower)) return 0.9
  if (/\b(chair|stool)\b/.test(lower)) return 0.9
  if (/\b(bench)\b/.test(lower)) return 1.8
  if (/\b(cabinet|machine|arcade)\b/.test(lower)) return 1.8
  if (/\b(lamp|light)\b/.test(lower)) return 4
  if (/\b(trash\s*can|bin)\b/.test(lower)) return 1.1
  if (/\b(sign)\b/.test(lower)) return 2

  // Nature
  if (/\b(palm|tree)\b/.test(lower)) return 8
  if (/\b(bush|shrub|plant)\b/.test(lower)) return 1.5
  if (/\b(flower)\b/.test(lower)) return 0.5

  // Small objects
  if (/\b(cup|glass|mug|bottle)\b/.test(lower)) return 0.3
  if (/\b(balloon)\b/.test(lower)) return 0.4
  if (/\b(newspaper|paper|card)\b/.test(lower)) return 0.5
  if (/\b(leaves|leaf)\b/.test(lower)) return 0.8

  // Default for unknown props
  return 1.5
}

/**
 * Parse NEW layered scene plan format and convert to flat asset list
 *
 * Converts:
 *   { layers: { focal: {...}, anchors: [...], frame: [...], fill: [...] } }
 * To:
 *   { assets: [...], _layers: {...} }
 *
 * The _layers property is preserved for use by SceneGenerationAgent's layer-by-layer execution.
 *
 * @param {Object} plan - Parsed plan with layers property
 * @returns {Object} Plan with flat assets array
 */
function parseLayeredPlan(plan) {
  const assets = []

  // Track layer information for layer-by-layer execution
  const layerInfo = {
    focal: null,
    anchors: [],
    frame: [],
    fill: []
  }

  // Process FOCAL layer (exactly 1 asset)
  if (plan.layers.focal) {
    const focal = plan.layers.focal
    const focalAsset = {
      ...focal.asset,
      placement: 'focal',
      location: focal.position || 'center',
      count: 1,
      _layer: 'focal'
    }

    // Filter ground cover
    if (!isGroundCoverAsset(focalAsset.prompt)) {
      assets.push(focalAsset)
      layerInfo.focal = focalAsset
    }
  }

  // Process ANCHORS layer (array)
  if (Array.isArray(plan.layers.anchors)) {
    for (const anchor of plan.layers.anchors) {
      const anchorAsset = {
        ...anchor.asset,
        placement: anchor.placement || 'ring',
        reference: anchor.reference || 'focal',
        distance: anchor.distance,
        radius: anchor.radius || anchor.distance,
        count: anchor.count || 1,
        minDistance: anchor.minDistance || 8,
        facing: anchor.facing,
        _layer: 'anchors'
      }

      if (!isGroundCoverAsset(anchorAsset.prompt)) {
        assets.push(anchorAsset)
        layerInfo.anchors.push(anchorAsset)
      }
    }
  }

  // Process FRAME layer (array)
  // Frame layer places at scene edges (minDistance >= 40m from focal)
  if (Array.isArray(plan.layers.frame)) {
    for (const frame of plan.layers.frame) {
      // Ensure frame elements are placed at edges (minDistance from focal >= 40m)
      const frameMinDistance = Math.max(frame.minDistance || 40, 40)

      const frameAsset = {
        ...frame.asset,
        placement: frame.placement || 'background',
        reference: frame.reference || 'focal',
        minDistance: frameMinDistance,
        distance: frameMinDistance,
        count: frame.count || 1,
        cameraAware: frame.cameraAware !== false,  // Default true
        _layer: 'frame'
      }

      if (!isGroundCoverAsset(frameAsset.prompt)) {
        assets.push(frameAsset)
        layerInfo.frame.push(frameAsset)
      }
    }
  }

  // Process FILL layer (array)
  // Fill uses tighter spacing (minDistance=2) for denser props
  if (Array.isArray(plan.layers.fill)) {
    for (const fill of plan.layers.fill) {
      const fillAsset = {
        ...fill.asset,
        placement: fill.placement || 'scatter',
        reference: fill.reference,
        radius: fill.radius,  // Will be set by layer defaults below
        count: fill.count || 1,
        minDistance: fill.minDistance,  // Will be set by layer/category defaults below
        densityGradient: fill.densityGradient || { center: 0.3, edge: 0.7 },  // Default gradient for better distribution
        _layer: 'fill'
      }

      if (!isGroundCoverAsset(fillAsset.prompt)) {
        assets.push(fillAsset)
        layerInfo.fill.push(fillAsset)
      }
    }
  }

  // Log layer summary
  console.log(`[ScenePlan] Layers: focal=${layerInfo.focal ? 1 : 0}, ` +
    `anchors=${layerInfo.anchors.length}, frame=${layerInfo.frame.length}, fill=${layerInfo.fill.length}`)

  // Apply layer-specific and category-aware defaults
  // CRITICAL: Do NOT overwrite with generic values (radius=30, minDistance=10)
  // as that destroys the per-layer composition intent
  for (const asset of assets) {
    const layer = asset._layer || 'fill'
    const category = asset.category || 'props'
    const layerDefaults = LAYER_SPACING_DEFAULTS[layer] || LAYER_SPACING_DEFAULTS.fill

    // Clamp count to reasonable range
    asset.count = Math.min(Math.max(asset.count || 1, 1), 20)

    // Use layer-specific radius if not explicitly set, clamped to zone feasibility
    if (asset.radius === undefined) {
      asset.radius = layerDefaults.radius
    }
    asset.radius = Math.min(asset.radius, MAX_REASONABLE_RADIUS)

    // Use category-aware minDistance if not explicitly set, falling back to layer default
    if (asset.minDistance === undefined) {
      asset.minDistance = CATEGORY_MIN_DISTANCE[category] ?? layerDefaults.minDistance
    }

    // Log spacing decisions for debugging
    console.log(`[ScenePlan]   ${layer}/${category}: radius=${asset.radius}m, minDistance=${asset.minDistance}m`)
  }

  // Process NPCs (same as legacy)
  const npcs = plan.npcs || []
  for (const npc of npcs) {
    npc.wanderRadius = npc.wanderRadius || 20
  }

  // Build final plan
  const normalizedPlan = {
    terrain: plan.terrain || { biome: 'grass', modifications: [] },
    assets,
    npcs,
    _layers: layerInfo,  // Preserved for layer-by-layer execution
    _isLayered: true     // Flag indicating this was a layered plan
  }

  // Process through size invariants
  const processedPlan = processSizeInvariants(normalizedPlan)

  if (processedPlan._sizeWarnings?.length > 0) {
    console.log('[ScenePlan] Size warnings:', processedPlan._sizeWarnings)
  }

  return processedPlan
}

/**
 * Parse and validate refinement plan JSON from LLM response
 * Handles the refinement-specific schema: addAssets, rescaleAssets, removeAssets, moveAssets
 *
 * @param {string} response - Raw LLM response
 * @returns {Object|null} Parsed refinement plan or null if invalid
 */
export function parseRefinementPlan(response) {
  try {
    let jsonStr = response.trim()

    // Remove markdown code blocks if present
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7)
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3)
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3)
    }

    const plan = JSON.parse(jsonStr.trim())

    // Initialize arrays if not present
    plan.addAssets = plan.addAssets || []
    plan.rescaleAssets = plan.rescaleAssets || []
    plan.removeAssets = plan.removeAssets || []
    plan.moveAssets = plan.moveAssets || []
    plan.terrain = plan.terrain || { modifications: [] }

    // Validate and process addAssets through size invariants
    if (plan.addAssets.length > 0) {
      // Filter out assets without prompts (malformed LLM output)
      plan.addAssets = plan.addAssets.filter(asset => {
        if (!asset.prompt) {
          console.warn('[RefinementPlan] addAsset missing prompt, skipping:', asset)
          return false
        }
        return true
      })

      // Set defaults for new assets
      for (const asset of plan.addAssets) {
        asset.count = Math.min(Math.max(asset.count || 1, 1), 10)  // Cap at 10 for refinements
        asset.radius = asset.radius || 30
        asset.minDistance = asset.minDistance || 10
      }

      // Process through size invariants to convert realWorldSize → scale
      const tempPlan = { assets: plan.addAssets, npcs: [], terrain: { biome: 'grass' } }
      const processed = processSizeInvariants(tempPlan)
      plan.addAssets = processed.assets
    }

    // Validate rescaleAssets have required fields
    // Accepts either suggestedMultiplier (new) or newRealWorldSize (legacy)
    if (plan.rescaleAssets.length > 0) {
      console.log('[RefinementPlan] Raw rescaleAssets from LLM:', JSON.stringify(plan.rescaleAssets, null, 2))
    }
    plan.rescaleAssets = plan.rescaleAssets.filter(r => {
      // Accept instanceId or structureId as primary identifier, or description/location as fallback
      if (!r.instanceId && !r.structureId && !r.description && !r.location) {
        console.warn('[RefinementPlan] Rescale missing instanceId, structureId, description, and location, skipping:', r)
        return false
      }

      const hasMultiplier = typeof r.suggestedMultiplier === 'number' && r.suggestedMultiplier > 0
      const hasAbsoluteSize = typeof r.newRealWorldSize === 'number' && r.newRealWorldSize > 0

      if (!hasMultiplier && !hasAbsoluteSize) {
        console.warn(`[RefinementPlan] Rescale has wrong format (need suggestedMultiplier or newRealWorldSize):`, r)
        return false
      }
      return true
    })

    // Validate removeAssets have instanceId, structureId, description, or location
    plan.removeAssets = plan.removeAssets.filter(r => {
      if (!r.instanceId && !r.structureId && !r.description && !r.location) {
        console.warn('[RefinementPlan] Remove missing instanceId, structureId, description, and location, skipping')
        return false
      }
      return true
    })

    // Validate moveAssets have instanceId, structureId, description, or location and a target position
    plan.moveAssets = plan.moveAssets.filter(r => {
      if (!r.instanceId && !r.structureId && !r.description && !r.location) {
        console.warn('[RefinementPlan] Move missing instanceId, structureId, description, and location, skipping')
        return false
      }
      if (!r.newPosition && !r.position) {
        console.warn('[RefinementPlan] Move missing target position, skipping')
        return false
      }
      return true
    })

    // Log summary for debugging
    const actions = []
    if (plan.addAssets.length) actions.push(`add:${plan.addAssets.length}`)
    if (plan.rescaleAssets.length) actions.push(`rescale:${plan.rescaleAssets.length}`)
    if (plan.removeAssets.length) actions.push(`remove:${plan.removeAssets.length}`)
    if (plan.moveAssets.length) actions.push(`move:${plan.moveAssets.length}`)
    if (actions.length) {
      console.log(`[RefinementPlan] Parsed: ${actions.join(', ')}`)
    }

    return plan
  } catch (e) {
    console.error('Failed to parse refinement plan:', e)
    return null
  }
}

/**
 * Parse and validate evaluation JSON from LLM response
 * @param {string} response - Raw LLM response
 * @returns {Object|null} Parsed evaluation or null if invalid
 */
export function parseSceneEvaluation(response) {
  try {
    let jsonStr = response.trim()

    // Remove markdown code blocks if present
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7)
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3)
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3)
    }

    const evaluation = JSON.parse(jsonStr.trim())

    // Validate required fields
    if (typeof evaluation.overallScore !== 'number') {
      console.warn('Evaluation missing overallScore')
      return null
    }

    // Ensure arrays exist
    evaluation.actionItems = evaluation.actionItems || []
    evaluation.requestedViews = evaluation.requestedViews || []

    // Determine satisfactory if not set
    if (evaluation.satisfactory === undefined) {
      const hasCritical = evaluation.actionItems.some(a => a.priority === 1)
      evaluation.satisfactory = evaluation.overallScore >= 75 && !hasCritical
    }

    return evaluation
  } catch (e) {
    console.error('Failed to parse scene evaluation:', e)
    return null
  }
}

/**
 * Parse V2 evaluation response (binary verdict with issues array)
 * @param {string} response - Raw LLM response
 * @returns {Object|null} Parsed V2 evaluation or null if invalid
 *
 * V2 schema:
 * {
 *   verdict: "accept" | "needs_work",
 *   overallImpression: string,
 *   issues: [{ type, description, affected, suggestion }]
 * }
 */
export function parseV2Evaluation(response) {
  try {
    let jsonStr = response.trim()

    // Remove markdown code blocks if present
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7)
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3)
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3)
    }

    const evaluation = JSON.parse(jsonStr.trim())

    // Validate required V2 fields
    if (!evaluation.verdict || !['accept', 'needs_work'].includes(evaluation.verdict)) {
      console.warn('V2 evaluation missing or invalid verdict:', evaluation.verdict)
      // Try to infer from issues count
      if (evaluation.issues && Array.isArray(evaluation.issues)) {
        evaluation.verdict = evaluation.issues.length >= 3 ? 'needs_work' : 'accept'
      } else {
        return null
      }
    }

    // Ensure issues array exists
    evaluation.issues = evaluation.issues || []

    // Map to legacy-compatible format for SceneGenerationAgent
    // satisfactory = true only if verdict is accept AND no issues found
    // This ensures the evaluation loop runs when there are issues to fix
    const hasIssues = evaluation.issues && evaluation.issues.length > 0
    evaluation.satisfactory = evaluation.verdict === 'accept' && !hasIssues
    evaluation.overallScore = evaluation.satisfactory ? 85 : (evaluation.verdict === 'accept' ? 70 : 55)

    // Convert V2 issues to legacy actionItems format for compatibility
    evaluation.actionItems = evaluation.issues.map((issue, idx) => ({
      priority: issue.type === 'overlap' || issue.type === 'missing' ? 1 : 2,
      action: issue.type,
      target: issue.affected?.join(', ') || 'scene',
      description: `${issue.description}. ${issue.suggestion}`,
      _v2Issue: issue  // Preserve original V2 issue for reference
    }))

    return evaluation
  } catch (e) {
    console.error('Failed to parse V2 scene evaluation:', e)
    return null
  }
}
