/**
 * ScenePlanner — Gemini-powered scene plan generation
 *
 * Takes a natural language scene description and generates a structured
 * plan with shots, assets, environment, and soundtrack.
 *
 * @see ../CLAUDE.md for architecture overview
 */

import SYSTEM_PROMPT from './prompts/scenePlannerSystem.txt?raw'

const MODEL = 'gemini-3-flash-preview'
const BASE_URL = '/api/proxy'
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1000

/**
 * @typedef {Object} Shot
 * @property {string} beat - Narrative beat name
 * @property {string} description - What happens in this shot
 * @property {number} duration_seconds - Shot duration
 * @property {{ primary: string, secondary: string|null }} subjects - Asset IDs
 * @property {string} spatial_relationship - Spatial relationship type
 * @property {string} camera_style - Camera style type
 * @property {string} [mood] - Emotional tone
 */

/**
 * @typedef {Object} Asset
 * @property {string} id - Unique identifier
 * @property {string} description - Asset description for generation
 */

/**
 * @typedef {Object} Environment
 * @property {string} time_of_day - Time of day
 * @property {string} weather - Weather condition
 * @property {string} terrain - Terrain description
 */

/**
 * @typedef {Object} Soundtrack
 * @property {string} style - Music style
 * @property {string} tempo - Music tempo
 * @property {string} mood_progression - How music evolves
 */

/**
 * @typedef {Object} ScenePlan
 * @property {Shot[]} shots - Array of shots
 * @property {Asset[]} assets_needed - Required assets
 * @property {Environment} environment - Scene environment
 * @property {Soundtrack} soundtrack - Music settings
 */

/**
 * Parse JSON from model response, handling potential markdown wrapping
 * @param {string} text - Raw response text
 * @returns {{ success: boolean, data?: object, error?: string }}
 */
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

/**
 * Validate scene plan structure
 * @param {object} plan - Parsed plan object
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateScenePlan(plan) {
  const errors = []

  if (!plan.shots || !Array.isArray(plan.shots)) {
    errors.push('Missing or invalid "shots" array')
  } else if (plan.shots.length === 0) {
    errors.push('Scene plan has no shots')
  } else {
    plan.shots.forEach((shot, i) => {
      if (!shot.beat) errors.push(`Shot ${i + 1}: missing "beat"`)
      if (!shot.description) errors.push(`Shot ${i + 1}: missing "description"`)
      if (typeof shot.duration_seconds !== 'number') {
        errors.push(`Shot ${i + 1}: missing or invalid "duration_seconds"`)
      }
      if (!shot.spatial_relationship) {
        errors.push(`Shot ${i + 1}: missing "spatial_relationship"`)
      }
      if (!shot.camera_style) errors.push(`Shot ${i + 1}: missing "camera_style"`)
    })
  }

  if (!plan.assets_needed || !Array.isArray(plan.assets_needed)) {
    errors.push('Missing or invalid "assets_needed" array')
  } else {
    plan.assets_needed.forEach((asset, i) => {
      if (!asset.id) errors.push(`Asset ${i + 1}: missing "id"`)
      if (!asset.description) errors.push(`Asset ${i + 1}: missing "description"`)
    })
  }

  if (!plan.environment) {
    errors.push('Missing "environment" object')
  }

  if (!plan.soundtrack) {
    errors.push('Missing "soundtrack" object')
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Call Gemini API through the authenticated server proxy
 * @param {string} prompt - User prompt
 * @returns {Promise<{ text: string, usage: object }>}
 */
async function callGemini(prompt) {
  const requestBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingBudget: 0 }  // Flash doesn't need thinking budget
    }
  }

  const response = await fetch(`${BASE_URL}/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`API error ${response.status}: ${errorText}`)
  }

  const data = await response.json()
  const candidate = data.candidates?.[0]

  if (!candidate) {
    throw new Error('No response generated')
  }

  if (candidate.finishReason === 'SAFETY') {
    throw new Error('Content blocked by safety filters')
  }

  const text = candidate.content?.parts?.[0]?.text
  if (!text) {
    throw new Error('Empty response from model')
  }

  return {
    text,
    usage: {
      promptTokens: data.usageMetadata?.promptTokenCount || 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount || 0
    }
  }
}

/**
 * Plan a scene from a natural language description
 *
 * @param {string} userPrompt - Scene description from user
 * @param {Object} options - Options
 * @returns {Promise<ScenePlan>}
 * @throws {Error} If planning fails after retries
 *
 * @example
 * const plan = await planScene('A robot walks through a neon city at night')
 * console.log(plan.shots.length) // e.g., 3
 */
export async function planScene(userPrompt, options = {}) {
  if (!userPrompt || typeof userPrompt !== 'string') {
    throw new Error('User prompt required')
  }

  let lastError = null

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[ScenePlanner] Attempt ${attempt}/${MAX_RETRIES}`)

      const response = await callGemini(userPrompt)

      // Parse JSON response
      const parsed = parseJSON(response.text)
      if (!parsed.success) {
        throw new Error(`JSON parse failed: ${parsed.error}`)
      }

      // Validate structure
      const validation = validateScenePlan(parsed.data)
      if (!validation.valid) {
        throw new Error(`Invalid scene plan: ${validation.errors.join(', ')}`)
      }

      console.log(`[ScenePlanner] Success - ${parsed.data.shots.length} shots, ${parsed.data.assets_needed.length} assets`)

      return parsed.data
    } catch (err) {
      console.warn(`[ScenePlanner] Attempt ${attempt} failed:`, err.message)
      lastError = err

      // Don't retry on certain errors
      if (err.message.includes('safety filters')) {
        throw err
      }

      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt)  // Exponential backoff
      }
    }
  }

  throw new Error(`Scene planning failed after ${MAX_RETRIES} attempts: ${lastError?.message}`)
}

// Re-export validation utilities for testing
export { parseJSON, validateScenePlan }
