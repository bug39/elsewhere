/**
 * Size Invariants Module - Enforces correct asset sizing for scene generation
 *
 * This module provides a deterministic system that converts AI-specified real-world
 * sizes (in meters) to internal scale values, while enforcing hard limits that make
 * impossible sizes (like 450m trees) mathematically unachievable.
 *
 * Key insight: AI specifies "this tree should be 12 meters tall" (intuitive),
 * system computes scale = 12m / 2m baseline = 6 (deterministic).
 *
 * UNIVERSAL BASELINE: All assets are normalized to 2 units at generation time,
 * so scale is now a simple multiplier: realWorldSize / 2 = scale.
 */

/**
 * Universal baseline for all assets.
 * All assets are normalized to this size (max dimension) at generation time.
 * This replaces category-specific baselines for consistent behavior.
 */
export const UNIVERSAL_BASELINE = 2.0

/**
 * Game world scale factor - multiplies AI's realistic sizes for game visibility.
 *
 * AI thinks in real-world sizes (e.g., "5m tree"), but game worlds need exaggerated
 * scales for visual impact. Without this, scene-generated assets appear ~4x smaller
 * than manually-placed assets (which default to scale 10).
 *
 * Factor of 4 maps:
 * - 5m tree → scale 10 (matches manual placement)
 * - 2m human → scale 4 (visible but appropriately small)
 * - 15m house → scale 30 (impressive landmark)
 *
 * This preserves the AI's size hierarchy (relative sizes unchanged) while shifting
 * everything to "game scale" visibility.
 */
export const GAME_SCALE_FACTOR = 8  // Doubled from 4 to improve visibility

/**
 * Size invariant constants
 * These hard limits are mathematically enforced - no code path can bypass them
 */
export const SIZE_INVARIANTS = {
  // Absolute limits (nothing outside this range)
  MAX_ASSET_SIZE: 60,    // Nothing larger than 60m (allows dramatic mountains)
  MIN_ASSET_SIZE: 0.1,   // Nothing smaller than 0.1m

  // Scene-wide proportion check
  MAX_SIZE_RATIO: 100,   // Largest asset ≤ 100× smallest

  // Default sizes when AI provides invalid/missing values (in meters)
  // These should be on the LARGER end to ensure visibility in 60×60m scenes
  DEFAULT_SIZES: {
    props: 1.5,       // Visible props like barrels, crates
    characters: 1.8,  // Human-scale
    creatures: 2.0,   // Visible animals
    nature: 12.0,     // Visible trees (not saplings)
    buildings: 12.0,  // Clearly visible houses/structures
    vehicles: 4.0     // Visible carts, boats
  },

  // Maximum allowed size per category (prevents giant flowers, etc.)
  MAX_CATEGORY_SIZES: {
    props: 5,         // Props shouldn't exceed 5m
    characters: 4,    // Humanoids up to 4m (giant)
    creatures: 10,    // Creatures up to 10m (dragon)
    nature: 60,       // Trees 8-20m, mountains/terrain 30-60m
    buildings: 50,    // Buildings up to 50m (tower)
    vehicles: 20      // Vehicles up to 20m (ship)
  }
}

/**
 * Default maximum scale value for categories not explicitly listed.
 */
export const MAX_SCALE = 80

/**
 * Category-specific maximum scale values.
 *
 * Purpose: Preserve size hierarchy across different asset types.
 * Mountains/terrain SHOULD dominate as backdrops; props should not.
 *
 * Breakpoint calculation: maxScale = (maxRealWorldSize / 2) × GAME_SCALE_FACTOR
 *
 * | Category   | Max Real Size | Max Scale | Visual Role |
 * |------------|---------------|-----------|-------------|
 * | props      | 5m            | 40        | Small details |
 * | characters | 4m            | 32        | Human-scale |
 * | creatures  | 10m           | 80        | Large animals |
 * | vehicles   | 20m           | 80        | Cars, boats |
 * | buildings  | 50m           | 200       | Main structures, tall landmarks |
 * | nature     | 60m           | 240       | Trees, mountains (backdrop) |
 */
export const MAX_SCALE_BY_CATEGORY = {
  props: 40,        // 5m max → small scene details
  characters: 32,   // 4m max → human scale
  creatures: 80,    // 10m max → large animals
  vehicles: 80,     // 20m max → cars, boats
  buildings: 200,   // 50m max → main structures, tall landmarks (e.g. rockets, towers)
  nature: 240       // 60m max → trees AND mountains as dramatic backdrop
}

// Log loaded scale limits on module init (helps diagnose stale-cache issues)
console.log(`[SizeInvariants] Module loaded — MAX_SCALE_BY_CATEGORY: buildings=${MAX_SCALE_BY_CATEGORY.buildings}, nature=${MAX_SCALE_BY_CATEGORY.nature}, default=${MAX_SCALE}`)

/**
 * Get the maximum scale for a category
 * @param {string} category
 * @returns {number}
 */
export function getMaxScaleForCategory(category) {
  return MAX_SCALE_BY_CATEGORY[category] || MAX_SCALE
}

/**
 * Compute scale multiplier from real-world size
 *
 * With universal normalization, all assets are normalized to 2 units.
 * Scale formula: (realWorldSize / UNIVERSAL_BASELINE) × GAME_SCALE_FACTOR
 *
 * The GAME_SCALE_FACTOR (4x) converts AI's realistic sizes to game-visible scales.
 *
 * @param {number} realWorldSize - Desired size in meters (max dimension)
 * @param {string} category - Asset category (for invariant enforcement)
 * @returns {number} Scale multiplier to apply to normalized asset
 *
 * @example
 * computeScaleFromSize(5, 'nature')     // → 10.0 (5m / 2m × 4)
 * computeScaleFromSize(2, 'characters') // → 4.0  (2m / 2m × 4)
 * computeScaleFromSize(15, 'buildings') // → 30.0 (15m / 2m × 4)
 */
export function computeScaleFromSize(realWorldSize, category) {
  // Enforce invariants on input (category still matters for max size limits)
  const { size: clampedSize } = enforceInvariants(realWorldSize, category)

  // Compute scale as ratio to universal baseline, then apply game scale factor
  const scale = (clampedSize / UNIVERSAL_BASELINE) * GAME_SCALE_FACTOR

  // Apply category-specific scale cap to preserve size hierarchy
  // Mountains (nature) can be much larger than buildings, which can be larger than props
  const maxScale = getMaxScaleForCategory(category)
  if (scale > maxScale) {
    console.warn(`[SizeInvariants] Clamping scale ${scale.toFixed(1)} → maxScale=${maxScale} for ${category} (${realWorldSize}m, categoryLimit=${MAX_SCALE_BY_CATEGORY[category] ?? 'default'})`)
    return maxScale
  }

  return scale
}

/**
 * Enforce size invariants on a real-world size value
 *
 * @param {number} realWorldSize - Proposed size in meters
 * @param {string} category - Asset category
 * @returns {{ size: number, clamped: boolean, reason: string|null }}
 */
export function enforceInvariants(realWorldSize, category) {
  const result = {
    size: realWorldSize,
    clamped: false,
    reason: null
  }

  // Handle invalid input
  if (typeof realWorldSize !== 'number' || !isFinite(realWorldSize) || realWorldSize <= 0) {
    result.size = SIZE_INVARIANTS.DEFAULT_SIZES[category] || SIZE_INVARIANTS.DEFAULT_SIZES.props
    result.clamped = true
    result.reason = `Invalid size (${realWorldSize}), using default ${result.size}m for ${category}`
    return result
  }

  let size = realWorldSize

  // Enforce absolute minimum
  if (size < SIZE_INVARIANTS.MIN_ASSET_SIZE) {
    size = SIZE_INVARIANTS.MIN_ASSET_SIZE
    result.clamped = true
    result.reason = `Size ${realWorldSize}m below minimum, clamped to ${size}m`
  }

  // Enforce absolute maximum
  if (size > SIZE_INVARIANTS.MAX_ASSET_SIZE) {
    size = SIZE_INVARIANTS.MAX_ASSET_SIZE
    result.clamped = true
    result.reason = `Size ${realWorldSize}m above maximum, clamped to ${size}m`
  }

  // Enforce category-specific maximum
  const categoryMax = SIZE_INVARIANTS.MAX_CATEGORY_SIZES[category]
  if (categoryMax && size > categoryMax) {
    size = categoryMax
    result.clamped = true
    result.reason = `Size ${realWorldSize}m exceeds ${category} max, clamped to ${size}m`
  }

  result.size = size
  return result
}

/**
 * Validate scene-wide proportions
 *
 * Flags issues when the largest asset is more than MAX_SIZE_RATIO times
 * larger than the smallest, which usually indicates a sizing error.
 *
 * @param {Array<{size: number, description?: string}>} assets - Assets with sizes
 * @returns {{ valid: boolean, ratio: number, warning: string|null }}
 */
export function validateProportions(assets) {
  if (!assets || assets.length < 2) {
    return { valid: true, ratio: 1, warning: null }
  }

  const sizes = assets.map(a => a.size || a.realWorldSize || 1).filter(s => s > 0)

  if (sizes.length < 2) {
    return { valid: true, ratio: 1, warning: null }
  }

  const minSize = Math.min(...sizes)
  const maxSize = Math.max(...sizes)
  const ratio = maxSize / minSize

  if (ratio > SIZE_INVARIANTS.MAX_SIZE_RATIO) {
    return {
      valid: false,
      ratio,
      warning: `Size ratio ${ratio.toFixed(1)}× exceeds limit of ${SIZE_INVARIANTS.MAX_SIZE_RATIO}× ` +
               `(smallest: ${minSize}m, largest: ${maxSize}m)`
    }
  }

  return { valid: true, ratio, warning: null }
}

/**
 * Process an entire scene plan through the invariant system
 *
 * Converts all realWorldSize values to scale, enforcing limits.
 * Also handles backward compatibility with legacy 'scale' field.
 *
 * @param {Object} plan - Scene plan from AI
 * @returns {Object} Processed plan with scales computed and warnings attached
 */
export function processScenePlan(plan) {
  if (!plan) return plan

  const warnings = []

  // Process assets array
  if (plan.assets && Array.isArray(plan.assets)) {
    for (const asset of plan.assets) {
      const result = processAssetSpec(asset)
      if (result.warning) {
        warnings.push(result.warning)
      }
    }
  }

  // Process NPCs array
  if (plan.npcs && Array.isArray(plan.npcs)) {
    for (const npc of plan.npcs) {
      const result = processAssetSpec(npc)
      if (result.warning) {
        warnings.push(result.warning)
      }
    }
  }

  // Validate scene-wide proportions
  const allAssets = [...(plan.assets || []), ...(plan.npcs || [])]
  const proportionCheck = validateProportions(
    allAssets.map(a => ({
      size: a.realWorldSize,
      description: a.prompt
    }))
  )

  if (!proportionCheck.valid) {
    warnings.push(proportionCheck.warning)
  }

  // Attach warnings to plan for debugging
  if (warnings.length > 0) {
    plan._sizeWarnings = warnings
  }

  return plan
}

/**
 * Process a single asset specification
 *
 * Handles three cases:
 * 1. realWorldSize provided → compute scale
 * 2. Only scale provided (legacy) → convert to realWorldSize, then compute scale
 * 3. Neither provided → use category default
 *
 * @param {Object} asset - Asset specification
 * @returns {{ warning: string|null }}
 */
function processAssetSpec(asset) {
  const category = asset.category || 'props'
  let warning = null

  // Case 1: realWorldSize provided (new format)
  if (typeof asset.realWorldSize === 'number') {
    const result = enforceInvariants(asset.realWorldSize, category)

    if (result.clamped) {
      warning = `[${asset.prompt?.slice(0, 30) || 'asset'}]: ${result.reason}`
    }

    asset.realWorldSize = result.size
    asset.scale = computeScaleFromSize(result.size, category)

    console.log(`[SizeInvariants] "${asset.prompt?.slice(0, 25)}": realWorldSize=${result.size}m → scale=${asset.scale.toFixed(2)}`)

    return { warning }
  }

  // Case 2: Only legacy scale provided → convert to realWorldSize
  if (typeof asset.scale === 'number' && asset.scale > 0) {
    // Convert scale to realWorldSize: scale × universal baseline = size
    const impliedSize = asset.scale * UNIVERSAL_BASELINE

    const result = enforceInvariants(impliedSize, category)

    if (result.clamped) {
      warning = `[${asset.prompt?.slice(0, 30) || 'asset'}]: Legacy scale ${asset.scale} → ${impliedSize}m, ${result.reason}`
    }

    asset.realWorldSize = result.size
    asset.scale = computeScaleFromSize(result.size, category)

    console.log(`[SizeInvariants] "${asset.prompt?.slice(0, 25)}": LEGACY scale=${asset.scale} → realWorldSize=${result.size}m`)

    return { warning }
  }

  // Case 3: No size info → use default
  const defaultSize = SIZE_INVARIANTS.DEFAULT_SIZES[category]
  asset.realWorldSize = defaultSize
  asset.scale = computeScaleFromSize(defaultSize, category)

  console.log(`[SizeInvariants] "${asset.prompt?.slice(0, 25)}": NO SIZE → using ${category} default ${defaultSize}m → scale=${asset.scale.toFixed(2)}`)

  return { warning: null }
}

/**
 * Convert a rescale action to proper scale value
 *
 * Used by refinement loop when AI says "make this asset 8 meters"
 *
 * @param {number} newRealWorldSize - Target size in meters
 * @param {string} category - Asset category
 * @returns {{ scale: number, realWorldSize: number, clamped: boolean }}
 */
export function computeRescale(newRealWorldSize, category) {
  const result = enforceInvariants(newRealWorldSize, category)

  return {
    scale: computeScaleFromSize(result.size, category),
    realWorldSize: result.size,
    clamped: result.clamped
  }
}
