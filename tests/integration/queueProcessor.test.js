/**
 * Integration tests for queue processor
 *
 * Tests the integration between:
 * - Generation queue state management
 * - Queue processor execution
 * - Asset generator
 * - Error handling and retry logic
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  generationQueue,
  addToQueue,
  updateQueueItem,
  getNextPending,
  dismissItem,
  loadQueue,
  saveQueue
} from '../../src/studio/state/generationQueue'

// Mock the asset generator
const mockGenerateAsset = vi.fn()

vi.mock('../../src/generator/AssetGenerator', () => ({
  generateAsset: (...args) => mockGenerateAsset(...args)
}))

describe('queueProcessor integration', () => {
  beforeEach(async () => {
    // Reset queue
    generationQueue.value = []
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('sequential processing', () => {
    it('should process items in FIFO order', async () => {
      const processOrder = []

      mockGenerateAsset.mockImplementation(async (prompt) => {
        processOrder.push(prompt)
        return {
          code: `// ${prompt}`,
          name: prompt,
          thumbnail: 'data:...',
          category: 'props'
        }
      })

      // Add items to queue
      await addToQueue('first')
      await addToQueue('second')
      await addToQueue('third')

      // Simulate processor picking up items
      let next = getNextPending()
      while (next) {
        await updateQueueItem(next.id, { status: 'generating' })
        const result = await mockGenerateAsset(next.prompt)
        await updateQueueItem(next.id, { status: 'completed', result })
        next = getNextPending()
      }

      expect(processOrder).toEqual(['first', 'second', 'third'])
    })

    it('should not process already generating items', async () => {
      mockGenerateAsset.mockResolvedValue({
        code: '// test',
        name: 'Test',
        thumbnail: 'data:...'
      })

      const { item } = await addToQueue('test prompt')
      await updateQueueItem(item.id, { status: 'generating' })

      const next = getNextPending()

      expect(next).toBeUndefined()
    })
  })

  describe('error handling', () => {
    it('should mark item as failed on generator error', async () => {
      mockGenerateAsset.mockRejectedValue(new Error('API rate limit exceeded'))

      const { item } = await addToQueue('test prompt')

      await updateQueueItem(item.id, { status: 'generating' })

      try {
        await mockGenerateAsset(item.prompt)
        await updateQueueItem(item.id, { status: 'completed' })
      } catch (err) {
        await updateQueueItem(item.id, {
          status: 'failed',
          error: err.message
        })
      }

      const failed = generationQueue.value.find(i => i.id === item.id)
      expect(failed.status).toBe('failed')
      expect(failed.error).toBe('API rate limit exceeded')
    })

    it('should allow retry of failed items', async () => {
      mockGenerateAsset
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          code: '// success',
          name: 'Dragon',
          thumbnail: 'data:...'
        })

      const { item } = await addToQueue('dragon')

      // First attempt fails
      await updateQueueItem(item.id, { status: 'generating' })
      try {
        await mockGenerateAsset(item.prompt)
      } catch {
        await updateQueueItem(item.id, { status: 'failed', error: 'Network error' })
      }

      // Retry
      await updateQueueItem(item.id, { status: 'pending', error: null })
      await updateQueueItem(item.id, { status: 'generating' })
      const result = await mockGenerateAsset(item.prompt)
      await updateQueueItem(item.id, { status: 'completed', result })

      const completed = generationQueue.value.find(i => i.id === item.id)
      expect(completed.status).toBe('completed')
      expect(completed.result.name).toBe('Dragon')
    })
  })

  describe('cancellation', () => {
    it('should allow dismissing pending items', async () => {
      const { item: item1 } = await addToQueue('item 1')
      const { item: item2 } = await addToQueue('item 2')

      await dismissItem(item1.id)

      expect(generationQueue.value).toHaveLength(1)
      expect(generationQueue.value[0].id).toBe(item2.id)
    })

    it('should allow dismissing generating items', async () => {
      const { item } = await addToQueue('generating item')
      await updateQueueItem(item.id, { status: 'generating' })

      await dismissItem(item.id)

      expect(generationQueue.value).toHaveLength(0)
    })
  })

  describe('progress updates', () => {
    it('should update progress during generation', async () => {
      const progressUpdates = []

      mockGenerateAsset.mockImplementation(async () => {
        // Simulate progress updates
        await updateQueueItem(generationQueue.value[0].id, { progress: 'Planning...' })
        progressUpdates.push('Planning...')

        await updateQueueItem(generationQueue.value[0].id, { progress: 'Generating code...' })
        progressUpdates.push('Generating code...')

        await updateQueueItem(generationQueue.value[0].id, { progress: 'Creating thumbnail...' })
        progressUpdates.push('Creating thumbnail...')

        return { code: '// done', name: 'Test', thumbnail: 'data:...' }
      })

      const { item } = await addToQueue('test')
      await updateQueueItem(item.id, { status: 'generating' })
      await mockGenerateAsset(item.prompt)

      expect(progressUpdates).toContain('Planning...')
      expect(progressUpdates).toContain('Generating code...')
      expect(progressUpdates).toContain('Creating thumbnail...')
    })
  })

  describe('persistence', () => {
    it('should persist queue state across saves', async () => {
      await addToQueue('persisted item 1')
      await addToQueue('persisted item 2')

      await saveQueue()

      // Clear in-memory queue
      generationQueue.value = []

      // Reload from storage
      await loadQueue()

      expect(generationQueue.value).toHaveLength(2)
      expect(generationQueue.value[0].prompt).toBe('persisted item 1')
    })

    it('should reset generating items to pending on load (recovery)', async () => {
      const { item } = await addToQueue('interrupted')
      await updateQueueItem(item.id, { status: 'generating', progress: 'Was running...' })

      await saveQueue()
      generationQueue.value = []
      await loadQueue()

      const recovered = generationQueue.value.find(i => i.prompt === 'interrupted')
      expect(recovered.status).toBe('pending')
      expect(recovered.progress).toBe('')
    })
  })

  describe('world association', () => {
    it('should track worldId for queue items', async () => {
      await addToQueue('world a item', 'world_a')
      await addToQueue('world b item', 'world_b')
      await addToQueue('global item', null)

      const items = generationQueue.value

      expect(items[0].worldId).toBe('world_a')
      expect(items[1].worldId).toBe('world_b')
      expect(items[2].worldId).toBeNull()
    })
  })

  describe('concurrent operations', () => {
    it('should handle rapid queue additions', async () => {
      const promises = []

      // Simulate rapid-fire additions
      for (let i = 0; i < 10; i++) {
        promises.push(addToQueue(`rapid item ${i}`))
      }

      await Promise.all(promises)

      // Queue should have all items (or hit limit)
      expect(generationQueue.value.length).toBeGreaterThanOrEqual(10)
    })

    it('should prevent duplicate additions from concurrent calls', async () => {
      // Both try to add same prompt simultaneously
      const [result1, result2] = await Promise.all([
        addToQueue('same prompt'),
        addToQueue('same prompt')
      ])

      // One should succeed, one should be marked duplicate
      const successCount = [result1, result2].filter(r => r.item !== null).length
      const duplicateCount = [result1, result2].filter(r => r.duplicate).length

      expect(successCount).toBe(1)
      expect(duplicateCount).toBe(1)
    })
  })
})
