/**
 * MockGeminiClient - Deterministic API responses for testing
 *
 * Uses fixture files to return pre-recorded responses for matching prompts.
 * This allows tests to run without actual API calls, providing:
 * - Fast execution
 * - Deterministic results
 * - No API costs during testing
 */

/**
 * Simple hash function for prompt matching
 * @param {string} str - String to hash
 * @returns {string} Hash string
 */
function hashPrompt(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return hash.toString(16)
}

/**
 * Extract key terms from a prompt for fuzzy matching
 * @param {string} prompt - The prompt to analyze
 * @returns {string[]} Key terms
 */
function extractKeyTerms(prompt) {
  const lowered = prompt.toLowerCase()
  const terms = []

  // Check for scene types
  const sceneTypes = ['village', 'forest', 'desert', 'graveyard', 'oasis', 'mountain', 'camp', 'clearing']
  for (const type of sceneTypes) {
    if (lowered.includes(type)) terms.push(type)
  }

  // Check for elements
  const elements = ['tree', 'cottage', 'well', 'rock', 'tombstone', 'tent', 'cabin', 'stone']
  for (const elem of elements) {
    if (lowered.includes(elem)) terms.push(elem)
  }

  return terms
}

export class MockGeminiClient {
  constructor(fixtures = new Map()) {
    this.fixtures = fixtures
    this.callLog = []
    this.defaultResponses = new Map()
    this.failureMode = null
  }

  /**
   * Register a fixture for a specific prompt hash
   * @param {string} promptHash - Hash of the prompt
   * @param {string} response - Response to return
   */
  addFixture(promptHash, response) {
    this.fixtures.set(promptHash, response)
  }

  /**
   * Register a default response for prompts containing certain keywords
   * @param {string} keyword - Keyword to match
   * @param {string} response - Response to return
   */
  addDefaultResponse(keyword, response) {
    this.defaultResponses.set(keyword.toLowerCase(), response)
  }

  /**
   * Set failure mode for testing error handling
   * @param {'rate_limit'|'auth_error'|'timeout'|null} mode - Failure mode or null to disable
   */
  setFailureMode(mode) {
    this.failureMode = mode
  }

  /**
   * Find a matching fixture or default response
   * @param {string} prompt - The prompt to match
   * @returns {string|null} Matching response or null
   */
  findResponse(prompt) {
    // Check exact hash match first
    const hash = hashPrompt(prompt)
    if (this.fixtures.has(hash)) {
      return this.fixtures.get(hash)
    }

    // Check for keyword matches in default responses
    const lowered = prompt.toLowerCase()
    for (const [keyword, response] of this.defaultResponses) {
      if (lowered.includes(keyword)) {
        return response
      }
    }

    return null
  }

  /**
   * Simulate API key retrieval
   */
  getApiKey() {
    return 'mock-api-key-for-testing'
  }

  /**
   * Simulate setting API key
   */
  setApiKey(key) {
    // No-op for mock
  }

  /**
   * Cancel current request (no-op for mock)
   */
  cancel() {
    // No-op for mock
  }

  /**
   * Mock generate method
   * @param {string} prompt - User prompt
   * @param {string} systemInstruction - System instruction
   * @param {object} options - Generation options
   * @returns {Promise<string>} Generated response
   */
  async generate(prompt, systemInstruction, options = {}) {
    // Log the call
    this.callLog.push({
      method: 'generate',
      prompt,
      systemInstruction: systemInstruction?.slice(0, 100),
      options,
      timestamp: Date.now()
    })

    // Simulate failure modes
    if (this.failureMode === 'rate_limit') {
      throw new Error('Gemini API error 429: Rate limit exceeded')
    }
    if (this.failureMode === 'auth_error') {
      throw new Error('Invalid API key. Please check your Gemini API key.')
    }
    if (this.failureMode === 'timeout') {
      await new Promise(resolve => setTimeout(resolve, 100))
      throw new Error('Request timeout')
    }

    // Find matching response
    const response = this.findResponse(prompt)
    if (response) {
      // Simulate API latency
      await new Promise(resolve => setTimeout(resolve, 10))
      return response
    }

    throw new Error(`MockGeminiClient: No fixture for prompt: ${prompt.slice(0, 100)}...`)
  }

  /**
   * Mock generateWithImage method
   * @param {string} prompt - User prompt
   * @param {string} imageBase64 - Image data (ignored in mock)
   * @param {string} systemInstruction - System instruction
   * @param {object} options - Generation options
   * @returns {Promise<string>} Generated response
   */
  async generateWithImage(prompt, imageBase64, systemInstruction, options = {}) {
    // Log the call
    this.callLog.push({
      method: 'generateWithImage',
      prompt,
      hasImage: !!imageBase64,
      imageSize: imageBase64?.length || 0,
      systemInstruction: systemInstruction?.slice(0, 100),
      options,
      timestamp: Date.now()
    })

    // Simulate failure modes
    if (this.failureMode) {
      return this.generate(prompt, systemInstruction, options)
    }

    // For vision requests, look for evaluation fixtures
    const response = this.findResponse(prompt)
    if (response) {
      await new Promise(resolve => setTimeout(resolve, 10))
      return response
    }

    // Default evaluation response if no fixture
    return JSON.stringify({
      overallScore: 70,
      satisfactory: false,
      composition: { score: 70, issues: [], suggestions: [] },
      density: { score: 70, tooSparse: [], tooCrowded: [] },
      themeConsistency: { score: 70, outliers: [], missing: [] },
      spatialBalance: { score: 70, emptyQuadrants: [], cluttered: [] },
      terrainFit: { score: 70, issues: [] },
      actionItems: []
    })
  }

  /**
   * Mock generateWithImages method
   * @param {string} prompt - User prompt
   * @param {Array} images - Array of image objects
   * @param {string} systemInstruction - System instruction
   * @param {object} options - Generation options
   * @returns {Promise<string>} Generated response
   */
  async generateWithImages(prompt, images, systemInstruction, options = {}) {
    // Log the call
    this.callLog.push({
      method: 'generateWithImages',
      prompt,
      imageCount: images?.length || 0,
      systemInstruction: systemInstruction?.slice(0, 100),
      options,
      timestamp: Date.now()
    })

    // Delegate to generateWithImage with first image
    return this.generateWithImage(
      prompt,
      images?.[0]?.data,
      systemInstruction,
      options
    )
  }

  /**
   * Get call log for test assertions
   * @returns {Array} Array of logged calls
   */
  getCallLog() {
    return this.callLog
  }

  /**
   * Clear call log
   */
  clearCallLog() {
    this.callLog = []
  }

  /**
   * Get count of calls made
   * @param {string} method - Optional method filter
   * @returns {number} Call count
   */
  getCallCount(method = null) {
    if (method) {
      return this.callLog.filter(c => c.method === method).length
    }
    return this.callLog.length
  }
}

/**
 * Create a mock client pre-loaded with common fixtures
 */
export function createMockClient() {
  const client = new MockGeminiClient()

  // Add default scene planning response
  client.addDefaultResponse('village', JSON.stringify({
    terrain: { biome: 'grass', modifications: [] },
    assets: [
      { prompt: 'medieval stone well', category: 'props', placement: 'focal', location: 'center', count: 1, scale: 8 },
      { prompt: 'thatched cottage', category: 'buildings', placement: 'ring', location: 'around center', count: 4, radius: 50, scale: 15 }
    ],
    npcs: []
  }))

  client.addDefaultResponse('forest', JSON.stringify({
    terrain: { biome: 'forest', modifications: [] },
    assets: [
      { prompt: 'oak tree with full canopy', category: 'nature', placement: 'scatter', location: 'throughout', count: 12, minDistance: 20, scale: 12 },
      { prompt: 'mossy rock', category: 'nature', placement: 'scatter', location: 'throughout', count: 6, scale: 6 }
    ],
    npcs: []
  }))

  client.addDefaultResponse('graveyard', JSON.stringify({
    terrain: { biome: 'volcanic', modifications: [] },
    assets: [
      { prompt: 'gothic tombstone', category: 'props', placement: 'grid', location: 'center', count: 12, scale: 5 },
      { prompt: 'dead tree', category: 'nature', placement: 'edge', location: 'N edge', count: 4, scale: 10 },
      { prompt: 'gothic mausoleum', category: 'buildings', placement: 'focal', location: 'center', count: 1, scale: 20 }
    ],
    npcs: []
  }))

  return client
}
