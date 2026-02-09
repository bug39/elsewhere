/**
 * Instance matching utilities for refinement operations
 *
 * Provides fuzzy matching to find placed instances by description,
 * instanceId, or structureId. Used by rescale and remove operations
 * during scene refinement.
 *
 * Matching stages (in priority order):
 * 1. Exact instanceId match (confidence 1.0)
 * 2. Exact structureId match (confidence 1.0)
 * 3. Description→structureId bridge (confidence 0.9)
 * 4. Fuzzy text matching with optional location boost
 */

import { parseSemanticLocation } from './placementAlgorithms'

/**
 * Common words to filter from search terms
 */
export const STOP_WORDS = new Set(['a', 'an', 'the', 'in', 'at', 'on', 'near', 'by', 'with', 'of', 'to', 'and'])

/**
 * Minimum confidence score to include a match
 */
const MIN_CONFIDENCE = 0.25

/**
 * Get category for an instance from its library asset
 *
 * @param {Object} instance - The placed instance
 * @param {Object} data - World data with library
 * @returns {string} Category name or 'props' as default
 */
export function getCategoryForInstance(instance, data) {
  const libraryAsset = data.library.find(a => a.id === instance.libraryId)
  return libraryAsset?.category || 'props'
}

/**
 * Normalize instanceId by stripping brackets and whitespace.
 * Handles variations like "[inst_abc]", "inst_abc", " [inst_abc] "
 *
 * @param {string} id - The instanceId to normalize
 * @returns {string} Normalized instanceId (e.g., "inst_abc")
 */
function normalizeInstanceId(id) {
  if (!id || typeof id !== 'string') return ''
  return id.replace(/^\[|\]$/g, '').trim()
}

/**
 * Find instances matching a refinement target description
 *
 * Uses fuzzy matching with confidence scoring:
 * 1. Exact keyword matches (high weight)
 * 2. Partial/substring matches (medium weight)
 * 3. Location proximity (bonus)
 *
 * @param {Object} target - Target with description and/or location
 * @param {Object} data - World data with placedAssets and library
 * @returns {Array} Matching instances (filtered by confidence threshold)
 */
export function findMatchingInstances(target, data) {
  const { placedAssets, library } = data
  const candidates = []

  // 1. Direct instance ID match (highest priority)
  // Normalize both sides to handle format variations (with/without brackets)
  if (target.instanceId) {
    const normalizedTargetId = normalizeInstanceId(target.instanceId)
    const instance = placedAssets.find(p => normalizeInstanceId(p.instanceId) === normalizedTargetId)
    if (instance) {
      console.log(`[Refinement] Found by instanceId: ${target.instanceId} → ${instance.instanceId}`)
      return [{ ...instance, _matchScore: 1.0 }]
    } else {
      console.warn(`[Refinement] Instance ID "${target.instanceId}" (normalized: "${normalizedTargetId}") not found, falling back to structureId/description matching`)
    }
  }

  // 2. Structure ID match (from relationship-based placement)
  if (target.structureId) {
    const instance = placedAssets.find(p => p._structureId === target.structureId)
    if (instance) {
      console.log(`[Refinement] Found by structureId: ${target.structureId}`)
      return [{ ...instance, _matchScore: 1.0 }]
    }
  }

  // 3. Check if description matches a structure ID (vocabulary bridge)
  // Converts description like "surf diner" → "surf_diner" for matching
  if (target.description) {
    const descNormalized = target.description.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    const structMatch = placedAssets.find(p =>
      p._structureId && p._structureId.toLowerCase() === descNormalized
    )
    if (structMatch) {
      console.log(`[Refinement] Found by description→structureId: ${structMatch._structureId}`)
      return [{ ...structMatch, _matchScore: 0.9 }]
    }
  }

  // 3b. If structureId was provided but no direct match, use it as description for fuzzy matching
  // This handles cases where scene wasn't created with RELATIONSHIP placement
  if (target.structureId && !target.description) {
    // Convert structure ID back to searchable text: "yoyodyne_office" → "yoyodyne office"
    target.description = target.structureId.replace(/_/g, ' ')
    console.log(`[Refinement] Using structureId as description for fuzzy match: "${target.description}"`)
  }

  // 4. Parse target location if provided (for fuzzy matching)
  let targetBounds = null
  if (target.location) {
    try {
      targetBounds = parseSemanticLocation(target.location)
    } catch (e) {
      // Location parsing failed, will rely on description matching
    }
  }

  // Extract meaningful search terms (filter out common words)
  const searchTerms = (target.description || '')
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(term => term.length > 2 && !STOP_WORDS.has(term))

  if (searchTerms.length === 0 && !targetBounds) {
    console.warn('[Refinement] No valid search terms or location for matching')
    return []
  }

  for (const instance of placedAssets) {
    const libraryAsset = library.find(a => a.id === instance.libraryId)
    if (!libraryAsset) continue

    const assetText = (libraryAsset.name || libraryAsset.prompt || '').toLowerCase()
    const assetTerms = assetText.split(/[\s,]+/)

    // Calculate match score with weighted components
    let exactMatches = 0
    let partialMatches = 0

    for (const searchTerm of searchTerms) {
      // Exact term match (higher weight)
      if (assetTerms.includes(searchTerm)) {
        exactMatches++
      }
      // Partial/substring match (lower weight)
      else if (assetText.includes(searchTerm)) {
        partialMatches++
      }
    }

    // Calculate normalized confidence score (0-1)
    const maxPossibleScore = searchTerms.length * 2  // 2 points per term max
    const rawScore = (exactMatches * 2) + (partialMatches * 0.5)
    let confidence = maxPossibleScore > 0 ? rawScore / maxPossibleScore : 0

    // Location bonus: boost score if in target zone
    let inTargetZone = false
    if (targetBounds) {
      const [x, , z] = instance.position
      if (x >= targetBounds.minX && x <= targetBounds.maxX &&
          z >= targetBounds.minZ && z <= targetBounds.maxZ) {
        inTargetZone = true
        confidence = Math.min(1, confidence + 0.3)  // 30% boost for being in zone
      }
    }

    // Include if above confidence threshold OR in target zone with any match
    if (confidence >= MIN_CONFIDENCE || (inTargetZone && rawScore > 0)) {
      candidates.push({
        ...instance,
        // instance already has .instanceId property, no need to remap from .id
        _matchScore: confidence,
        _exactMatches: exactMatches,
        _partialMatches: partialMatches,
        _inTargetZone: inTargetZone
      })
    }
  }

  // Sort by confidence score, best first
  candidates.sort((a, b) => b._matchScore - a._matchScore)

  // Log matching details for debugging
  if (candidates.length > 0) {
    const topMatch = candidates[0]
    const asset = library.find(a => a.id === topMatch.libraryId)
    console.log(`[Refinement] Best match for "${target.description}": ` +
      `"${asset?.name?.slice(0, 30)}" (confidence: ${(topMatch._matchScore * 100).toFixed(0)}%, ` +
      `exact: ${topMatch._exactMatches}, partial: ${topMatch._partialMatches}, zone: ${topMatch._inTargetZone})`)
  }

  return candidates
}
