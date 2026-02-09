import * as THREE from 'three'
import { geminiClient } from './GeminiClient'
import { ASSET_SYSTEM_PROMPT_V4_BRIGHT, PLANNING_SYSTEM_PROMPT_V4, CATEGORY_PALETTES, CATEGORY_PROPORTIONS } from './systemPrompts'
import { assertCodeSafety } from './CodeSandbox'
import { assertDelimiterBalance, validateDelimiterBalance } from './syntaxValidator'
import { SchemaCompiler } from './compiler/SchemaCompiler.js'
import { recordUsage } from './tokenUsage.js'

/**
 * Quality metrics for a generated asset
 *
 * NOTE: This is advisory only - creative/unusual prompts may produce
 * unconventional results that don't fit typical patterns. Only flag
 * genuinely broken assets (no meshes, no materials).
 */
function analyzeAssetQuality(asset) {
  const metrics = {
    meshCount: 0,
    materialCount: 0,
    uniqueColors: new Set(),
    boundingBox: new THREE.Box3(),
    center: new THREE.Vector3(),
    dimensions: new THREE.Vector3(),
    grounded: false,
    centered: false,
    errors: [],      // Blocking issues (empty asset)
    warnings: [],    // Non-blocking but notable
    info: []         // Just informational
  }

  // Count meshes and materials
  const materials = new Set()
  asset.traverse(obj => {
    if (obj.isMesh) {
      metrics.meshCount++
      if (obj.material) {
        materials.add(obj.material.uuid)
        if (obj.material.color) {
          metrics.uniqueColors.add(obj.material.color.getHexString())
        }
      }
    }
  })
  metrics.materialCount = materials.size

  // Analyze color contrast for visibility
  if (metrics.uniqueColors.size > 0) {
    const colorArray = Array.from(metrics.uniqueColors).map(hex => parseInt(hex, 16))

    // Calculate luminance for each color (relative luminance formula)
    const luminances = colorArray.map(rgb => {
      const r = ((rgb >> 16) & 0xFF) / 255
      const g = ((rgb >> 8) & 0xFF) / 255
      const b = (rgb & 0xFF) / 255
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    })

    metrics.minLuminance = Math.min(...luminances)
    metrics.maxLuminance = Math.max(...luminances)
    metrics.luminanceRange = metrics.maxLuminance - metrics.minLuminance

    // Check for problematic cases
    if (metrics.maxLuminance < 0.25) {
      metrics.warnings.push('All colors very dark (max luminance < 0.25) - asset may be hard to see')
    }

    if (metrics.uniqueColors.size > 1 && metrics.luminanceRange < 0.2) {
      metrics.warnings.push(`Low color contrast (range ${metrics.luminanceRange.toFixed(2)}) - colors too similar`)
    }
  }

  // Compute bounding box
  metrics.boundingBox.setFromObject(asset)
  metrics.boundingBox.getCenter(metrics.center)
  metrics.boundingBox.getSize(metrics.dimensions)

  // Check normalization
  const tolerance = 0.15
  metrics.grounded = Math.abs(metrics.boundingBox.min.y) < tolerance
  metrics.centered = Math.abs(metrics.center.x) < tolerance && Math.abs(metrics.center.z) < tolerance

  // Only flag genuinely broken assets as errors
  if (metrics.meshCount === 0) {
    metrics.errors.push('The generated model has no visible parts. Try a different description.')
  }

  if (metrics.materialCount === 0 && metrics.meshCount > 0) {
    metrics.warnings.push('Asset has no materials assigned')
  }

  // Budget exceeded is a warning, not error (still usable)
  if (metrics.meshCount > 30) {
    metrics.warnings.push(`High mesh count (${metrics.meshCount}) may impact performance`)
  }

  // Normalization issues are informational - some assets intentionally float
  if (!metrics.grounded && metrics.boundingBox.min.y > 0.3) {
    metrics.info.push(`Asset floating above ground (min.y = ${metrics.boundingBox.min.y.toFixed(2)})`)
  }

  if (!metrics.centered && (Math.abs(metrics.center.x) > 0.5 || Math.abs(metrics.center.z) > 0.5)) {
    metrics.info.push(`Asset off-center`)
  }

  const maxDim = Math.max(metrics.dimensions.x, metrics.dimensions.y, metrics.dimensions.z)
  if (maxDim > 3.0) {
    metrics.warnings.push(`Large asset (${maxDim.toFixed(1)} units) - may need manual scaling`)
  } else if (maxDim < 0.1) {
    metrics.warnings.push(`Very small asset (${maxDim.toFixed(2)} units)`)
  }

  return metrics
}

/**
 * Analyze connectivity of an asset's parts
 * Checks if meshes are reasonably connected to their siblings/parents
 *
 * @returns {{ connected: boolean, disconnectedParts: string[] }}
 */
function analyzeConnectivity(asset) {
  const meshes = []
  const boxes = []

  // Collect all meshes with their bounding boxes
  asset.traverse(obj => {
    if (obj.isMesh) {
      const box = new THREE.Box3().setFromObject(obj)
      meshes.push({ name: obj.name || 'unnamed', box })
      boxes.push(box)
    }
  })

  if (meshes.length <= 1) {
    return { connected: true, disconnectedParts: [] }
  }

  // Compute overall asset bounding box
  const assetBox = new THREE.Box3().setFromObject(asset)
  const assetSize = assetBox.getSize(new THREE.Vector3())
  const maxDim = Math.max(assetSize.x, assetSize.y, assetSize.z)

  // Distance threshold: a part is "disconnected" if it's more than 50% of asset size
  // away from any other part
  const threshold = maxDim * 0.5

  const disconnectedParts = []

  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i]
    const center = mesh.box.getCenter(new THREE.Vector3())

    // Check if this mesh is close to at least one other mesh
    let isConnected = false

    for (let j = 0; j < boxes.length; j++) {
      if (i === j) continue

      // Distance from center to other box
      const otherCenter = boxes[j].getCenter(new THREE.Vector3())
      const distance = center.distanceTo(otherCenter)

      // Or check if boxes overlap/touch
      if (mesh.box.intersectsBox(boxes[j]) || distance < threshold) {
        isConnected = true
        break
      }
    }

    if (!isConnected) {
      disconnectedParts.push(mesh.name)
    }
  }

  return {
    connected: disconnectedParts.length === 0,
    disconnectedParts
  }
}

/**
 * Build category-specific hints to enhance the prompt.
 * Set USE_CATEGORY_HINTS to false to disable this feature.
 */
const USE_CATEGORY_HINTS = true

function getCategoryHints(category, plan) {
  if (!USE_CATEGORY_HINTS) return ''

  const hints = []

  // Map plan category to our palette categories
  const categoryMap = {
    'character': 'character',
    'creature': 'creature',
    'animal': 'creature',
    'vehicle': 'vehicle',
    'building': 'building',
    'prop': 'prop',
    'furniture': 'prop',
    'tool': 'prop',
    'nature': 'nature',
    'plant': 'nature',
    'wearable': 'prop'
  }

  const mappedCategory = categoryMap[category] || 'prop'
  const palette = CATEGORY_PALETTES[mappedCategory]
  const proportions = CATEGORY_PROPORTIONS[mappedCategory]

  if (palette) {
    // Pick the most relevant color groups for this category
    const colorGroups = Object.entries(palette).slice(0, 3)
    const colorHints = colorGroups.map(([name, colors]) => {
      const hexColors = colors.slice(0, 2).join(', ')
      return `${name}: ${hexColors}`
    }).join('; ')
    hints.push(`Suggested colors - ${colorHints}`)
  }

  if (proportions && proportions.notes) {
    hints.push(`Style note: ${proportions.notes}`)
  }

  return hints.length > 0 ? `\n\nCATEGORY HINTS (${mappedCategory}):\n${hints.join('\n')}` : ''
}

/**
 * Determine if an error is an API/network error (not the user's fault)
 */
function isApiError(error) {
  // H8 FIX: Protect against errors without message property
  const msg = (error?.message ?? String(error)).toLowerCase()
  return (
    msg.includes('api') ||
    msg.includes('key') ||
    msg.includes('network') ||
    msg.includes('fetch') ||
    msg.includes('cors') ||
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('429') ||  // Rate limiting
    msg.includes('500') ||
    msg.includes('503') ||
    msg.includes('timeout') ||
    msg.includes('quota') ||
    msg.includes('no response')
  )
}

/**
 * Generate prompt improvement suggestions based on error type
 * Only returns suggestions for prompt-related errors, not API errors
 */
function getPromptSuggestions(error, prompt) {
  // H8 FIX: Protect against errors without message property
  const errorMsg = (error?.message ?? String(error)).toLowerCase()

  // Don't blame the prompt for API errors
  if (isApiError(error)) {
    return {
      isApiError: true,
      suggestions: [],
      friendlyMessage: getApiErrorMessage(error)
    }
  }

  const suggestions = []

  if (errorMsg.includes('truncated') || (errorMsg.includes('missing') && errorMsg.includes('brace'))) {
    suggestions.push('Try a simpler prompt with fewer details')
    suggestions.push('Avoid requesting multiple objects or complex scenes')
  }

  if (errorMsg.includes('createasset')) {
    suggestions.push('Try rephrasing the prompt to focus on a single object')
  }

  // Check for problematic prompt patterns
  const lower = prompt.toLowerCase()

  if (lower.includes(' and ') && lower.split(' and ').length > 2) {
    suggestions.push('Prompt mentions multiple items - focus on just one')
  }

  if (/\b(scene|environment|room|level|world)\b/.test(lower)) {
    suggestions.push('Scene/environment detected - try describing a single object instead')
  }

  if (/\b(tiny|detailed|intricate|complex|realistic)\b/.test(lower)) {
    suggestions.push('Avoid words like "detailed" or "intricate" - keep it simple and chunky')
  }

  if (/\b(text|logo|writing|letters|words)\b/.test(lower)) {
    suggestions.push('Text/logos are not supported - describe shapes instead')
  }

  return {
    isApiError: false,
    suggestions,
    friendlyMessage: null
  }
}

/**
 * Get a friendly message for API errors (not the user's fault)
 */
function getApiErrorMessage(error) {
  const msg = error.message.toLowerCase()

  if (msg.includes('key') || msg.includes('401') || msg.includes('403')) {
    return 'API key issue - check that your key is valid'
  }

  if (msg.includes('429') || msg.includes('quota') || msg.includes('rate')) {
    return 'API rate limit reached - wait a moment and try again'
  }

  if (msg.includes('500') || msg.includes('503')) {
    return 'AI service is temporarily unavailable - try again in a few minutes'
  }

  if (msg.includes('network') || msg.includes('fetch') || msg.includes('cors')) {
    return 'Network error - check your internet connection'
  }

  if (msg.includes('timeout') || msg.includes('no response')) {
    return 'Request timed out - the AI service may be busy, try again'
  }

  return 'Service error - this is not your fault, please try again'
}

/**
 * Extract JavaScript code from a response that may have markdown wrapping
 */
function extractCode(response) {
  let code = response.trim()

  // Remove markdown code blocks
  if (code.startsWith('```javascript')) {
    code = code.slice(13)
  } else if (code.startsWith('```js')) {
    code = code.slice(5)
  } else if (code.startsWith('```')) {
    code = code.slice(3)
  }
  if (code.endsWith('```')) {
    code = code.slice(0, -3)
  }
  code = code.trim()

  // Sanitize CJK punctuation that can leak through
  code = code
    .replace(/\u3002/g, '.')   // 。 -> .
    .replace(/\uff0c/g, ',')   // ， -> ,
    .replace(/\uff1a/g, ':')   // ： -> :
    .replace(/\uff1b/g, ';')   // ； -> ;
    .replace(/\uff01/g, '!')   // ！ -> !
    .replace(/\uff1f/g, '?')   // ？ -> ?
    .replace(/[\u2018\u2019]/g, "'")  // '' -> '
    .replace(/[\u201c\u201d]/g, '"')  // "" -> "
    .replace(/\uff08/g, '(')   // （ -> (
    .replace(/\uff09/g, ')')   // ） -> )

  // Strip ALL non-ASCII (Chinese words like 展现 appearing as identifiers)
  code = code.replace(/[^\x00-\x7F]+/g, '')

  // Strip import statements (THREE is passed as parameter, not imported)
  code = code.replace(/^import\s+.*?from\s+['"][^'"]+['"];?\s*\n?/gm, '')
  code = code.replace(/^import\s+['"][^'"]+['"];?\s*\n?/gm, '')

  // If multiple createAsset functions, extract just the first one
  const funcMatches = [...code.matchAll(/export\s+function\s+createAsset\s*\(\s*THREE\s*\)\s*\{/g)]
  if (funcMatches.length > 1) {
    console.warn(`Found ${funcMatches.length} createAsset declarations, extracting first one`)
    const firstStart = funcMatches[0].index
    const secondStart = funcMatches[1].index

    // Find closing brace by counting
    let braceCount = 0
    let inFunction = false
    let funcEnd = secondStart
    for (let i = firstStart; i < secondStart; i++) {
      if (code[i] === '{') {
        braceCount++
        inFunction = true
      } else if (code[i] === '}') {
        braceCount--
        if (inFunction && braceCount === 0) {
          funcEnd = i + 1
          break
        }
      }
    }
    code = code.slice(firstStart, funcEnd)
  }

  // Truncation/syntax detection with string-aware counting
  const balanceResult = validateDelimiterBalance(code)
  if (!balanceResult.valid) {
    console.warn('[AssetGenerator] Code syntax issue:', balanceResult.errors)
  }

  return code
}

/**
 * Validate generated code before execution
 */
function validateCode(code) {
  if (!code.includes('createAsset')) {
    throw new Error('The AI could not create a valid 3D model. Try describing a simpler, single object.')
  }

  const createAssetMatches = code.match(/function\s+createAsset/g)
  if (createAssetMatches && createAssetMatches.length > 1) {
    throw new Error('The AI generated a confused response. Please try again with a clearer description.')
  }

  // Check for non-ASCII that suggests non-code output
  const nonAsciiMatch = code.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g)
  if (nonAsciiMatch) {
    throw new Error('The AI response was incomplete. Please try again.')
  }

  // Check delimiter balance (string-aware)
  assertDelimiterBalance(code)

  return true
}

/**
 * Load generated code as a module using Blob URL
 */
async function loadAssetModule(code) {
  const blob = new Blob([code], { type: 'application/javascript' })
  const url = URL.createObjectURL(blob)
  try {
    const module = await import(/* @vite-ignore */ url)
    return module
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Parse JSON from a response that may have markdown wrapping
 * Handles JavaScript-style hex literals (0x...) that Gemini sometimes outputs
 */
function parseJSON(text) {
  let jsonText = text.trim()
  if (jsonText.startsWith('```json')) {
    jsonText = jsonText.slice(7)
  } else if (jsonText.startsWith('```')) {
    jsonText = jsonText.slice(3)
  }
  if (jsonText.endsWith('```')) {
    jsonText = jsonText.slice(0, -3)
  }
  jsonText = jsonText.trim()

  // Convert JavaScript hex literals to decimal (0x... -> decimal)
  // Only convert standalone hex values, not inside strings
  jsonText = jsonText.replace(/:\s*0x([0-9a-fA-F]+)/g, (match, hex) => {
    return ': ' + parseInt(hex, 16)
  })

  try {
    return JSON.parse(jsonText)
  } catch (e) {
    console.warn('Failed to parse plan JSON:', jsonText.slice(0, 200), e.message)
    return { raw: text }
  }
}

/**
 * Post-process v3 schema to fix technical bugs while preserving creativity
 * Fixes: Technical bugs (references, ranges, structure)
 * Preserves: Aesthetic choices (colors, proportions, style)
 *
 * @returns {{ schema: Object, adjustments: string[] }}
 */
function postProcessSchema(schema) {
  if (!schema || schema.v !== 3) return { schema, adjustments: [] }

  const fixed = JSON.parse(JSON.stringify(schema)) // Deep clone
  const adjustments = [] // Track user-visible adjustments

  // 1. FIX: Invalid material references - ensure materials array exists
  const matCount = (fixed.m || []).length
  if (matCount === 0) {
    // Add default material if missing
    console.warn('[postProcess] No materials found, adding default')
    fixed.m = [{ n: 'default', c: 0x808080, r: 0.7, met: 0, flat: true }]
  }

  // Clamp material indices on all parts
  for (const part of (fixed.p || [])) {
    if (part.mat >= (fixed.m || []).length) {
      console.warn(`[postProcess] Part '${part.n}' has invalid material index ${part.mat}, clamping to 0`)
      part.mat = 0
    }
  }

  // 2. FIX: Invalid parent references
  const partNames = new Set((fixed.p || []).map(p => p.n))
  for (const part of (fixed.p || [])) {
    if (part.par && !partNames.has(part.par)) {
      console.warn(`[postProcess] Invalid parent '${part.par}' for part '${part.n}', setting to null`)
      part.par = null
    }
  }

  // 3. FIX: Quadruped orientation bug (body rotated on X/Z makes it lie sideways)
  // Detect quadrupeds: category=creature/animal AND has 4+ legs
  if (fixed.cat === 'creature' || fixed.cat === 'animal') {
    const bodyPart = (fixed.p || []).find(p => p.n === 'body' && !p.par)
    const legParts = (fixed.p || []).filter(p =>
      p.n.includes('leg') && p.i && p.i.length >= 4
    )

    if (bodyPart && legParts.length > 0) {
      // This is likely a quadruped - fix body rotation if it's rotated on X or Z
      for (const inst of (bodyPart.i || [])) {
        if (inst.r) {
          const [rx, ry, rz] = inst.r
          if (Math.abs(rx) > 0.5 || Math.abs(rz) > 0.5) {
            console.warn(`[postProcess] Quadruped body rotated [${rx}, ${ry}, ${rz}], fixing to [0, ${ry}, 0]`)
            inst.r = [0, ry, 0]
          }
        }
      }

      // Fix scale if elongated on X instead of Z (common LLM error)
      for (const inst of (bodyPart.i || [])) {
        if (inst.s) {
          const [sx, sy, sz] = inst.s
          if (sx > 1.2 && sz < 1.1 && sx > sz) {
            // Body is elongated horizontally (X) when it should be front-to-back (Z)
            console.warn(`[postProcess] Swapping body scale [${sx}, ${sy}, ${sz}] to [${sz}, ${sy}, ${sx}]`)
            inst.s = [sz, sy, sx]
          }
        }
      }
    }
  }

  // 4. FIX: Coordinates wildly out of range (normalize to [-2, 2] pre-normalization)
  for (const part of (fixed.p || [])) {
    for (const inst of (part.i || [])) {
      if (inst.p) {
        const [x, y, z] = inst.p
        const maxCoord = Math.max(Math.abs(x), Math.abs(y), Math.abs(z))
        if (maxCoord > 5) {
          const scale = 1.5 / maxCoord
          console.warn(`[postProcess] Part '${part.n}' at [${x}, ${y}, ${z}] out of range, scaling by ${scale.toFixed(2)}`)
          inst.p = [x * scale, y * scale, z * scale]
        }
      }
    }
  }

  // 5. FIX: Dark/low-contrast colors (per-material additive brightening)
  // Check EACH material individually - don't let one light material hide dark ones
  const materials = (fixed.m || [])
  if (materials.length > 0) {
    // First pass: Calculate luminances and fix very dark materials with ADDITIVE brightening
    const MIN_LUMINANCE = 0.15  // Below this, material is too dark to see
    const ADDITIVE_BOOST = 80   // Add this to RGB to make visible (not multiply!)

    for (let i = 0; i < materials.length; i++) {
      const mat = materials[i]
      const r = (mat.c >> 16) & 0xFF
      const g = (mat.c >> 8) & 0xFF
      const b = mat.c & 0xFF
      const lum = 0.2126 * (r / 255) + 0.7152 * (g / 255) + 0.0722 * (b / 255)

      // ADDITIVE brightening for very dark colors (multiplicative fails for black!)
      if (lum < MIN_LUMINANCE) {
        const newR = Math.min(255, r + ADDITIVE_BOOST)
        const newG = Math.min(255, g + ADDITIVE_BOOST)
        const newB = Math.min(255, b + ADDITIVE_BOOST)
        mat.c = (newR << 16) | (newG << 8) | newB
        adjustments.push('Dark colors brightened for visibility')
        console.warn(`[postProcess] Material ${i} too dark (lum ${lum.toFixed(2)}), adding +${ADDITIVE_BOOST} -> 0x${mat.c.toString(16).padStart(6, '0')}`)
      }
    }

    // Second pass: Enforce material luminance spread (at least 0.3 difference)
    // This ensures contrast between materials even if none are "pure black"
    if (materials.length > 1) {
      const lums = materials.map(mat => {
        const r = ((mat.c >> 16) & 0xFF) / 255
        const g = ((mat.c >> 8) & 0xFF) / 255
        const b = (mat.c & 0xFF) / 255
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      })

      const minLum = Math.min(...lums)
      const maxLum = Math.max(...lums)
      const spread = maxLum - minLum

      if (spread < 0.3) {
        adjustments.push('Color contrast increased for visibility')
        console.warn(`[postProcess] Low material contrast (spread ${spread.toFixed(2)}), brightening darkest material`)
        // Find darkest material and brighten it significantly
        const darkestIdx = lums.indexOf(minLum)
        const mat = materials[darkestIdx]
        const r = (mat.c >> 16) & 0xFF
        const g = (mat.c >> 8) & 0xFF
        const b = mat.c & 0xFF

        // Brighten to at least 0.5 luminance (use additive if near zero)
        if (minLum < 0.05) {
          // Very dark - use additive
          const boost = 128
          mat.c = (
            (Math.min(255, r + boost) << 16) |
            (Math.min(255, g + boost) << 8) |
            Math.min(255, b + boost)
          )
        } else {
          // Has some color - use scale
          // Use 0.05 floor to prevent overflow with very dark colors
          const targetLum = 0.5
          const scale = targetLum / Math.max(0.05, minLum)
          mat.c = (
            (Math.min(255, Math.floor(r * scale)) << 16) |
            (Math.min(255, Math.floor(g * scale)) << 8) |
            Math.min(255, Math.floor(b * scale))
          )
        }
        console.warn(`[postProcess] Brightened material ${darkestIdx} -> 0x${mat.c.toString(16).padStart(6, '0')}`)
      }
    }

    // Single material check: ensure it's visible
    if (materials.length === 1) {
      const r = (materials[0].c >> 16) & 0xFF
      const g = (materials[0].c >> 8) & 0xFF
      const b = materials[0].c & 0xFF
      const lum = 0.2126 * (r / 255) + 0.7152 * (g / 255) + 0.0722 * (b / 255)

      if (lum < 0.25) {
        console.warn('[postProcess] Single material too dark, setting minimum 0x404040')
        const newR = Math.max(64, r)
        const newG = Math.max(64, g)
        const newB = Math.max(64, b)
        materials[0].c = (newR << 16) | (newG << 8) | newB
      }
    }
  }

  // 6. PRESERVE: Proportions, geometry choices
  // 7. PRESERVE: Part names, animation style, attach points

  // Deduplicate adjustments
  const uniqueAdjustments = [...new Set(adjustments)]

  return { schema: fixed, adjustments: uniqueAdjustments }
}

export class AssetGenerator {
  constructor() {
    this.onProgress = null
    this.isCancelled = false
  }

  /**
   * Set progress callback
   */
  setProgressCallback(callback) {
    this.onProgress = callback
  }

  /**
   * Cancel the current generation
   */
  cancel() {
    this.isCancelled = true
    geminiClient.cancel()
  }

  /**
   * Reset cancellation state before starting new generation
   */
  resetCancellation() {
    this.isCancelled = false
  }

  /**
   * Report progress
   */
  progress(message, phase = 'info') {
    console.log(`[AssetGenerator] ${message}`)
    this.onProgress?.(message, phase)
  }

  /**
   * Plan the asset decomposition
   */
  async planAsset(prompt) {
    this.progress('Planning asset structure...', 'planning')

    const fullPrompt = `Plan the 3D asset: ${prompt}`
    const result = await geminiClient.generateWithMetadata(
      fullPrompt,
      PLANNING_SYSTEM_PROMPT_V4,
      { temperature: 0.5, maxOutputTokens: 8192 }
    )

    // Record token usage
    recordUsage('plan', fullPrompt, result.usage)

    const plan = parseJSON(result.text)

    // DEBUG: Log raw schema from LLM
    console.log('[AssetGenerator] Raw LLM schema:', JSON.stringify(plan, null, 2))

    if (plan.parts) {
      this.progress(`Plan: ${plan.parts.length} parts - ${plan.parts.join(', ')}`, 'planning')
    }

    return plan
  }

  /**
   * Generate asset code with an optional plan
   */
  async generateCode(prompt, plan = null) {
    let enhancedPrompt = `Create a 3D asset: ${prompt}`

    // Pass v3 plan directly as JSON - V4 prompts interpret this schema
    if (plan && plan.v === 3) {
      enhancedPrompt += `\n\nPLAN JSON:\n${JSON.stringify(plan)}`
      // Add category-specific hints based on plan category
      if (plan.cat) {
        enhancedPrompt += getCategoryHints(plan.cat, plan)
      }
    } else if (plan && !plan.raw) {
      // Legacy plan format fallback
      enhancedPrompt += `\n\nDECOMPOSITION PLAN:\n`
      if (plan.parts) {
        enhancedPrompt += `Parts: ${plan.parts.join(', ')}\n`
      }
      if (plan.geometry) {
        enhancedPrompt += `Geometry hints: ${Object.entries(plan.geometry).map(([k, v]) => `${k}=${v}`).join(', ')}\n`
      }
      if (plan.connections) {
        enhancedPrompt += `Connections: ${plan.connections.join('; ')}\n`
      }
      if (plan.style) {
        enhancedPrompt += `Style: ${plan.style}`
      }
    } else if (plan?.raw) {
      // Raw text fallback - try to pass as-is for AI to interpret
      enhancedPrompt += `\n\nPLAN:\n${plan.raw}`
    }

    this.progress('Generating Three.js code...', 'generating')

    const result = await geminiClient.generateWithMetadata(
      enhancedPrompt,
      ASSET_SYSTEM_PROMPT_V4_BRIGHT,
      { temperature: 0.3, maxOutputTokens: 8192 }
    )

    // Record token usage
    recordUsage('generate', enhancedPrompt, result.usage)

    return extractCode(result.text)
  }

  /**
   * Generate an asset from a prompt
   * Returns the THREE.Group and the generated code
   *
   * Pipeline:
   * 1. Plan (Gemini → v3 schema)
   * 2. Compile (deterministic, no LLM) - if valid schema
   * 3. Fallback to LLM code gen if compile fails
   * 4. Load & validate
   * 5. Quality check with connectivity validation
   */
  async generate(prompt, options = {}) {
    const { maxAttempts = 3, usePlanning = true, useCompiler = true } = options

    // Reset cancellation state
    this.resetCancellation()

    const startTime = performance.now()

    // Step 1: Plan (get v3 schema)
    let plan = null
    if (usePlanning) {
      try {
        plan = await this.planAsset(prompt)
        if (this.isCancelled) {
          throw new Error('Generation cancelled')
        }
      } catch (err) {
        if (this.isCancelled || err.name === 'AbortError') {
          throw new Error('Generation cancelled')
        }
        this.progress(`Planning failed: ${err.message}, continuing without plan`, 'warning')
      }
    }

    // Step 1.5: Post-process schema to fix common LLM errors
    let postProcessAdjustments = []

    if (plan && plan.v === 3) {
      const postResult = postProcessSchema(plan)
      plan = postResult.schema
      postProcessAdjustments = postResult.adjustments

      // DEBUG: Log post-processing results
      if (postProcessAdjustments.length > 0) {
        console.log('[AssetGenerator] Post-process adjustments:', postProcessAdjustments)
        console.log('[AssetGenerator] Schema after post-processing:', JSON.stringify(plan, null, 2))
      }
    }

    // Step 2: Try deterministic compilation first (if we have a valid v3 schema)
    let code = null
    let module = null
    let compiledSuccessfully = false

    // Validate schema before attempting compilation
    if (useCompiler && plan && plan.v === 3) {
      let validation = SchemaCompiler.validate(plan)

      // If validation failed due to color issues, retry planning with stronger color guidance
      if (!validation.valid) {
        const hasColorError = validation.errors.some(e =>
          e.includes('luminance') || e.includes('contrast') || e.includes('too dark')
        )

        if (hasColorError) {
          this.progress('Schema failed color validation, retrying with color guidance...', 'warning')
          console.warn('[AssetGenerator] Color validation failed:', validation.errors)

          // Retry planning with explicit color requirements
          const colorGuidance = `

CRITICAL COLOR REQUIREMENTS (previous attempt rejected for dark colors):
- NO pure black (0x000000) - use dark gray (0x2F2F2F) minimum
- REQUIRE luminance spread >= 0.3 between materials
- For dark themes: Use dark purple (0x4B0082), dark blue (0x191970), or dark gray (0x2F4F4F) - NOT black
- Example dark wizard: [0x4B0082, 0x9370DB, 0xFFD700] (purple robes, not black!)
- Example black cat: [0x2F2F2F, 0x808080, 0xFFFF00] (dark gray, not pure black!)`

          try {
            plan = await this.planAsset(prompt + colorGuidance)
            if (plan && plan.v === 3) {
              const postResult = postProcessSchema(plan)
              plan = postResult.schema
              postProcessAdjustments = postResult.adjustments
              validation = SchemaCompiler.validate(plan)
            }
          } catch (err) {
            console.warn('[AssetGenerator] Color-guided retry failed:', err.message)
          }
        }
      }

      if (!validation.valid) {
        this.progress(`Schema validation failed: ${validation.errors[0]}, falling back to LLM`, 'warning')
        console.warn('[AssetGenerator] Schema validation errors:', validation.errors)
        plan = null // Force LLM fallback
      } else if (validation.warnings.length > 0) {
        console.log('[AssetGenerator] Schema warnings:', validation.warnings)
      }
    }

    if (useCompiler && plan && plan.v === 3) {
      try {
        this.progress('Compiling schema...', 'compiling')
        const compileResult = SchemaCompiler.compile(plan, { autoSnap: true })
        code = compileResult.code

        // Log any compiler warnings
        for (const warning of compileResult.warnings) {
          console.log(`[AssetGenerator] Compiler warning: ${warning}`)
        }

        this.progress('Loading compiled module...', 'loading')
        module = await loadAssetModule(code)
        compiledSuccessfully = true

        this.progress('Compiled successfully', 'success')
      } catch (err) {
        this.progress(`Compilation failed: ${err.message}, falling back to LLM`, 'warning')
        console.warn('[AssetGenerator] Compiler error:', err)
        code = null
        module = null
      }
    }

    // Step 3: Fallback to LLM code generation if compiler failed or wasn't used
    if (!module) {
      let lastError = null

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          if (attempt > 1) {
            this.progress(`Retrying generation (attempt ${attempt}/${maxAttempts})...`, 'generating')
          }

          code = await this.generateCode(prompt, plan)
          this.progress('Validating code...', 'validating')

          validateCode(code)

          // Security check: validate code doesn't contain dangerous patterns
          this.progress('Security validation...', 'validating')
          assertCodeSafety(code)

          this.progress('Loading module...', 'loading')
          module = await loadAssetModule(code)
          break
        } catch (err) {
          lastError = err
          const isRetryable =
            err.message.includes('Unexpected') ||
            err.message.includes('invalid') ||
            err.message.includes('SyntaxError') ||
            err.message.includes('Retry') ||
            err.message.includes('Module does not export') ||
            err.message.includes('missing createAsset') ||
            err.message.includes('truncated')

          if (isRetryable && attempt < maxAttempts) {
            this.progress(`Error: ${err.message}. Retrying...`, 'error')
            continue
          }

          // Add prompt suggestions or API error info to the error
          const suggestionResult = getPromptSuggestions(err, prompt)
          if (suggestionResult.isApiError) {
            err.isApiError = true
            err.friendlyMessage = suggestionResult.friendlyMessage
            console.log('[AssetGenerator] API error:', suggestionResult.friendlyMessage)
          } else if (suggestionResult.suggestions.length > 0) {
            err.promptSuggestions = suggestionResult.suggestions
            console.log('[AssetGenerator] Prompt suggestions:', suggestionResult.suggestions)
          }

          throw err
        }
      }

      if (!module) {
        const suggestionResult = getPromptSuggestions(lastError || new Error('Unknown'), prompt)
        if (lastError) {
          if (suggestionResult.isApiError) {
            lastError.isApiError = true
            lastError.friendlyMessage = suggestionResult.friendlyMessage
          } else {
            lastError.promptSuggestions = suggestionResult.suggestions
          }
        }
        throw lastError || new Error('Failed to generate valid code')
      }
    }

    if (typeof module.createAsset !== 'function') {
      throw new Error('Module does not export createAsset function')
    }

    // Step 4: Create the asset
    this.progress('Creating 3D asset...', 'creating')
    const asset = module.createAsset(THREE)

    if (!(asset instanceof THREE.Object3D)) {
      throw new Error('createAsset did not return a THREE.Object3D')
    }

    // Step 5: Quality analysis with connectivity check
    const quality = analyzeAssetQuality(asset)

    // Add connectivity analysis
    const connectivity = analyzeConnectivity(asset)
    quality.connected = connectivity.connected
    quality.disconnectedParts = connectivity.disconnectedParts

    // Log quality metrics
    console.log('[AssetGenerator] Quality metrics:', {
      meshes: quality.meshCount,
      materials: quality.materialCount,
      colors: quality.uniqueColors.size,
      dimensions: `${quality.dimensions.x.toFixed(2)} x ${quality.dimensions.y.toFixed(2)} x ${quality.dimensions.z.toFixed(2)}`,
      grounded: quality.grounded,
      centered: quality.centered,
      connected: quality.connected,
      compiledSuccessfully
    })

    // Only block on true errors (empty assets)
    if (quality.errors.length > 0) {
      throw new Error(quality.errors[0])
    }

    // Report warnings (non-blocking)
    for (const warning of quality.warnings) {
      this.progress(`Note: ${warning}`, 'warning')
    }

    // Log connectivity issues as warnings (not blocking)
    if (!quality.connected && quality.disconnectedParts.length > 0) {
      console.warn(`[AssetGenerator] Potentially disconnected parts: ${quality.disconnectedParts.join(', ')}`)
    }

    // Log info for debugging only
    for (const info of quality.info) {
      console.log(`[AssetGenerator] Info: ${info}`)
    }

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2)
    this.progress(`Asset created in ${elapsed}s`, 'success')

    return { asset, code, quality, compiledSuccessfully, postProcessAdjustments, v3Schema: plan }
  }

  /**
   * Derive a name from a prompt
   */
  deriveName(prompt) {
    // Simple name derivation: capitalize first letter of each word, limit length
    return prompt
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
      .slice(0, 50)
  }

  /**
   * Guess category from prompt
   */
  guessCategory(prompt) {
    const lower = prompt.toLowerCase()

    // Character keywords
    if (/\b(character|person|knight|wizard|warrior|fighter|villager|npc|human|man|woman|girl|boy|anime)\b/.test(lower)) {
      return 'characters'
    }

    // Creature keywords
    if (/\b(creature|monster|dragon|spider|octopus|beast|animal|snake|wolf|bear|fish|bird)\b/.test(lower)) {
      return 'creatures'
    }

    // Building keywords
    if (/\b(building|house|tower|castle|cottage|church|barn|shop|temple|fortress|wall|gate)\b/.test(lower)) {
      return 'buildings'
    }

    // Vehicle keywords
    if (/\b(car|vehicle|truck|tank|boat|ship|plane|aircraft|helicopter|train|bike)\b/.test(lower)) {
      return 'vehicles'
    }

    // Nature keywords
    if (/\b(tree|rock|stone|plant|flower|bush|grass|mountain|crystal|mushroom|cactus)\b/.test(lower)) {
      return 'nature'
    }

    // Default to props
    return 'props'
  }
}

// Singleton instance
export const assetGenerator = new AssetGenerator()
