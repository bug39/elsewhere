/**
 * ThemePackPlanner — Gemini-powered theme pack ideation
 *
 * Takes a theme description and generates a list of thematically coherent
 * assets for world-building. Reuses the same Gemini API pattern as ScenePlanner.
 *
 * @see ../director/ScenePlanner.js for the pattern origin
 */

import SYSTEM_PROMPT from './prompts/themePackSystem.txt?raw'

const MODEL = 'gemini-3-flash-preview'
const BASE_URL = '/api/proxy'
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1000

/**
 * @typedef {Object} ThemeAsset
 * @property {string} id - lowercase_snake identifier
 * @property {string} description - Detailed generation prompt
 * @property {string} category - character|building|nature|vehicle|prop
 */

/**
 * @typedef {Object} ThemePack
 * @property {string} pack_name - Human-readable pack name
 * @property {ThemeAsset[]} assets - Array of asset descriptions
 */

/**
 * Parse JSON from model response, handling potential markdown wrapping
 * @param {string} text - Raw response text
 * @returns {{ success: boolean, data?: object, error?: string }}
 */
function parseJSON(text) {
  try {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    const jsonStr = jsonMatch ? jsonMatch[1] : text
    return { success: true, data: JSON.parse(jsonStr.trim()) }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

/**
 * Validate theme pack structure
 * @param {object} pack - Parsed pack object
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateThemePack(pack) {
  const errors = []

  if (!pack.assets || !Array.isArray(pack.assets)) {
    errors.push('Missing or invalid "assets" array')
  } else if (pack.assets.length === 0) {
    errors.push('Theme pack has no assets')
  } else {
    pack.assets.forEach((asset, i) => {
      if (!asset.id) errors.push(`Asset ${i + 1}: missing "id"`)
      if (!asset.description) errors.push(`Asset ${i + 1}: missing "description"`)
    })
  }

  return { valid: errors.length === 0, errors }
}

/**
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Call Gemini API with theme pack system prompt through server proxy
 * @param {string} prompt - User prompt
 * @returns {Promise<{ text: string }>}
 */
async function callGemini(prompt) {
  const requestBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingBudget: 0 }
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

  return { text }
}

/**
 * Plan a theme pack from a natural language description
 *
 * @param {string} themePrompt - Theme description from user
 * @param {Object} options - Options
 * @param {string} [options.biome] - World biome for context
 * @returns {Promise<ThemePack>}
 * @throws {Error} If planning fails after retries
 *
 * @example
 * const pack = await planThemePack('pirate cove with ships and treasure', { biome: 'desert' })
 * console.log(pack.assets.length) // e.g., 8
 */
export async function planThemePack(themePrompt, options = {}) {
  const { biome } = options

  if (!themePrompt || typeof themePrompt !== 'string') {
    throw new Error('Theme prompt required')
  }

  // Build user message with biome context
  let userMessage = `Theme: ${themePrompt}`
  if (biome) {
    userMessage += `\nBiome: ${biome}`
  }

  let lastError = null

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[ThemePackPlanner] Attempt ${attempt}/${MAX_RETRIES}`)

      const response = await callGemini(userMessage)

      const parsed = parseJSON(response.text)
      if (!parsed.success) {
        throw new Error(`JSON parse failed: ${parsed.error}`)
      }

      const validation = validateThemePack(parsed.data)
      if (!validation.valid) {
        throw new Error(`Invalid theme pack: ${validation.errors.join(', ')}`)
      }

      console.log(`[ThemePackPlanner] Success - ${parsed.data.assets.length} assets`)

      return parsed.data
    } catch (err) {
      console.warn(`[ThemePackPlanner] Attempt ${attempt} failed:`, err.message)
      lastError = err

      if (err.message.includes('safety filters')) {
        throw err
      }

      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt)
      }
    }
  }

  throw new Error(`Theme pack planning failed after ${MAX_RETRIES} attempts: ${lastError?.message}`)
}
