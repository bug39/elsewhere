import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock localStorage
vi.stubGlobal('localStorage', {
  getItem: vi.fn(() => 'test-api-key'),
  setItem: vi.fn()
})

describe('GeminiClient', () => {
  let GeminiClient

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    // Reset module cache to get fresh instance
    vi.resetModules()
    const mod = await import('../../../src/generator/GeminiClient.js')
    GeminiClient = mod.GeminiClient
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('request timeout', () => {
    it('times out after REQUEST_TIMEOUT_MS', async () => {
      // Create a fetch that respects abort signal
      mockFetch.mockImplementation((_url, options) => {
        return new Promise((resolve, reject) => {
          const signal = options?.signal
          if (signal) {
            signal.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'))
            })
          }
        })
      })

      const client = new GeminiClient()
      const promise = client.generate('test', 'system').catch(e => e)

      // Advance past all retries (30s * 3 retries + delays)
      await vi.advanceTimersByTimeAsync(100000)

      const result = await promise
      expect(result).toBeInstanceOf(Error)
    })
  })

  describe('concurrent requests', () => {
    it('allows concurrent requests without cancellation', async () => {
      let resolvers = []
      mockFetch.mockImplementation(() => new Promise(resolve => {
        resolvers.push(() => resolve({
          ok: true,
          json: () => Promise.resolve({
            candidates: [{ content: { parts: [{ text: 'result' }] } }]
          })
        }))
      }))

      const client = new GeminiClient()
      const promise1 = client.generate('prompt1', 'system')
      const promise2 = client.generate('prompt2', 'system')

      // Both requests should be active
      expect(client.activeControllers.size).toBe(2)

      // Resolve both
      resolvers.forEach(r => r())
      
      const [result1, result2] = await Promise.all([promise1, promise2])
      expect(result1).toBe('result')
      expect(result2).toBe('result')
    })
  })

  describe('cancel', () => {
    it('aborts all active requests', async () => {
      // Create a fetch that respects abort signal
      mockFetch.mockImplementation((_url, options) => {
        return new Promise((resolve, reject) => {
          const signal = options?.signal
          if (signal) {
            signal.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'))
            })
          }
        })
      })

      const client = new GeminiClient()
      const promise1 = client.generate('prompt1', 'system')
      const promise2 = client.generate('prompt2', 'system')

      expect(client.activeControllers.size).toBe(2)

      client.cancel()

      expect(client.activeControllers.size).toBe(0)

      await expect(promise1).rejects.toThrow()
      await expect(promise2).rejects.toThrow()
    })
  })

  describe('generateWithMetadata retry', () => {
    it('retries on 500 error then succeeds', async () => {
      let callCount = 0
      mockFetch.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('Server error') })
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            candidates: [{ content: { parts: [{ text: '{"result": "success"}' }] } }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 }
          })
        })
      })

      const client = new GeminiClient()
      const promise = client.generateWithMetadata('prompt', 'system')
      
      // Advance for retry delay
      await vi.advanceTimersByTimeAsync(1000)
      
      const result = await promise
      expect(callCount).toBe(2)
      expect(result.text).toContain('success')
    })
  })

  describe('cleanup on completion', () => {
    it('removes controller from activeControllers after successful request', async () => {
      mockFetch.mockImplementation(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ text: 'result' }] } }]
        })
      }))

      const client = new GeminiClient()
      await client.generate('test', 'system')

      expect(client.activeControllers.size).toBe(0)
    })

    it('removes controller from activeControllers after failed request', async () => {
      mockFetch.mockImplementation(() => Promise.resolve({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Bad request')
      }))

      const client = new GeminiClient()
      
      await expect(client.generate('test', 'system')).rejects.toThrow()
      expect(client.activeControllers.size).toBe(0)
    })
  })
})
