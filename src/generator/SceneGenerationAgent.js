/**
 * SceneGenerationAgent - Orchestrates iterative scene generation with visual feedback
 *
 * The agent implements an agentic loop:
 * 1. Plan - Generate scene plan from user description
 * 2. Generate - Create assets defined in the plan
 * 3. Place - Position assets according to placement strategies
 * 4. Capture - Take screenshots for evaluation
 * 5. Evaluate - Use vision API to assess scene quality
 * 6. Refine - Apply corrections based on feedback
 * 7. Repeat until satisfactory or max iterations
 */

import { geminiClient } from './GeminiClient'
import { AssetGenerator } from './AssetGenerator'
import { getSceneCaptureService, DEFAULT_CAPTURE_PRESETS } from './SceneCaptureService'
import {
  SCENE_PLANNING_PROMPT,
  LAYERED_SCENE_PLANNING_PROMPT,
  SCENE_EVALUATION_PROMPT,
  SCENE_REFINEMENT_PROMPT,
  SCENE_REFINEMENT_PROMPT_V2,
  buildScenePlanningPrompt,
  buildSceneEvaluationSystemPrompt,
  buildRefinementPrompt,
  buildV2RefinementPrompt,
  parseScenePlan,
  parseSceneEvaluation,
  parseV2Evaluation,
  parseRefinementPlan,
  getScenePlanningSystemPrompt
} from './scenePrompts'
import {
  executeAssetPlacement,
  executeLayeredPlacement,
  validatePlacements,
  applyTerrainModification,
  parseSemanticLocation,
  rebalancePlacements,
  applyTerrainHeight,
  resolveRelationshipPlacements
} from './placementAlgorithms'
import { scoreComposition, validateLayerPlacement, calculateFocalPosition } from './compositionScorer'
import { generateId } from '../studio/state/storage'
import { generateThumbnail } from './ThumbnailRenderer'
import { GRID_SIZE, TILE_SIZE } from '../shared/constants'
import { computeRescale } from './sizeInvariants'
import { findMatchingInstances, getCategoryForInstance } from './instanceMatcher'
import { getAssetMeasurementService } from './AssetMeasurementService'
import { getCollisionAnalyzer } from './CollisionAnalyzer'

/**
 * Yield to the main thread to allow UI updates.
 * Uses requestIdleCallback when available, falls back to setTimeout.
 * This prevents long tasks (>50ms) during scene generation.
 * @returns {Promise<void>}
 */
function yieldToMain() {
  return new Promise(resolve => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(resolve, { timeout: 100 })
    } else {
      setTimeout(resolve, 0)
    }
  })
}

/**
 * Scene generation configuration defaults
 */
const DEFAULT_CONFIG = {
  maxIterations: 5,
  qualityThreshold: 75,
  capturePresets: DEFAULT_CAPTURE_PRESETS,
  generateAssets: true,
  applyTerrain: false,  // Disabled: terrain height mods create brown color artifacts
  enableRefinement: true
}

/**
 * Scene generation states
 */
export const SCENE_STATE = {
  IDLE: 'idle',
  PLANNING: 'planning',
  GENERATING_ASSETS: 'generating_assets',
  PLACING: 'placing',
  CAPTURING: 'capturing',
  EVALUATING: 'evaluating',
  REFINING: 'refining',
  COMPLETE: 'complete',
  ERROR: 'error'
}

export class SceneGenerationAgent {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.assetGenerator = new AssetGenerator()
    this.captureService = getSceneCaptureService()
    this.measurementService = getAssetMeasurementService()
    this.collisionAnalyzer = getCollisionAnalyzer()

    // State
    this.state = SCENE_STATE.IDLE
    this.currentIteration = 0
    this.originalPrompt = ''
    this.currentPlan = null
    this.generatedAssets = new Map() // prompt -> libraryAsset
    this.assetMeasurements = new Map() // libraryId -> measured bounds
    this.evaluationHistory = []
    this.aborted = false
    this.mode = 'full'  // 'full' | 'v2' | 'zone' | 'layered'

    // Callbacks
    this.onStateChange = null
    this.onProgress = null
    this.onAssetGenerated = null
    this.onIterationComplete = null
  }

  /**
   * Set state and notify listeners
   */
  setState(state, details = {}) {
    this.state = state
    if (this.onStateChange) {
      this.onStateChange(state, details)
    }
  }

  /**
   * Report progress
   */
  progress(message, percent = null) {
    if (this.onProgress) {
      this.onProgress({ message, percent, iteration: this.currentIteration })
    }
  }

  /**
   * Abort the current generation
   */
  abort() {
    this.aborted = true
    geminiClient.cancel()
  }

  /**
   * Reset agent state for a new generation
   */
  reset() {
    this.state = SCENE_STATE.IDLE
    this.currentIteration = 0
    this.originalPrompt = ''
    this.currentPlan = null
    this.generatedAssets.clear()
    this.assetMeasurements.clear()
    this.evaluationHistory = []
    this.aborted = false
    this.mode = 'full'
  }

  /**
   * Main entry point - generate a scene from a user description
   *
   * @param {string} userPrompt - Natural language scene description
   * @param {Object} worldHooks - World state hooks
   *   {executeScenePlan, updateInstance, deleteInstance, getWorldData, worldRenderer}
   * @param {THREE.Scene} threeScene - The Three.js scene for captures
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Generation result
   */
  async generate(userPrompt, worldHooks, threeScene, options = {}) {
    console.log('[SceneGen] ════════════════════════════════════════════════════════════')
    console.log('[SceneGen] SCENE GENERATION STARTED')
    console.log(`[SceneGen] Prompt: "${userPrompt.slice(0, 60)}..."`)
    console.log('[SceneGen] ════════════════════════════════════════════════════════════')

    this.reset()
    this.originalPrompt = userPrompt

    // Create live data accessor — falls back to static .data for backward compatibility
    const getWorldData = typeof worldHooks.getWorldData === 'function'
      ? worldHooks.getWorldData
      : () => worldHooks.data
    this._getWorldData = getWorldData

    const { mode = 'full' } = options
    this.mode = mode  // Store mode for use in evaluation/refinement
    const existingAssetCount = getWorldData()?.placedAssets?.length || 0

    try {
      // Phase 1: Planning
      this.setState(SCENE_STATE.PLANNING)
      this.progress('Analyzing scene description...')

      // Use layered prompt for full scenes, legacy for zone additions
      const systemPrompt = getScenePlanningSystemPrompt({ mode })
      const planPrompt = buildScenePlanningPrompt(userPrompt, { mode, existingAssetCount })
      const planResponse = await geminiClient.generate(planPrompt, systemPrompt, {
        temperature: 0.5,  // Lower temperature for more consistent structured JSON output
        maxOutputTokens: 4096
      })

      if (this.aborted) return { success: false, aborted: true }

      this.currentPlan = parseScenePlan(planResponse)
      if (!this.currentPlan) {
        throw new Error('Failed to parse scene plan from AI response')
      }

      // Diagnostic logging for plan analysis - DETAILED for debugging
      console.log('[SceneGen] ═══════════════════════════════════════════════════')
      console.log('[SceneGen] PLAN ANALYSIS')
      console.log('[SceneGen] ═══════════════════════════════════════════════════')
      console.log(`[SceneGen] Biome: ${this.currentPlan.terrain?.biome}`)

      // Handle relationship plan logging differently
      if (this.currentPlan._isRelationshipPlan) {
        console.log(`[SceneGen] Plan type: RELATIONSHIP (intentional placement)`)
        console.log(`[SceneGen] Structures: ${this.currentPlan.structures?.length || 0}`)
        console.log(`[SceneGen] Decorations: ${this.currentPlan.decorations?.length || 0}`)
        console.log(`[SceneGen] Arrangements: ${this.currentPlan.arrangements?.length || 0}`)
        console.log(`[SceneGen] Atmosphere: ${this.currentPlan.atmosphere?.length || 0}`)
        console.log(`[SceneGen] NPCs: ${this.currentPlan.npcs?.length || 0}`)
        console.log('[SceneGen] ───────────────────────────────────────────────────')
        console.log('[SceneGen] STRUCTURES:')
        for (const struct of (this.currentPlan.structures || [])) {
          console.log(`[SceneGen]   ${struct.id}: "${struct.asset?.prompt?.slice(0, 35) || 'no prompt'}..."`)
          console.log(`[SceneGen]      position: ${struct.placement?.position}, facing: ${struct.placement?.facing}`)
        }
        console.log('[SceneGen] ═══════════════════════════════════════════════════')

        const totalItems = (this.currentPlan.structures?.length || 0) +
          (this.currentPlan.decorations?.length || 0) +
          (this.currentPlan.arrangements?.reduce((n, a) => n + a.items.length, 0) || 0) +
          (this.currentPlan.atmosphere?.length || 0) +
          (this.currentPlan.npcs?.length || 0)
        this.progress(`Plan created: ${totalItems} elements in ${this.currentPlan.structures?.length || 0} structures`)
      } else {
        console.log(`[SceneGen] Plan type: ${this.currentPlan._isLayered ? 'LAYERED' : 'LEGACY'}`)
        console.log(`[SceneGen] Total assets: ${this.currentPlan.assets?.length || 0}`)
        console.log(`[SceneGen] Total NPCs: ${this.currentPlan.npcs?.length || 0}`)
        console.log('[SceneGen] ───────────────────────────────────────────────────')
        console.log('[SceneGen] ASSET BREAKDOWN:')
        for (const asset of (this.currentPlan.assets || [])) {
          const sizeStatus = asset.realWorldSize < 1 ? '⚠️ TINY' :
                             asset.realWorldSize > 30 ? '⚠️ HUGE' : '✓'
          console.log(`[SceneGen]   ${sizeStatus} "${asset.prompt?.slice(0, 35) || 'no prompt'}..."`)
          console.log(`[SceneGen]      category: ${asset.category}, realWorldSize: ${asset.realWorldSize}m, scale: ${asset.scale?.toFixed(2)}`)
          console.log(`[SceneGen]      placement: ${asset.placement}, location: ${asset.location}, count: ${asset.count}`)
        }
        console.log('[SceneGen] ═══════════════════════════════════════════════════')

        this.progress(`Plan created: ${this.currentPlan.assets?.length || 0} assets, ${this.currentPlan.npcs?.length || 0} NPCs`)
      }

      // Yield to main thread after planning phase for smoother UI
      await yieldToMain()

      // Phase 2: Generate Assets
      if (this.config.generateAssets) {
        this.setState(SCENE_STATE.GENERATING_ASSETS)

        // Handle RELATIONSHIP plan format
        if (this.currentPlan._isRelationshipPlan) {
          const allAssetSpecs = this.collectRelationshipAssets(this.currentPlan)
          if (allAssetSpecs.length > 0) {
            await this.generateAssets(allAssetSpecs)
            if (this.aborted) return { success: false, aborted: true }
          }
        } else {
          // Handle LAYERED and LEGACY formats
          if (this.currentPlan.assets?.length > 0) {
            await this.generateAssets(this.currentPlan.assets)
            if (this.aborted) return { success: false, aborted: true }
          }

          // Generate NPC assets
          if (this.currentPlan.npcs?.length > 0) {
            await this.generateAssets(this.currentPlan.npcs)
            if (this.aborted) return { success: false, aborted: true }
          }
        }
      }

      // Phase 3: Initial Placement
      this.setState(SCENE_STATE.PLACING)
      this.progress('Placing assets in scene...')

      const placementResult = await this.executeInitialPlacement(worldHooks, options)
      if (this.aborted) return { success: false, aborted: true }

      // Force WorldRenderer to process the new world data immediately
      // and wait for all async mesh loading to complete before capturing
      if (worldHooks.worldRenderer) {
        // CRITICAL: executeScenePlan() uses setData() which is async.
        // We must yield to let React process the state update before
        // calling updateWorld(), otherwise the renderer gets stale data
        // and assets won't be visible until the next user interaction.
        await new Promise(resolve => requestAnimationFrame(resolve))

        worldHooks.worldRenderer.updateWorld(getWorldData())

        this.progress('Waiting for assets to load...')
        await this.waitForMeshesLoaded(worldHooks.worldRenderer)
      }

      // If refinement is disabled, we're done
      if (!this.config.enableRefinement) {
        this.setState(SCENE_STATE.COMPLETE)
        return {
          success: true,
          plan: this.currentPlan,
          iterations: 1,
          finalScore: null,
          generatedAssets: Array.from(this.generatedAssets.values()),
          placedInstances: placementResult.instanceIds
        }
      }

      // Yield to main thread after placement for smoother UI
      await yieldToMain()

      // Phase 4-6: Iterative Refinement Loop
      let lastEvaluation = null

      for (this.currentIteration = 1; this.currentIteration <= this.config.maxIterations; this.currentIteration++) {
        if (this.aborted) return { success: false, aborted: true }

        // Capture screenshots from multiple angles for better evaluation
        this.setState(SCENE_STATE.CAPTURING)
        this.progress(`Iteration ${this.currentIteration}: Capturing scene...`)

        // Capture overview (bird's eye), ground-level, and orthographic top-down
        const overviewScreenshot = this.captureService.captureOverview(threeScene)
        const groundLevelScreenshot = this.captureService.capture(threeScene, 'groundLevel')
        const topDownScreenshot = this.captureService.captureOrthographic(threeScene)

        // Use overview as primary screenshot for evaluation
        // Ground-level helps catch scale issues and floating assets
        // Top-down (orthographic) shows true layout without perspective distortion
        const screenshot = overviewScreenshot

        // Evaluate with vision
        this.setState(SCENE_STATE.EVALUATING)
        this.progress(`Iteration ${this.currentIteration}: Evaluating scene...`)

        const evaluation = await this.evaluateScene(screenshot, groundLevelScreenshot, topDownScreenshot, getWorldData())
        if (this.aborted) return { success: false, aborted: true }

        // Log evaluation details
        console.log(`[SceneGen] ═══════════════════════════════════════════════════`)
        console.log(`[SceneGen] EVALUATION - Iteration ${this.currentIteration}`)
        console.log(`[SceneGen] ═══════════════════════════════════════════════════`)
        console.log(`[SceneGen] Overall Score: ${evaluation.overallScore}/100`)
        console.log(`[SceneGen] Satisfactory: ${evaluation.satisfactory}`)
        if (evaluation.scaleAppropriateness) {
          console.log(`[SceneGen] Scale Score: ${evaluation.scaleAppropriateness.score}/100`)
          if (evaluation.scaleAppropriateness.tooSmall?.length) {
            console.log(`[SceneGen]   Too small: ${evaluation.scaleAppropriateness.tooSmall.join(', ')}`)
          }
          if (evaluation.scaleAppropriateness.tooLarge?.length) {
            console.log(`[SceneGen]   Too large: ${evaluation.scaleAppropriateness.tooLarge.join(', ')}`)
          }
        }
        if (evaluation.actionItems?.length) {
          console.log(`[SceneGen] Action Items:`)
          for (const item of evaluation.actionItems.slice(0, 5)) {
            console.log(`[SceneGen]   P${item.priority}: ${item.action} - ${item.target?.slice(0, 50)}`)
          }
        }
        console.log(`[SceneGen] ═══════════════════════════════════════════════════`)

        this.evaluationHistory.push(evaluation)
        lastEvaluation = evaluation

        if (this.onIterationComplete) {
          this.onIterationComplete({
            iteration: this.currentIteration,
            evaluation,
            screenshot
          })
        }

        // Check if satisfactory
        if (evaluation.satisfactory || evaluation.overallScore >= this.config.qualityThreshold) {
          this.progress(`Scene achieved quality threshold (${evaluation.overallScore}/100)`)
          break
        }

        // Apply refinements if not last iteration
        // IMPORTANT: Apply refinements BEFORE plateau check, so refinements get a chance to fix issues
        if (this.currentIteration < this.config.maxIterations) {
          this.setState(SCENE_STATE.REFINING)
          this.progress(`Iteration ${this.currentIteration}: Applying refinements...`)

          await this.applyRefinements(evaluation, worldHooks, options)
        }

        // Check for score plateau AFTER refinements applied
        // Only stop if we've tried refinements and still no improvement
        if (this.evaluationHistory.length >= 3) {
          const prevPrev = this.evaluationHistory[this.evaluationHistory.length - 3]
          const prev = this.evaluationHistory[this.evaluationHistory.length - 2]
          // Stop if last 3 scores show no meaningful trend
          if (evaluation.overallScore <= prev.overallScore + 3 &&
              prev.overallScore <= prevPrev.overallScore + 3) {
            this.progress(`Score plateau detected over 3 iterations, stopping refinement`)
            break
          }
        }
      }

      this.setState(SCENE_STATE.COMPLETE)
      return {
        success: true,
        plan: this.currentPlan,
        iterations: this.currentIteration,
        finalScore: lastEvaluation?.overallScore || null,
        evaluationHistory: this.evaluationHistory,
        generatedAssets: Array.from(this.generatedAssets.values()),
        placedInstances: placementResult.instanceIds
      }

    } catch (error) {
      this.setState(SCENE_STATE.ERROR, { error: error.message })
      return {
        success: false,
        error: error.message,
        plan: this.currentPlan,
        iterations: this.currentIteration
      }
    }
  }

  /**
   * Generate all assets defined in the plan
   */
  async generateAssets(assetSpecs) {
    const total = assetSpecs.length
    let completed = 0

    for (const spec of assetSpecs) {
      if (this.aborted) return

      // Skip specs without a prompt (malformed LLM output)
      if (!spec.prompt) {
        console.warn('[SceneGen] Skipping asset spec without prompt:', spec)
        completed++
        continue
      }

      // Skip if we already generated this exact prompt
      if (this.generatedAssets.has(spec.prompt)) {
        completed++
        continue
      }

      this.progress(`Generating asset ${completed + 1}/${total}: ${spec.prompt.slice(0, 40)}...`,
        Math.round((completed / total) * 100))

      try {
        const result = await this.assetGenerator.generate(spec.prompt, {
          category: spec.category
        })

        // Bug #2 fix: Check result.code instead of result.success
        // AssetGenerator returns { asset, code, quality, compiledSuccessfully }
        if (result.code) {
          // Bug #4 fix: Generate thumbnail from result.asset (same pattern as queueProcessor.js)
          const thumbnail = generateThumbnail(result.asset)

          // FIX: Add preferredScale matching AssetReviewModal default (10)
          // Without this, scene-gen assets use computeScaleFromSize() which produces
          // scales of 2-5, making assets 2-4x smaller than manually-placed assets
          const libraryAsset = {
            id: generateId('asset'),
            name: spec.prompt.slice(0, 50),
            prompt: spec.prompt,
            category: spec.category,
            generatedCode: result.code,  // Bug #3 fix: Use 'generatedCode' (WorldRenderer expects this)
            thumbnail,
            thumbnailVersion: 2,  // Matches current ThumbnailRenderer formula
            createdAt: new Date().toISOString(),
            sceneGenerated: true, // Tag as scene-generated
            preferredScale: 10  // Same default as AssetReviewModal - ensures consistent sizing
          }

          this.generatedAssets.set(spec.prompt, libraryAsset)

          // Measure the asset's actual bounding box for accurate collision detection
          try {
            const measured = await this.measurementService.measureAsset(result.code)
            this.assetMeasurements.set(libraryAsset.id, measured)
            console.log(`[SceneGen] Measured ${libraryAsset.id}: ${measured.width.toFixed(1)}×${measured.depth.toFixed(1)}×${measured.height.toFixed(1)}m`)
          } catch (e) {
            console.warn(`[SceneGen] Measurement failed for ${libraryAsset.id}, using estimate`)
          }

          if (this.onAssetGenerated) {
            this.onAssetGenerated(libraryAsset, spec)
          }
        } else {
          console.warn(`Failed to generate asset: ${spec.prompt}`, result)
        }
      } catch (error) {
        console.error(`Error generating asset: ${spec.prompt}`, error)
      }

      completed++

      // Yield to main thread between asset generations for smoother UI
      // This prevents long tasks (>50ms) that cause jank
      await yieldToMain()
    }
  }

  /**
   * Collect all unique asset specifications from a relationship plan.
   * Deduplicates by prompt to avoid generating the same asset multiple times.
   *
   * @param {Object} plan - Relationship plan with structures, decorations, arrangements, atmosphere, npcs
   * @returns {Array} Array of unique asset specifications
   */
  collectRelationshipAssets(plan) {
    const assetMap = new Map()

    // Helper to add asset if not already present
    const addAsset = (spec) => {
      if (spec?.asset?.prompt && !assetMap.has(spec.asset.prompt)) {
        assetMap.set(spec.asset.prompt, {
          prompt: spec.asset.prompt,
          category: spec.asset.category || 'props',
          realWorldSize: spec.asset.realWorldSize || 2,
          scale: spec.asset.scale
        })
      }
    }

    // Collect from structures
    for (const structure of plan.structures || []) {
      addAsset(structure)
    }

    // Collect from decorations
    for (const decoration of plan.decorations || []) {
      addAsset(decoration)
    }

    // Collect from arrangements
    for (const arrangement of plan.arrangements || []) {
      for (const item of arrangement.items || []) {
        addAsset(item)
      }
    }

    // Collect from atmosphere
    for (const atmo of plan.atmosphere || []) {
      addAsset(atmo)
    }

    // Collect from NPCs
    for (const npc of plan.npcs || []) {
      addAsset(npc)
    }

    const specs = Array.from(assetMap.values())
    console.log(`[SceneGen] Collected ${specs.length} unique asset prompts from relationship plan`)
    return specs
  }

  /**
   * Wait for all pending mesh loading to complete in WorldRenderer
   *
   * This is necessary because executeScenePlan() updates state, but:
   * 1. WorldRenderer.updateWorld() runs asynchronously in the animation loop
   * 2. Even after updateWorld(), createInstanceMeshAsync() loads meshes async
   *
   * We must wait for both levels to complete before capturing screenshots.
   *
   * @param {Object} worldRenderer - WorldRenderer instance
   * @param {number} timeout - Max wait time in ms (default 15s for large scenes)
   */
  async waitForMeshesLoaded(worldRenderer, timeout = 15000) {
    const start = Date.now()

    // Wait for pendingMeshes to empty (all async mesh loading complete)
    while (worldRenderer.instances.pendingMeshes.size > 0) {
      if (Date.now() - start > timeout) {
        console.warn(`[SceneGen] Timeout waiting for meshes to load (${worldRenderer.instances.pendingMeshes.size} still pending)`)
        break
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    // One more animation frame for rendering to complete
    await new Promise(resolve => requestAnimationFrame(resolve))
  }

  /**
   * Execute initial asset placement based on the plan
   *
   * For LAYERED plans (_isLayered = true), executes in composition order:
   * 1. Focal layer first - establishes the scene anchor
   * 2. Anchors layer - positioned relative to focal
   * 3. Frame layer - background elements, camera-aware
   * 4. Fill layer - detail props with density gradient
   *
   * For LEGACY plans, uses flat asset list with zone-based placement.
   */
  async executeInitialPlacement(worldHooks, options = {}) {
    const { executeScenePlan } = worldHooks
    const data = this._getWorldData()
    const placements = []
    const libraryAssets = []

    // Collect library assets to add
    for (const asset of this.generatedAssets.values()) {
      // Only add if not already in library
      if (!data.library.find(a => a.id === asset.id)) {
        libraryAssets.push(asset)
      }
    }

    // Helper to lookup category for existing instances (closure over data)
    const getCategoryFn = (inst) => getCategoryForInstance(inst, data)

    // Track focal position for relative placements
    let focalPosition = null

    // Check if this is a RELATIONSHIP plan (new intentional placement)
    if (this.currentPlan._isRelationshipPlan) {
      console.log('[SceneGen] ═══════════════════════════════════════════════════')
      console.log('[SceneGen] RELATIONSHIP PLACEMENT (intentional scene composition)')
      console.log('[SceneGen] ═══════════════════════════════════════════════════')

      // Use the relationship resolver to place all assets
      const result = resolveRelationshipPlacements(
        this.currentPlan,
        this.generatedAssets,
        data.placedAssets || [],
        this.assetMeasurements
      )

      // Merge library assets
      for (const asset of result.libraryAssets) {
        if (!libraryAssets.find(a => a.id === asset.id)) {
          libraryAssets.push(asset)
        }
      }

      // Add placements
      placements.push(...result.placements)

      // Execute the scene plan
      executeScenePlan({
        terrain: { biome: this.currentPlan.terrain?.biome || 'grass' },
        libraryAssets,
        placements
      })

      // Return instance IDs
      const instanceIds = placements.map(p => p.instanceId || generateId())
      return {
        placements,
        libraryAssets,
        instanceIds
      }
    }

    // Check if this is a LAYERED plan
    if (this.currentPlan._isLayered && this.currentPlan._layers) {
      console.log('[SceneGen] ═══════════════════════════════════════════════════')
      console.log('[SceneGen] LAYERED PLACEMENT (composition-aware)')
      console.log('[SceneGen] ═══════════════════════════════════════════════════')

      const layers = this.currentPlan._layers

      // LAYER 1: FOCAL - Place first, record position
      if (layers.focal) {
        focalPosition = calculateFocalPosition('centered')
        const focalPlacements = this.placeLayerAssets(
          [layers.focal], focalPosition, data, getCategoryFn, placements
        )
        console.log(`[SceneGen] FOCAL layer: ${focalPlacements.length} placed at (${focalPosition.x.toFixed(0)}, ${focalPosition.z.toFixed(0)})`)
        placements.push(...focalPlacements)
      } else {
        // No focal specified, use center
        focalPosition = calculateFocalPosition('centered')
        console.log('[SceneGen] No focal specified, using center as reference')
      }

      // LAYER 2: ANCHORS - Place relative to focal
      if (layers.anchors?.length > 0) {
        const anchorPlacements = this.placeLayerAssets(
          layers.anchors, focalPosition, data, getCategoryFn, placements
        )
        console.log(`[SceneGen] ANCHORS layer: ${anchorPlacements.length} placed around focal`)
        placements.push(...anchorPlacements)

        // Validate anchor placements don't block focal
        const validation = validateLayerPlacement(
          placements.filter(p => p._layer !== 'anchors'),
          anchorPlacements,
          focalPosition
        )
        if (validation.warnings.length > 0) {
          console.log(`[SceneGen]   ⚠️ Anchor warnings: ${validation.warnings.join(', ')}`)
        }
      }

      // LAYER 3: FRAME - Background elements, camera-aware
      if (layers.frame?.length > 0) {
        const framePlacements = this.placeLayerAssets(
          layers.frame, focalPosition, data, getCategoryFn, placements
        )
        console.log(`[SceneGen] FRAME layer: ${framePlacements.length} placed at edges`)
        placements.push(...framePlacements)
      }

      // LAYER 4: FILL - Detail props with density gradient
      if (layers.fill?.length > 0) {
        const fillPlacements = this.placeLayerAssets(
          layers.fill, focalPosition, data, getCategoryFn, placements
        )
        console.log(`[SceneGen] FILL layer: ${fillPlacements.length} scattered throughout`)
        placements.push(...fillPlacements)
      }

      // Run composition scorer to validate overall layout
      const allPositions = placements.map(p => ({
        x: p.position[0],
        z: p.position[2],
        scale: p.scale
      }))
      const compositionScore = scoreComposition(allPositions, focalPosition)
      console.log(`[SceneGen] ───────────────────────────────────────────────────`)
      console.log(`[SceneGen] COMPOSITION SCORE: ${compositionScore.overall}/100`)
      console.log(`[SceneGen]   Depth layers: ${compositionScore.depthLayers.score}`)
      console.log(`[SceneGen]   Focal visible: ${compositionScore.focalVisible.score}`)
      console.log(`[SceneGen]   Density: ${compositionScore.density.score}`)
      console.log(`[SceneGen]   Balance: ${compositionScore.balance.score}`)
      if (compositionScore.warnings.length > 0) {
        console.log(`[SceneGen]   Warnings: ${compositionScore.warnings.join(', ')}`)
      }
      console.log('[SceneGen] ═══════════════════════════════════════════════════')

    } else {
      // LEGACY: Flat asset list with zone-based placement
      console.log('[SceneGen] Using LEGACY placement (zone-based)')

      const allSpecs = [...(this.currentPlan.assets || []), ...(this.currentPlan.npcs || [])]

      for (const spec of allSpecs) {
        if (!spec.prompt) continue  // Skip malformed specs
        const libraryAsset = this.generatedAssets.get(spec.prompt)
        if (!libraryAsset) continue

        // Get placement positions using our algorithm
        const positions = executeAssetPlacement(spec)

        // Log placement results for debugging - DETAILED
        console.log(`[SceneGen] PLACEMENT: "${spec.prompt.slice(0, 30)}"`)
        console.log(`[SceneGen]   category: ${spec.category}, realWorldSize: ${spec.realWorldSize}m, SCALE: ${spec.scale}`)
        console.log(`[SceneGen]   algorithm: ${spec.placement}, location: ${spec.location}`)
        console.log(`[SceneGen]   requested: ${spec.count}, generated: ${positions.length} positions`)
        if (positions.length > 0) {
          const xs = positions.map(p => p.x)
          const zs = positions.map(p => p.z)
          console.log(`[SceneGen]   X range: ${Math.min(...xs).toFixed(0)}-${Math.max(...xs).toFixed(0)}`)
          console.log(`[SceneGen]   Z range: ${Math.min(...zs).toFixed(0)}-${Math.max(...zs).toFixed(0)}`)
        }

        // CRITICAL FIX: Combine world assets + already-placed scene assets
        // This ensures collision detection sees ALL assets, not just pre-existing ones
        const allExisting = [
          ...data.placedAssets,
          ...placements.map(p => ({
            position: p.position,
            scale: p.scale,
            libraryId: p.libraryId
          }))
        ]

        // Get measured bounds for this asset (if available)
        const newAssetBounds = this.assetMeasurements.get(libraryAsset.id)

        // Validate positions against ALL existing with measurement-aware collision
        const validPositions = validatePlacements(
          positions,
          allExisting,
          spec.scale || 1,
          spec.category || 'props',
          getCategoryFn,
          spec.minDistance,  // Now used as floor, not override
          this.assetMeasurements,  // Pass measurements map for existing assets
          newAssetBounds  // Pass bounds for new asset
        )

        console.log(`[SceneGen]   after collision filter: ${validPositions.length} valid positions`)

        // Create placement entries
        for (const pos of validPositions) {
          placements.push({
            libraryId: libraryAsset.id,
            position: [pos.x, 0, pos.z],
            rotation: pos.rotation || Math.random() * Math.PI * 2,
            scale: spec.scale ?? 1,
            behavior: spec.behavior,
            wanderRadius: spec.wanderRadius
          })
        }
      }
    }

    // Note: NPCs are already processed in the loop above for layered plans
    // For legacy plans, NPCs are included in allSpecs

    // PHASE 4: Rebalance placements for even distribution across scene
    // This moves excess assets from crowded cells to sparse cells
    console.log('[SceneGen] ───────────────────────────────────────────────────')
    console.log('[SceneGen] REBALANCING placements...')

    const placementPositions = placements.map((p, i) => ({
      x: p.position[0],
      z: p.position[2],
      index: i
    }))

    const rebalanceResult = rebalancePlacements(placementPositions, 6, 3)

    // Apply rebalanced positions back to placements
    for (const pos of rebalanceResult.placements) {
      if (pos._relocated && pos.index !== undefined) {
        placements[pos.index].position[0] = pos.x
        placements[pos.index].position[2] = pos.z
      }
    }

    if (rebalanceResult.moved > 0) {
      console.log(`[SceneGen] Rebalanced: moved ${rebalanceResult.moved} assets`)
    } else {
      console.log('[SceneGen] Rebalance: no changes needed')
    }

    // PHASE 2.1: Apply terrain height to placements
    // Query terrain heightmap to set Y coordinate (assets sit ON terrain)
    if (worldHooks.worldRenderer?.terrain?.getTerrainHeight) {
      const getHeight = (x, z) => worldHooks.worldRenderer.terrain.getTerrainHeight(x, z)
      for (const p of placements) {
        const y = getHeight(p.position[0], p.position[2]) || 0
        p.position[1] = y
      }
      console.log('[SceneGen] Applied terrain height to placements')
    }

    // Calculate terrain modifications
    let terrainChanges = []
    if (this.config.applyTerrain && this.currentPlan.terrain?.modifications) {
      const heightmapCopy = data.terrain.heightmap.map(row => [...row])

      for (const mod of this.currentPlan.terrain.modifications) {
        const changes = applyTerrainModification(heightmapCopy, mod)
        terrainChanges = terrainChanges.concat(changes.map(c => ({
          x: c.x,
          z: c.z,
          newValue: c.newValue
        })))
      }
    }

    // Execute the scene plan as a single undoable operation
    const scenePlan = {
      terrain: {
        biome: this.currentPlan.terrain?.biome,
        heightChanges: terrainChanges
      },
      libraryAssets,
      placements
    }

    const result = executeScenePlan(scenePlan)
    return result
  }

  /**
   * Place assets for a single composition layer
   *
   * @param {Array} layerSpecs - Asset specs for this layer
   * @param {{x: number, z: number}} focalPosition - Focal position for relative placements
   * @param {Object} data - World data
   * @param {Function} getCategoryForInstance - Category lookup helper
   * @param {Array} existingPlacements - Already placed assets (for collision detection)
   * @returns {Array} Placement entries for this layer
   */
  placeLayerAssets(layerSpecs, focalPosition, data, getCategoryForInstance, existingPlacements) {
    const placements = []

    for (const spec of layerSpecs) {
      if (!spec.prompt) continue  // Skip malformed specs
      const libraryAsset = this.generatedAssets.get(spec.prompt)
      if (!libraryAsset) continue

      // Use layered placement algorithm
      const positions = executeLayeredPlacement(spec, focalPosition)

      // Log for debugging
      const layerName = spec._layer || 'unknown'
      console.log(`[SceneGen]   "${spec.prompt.slice(0, 30)}" (${layerName})`)
      console.log(`[SceneGen]     placement: ${spec.placement}, scale: ${spec.scale}, count: ${positions.length}`)

      // Combine existing world assets with already-placed scene assets
      const allExisting = [
        ...data.placedAssets,
        ...existingPlacements.map(p => ({
          position: p.position,
          scale: p.scale,
          libraryId: p.libraryId  // Include libraryId for measurement lookup
        }))
      ]

      console.log(`[SceneGen]     checking against ${allExisting.length} existing placements`)

      // Get measured bounds for this asset (if available)
      const newAssetBounds = this.assetMeasurements.get(libraryAsset.id)

      // Validate positions with measurement-aware collision
      // minDistance is now a FLOOR, not override (see validatePlacements fix)
      const validPositions = validatePlacements(
        positions,
        allExisting,
        spec.scale || 1,
        spec.category || 'props',
        getCategoryForInstance,
        spec.minDistance,
        this.assetMeasurements,  // Pass measurements map for existing assets
        newAssetBounds  // Pass bounds for new asset
      )

      console.log(`[SceneGen]     after collision: ${validPositions.length} valid (${positions.length - validPositions.length} rejected)`)

      // Create placement entries
      for (const pos of validPositions) {
        placements.push({
          libraryId: libraryAsset.id,
          position: [pos.x, 0, pos.z],
          rotation: pos.rotation ?? Math.random() * Math.PI * 2,
          scale: spec.scale ?? 1,
          _layer: spec._layer  // Preserve layer info for debugging
        })
      }
    }

    return placements
  }

  /**
   * Generate a text summary of placed assets for the evaluator.
   * This gives the vision model context about what assets exist, their names,
   * positions, and categories - information not visible from screenshots alone.
   *
   * @param {Object} worldData - World data with placedAssets and library
   * @returns {string} Formatted summary of scene state
   */
  generateSceneStateSummary(worldData) {
    const { placedAssets, library } = worldData
    if (!placedAssets || placedAssets.length === 0) {
      return ''
    }

    const lines = ['PLACED ASSETS (use instanceId or structureId for refinement references):']

    for (const inst of placedAssets) {
      const asset = library.find(a => a.id === inst.libraryId)
      if (!asset) continue

      const [x, y, z] = inst.position
      const name = asset.name || asset.prompt?.slice(0, 40) || 'unknown'
      const category = asset.category || 'props'
      const scale = inst.scale?.toFixed(1) || '1.0'

      // Include structure ID if this was a relationship-based structure placement
      const structureId = inst._structureId ? ` | ${inst._structureId}` : ''

      // Include instance ID and optional structure ID for direct reference in refinement
      lines.push(`- [${inst.instanceId}${structureId}] "${name}" at (${x.toFixed(0)}, ${z.toFixed(0)}), category: ${category}, scale: ${scale}`)
    }

    // Add summary stats
    const byCategory = {}
    for (const inst of placedAssets) {
      const asset = library.find(a => a.id === inst.libraryId)
      const cat = asset?.category || 'props'
      byCategory[cat] = (byCategory[cat] || 0) + 1
    }

    lines.push('')
    lines.push(`SUMMARY: ${placedAssets.length} total assets`)
    for (const [cat, count] of Object.entries(byCategory)) {
      lines.push(`  ${cat}: ${count}`)
    }

    return lines.join('\n')
  }

  /**
   * Evaluate the current scene using vision API
   * @param {string} overviewScreenshot - Bird's eye view screenshot
   * @param {string} [groundLevelScreenshot] - Optional ground-level screenshot for scale verification
   * @param {string} [topDownScreenshot] - Optional orthographic top-down view
   * @param {Object} [worldData] - Optional world data for scene state summary
   */
  async evaluateScene(overviewScreenshot, groundLevelScreenshot = null, topDownScreenshot = null, worldData = null) {
    // Generate scene state summary if world data is available
    let sceneStateSummary = worldData ? this.generateSceneStateSummary(worldData) : ''

    // Add collision analysis if we have world data and measurements
    if (worldData?.placedAssets) {
      const collisionReport = this.collisionAnalyzer.analyzeScene(
        worldData.placedAssets,
        this.assetMeasurements
      )
      const structuralSummary = this.collisionAnalyzer.formatForPrompt(collisionReport)
      sceneStateSummary = sceneStateSummary + '\n\n' + structuralSummary
    }

    // V2 mode uses different evaluation prompt and includes scene plan for structure ID reference
    const systemPrompt = buildSceneEvaluationSystemPrompt(this.originalPrompt, sceneStateSummary, {
      mode: this.mode,
      scenePlan: this.mode === 'v2' ? this.currentPlan : null
    })

    let response
    const images = [{ data: overviewScreenshot }]
    let prompt = this.mode === 'v2'
      ? 'Evaluate this scene for composition quality. Reference structure IDs from the plan when describing issues.'
      : 'Analyze this 3D scene screenshot and provide quality scores.'

    if (groundLevelScreenshot) {
      images.push({ data: groundLevelScreenshot })
      prompt = this.mode === 'v2'
        ? 'Evaluate these scene screenshots. Image 1 is overview, Image 2 is ground-level. Check for scale and composition issues.'
        : 'Analyze these 3D scene screenshots. Image 1 is a bird\'s eye overview, Image 2 is ground-level perspective. ' +
          'Pay special attention to scale issues visible in the ground-level view (assets that appear too large or too small relative to each other).'
    }

    if (topDownScreenshot) {
      images.push({ data: topDownScreenshot })
      prompt = this.mode === 'v2'
        ? 'Evaluate these scene screenshots. Image 1 is overview, Image 2 is ground-level, Image 3 is top-down. Check for clustering, overlap, and scale issues.'
        : 'Analyze these 3D scene screenshots. Image 1 is a bird\'s eye overview, Image 2 is ground-level perspective, ' +
          'Image 3 is orthographic top-down view for accurate layout assessment. ' +
          'Pay special attention to: scale issues in ground-level view, and overlapping/clustering issues in top-down view.'
    }

    if (images.length > 1) {
      response = await geminiClient.generateWithImages(prompt, images, systemPrompt, {
        temperature: 0.3,
        maxOutputTokens: 2048
      })
    } else {
      response = await geminiClient.generateWithImage(prompt, overviewScreenshot, systemPrompt, {
        temperature: 0.3,
        maxOutputTokens: 2048
      })
    }

    // Use appropriate parser based on mode
    const evaluation = this.mode === 'v2'
      ? parseV2Evaluation(response)
      : parseSceneEvaluation(response)

    if (!evaluation) {
      // Return a default evaluation if parsing fails
      return {
        overallScore: 50,
        satisfactory: false,
        actionItems: [],
        parseError: true
      }
    }

    return evaluation
  }

  /**
   * Apply refinements based on evaluation feedback
   */
  async applyRefinements(evaluation, worldHooks, options = {}) {
    // V2 mode uses completely different refinement logic
    if (this.mode === 'v2') {
      return this.applyV2Refinements(evaluation, worldHooks, options)
    }

    // Only process high-priority action items
    const criticalItems = evaluation.actionItems?.filter(item => item.priority <= 2) || []

    console.log(`[SceneGen] applyRefinements called with ${criticalItems.length} critical items`)

    if (criticalItems.length === 0) {
      console.log('[SceneGen] No critical items, skipping refinements')
      return // No refinements needed
    }

    console.log('[SceneGen] Generating refinement plan...')

    // Generate scene state summary for refinement LLM
    const sceneStateSummary = this.generateSceneStateSummary(this._getWorldData())

    // Generate refinement plan with scene context
    const refinementPrompt = buildRefinementPrompt(evaluation, this.currentPlan, sceneStateSummary)
    const response = await geminiClient.generate(refinementPrompt, SCENE_REFINEMENT_PROMPT, {
      temperature: 0.5,
      maxOutputTokens: 2048
    })

    if (this.aborted) return

    const refinements = parseRefinementPlan(response) // Use dedicated refinement parser
    if (!refinements) {
      console.warn('[SceneGen] Failed to parse refinement response')
      console.warn('[SceneGen] Raw response:', response.slice(0, 500))
      return
    }

    // Log what we got from the refinement
    console.log('[SceneGen] Refinement plan:', {
      rescaleAssets: refinements.rescaleAssets?.length || 0,
      removeAssets: refinements.removeAssets?.length || 0,
      addAssets: refinements.addAssets?.length || 0,
      moveAssets: refinements.moveAssets?.length || 0
    })

    // Process rescale operations FIRST (before adding new assets)
    if (refinements.rescaleAssets?.length > 0) {
      await this.processRescales(refinements.rescaleAssets, worldHooks)
    }

    // Process remove operations
    if (refinements.removeAssets?.length > 0) {
      await this.processRemovals(refinements.removeAssets, worldHooks)
    }

    // Process move operations
    if (refinements.moveAssets?.length > 0) {
      await this.processMoves(refinements.moveAssets, worldHooks)
    }

    // Generate new assets if needed
    if (refinements.addAssets?.length > 0) {
      await this.generateAssets(refinements.addAssets)
    }

    // Apply the refinements as a new scene batch
    if (refinements.addAssets?.length > 0 || refinements.terrain?.modifications?.length > 0) {
      const placements = []
      const libraryAssets = []

      // Collect new assets
      for (const spec of (refinements.addAssets || [])) {
        const asset = this.generatedAssets.get(spec.prompt)
        if (asset && !this._getWorldData().library.find(a => a.id === asset.id)) {
          libraryAssets.push(asset)
        }
      }

      // Helper to lookup category for existing instances (uses live data)
      const getCategoryFn = (inst) => getCategoryForInstance(inst, this._getWorldData())

      // Generate placements for new assets
      for (const spec of (refinements.addAssets || [])) {
        const libraryAsset = this.generatedAssets.get(spec.prompt)
        if (!libraryAsset) continue

        // Get measured bounds for this asset (if available)
        const newAssetBounds = this.assetMeasurements.get(libraryAsset.id)

        const positions = executeAssetPlacement(spec)
        const validPositions = validatePlacements(
          positions,
          this._getWorldData().placedAssets,
          spec.scale || 1,
          spec.category || 'props',
          getCategoryFn,
          spec.minDistance,
          this.assetMeasurements,  // Pass measurements map for existing assets
          newAssetBounds  // Pass bounds for new asset
        )

        for (const pos of validPositions) {
          placements.push({
            libraryId: libraryAsset.id,
            position: [pos.x, 0, pos.z],
            rotation: pos.rotation || Math.random() * Math.PI * 2,
            scale: spec.scale ?? 1  // H7 FIX: Default to 1 if scale is undefined
          })
        }
      }

      // Calculate terrain changes
      let terrainChanges = []
      if (refinements.terrain?.modifications) {
        const heightmapCopy = this._getWorldData().terrain.heightmap.map(row => [...row])
        for (const mod of refinements.terrain.modifications) {
          const changes = applyTerrainModification(heightmapCopy, mod)
          terrainChanges = terrainChanges.concat(changes.map(c => ({
            x: c.x,
            z: c.z,
            newValue: c.newValue
          })))
        }
      }

      // Execute refinements
      if (placements.length > 0 || libraryAssets.length > 0 || terrainChanges.length > 0) {
        worldHooks.executeScenePlan({
          terrain: { heightChanges: terrainChanges },
          libraryAssets,
          placements
        })

        // Force WorldRenderer to process refinements and wait for mesh loading
        if (worldHooks.worldRenderer) {
          // Yield to let React process state update from executeScenePlan
          await new Promise(resolve => requestAnimationFrame(resolve))
          worldHooks.worldRenderer.updateWorld(this._getWorldData())
          await this.waitForMeshesLoaded(worldHooks.worldRenderer)
        }
      }
    }

    // Update the current plan to include refinements
    if (refinements.addAssets) {
      this.currentPlan.assets = [...(this.currentPlan.assets || []), ...refinements.addAssets]
    }
  }

  /**
   * Apply V2 refinements - complete plan revision based on semantic feedback
   *
   * Unlike legacy refinements (incremental changes), V2 refinement:
   * 1. Receives semantic issue descriptions from evaluation
   * 2. Asks LLM to revise the complete plan with coordinate fixes
   * 3. Re-parses the revised plan
   * 4. Clears and re-places all structures with new coordinates
   *
   * @param {Object} evaluation - V2 evaluation with verdict/issues
   * @param {Object} worldHooks - World state hooks
   * @param {Object} options - Additional options
   */
  async applyV2Refinements(evaluation, worldHooks, options = {}) {
    // Check if there are issues to fix
    const issues = evaluation.issues || evaluation.actionItems || []

    if (issues.length === 0 || evaluation.verdict === 'accept') {
      console.log('[SceneGen] V2: No issues to refine, scene accepted')
      return
    }

    console.log(`[SceneGen] V2: Refining plan based on ${issues.length} issues`)

    // Build V2 refinement prompt
    const refinementPrompt = buildV2RefinementPrompt(evaluation, this.currentPlan)
    const response = await geminiClient.generate(refinementPrompt, SCENE_REFINEMENT_PROMPT_V2, {
      temperature: 0.4,
      maxOutputTokens: 4096
    })

    if (this.aborted) return

    // Parse the revised plan (same schema as original V2 plan)
    const revisedPlan = parseScenePlan(response, { mode: 'v2' })

    if (!revisedPlan) {
      console.warn('[SceneGen] V2: Failed to parse revised plan')
      console.warn('[SceneGen] V2: Raw response:', response.slice(0, 500))
      return
    }

    console.log('[SceneGen] V2: Revised plan parsed successfully')
    console.log('[SceneGen] V2: Structures:', revisedPlan.structures?.length || 0)

    // Track which instances to update vs keep
    const existingInstances = this._getWorldData().placedAssets || []
    const structureInstances = existingInstances.filter(inst =>
      inst._structureId
    )

    // For each structure in revised plan, update position/facing if changed
    for (const structure of (revisedPlan.structures || [])) {
      const structureId = structure.id
      const existingInstance = structureInstances.find(inst =>
        inst._structureId === structureId
      )

      if (existingInstance) {
        // Update position if changed (position is [x, y, z] array)
        const newPos = structure.position
        const oldPos = existingInstance.position

        if (newPos && (newPos[0] !== oldPos?.[0] || newPos[1] !== oldPos?.[2])) {
          console.log(`[SceneGen] V2: Moving ${structureId} from (${oldPos?.[0]}, ${oldPos?.[2]}) to (${newPos[0]}, ${newPos[1]})`)

          worldHooks.updateInstance(existingInstance.instanceId, {
            position: [newPos[0], existingInstance.position?.[1] || 0, newPos[1]]
          })
        }

        // Update facing if changed (rotation is a single number — yaw in radians)
        const facingMap = { north: 180, south: 0, east: -90, west: 90 }
        const newFacing = structure.facing
        if (newFacing && facingMap[newFacing] !== undefined) {
          const newRotation = facingMap[newFacing] * (Math.PI / 180)
          if (Math.abs(newRotation - (existingInstance.rotation || 0)) > 0.1) {
            console.log(`[SceneGen] V2: Rotating ${structureId} to face ${newFacing}`)

            worldHooks.updateInstance(existingInstance.instanceId, {
              rotation: newRotation
            })
          }
        }
      }
    }

    // Identify structures removed from revised plan (in world but not in plan)
    const revisedIds = new Set((revisedPlan.structures || []).map(s => s.id))
    const removedInstances = structureInstances.filter(inst =>
      inst._structureId && !revisedIds.has(inst._structureId)
    )

    if (removedInstances.length > 0) {
      console.log(`[SceneGen] V2: Removing ${removedInstances.length} structures no longer in plan`)
      for (const inst of removedInstances) {
        worldHooks.deleteInstance(inst.instanceId)
      }
    }

    // Identify structures added in revised plan (not yet in world)
    const existingIds = new Set(structureInstances.map(inst => inst._structureId))
    const addedStructures = (revisedPlan.structures || []).filter(s => !existingIds.has(s.id))

    if (addedStructures.length > 0) {
      console.log(`[SceneGen] V2: ${addedStructures.length} new structures to generate and place`)

      // Generate assets for new structures
      const newAssetSpecs = addedStructures.map(s => ({
        prompt: s.prompt || s.description,
        category: s.category || 'buildings',
        realWorldSize: s.realWorldSize || s.size
      }))
      await this.generateAssets(newAssetSpecs)

      // Build placements from the revised plan positions
      const placements = []
      const libraryAssets = []

      for (const structure of addedStructures) {
        const asset = this.generatedAssets.get(structure.prompt || structure.description)
        if (!asset) continue

        if (!this._getWorldData().library.find(a => a.id === asset.id)) {
          libraryAssets.push(asset)
        }

        const facingMap = { north: 180, south: 0, east: -90, west: 90 }
        const rotation = structure.facing && facingMap[structure.facing] !== undefined
          ? facingMap[structure.facing] * (Math.PI / 180)
          : 0

        placements.push({
          libraryId: asset.id,
          position: [structure.position[0], 0, structure.position[1]],
          rotation,
          scale: asset.scale || 10,
          _structureId: structure.id,
          _type: 'structure'
        })
      }

      if (placements.length > 0 || libraryAssets.length > 0) {
        worldHooks.executeScenePlan({
          terrain: { heightChanges: [] },
          libraryAssets,
          placements
        })
      }
    }

    // Update current plan with revisions
    this.currentPlan = revisedPlan

    // Force WorldRenderer to process updates
    if (worldHooks.worldRenderer) {
      // Yield to let React process state update from executeScenePlan
      await new Promise(resolve => requestAnimationFrame(resolve))
      worldHooks.worldRenderer.updateWorld(this._getWorldData())
      await this.waitForMeshesLoaded(worldHooks.worldRenderer)
    }
  }

  /**
   * Process rescale operations from refinement
   *
   * Supports two modes:
   * 1. Multiplier-based (new): suggestedMultiplier relative to current scale
   * 2. Absolute (legacy): newRealWorldSize in meters
   *
   * Multiplier-based is preferred for judge-based iterative correction.
   *
   * @param {Array} rescales - Rescale operations from refinement
   * @param {Object} worldHooks - World state hooks
   * @returns {Object} Summary of operations: { attempted, succeeded, failed }
   */
  async processRescales(rescales, worldHooks) {
    const data = this._getWorldData()
    const { updateInstance } = worldHooks

    // Track success/failure for verification logging
    let attempted = 0
    let succeeded = 0
    let failed = 0

    for (const rescale of rescales) {
      attempted++

      // Find matching instance(s)
      const matches = findMatchingInstances(rescale, data)

      if (matches.length === 0) {
        const targetDesc = rescale.instanceId || rescale.structureId || rescale.description || 'unknown target'
        console.log(`[Refinement] No instances found for rescale: "${targetDesc}"`)
        failed++
        continue
      }

      // Update all matching instances
      for (const instance of matches) {
        let newScale

        if (typeof rescale.suggestedMultiplier === 'number' && rescale.suggestedMultiplier > 0) {
          // New: Multiplier-based (relative to current scale)
          newScale = instance.scale * rescale.suggestedMultiplier
          console.log(`[Refinement] Rescaling instance ${instance.instanceId}: ` +
            `scale ${instance.scale.toFixed(2)} × ${rescale.suggestedMultiplier} → ${newScale.toFixed(2)}`)
        } else if (typeof rescale.newRealWorldSize === 'number' && rescale.newRealWorldSize > 0) {
          // Legacy: Absolute size using invariant system
          const category = getCategoryForInstance(instance, data)
          const { scale, clamped } = computeRescale(rescale.newRealWorldSize, category)
          newScale = scale

          if (clamped) {
            console.log(`[Refinement] Rescale clamped: ${rescale.newRealWorldSize}m for ${category}`)
          }
          console.log(`[Refinement] Rescaling instance ${instance.instanceId}: ` +
            `scale ${instance.scale.toFixed(2)} → ${newScale.toFixed(2)} (${rescale.newRealWorldSize}m)`)
        } else {
          console.warn(`[Refinement] Invalid rescale: missing suggestedMultiplier or newRealWorldSize`)
          failed++
          continue
        }

        // Clamp to reasonable range (same as INSTANCE_SCALE limits)
        newScale = Math.max(0.1, Math.min(200, newScale))

        if (updateInstance) {
          updateInstance(instance.instanceId, { scale: newScale })
          succeeded++
        }
      }
    }

    // Log verification summary
    console.log(`[Refinement] ═══════════════════════════════════════════════════`)
    console.log(`[Refinement] RESCALE SUMMARY: ${succeeded}/${attempted} applied successfully`)
    if (failed > 0) {
      console.warn(`[Refinement] ${failed} rescale operations failed (instanceId matching issues?)`)
    }
    console.log(`[Refinement] ═══════════════════════════════════════════════════`)

    return { attempted, succeeded, failed }
  }

  /**
   * Process removal operations from refinement
   *
   * Finds instances matching the description/location and removes them.
   *
   * @param {Array} removals - Remove operations from refinement
   * @param {Object} worldHooks - World state hooks
   * @returns {Object} Summary of operations: { attempted, succeeded, failed }
   */
  async processRemovals(removals, worldHooks) {
    const data = this._getWorldData()
    const { deleteInstance } = worldHooks

    // Track success/failure for verification logging
    let attempted = 0
    let succeeded = 0
    let failed = 0

    for (const removal of removals) {
      attempted++

      // Find matching instance(s)
      const matches = findMatchingInstances(removal, data)

      if (matches.length === 0) {
        const targetDesc = removal.instanceId || removal.description || 'unknown target'
        console.log(`[Refinement] No instances found for removal: "${targetDesc}"`)
        failed++
        continue
      }

      // Remove matching instances (limit to avoid over-deletion)
      const toRemove = matches.slice(0, 3) // Remove at most 3 at a time

      for (const instance of toRemove) {
        console.log(`[Refinement] Removing instance ${instance.instanceId}: "${removal.reason}"`)

        if (deleteInstance) {
          deleteInstance(instance.instanceId)
          succeeded++
        }
      }
    }

    // Log verification summary
    if (attempted > 0) {
      console.log(`[Refinement] ───────────────────────────────────────────────────`)
      console.log(`[Refinement] REMOVAL SUMMARY: ${succeeded}/${attempted} applied successfully`)
      if (failed > 0) {
        console.warn(`[Refinement] ${failed} removal operations failed (instanceId matching issues?)`)
      }
    }

    return { attempted, succeeded, failed }
  }

  /**
   * Process move operations from refinement
   *
   * Finds instances matching the description/location and moves them to new positions.
   *
   * @param {Array} moves - Move operations from refinement
   * @param {Object} worldHooks - World state hooks
   * @returns {Object} Summary of operations: { attempted, succeeded, failed }
   */
  async processMoves(moves, worldHooks) {
    const data = this._getWorldData()
    const { updateInstance } = worldHooks

    let attempted = 0
    let succeeded = 0
    let failed = 0

    for (const move of moves) {
      attempted++

      const matches = findMatchingInstances(move, data)

      if (matches.length === 0) {
        const targetDesc = move.instanceId || move.structureId || move.description || 'unknown target'
        console.warn(`[Refinement] Move: no matching instance for "${targetDesc}"`)
        failed++
        continue
      }

      const instance = matches[0]
      const newPos = move.newPosition || move.position

      if (!newPos || !Array.isArray(newPos) || newPos.length < 2) {
        console.warn(`[Refinement] Move: invalid position for ${instance.instanceId}`)
        failed++
        continue
      }

      if (updateInstance) {
        const y = instance.position?.[1] || 0
        updateInstance(instance.instanceId, {
          position: [newPos[0], y, newPos[1]]
        })
        console.log(`[Refinement] Moved ${instance.instanceId} to (${newPos[0]}, ${newPos[1]})`)
        succeeded++
      }
    }

    if (attempted > 0) {
      console.log(`[Refinement] ───────────────────────────────────────────────────`)
      console.log(`[Refinement] MOVE SUMMARY: ${succeeded}/${attempted} applied successfully`)
      if (failed > 0) {
        console.warn(`[Refinement] ${failed} move operations failed`)
      }
    }

    return { attempted, succeeded, failed }
  }

  /**
   * Get the current state and progress
   */
  getStatus() {
    return {
      state: this.state,
      iteration: this.currentIteration,
      maxIterations: this.config.maxIterations,
      evaluationHistory: this.evaluationHistory,
      generatedAssetsCount: this.generatedAssets.size,
      currentPlan: this.currentPlan
    }
  }
}

/**
 * Create a scene generation agent with default configuration
 */
export function createSceneAgent(config = {}) {
  return new SceneGenerationAgent(config)
}
