const MODEL = 'gemini-3-flash-preview'
const BASE_URL = '/api/proxy'
const IMAGEN_MODEL = 'imagen-4.0-generate-001'
const IMAGE_GENERATION_TIMEOUT_MS = 60000 // 60 second timeout for image generation

// Retry config for transient errors
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1000
const REQUEST_TIMEOUT_MS = 30000 // 30 second timeout per request

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
    this.activeControllers = new Set() // Track all active requests
  }

  /**
   * Cancel all active generation requests
   */
  cancel() {
    for (const controller of this.activeControllers) {
      controller.abort()
    }
    this.activeControllers.clear()
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

    let lastError = null
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        console.log(`[GeminiClient] Retry attempt ${attempt + 1}/${MAX_RETRIES} for text request`)
        await delay(RETRY_DELAY_MS * attempt)
      }

      const controller = new AbortController()
      this.activeControllers.add(controller)

      const timeoutId = setTimeout(() => {
        controller.abort()
      }, REQUEST_TIMEOUT_MS)

      try {
        const response = await fetch(
          `${BASE_URL}/${MODEL}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: controller.signal
          }
        )

        if (!response.ok) {
          const error = await response.text()
          if (response.status === 401 || response.status === 403) {
            throw new Error('Session expired. Please refresh the page.')
          }
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

        return text
      } finally {
        clearTimeout(timeoutId)
        this.activeControllers.delete(controller)
      }
    }

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

    let lastError = null
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        console.log(`[GeminiClient] Retry attempt ${attempt + 1}/${MAX_RETRIES} for image request`)
        await delay(RETRY_DELAY_MS * attempt)
      }

      const controller = new AbortController()
      this.activeControllers.add(controller)

      const timeoutId = setTimeout(() => {
        controller.abort()
      }, REQUEST_TIMEOUT_MS)

      try {
        const response = await fetch(
          `${BASE_URL}/${MODEL}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: controller.signal
          }
        )

        if (!response.ok) {
          const error = await response.text()
          if (response.status === 401 || response.status === 403) {
            throw new Error('Session expired. Please refresh the page.')
          }
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

        return text
      } finally {
        clearTimeout(timeoutId)
        this.activeControllers.delete(controller)
      }
    }

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

    let lastError = null
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        console.log(`[GeminiClient] Retry attempt ${attempt + 1}/${MAX_RETRIES} for multi-image request`)
        await delay(RETRY_DELAY_MS * attempt)
      }

      const controller = new AbortController()
      this.activeControllers.add(controller)

      const timeoutId = setTimeout(() => {
        controller.abort()
      }, REQUEST_TIMEOUT_MS)

      try {
        const response = await fetch(
          `${BASE_URL}/${MODEL}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: controller.signal
          }
        )

        if (!response.ok) {
          const error = await response.text()
          if (response.status === 401 || response.status === 403) {
            throw new Error('Session expired. Please refresh the page.')
          }
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

        return text
      } finally {
        clearTimeout(timeoutId)
        this.activeControllers.delete(controller)
      }
    }

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

    let lastError = null
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        console.log(`[GeminiClient] Retry attempt ${attempt + 1}/${MAX_RETRIES} for metadata request`)
        await delay(RETRY_DELAY_MS * attempt)
      }

      const controller = new AbortController()
      this.activeControllers.add(controller)

      const timeoutId = setTimeout(() => {
        controller.abort()
      }, REQUEST_TIMEOUT_MS)

      try {
        const response = await fetch(
          `${BASE_URL}/${MODEL}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: controller.signal
          }
        )

        if (!response.ok) {
          const error = await response.text()
          if (response.status === 401 || response.status === 403) {
            throw new Error('Session expired. Please refresh the page.')
          }
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

        return {
          text,
          finishReason: candidate?.finishReason || 'UNKNOWN',
          usage: {
            promptTokens: data.usageMetadata?.promptTokenCount || 0,
            outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
            thinkingTokens: data.usageMetadata?.thoughtsTokenCount || 0
          }
        }
      } finally {
        clearTimeout(timeoutId)
        this.activeControllers.delete(controller)
      }
    }

    throw lastError || new Error('Max retries exceeded')
  }

  /**
   * Generate an image using Imagen API
   * @param {string} prompt - Text prompt describing the image
   * @param {object} options - Generation options
   * @param {string} options.aspectRatio - '1:1', '3:4', '4:3', '9:16', '16:9' (default: '1:1')
   * @param {string} options.imageSize - '1K' or '2K' (default: '1K')
   * @param {number} options.sampleCount - Number of images 1-4 (default: 1)
   * @returns {Promise<Array<{imageBytes: string, mimeType: string}>>} Array of generated images
   */
  async generateImage(prompt, options = {}) {
    const {
      aspectRatio = '1:1',
      imageSize = '1K',
      sampleCount = 1
    } = options

    const requestBody = {
      instances: [{ prompt }],
      parameters: {
        sampleCount: Math.min(4, Math.max(1, sampleCount)),
        imageSize,
        aspectRatio,
        personGeneration: 'allow_adult'
      }
    }

    let lastError = null
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        console.log(`[GeminiClient] Retry attempt ${attempt + 1}/${MAX_RETRIES} for image generation`)
        await delay(RETRY_DELAY_MS * attempt)
      }

      const controller = new AbortController()
      this.activeControllers.add(controller)

      const timeoutId = setTimeout(() => {
        controller.abort()
      }, IMAGE_GENERATION_TIMEOUT_MS)

      try {
        const response = await fetch(
          `${BASE_URL}/${IMAGEN_MODEL}:predict`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: controller.signal
          }
        )

        if (!response.ok) {
          const error = await response.text()
          if (response.status === 401 || response.status === 403) {
            throw new Error('Session expired. Please refresh the page.')
          }
          if (isRetryableError(response.status, error) && attempt < MAX_RETRIES - 1) {
            lastError = new Error(`Imagen API error ${response.status}: ${error}`)
            continue // Retry
          }
          throw new Error(`Imagen API error ${response.status}: ${error}`)
        }

        const data = await response.json()
        const generatedImages = data.generatedImages || data.predictions

        if (!generatedImages || generatedImages.length === 0) {
          throw new Error('No images generated from Imagen API')
        }

        // Normalize response format - handle both direct and nested image data
        return generatedImages.map(item => ({
          imageBytes: item.image?.imageBytes || item.bytesBase64Encoded || item.imageBytes,
          mimeType: item.image?.mimeType || item.mimeType || 'image/png'
        }))
      } finally {
        clearTimeout(timeoutId)
        this.activeControllers.delete(controller)
      }
    }

    throw lastError || new Error('Max retries exceeded for image generation')
  }
}

// Singleton instance
export const geminiClient = new GeminiClient()
