/**
 * Unit tests for generationQueue.js
 *
 * Tests the generation queue state management including:
 * - Adding items to queue
 * - Duplicate detection
 * - Queue size limits
 * - Moving items up/down
 * - Queue persistence
 * - World-specific queue filtering
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { set } from 'idb-keyval'
import {
  generationQueue,
  loadQueue,
  saveQueue,
  addToQueue,
  checkDuplicate,
  getActiveQueueSize,
  updateQueueItem,
  dismissItem,
  retryItem,
  getNextPending,
  getQueueCounts,
  moveItemUp,
  moveItemDown,
  canMoveUp,
  canMoveDown,
  getQueueForWorld,
  clearQueueForWorld
} from '../../../src/studio/state/generationQueue'

// Spy on idb-keyval set to verify saveQueue calls
vi.mock('idb-keyval', async () => {
  const actual = await vi.importActual('idb-keyval')
  return {
    ...actual,
    set: vi.fn(actual.set)
  }
})

describe('generationQueue', () => {
  beforeEach(async () => {
    // Reset queue state before each test
    generationQueue.value = []
    vi.clearAllMocks()
  })

  describe('addToQueue', () => {
    it('should add a new item to the queue', async () => {
      const result = await addToQueue('a dragon')

      expect(result.item).toBeTruthy()
      expect(result.item.prompt).toBe('a dragon')
      expect(result.item.status).toBe('pending')
      expect(result.item.id).toMatch(/^gen_/)
      expect(result.error).toBeNull()
      expect(result.duplicate).toBe(false)
      expect(result.queueFull).toBe(false)
      expect(generationQueue.value).toHaveLength(1)
    })

    it('should trim whitespace from prompts', async () => {
      const result = await addToQueue('  a dragon  ')

      expect(result.item.prompt).toBe('a dragon')
    })

    it('should associate item with worldId when provided', async () => {
      const result = await addToQueue('a knight', 'world_123')

      expect(result.item.worldId).toBe('world_123')
    })

    it('should reject duplicate prompts', async () => {
      await addToQueue('a dragon')
      const result = await addToQueue('a dragon')

      expect(result.item).toBeNull()
      expect(result.duplicate).toBe(true)
      expect(result.error).toContain('Already queued')
    })

    it('should reject duplicate prompts case-insensitively', async () => {
      await addToQueue('A Dragon')
      const result = await addToQueue('a dragon')

      expect(result.duplicate).toBe(true)
    })

    it('should enforce maximum queue size', async () => {
      // Add 15 items (max)
      for (let i = 0; i < 15; i++) {
        await addToQueue(`item ${i}`)
      }

      const result = await addToQueue('one more')

      expect(result.item).toBeNull()
      expect(result.queueFull).toBe(true)
      expect(result.error).toContain('Queue full')
    })
  })

  describe('checkDuplicate', () => {
    it('should detect duplicates in pending state', async () => {
      await addToQueue('a dragon')

      const result = checkDuplicate('a dragon')

      expect(result.duplicate).toBe(true)
      expect(result.position).toBe(1)
    })

    it('should not detect completed items as duplicates', async () => {
      const { item } = await addToQueue('a dragon')
      await updateQueueItem(item.id, { status: 'completed' })

      const result = checkDuplicate('a dragon')

      expect(result.duplicate).toBe(false)
    })

    it('should handle empty queue', () => {
      const result = checkDuplicate('anything')

      expect(result.duplicate).toBe(false)
      expect(result.position).toBeNull()
    })
  })

  describe('updateQueueItem', () => {
    it('should update item status', async () => {
      const { item } = await addToQueue('a dragon')

      await updateQueueItem(item.id, { status: 'generating' })

      const updated = generationQueue.value.find(i => i.id === item.id)
      expect(updated.status).toBe('generating')
    })

    it('should update item progress', async () => {
      const { item } = await addToQueue('a dragon')

      await updateQueueItem(item.id, { progress: 'Building mesh...' })

      const updated = generationQueue.value.find(i => i.id === item.id)
      expect(updated.progress).toBe('Building mesh...')
    })

    it('should update item result on completion', async () => {
      const { item } = await addToQueue('a dragon')
      const result = { code: 'function() {}', name: 'Dragon', thumbnail: 'data:...' }

      await updateQueueItem(item.id, { status: 'completed', result })

      const updated = generationQueue.value.find(i => i.id === item.id)
      expect(updated.status).toBe('completed')
      expect(updated.result).toEqual(result)
    })
  })

  describe('dismissItem', () => {
    it('should remove item from queue', async () => {
      const { item } = await addToQueue('a dragon')

      await dismissItem(item.id)

      expect(generationQueue.value).toHaveLength(0)
    })

    it('should not affect other items', async () => {
      const { item: item1 } = await addToQueue('a dragon')
      const { item: item2 } = await addToQueue('a knight')

      await dismissItem(item1.id)

      expect(generationQueue.value).toHaveLength(1)
      expect(generationQueue.value[0].id).toBe(item2.id)
    })
  })

  describe('retryItem', () => {
    it('should reset failed item to pending', async () => {
      const { item } = await addToQueue('a dragon')
      await updateQueueItem(item.id, {
        status: 'failed',
        error: 'Network error',
        progress: 'Failed'
      })

      retryItem(item.id)

      const updated = generationQueue.value.find(i => i.id === item.id)
      expect(updated.status).toBe('pending')
      expect(updated.error).toBeNull()
      expect(updated.progress).toBe('')
    })
  })

  describe('getNextPending', () => {
    it('should return first pending item', async () => {
      await addToQueue('first')
      await addToQueue('second')

      const next = getNextPending()

      expect(next.prompt).toBe('first')
    })

    it('should skip generating items', async () => {
      const { item: item1 } = await addToQueue('first')
      await addToQueue('second')
      await updateQueueItem(item1.id, { status: 'generating' })

      const next = getNextPending()

      expect(next.prompt).toBe('second')
    })

    it('should return undefined when no pending items', async () => {
      const next = getNextPending()

      expect(next).toBeUndefined()
    })
  })

  describe('getQueueCounts', () => {
    it('should count items by status', async () => {
      const { item: item1 } = await addToQueue('pending1')
      const { item: item2 } = await addToQueue('pending2')
      const { item: item3 } = await addToQueue('pending3')

      await updateQueueItem(item1.id, { status: 'generating' })
      await updateQueueItem(item2.id, { status: 'completed' })

      const counts = getQueueCounts()

      expect(counts.pending).toBe(1)
      expect(counts.generating).toBe(1)
      expect(counts.completed).toBe(1)
      expect(counts.failed).toBe(0)
      expect(counts.total).toBe(3)
    })
  })

  describe('moveItemUp / moveItemDown', () => {
    it('should move pending item up in queue', async () => {
      await addToQueue('first')
      const { item: second } = await addToQueue('second')

      await moveItemUp(second.id)

      expect(generationQueue.value[0].prompt).toBe('second')
      expect(generationQueue.value[1].prompt).toBe('first')
    })

    it('should move pending item down in queue', async () => {
      const { item: first } = await addToQueue('first')
      await addToQueue('second')

      await moveItemDown(first.id)

      expect(generationQueue.value[0].prompt).toBe('second')
      expect(generationQueue.value[1].prompt).toBe('first')
    })

    it('should not move generating items', async () => {
      const { item: first } = await addToQueue('first')
      await addToQueue('second')
      await updateQueueItem(first.id, { status: 'generating' })

      await moveItemDown(first.id)

      expect(generationQueue.value[0].prompt).toBe('first')
    })

    it('should skip over non-pending items when moving', async () => {
      const { item: item1 } = await addToQueue('first')
      const { item: item2 } = await addToQueue('second')
      const { item: item3 } = await addToQueue('third')

      await updateQueueItem(item2.id, { status: 'completed' })

      await moveItemUp(item3.id)

      // Third should swap with first (skipping completed second)
      expect(generationQueue.value[0].prompt).toBe('third')
      expect(generationQueue.value[1].prompt).toBe('second')
      expect(generationQueue.value[2].prompt).toBe('first')
    })
  })

  describe('canMoveUp / canMoveDown', () => {
    it('should return true when item can move up', async () => {
      await addToQueue('first')
      const { item: second } = await addToQueue('second')

      expect(canMoveUp(second.id)).toBe(true)
    })

    it('should return false for first pending item', async () => {
      const { item: first } = await addToQueue('first')
      await addToQueue('second')

      expect(canMoveUp(first.id)).toBe(false)
    })

    it('should return true when item can move down', async () => {
      const { item: first } = await addToQueue('first')
      await addToQueue('second')

      expect(canMoveDown(first.id)).toBe(true)
    })

    it('should return false for last pending item', async () => {
      await addToQueue('first')
      const { item: second } = await addToQueue('second')

      expect(canMoveDown(second.id)).toBe(false)
    })
  })

  describe('getQueueForWorld', () => {
    it('should return items for specific world', async () => {
      await addToQueue('global item', null)
      await addToQueue('world a item', 'world_a')
      await addToQueue('world b item', 'world_b')

      const worldAQueue = getQueueForWorld('world_a')

      expect(worldAQueue).toHaveLength(2) // global + world_a
      expect(worldAQueue.map(i => i.prompt)).toContain('global item')
      expect(worldAQueue.map(i => i.prompt)).toContain('world a item')
      expect(worldAQueue.map(i => i.prompt)).not.toContain('world b item')
    })

    it('should include items with no worldId', async () => {
      await addToQueue('global item', null)

      const queue = getQueueForWorld('any_world')

      expect(queue).toHaveLength(1)
    })
  })

  describe('clearQueueForWorld', () => {
    it('should remove completed items for specific world', async () => {
      const { item: globalItem } = await addToQueue('global', null)
      const { item: worldAItem } = await addToQueue('world a', 'world_a')

      await updateQueueItem(globalItem.id, { status: 'completed' })
      await updateQueueItem(worldAItem.id, { status: 'completed' })

      await clearQueueForWorld('world_a')

      expect(generationQueue.value).toHaveLength(1)
      expect(generationQueue.value[0].prompt).toBe('global')
    })

    it('should keep pending items for the world', async () => {
      await addToQueue('pending item', 'world_a')

      await clearQueueForWorld('world_a')

      expect(generationQueue.value).toHaveLength(1)
    })
  })

  describe('loadQueue', () => {
    it('should reset generating items to pending on load', async () => {
      // Simulate a queue with a generating item (from interrupted session)
      const mockQueue = [
        { id: 'gen_1', prompt: 'test', status: 'generating', progress: 'Building...' }
      ]

      // Store directly to IndexedDB using idb-keyval
      const { set } = await import('idb-keyval')
      await set('thinq-generation-queue', mockQueue)

      await loadQueue()

      expect(generationQueue.value[0].status).toBe('pending')
      expect(generationQueue.value[0].progress).toBe('')
    })
  })

  describe('getActiveQueueSize', () => {
    it('should count only pending and generating items', async () => {
      const { item: item1 } = await addToQueue('pending')
      const { item: item2 } = await addToQueue('generating')
      const { item: item3 } = await addToQueue('completed')

      await updateQueueItem(item2.id, { status: 'generating' })
      await updateQueueItem(item3.id, { status: 'completed' })

      expect(getActiveQueueSize()).toBe(2)
    })
  })

  // ================================
  // M16 Mutation-Save Pattern Tests
  // ================================

  describe('M16 mutation-save pattern (awaited persistence)', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('addToQueue should await saveQueue', async () => {
      const result = await addToQueue('test item')

      expect(result.item).toBeTruthy()
      // Verify set was called (saveQueue uses idb-keyval set)
      expect(set).toHaveBeenCalled()

      // Verify the queue was saved with the new item
      const lastCall = set.mock.calls[set.mock.calls.length - 1]
      expect(lastCall[0]).toBe('thinq-generation-queue')
      expect(lastCall[1]).toContainEqual(expect.objectContaining({ prompt: 'test item' }))
    })

    it('updateQueueItem should await saveQueue', async () => {
      const { item } = await addToQueue('test')
      vi.clearAllMocks()

      await updateQueueItem(item.id, { status: 'generating' })

      expect(set).toHaveBeenCalled()
      const lastCall = set.mock.calls[set.mock.calls.length - 1]
      expect(lastCall[1]).toContainEqual(expect.objectContaining({
        id: item.id,
        status: 'generating'
      }))
    })

    it('dismissItem uses debounced saveQueue (non-blocking)', async () => {
      const { item } = await addToQueue('test')
      vi.clearAllMocks()

      // Enable fake timers AFTER async setup is complete
      vi.useFakeTimers()

      dismissItem(item.id)

      // Debounced save hasn't fired yet
      expect(set).not.toHaveBeenCalled()

      // Advance past the debounce timeout (100ms)
      await vi.advanceTimersByTimeAsync(150)

      expect(set).toHaveBeenCalled()
      // Item should be removed from saved queue
      const lastCall = set.mock.calls[set.mock.calls.length - 1]
      expect(lastCall[1]).not.toContainEqual(expect.objectContaining({ id: item.id }))
      vi.useRealTimers()
    })

    it('moveItemUp uses debounced saveQueue (non-blocking)', async () => {
      await addToQueue('first')
      const { item: second } = await addToQueue('second')
      vi.clearAllMocks()

      // Enable fake timers AFTER async setup is complete
      vi.useFakeTimers()

      moveItemUp(second.id)

      // Debounced save hasn't fired yet
      expect(set).not.toHaveBeenCalled()

      // Advance past the debounce timeout (100ms)
      await vi.advanceTimersByTimeAsync(150)

      expect(set).toHaveBeenCalled()
      // Verify order is persisted
      const lastCall = set.mock.calls[set.mock.calls.length - 1]
      expect(lastCall[1][0].prompt).toBe('second')
      expect(lastCall[1][1].prompt).toBe('first')
      vi.useRealTimers()
    })

    it('moveItemDown uses debounced saveQueue (non-blocking)', async () => {
      const { item: first } = await addToQueue('first')
      await addToQueue('second')
      vi.clearAllMocks()

      // Enable fake timers AFTER async setup is complete
      vi.useFakeTimers()

      moveItemDown(first.id)

      // Debounced save hasn't fired yet
      expect(set).not.toHaveBeenCalled()

      // Advance past the debounce timeout (100ms)
      await vi.advanceTimersByTimeAsync(150)

      expect(set).toHaveBeenCalled()
      // Verify order is persisted
      const lastCall = set.mock.calls[set.mock.calls.length - 1]
      expect(lastCall[1][0].prompt).toBe('second')
      expect(lastCall[1][1].prompt).toBe('first')
      vi.useRealTimers()
    })
  })

  describe('rapid save prevention', () => {
    it('should handle rapid sequential saves without data loss', async () => {
      // Simulate rapid adds
      const results = await Promise.all([
        addToQueue('item1'),
        addToQueue('item2'),
        addToQueue('item3')
      ])

      // All items should be successfully added
      expect(results.every(r => r.item !== null)).toBe(true)
      expect(generationQueue.value).toHaveLength(3)

      // Each add should have triggered a save
      expect(set).toHaveBeenCalledTimes(3)
    })

    it('should preserve order of operations after rapid updates', async () => {
      const { item } = await addToQueue('test')
      vi.clearAllMocks()

      // Rapid status updates
      await updateQueueItem(item.id, { progress: 'Step 1' })
      await updateQueueItem(item.id, { progress: 'Step 2' })
      await updateQueueItem(item.id, { progress: 'Step 3' })

      // Final state should reflect last update
      const updatedItem = generationQueue.value.find(i => i.id === item.id)
      expect(updatedItem.progress).toBe('Step 3')

      // Each update should have been saved
      expect(set).toHaveBeenCalledTimes(3)
    })

    it('should not lose data when multiple operations happen quickly', async () => {
      // Add items
      const { item: item1 } = await addToQueue('item1')
      const { item: item2 } = await addToQueue('item2')
      const { item: item3 } = await addToQueue('item3')

      // Rapid mixed operations
      await Promise.all([
        updateQueueItem(item1.id, { status: 'generating' }),
        updateQueueItem(item2.id, { status: 'completed' }),
        dismissItem(item3.id)
      ])

      // Verify final state
      expect(generationQueue.value).toHaveLength(2)
      expect(generationQueue.value.find(i => i.id === item1.id)?.status).toBe('generating')
      expect(generationQueue.value.find(i => i.id === item2.id)?.status).toBe('completed')
      expect(generationQueue.value.find(i => i.id === item3.id)).toBeUndefined()
    })
  })
})
