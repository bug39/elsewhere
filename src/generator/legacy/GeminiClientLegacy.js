const MODEL = 'gemini-3-flash-preview'
const BASE_URL = '/api/proxy'

// Retry config for transient errors
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1000

/**
 * Check if an error is retryable (transient)
 * @param {number} status - HTTP status code
 * @param {string} errorText - Error response body
 * @returns {boolean}
 */
function isRetryableError(status, errorText) {
  // Rate limiting
  if (status === 429) return true
  // Server errors
  if (status >= 500 && status < 600) return true
  // Transient image processing failures (Gemini-specific)
  if (status === 400 && errorText.includes('Unable to process input image')) return true
  return false
}

/**
 * Delay helper for retry backoff
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export class GeminiClient {
  constructor() {
    this.currentAbortController = null
  }

  /**
   * Cancel the current generation request if any
   */
  cancel() {
    if (this.currentAbortController) {
      this.currentAbortController.abort()
      this.currentAbortController = null
    }
  }

  async generate(prompt, systemInstruction, options = {}) {


    const {
      temperature = 1.0,
      maxOutputTokens = 4096,
      thinkingBudget = 0  // Default to no thinking for speed
    } = options

    const generationConfig = {
      temperature,
      maxOutputTokens,
      thinkingConfig: {
        thinkingBudget
      }
    }

    const requestBody = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      generationConfig,
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
      ]
    }

    // H2 FIX: Add retry loop for transient errors (consistent with generateWithImage)
    let lastError = null
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        console.log(`[GeminiClient] Retry attempt ${attempt + 1}/${MAX_RETRIES} for text request`)
        await delay(RETRY_DELAY_MS * attempt)
      }

      // Cancel any existing abort controller before creating new one
      if (this.currentAbortController) {
        this.currentAbortController.abort()
      }
      this.currentAbortController = new AbortController()

      const response = await fetch(
        `${BASE_URL}/${MODEL}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: this.currentAbortController.signal
        }
      )

      if (!response.ok) {
        const error = await response.text()
        if (response.status === 401 || response.status === 403) {
          throw new Error('Invalid API key. Please check your Gemini API key.')
        }
        // H2 FIX: Check if retryable
        if (isRetryableError(response.status, error) && attempt < MAX_RETRIES - 1) {
          lastError = new Error(`Gemini API error ${response.status}: ${error}`)
          continue // Retry
        }
        throw new Error(`Gemini API error ${response.status}: ${error}`)
      }

      const data = await response.json()
      const candidate = data.candidates?.[0]
      const text = candidate?.content?.parts?.[0]?.text

      if (!text) {
        throw new Error('No response from Gemini')
      }

      this.currentAbortController = null
      return text
    }

    // Should not reach here, but just in case
    throw lastError || new Error('Max retries exceeded')
  }

  /**
   * Generate content with a single image for vision analysis
   * @param {string} prompt - Text prompt to send
   * @param {string} imageBase64 - Base64-encoded image data (without data URL prefix)
   * @param {string} systemInstruction - System instruction for the model
   * @param {object} options - Generation options
   * @returns {Promise<string>} Generated text response
   */
  async generateWithImage(prompt, imageBase64, systemInstruction, options = {}) {


    // Validate image data before sending to API
    // A valid base64 PNG image should be at least a few hundred bytes
    if (!imageBase64 || typeof imageBase64 !== 'string' || imageBase64.length < 100) {
      throw new Error('Invalid or empty image data for vision API - scene may not have rendered yet')
    }

    const {
      temperature = 0.7,
      maxOutputTokens = 4096,
      thinkingBudget = 0,
      mimeType = 'image/png'
    } = options

    const generationConfig = {
      temperature,
      maxOutputTokens,
      thinkingConfig: {
        thinkingBudget
      }
    }

    const requestBody = {
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType,
              data: imageBase64
            }
          }
        ]
      }],
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      generationConfig,
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
      ]
    }

    // Retry loop for transient errors (especially "Unable to process input image")
    let lastError = null
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        console.log(`[GeminiClient] Retry attempt ${attempt + 1}/${MAX_RETRIES} for image request`)
        await delay(RETRY_DELAY_MS * attempt) // Exponential-ish backoff
      }

      // C5 FIX: Cancel any existing abort controller before creating new one
      if (this.currentAbortController) {
        this.currentAbortController.abort()
      }
      this.currentAbortController = new AbortController()

      const response = await fetch(
        `${BASE_URL}/${MODEL}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: this.currentAbortController.signal
        }
      )

      if (!response.ok) {
        const error = await response.text()
        if (response.status === 401 || response.status === 403) {
          throw new Error('Invalid API key. Please check your Gemini API key.')
        }
        // Check if retryable
        if (isRetryableError(response.status, error) && attempt < MAX_RETRIES - 1) {
          lastError = new Error(`Gemini API error ${response.status}: ${error}`)
          continue // Retry
        }
        throw new Error(`Gemini API error ${response.status}: ${error}`)
      }

      const data = await response.json()
      const candidate = data.candidates?.[0]
      const text = candidate?.content?.parts?.[0]?.text

      if (!text) {
        throw new Error('No response from Gemini')
      }

      this.currentAbortController = null
      return text
    }

    // Should not reach here, but just in case
    throw lastError || new Error('Max retries exceeded')
  }

  /**
   * Generate content with multiple images for comparison/analysis
   * @param {string} prompt - Text prompt to send
   * @param {Array<{data: string, mimeType?: string}>} images - Array of image objects
   * @param {string} systemInstruction - System instruction for the model
   * @param {object} options - Generation options
   * @returns {Promise<string>} Generated text response
   */
  async generateWithImages(prompt, images, systemInstruction, options = {}) {


    // Validate all images before sending to API
    for (let i = 0; i < images.length; i++) {
      const img = images[i]
      const data = typeof img === 'string' ? img : img.data
      if (!data || typeof data !== 'string' || data.length < 100) {
        throw new Error(`Invalid or empty image data at index ${i} for vision API - scene may not have rendered yet`)
      }
    }

    const {
      temperature = 0.7,
      maxOutputTokens = 4096,
      thinkingBudget = 0
    } = options

    const generationConfig = {
      temperature,
      maxOutputTokens,
      thinkingConfig: {
        thinkingBudget
      }
    }

    // Build parts array with text first, then all images
    const parts = [{ text: prompt }]
    for (const img of images) {
      parts.push({
        inlineData: {
          mimeType: img.mimeType || 'image/png',
          data: img.data
        }
      })
    }

    const requestBody = {
      contents: [{
        role: 'user',
        parts
      }],
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      generationConfig,
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
      ]
    }

    // Retry loop for transient errors (especially "Unable to process input image")
    let lastError = null
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        console.log(`[GeminiClient] Retry attempt ${attempt + 1}/${MAX_RETRIES} for multi-image request`)
        await delay(RETRY_DELAY_MS * attempt)
      }

      // C5 FIX: Cancel any existing abort controller before creating new one
      if (this.currentAbortController) {
        this.currentAbortController.abort()
      }
      this.currentAbortController = new AbortController()

      const response = await fetch(
        `${BASE_URL}/${MODEL}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: this.currentAbortController.signal
        }
      )

      if (!response.ok) {
        const error = await response.text()
        if (response.status === 401 || response.status === 403) {
          throw new Error('Invalid API key. Please check your Gemini API key.')
        }
        // Check if retryable
        if (isRetryableError(response.status, error) && attempt < MAX_RETRIES - 1) {
          lastError = new Error(`Gemini API error ${response.status}: ${error}`)
          continue // Retry
        }
        throw new Error(`Gemini API error ${response.status}: ${error}`)
      }

      const data = await response.json()
      const candidate = data.candidates?.[0]
      const text = candidate?.content?.parts?.[0]?.text

      if (!text) {
        throw new Error('No response from Gemini')
      }

      this.currentAbortController = null
      return text
    }

    // Should not reach here, but just in case
    throw lastError || new Error('Max retries exceeded')
  }

  async generateWithMetadata(prompt, systemInstruction, options = {}) {


    const {
      temperature = 1.0,
      maxOutputTokens = 4096,
      thinkingBudget = 0  // Default to no thinking for speed
    } = options

    const generationConfig = {
      temperature,
      maxOutputTokens,
      thinkingConfig: {
        thinkingBudget
      }
    }

    const requestBody = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      generationConfig,
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
      ]
    }

    // Create abort controller for this request
    this.currentAbortController = new AbortController()

    const response = await fetch(
      `${BASE_URL}/${MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: this.currentAbortController.signal
      }
    )

    if (!response.ok) {
      const error = await response.text()
      if (response.status === 401 || response.status === 403) {
        throw new Error('Invalid API key. Please check your Gemini API key.')
      }
      throw new Error(`Gemini API error ${response.status}: ${error}`)
    }

    const data = await response.json()
    const candidate = data.candidates?.[0]
    const text = candidate?.content?.parts?.[0]?.text

    if (!text) {
      throw new Error('No response from Gemini')
    }

    this.currentAbortController = null
    return {
      text,
      finishReason: candidate?.finishReason || 'UNKNOWN',
      usage: {
        promptTokens: data.usageMetadata?.promptTokenCount || 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
        thinkingTokens: data.usageMetadata?.thoughtsTokenCount || 0
      }
    }
  }
}

// Singleton instance
export const legacyGeminiClient = new GeminiClient()
