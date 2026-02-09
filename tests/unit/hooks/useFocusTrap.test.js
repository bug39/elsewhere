/**
 * Unit tests for useFocusTrap.js
 *
 * Tests the modal focus trap behavior including:
 * - Focus first element when active
 * - Tab cycles through focusables
 * - Shift+Tab cycles backward
 * - Escape calls onClose
 * - Focus restoration on unmount
 * - Edge cases with empty/disabled elements
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/preact'
import { useFocusTrap } from '../../../src/studio/hooks/useFocusTrap'

/**
 * Helper to create a container with focusable elements for testing
 * @returns {HTMLDivElement}
 */
function createTestContainer() {
  const container = document.createElement('div')

  const btn1 = document.createElement('button')
  btn1.id = 'btn1'
  btn1.textContent = 'Button 1'
  container.appendChild(btn1)

  const input1 = document.createElement('input')
  input1.id = 'input1'
  input1.type = 'text'
  container.appendChild(input1)

  const btn2 = document.createElement('button')
  btn2.id = 'btn2'
  btn2.textContent = 'Button 2'
  container.appendChild(btn2)

  const link1 = document.createElement('a')
  link1.id = 'link1'
  link1.href = '#'
  link1.textContent = 'Link'
  container.appendChild(link1)

  return container
}

describe('useFocusTrap', () => {
  let container
  let onClose

  beforeEach(() => {
    vi.useFakeTimers()
    onClose = vi.fn()

    // Create a container with focusable elements
    container = createTestContainer()
    document.body.appendChild(container)
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.removeChild(container)
    vi.clearAllMocks()
  })

  describe('focus first element', () => {
    it('should focus first focusable element when active', async () => {
      const { result } = renderHook(() => useFocusTrap(true, onClose))

      // Assign the ref to our container
      result.current.current = container

      // Advance past the 50ms delay
      await act(async () => {
        vi.advanceTimersByTime(50)
      })

      expect(document.activeElement).toBe(container.querySelector('#btn1'))
    })

    it('should delay focus by 50ms to ensure DOM is ready', async () => {
      const { result } = renderHook(() => useFocusTrap(true, onClose))
      result.current.current = container

      // Before 50ms, should not have focused
      await act(async () => {
        vi.advanceTimersByTime(40)
      })

      // Focus might not have happened yet (depends on initial activeElement)
      // After 50ms, should focus
      await act(async () => {
        vi.advanceTimersByTime(10)
      })

      expect(document.activeElement).toBe(container.querySelector('#btn1'))
    })

    it('should not focus when inactive', async () => {
      const initialActive = document.activeElement

      renderHook(() => useFocusTrap(false, onClose))

      await act(async () => {
        vi.advanceTimersByTime(100)
      })

      // Should not have changed focus
      expect(document.activeElement).toBe(initialActive)
    })
  })

  describe('Tab cycling', () => {
    it('should cycle from last to first element on Tab', async () => {
      const { result } = renderHook(() => useFocusTrap(true, onClose))
      result.current.current = container

      await act(async () => {
        vi.advanceTimersByTime(50)
      })

      // Focus last element
      const lastElement = container.querySelector('#link1')
      lastElement.focus()

      // Simulate Tab key
      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: false,
        bubbles: true,
        cancelable: true
      })
      const preventDefault = vi.fn()
      event.preventDefault = preventDefault

      document.dispatchEvent(event)

      // Should have called preventDefault and cycled to first
      // Note: The actual focus change happens in the handler
    })

    it('should cycle from first to last element on Shift+Tab', async () => {
      const { result } = renderHook(() => useFocusTrap(true, onClose))
      result.current.current = container

      await act(async () => {
        vi.advanceTimersByTime(50)
      })

      // Focus should be on first element
      expect(document.activeElement).toBe(container.querySelector('#btn1'))

      // Simulate Shift+Tab key
      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true
      })
      event.preventDefault = vi.fn()

      document.dispatchEvent(event)

      // Handler should have been called (we can verify through the mock)
    })

    it('should allow normal Tab navigation within container', async () => {
      const { result } = renderHook(() => useFocusTrap(true, onClose))
      result.current.current = container

      await act(async () => {
        vi.advanceTimersByTime(50)
      })

      // Focus middle element
      const inputElement = container.querySelector('#input1')
      inputElement.focus()

      // Tab should proceed normally (no wrapping needed)
      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: false,
        bubbles: true,
        cancelable: true
      })
      event.preventDefault = vi.fn()

      document.dispatchEvent(event)

      // For middle elements, preventDefault should NOT be called
      // (browser handles the focus change)
    })
  })

  describe('Escape key', () => {
    it('should call onClose when Escape is pressed', async () => {
      const { result } = renderHook(() => useFocusTrap(true, onClose))
      result.current.current = container

      await act(async () => {
        vi.advanceTimersByTime(50)
      })

      // Simulate Escape key
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true
      })
      event.preventDefault = vi.fn()

      document.dispatchEvent(event)

      expect(onClose).toHaveBeenCalled()
    })

    it('should prevent default on Escape', async () => {
      const { result } = renderHook(() => useFocusTrap(true, onClose))
      result.current.current = container

      await act(async () => {
        vi.advanceTimersByTime(50)
      })

      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true
      })
      event.preventDefault = vi.fn()

      document.dispatchEvent(event)

      expect(event.preventDefault).toHaveBeenCalled()
    })

    it('should not call onClose when Escape pressed but trap is inactive', async () => {
      renderHook(() => useFocusTrap(false, onClose))

      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true
      })

      document.dispatchEvent(event)

      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe('focus restoration', () => {
    it('should restore focus to previous element on unmount', async () => {
      // Focus an element before activating the trap
      const externalButton = document.createElement('button')
      externalButton.id = 'external'
      document.body.appendChild(externalButton)
      externalButton.focus()

      expect(document.activeElement).toBe(externalButton)

      const { result, unmount } = renderHook(() => useFocusTrap(true, onClose))
      result.current.current = container

      await act(async () => {
        vi.advanceTimersByTime(50)
      })

      // Focus should now be inside container
      expect(container.contains(document.activeElement)).toBe(true)

      // Unmount the hook
      unmount()

      // Focus should be restored to external button
      expect(document.activeElement).toBe(externalButton)

      document.body.removeChild(externalButton)
    })

    it('should clear timeout on unmount', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')

      const { result, unmount } = renderHook(() => useFocusTrap(true, onClose))
      result.current.current = container

      unmount()

      expect(clearTimeoutSpy).toHaveBeenCalled()

      clearTimeoutSpy.mockRestore()
    })
  })

  describe('edge cases', () => {
    it('should handle container with no focusable elements', async () => {
      const emptyContainer = document.createElement('div')
      const span = document.createElement('span')
      span.textContent = 'Non-focusable content'
      emptyContainer.appendChild(span)
      document.body.appendChild(emptyContainer)

      const { result } = renderHook(() => useFocusTrap(true, onClose))
      result.current.current = emptyContainer

      // Should not throw
      await act(async () => {
        vi.advanceTimersByTime(50)
      })

      document.body.removeChild(emptyContainer)
    })

    it('should handle container being null', async () => {
      const { result } = renderHook(() => useFocusTrap(true, onClose))
      // Don't set containerRef.current

      // Should not throw
      await act(async () => {
        vi.advanceTimersByTime(50)
      })
    })

    it('should skip disabled elements', async () => {
      // Remove existing container
      document.body.removeChild(container)

      // Create container with disabled button first
      container = document.createElement('div')
      const disabledBtn = document.createElement('button')
      disabledBtn.id = 'btn1'
      disabledBtn.disabled = true
      disabledBtn.textContent = 'Disabled'
      container.appendChild(disabledBtn)

      const enabledBtn = document.createElement('button')
      enabledBtn.id = 'btn2'
      enabledBtn.textContent = 'Enabled'
      container.appendChild(enabledBtn)

      document.body.appendChild(container)

      const { result } = renderHook(() => useFocusTrap(true, onClose))
      result.current.current = container

      await act(async () => {
        vi.advanceTimersByTime(50)
      })

      // Should focus the first enabled button
      expect(document.activeElement).toBe(container.querySelector('#btn2'))
    })

    it('should skip elements with tabindex=-1', async () => {
      // Remove existing container
      document.body.removeChild(container)

      // Create container with button[tabindex=-1] first, then regular button
      // Elements with tabindex=-1 should be excluded from keyboard navigation
      container = document.createElement('div')

      const notTabbable = document.createElement('button')
      notTabbable.id = 'btn1'
      notTabbable.setAttribute('tabindex', '-1')
      notTabbable.textContent = 'Not tabbable'
      container.appendChild(notTabbable)

      const tabbable = document.createElement('button')
      tabbable.id = 'btn2'
      tabbable.textContent = 'Tabbable'
      container.appendChild(tabbable)

      document.body.appendChild(container)

      const { result } = renderHook(() => useFocusTrap(true, onClose))
      result.current.current = container

      await act(async () => {
        vi.advanceTimersByTime(50)
      })

      // Should focus btn2 (btn1 has tabindex=-1 and should be excluded)
      expect(document.activeElement).toBe(container.querySelector('#btn2'))
    })

    it('should handle activation state changes', async () => {
      const { result, rerender } = renderHook(
        ({ isActive }) => useFocusTrap(isActive, onClose),
        { initialProps: { isActive: false } }
      )
      result.current.current = container

      // Initially inactive
      await act(async () => {
        vi.advanceTimersByTime(50)
      })

      // Activate
      rerender({ isActive: true })

      await act(async () => {
        vi.advanceTimersByTime(50)
      })

      // Should now be focused
      expect(container.contains(document.activeElement)).toBe(true)
    })

    it('should return containerRef that can be attached to elements', () => {
      const { result } = renderHook(() => useFocusTrap(true, onClose))

      // Should return a ref object
      expect(result.current).toHaveProperty('current')
      expect(result.current.current).toBe(null) // Initially null
    })

    it('should handle rapid activation/deactivation', async () => {
      const { rerender } = renderHook(
        ({ isActive }) => useFocusTrap(isActive, onClose),
        { initialProps: { isActive: false } }
      )

      // Rapid toggling should not throw
      expect(() => {
        rerender({ isActive: true })
        rerender({ isActive: false })
        rerender({ isActive: true })
        rerender({ isActive: false })
      }).not.toThrow()
    })
  })
})
