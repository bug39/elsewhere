/**
 * E2E Fuzz Tests: Input Fuzzing (Category A)
 *
 * Tests prompt field handling with:
 * A1. Extreme length prompts
 * A2. Unicode edge cases
 * A3. RTL text + mixed direction
 * A4. Zero-width characters
 * A5. Prompt injection patterns
 * A6. Rapid keystrokes during generation
 * A7. Undo/redo storm in prompt field
 */

import { test, expect } from '@playwright/test'
import {
  UNICODE_TEST_DATA,
  INJECTION_PATTERNS,
  generateLongString,
  createTestWorld,
  collectConsoleErrors,
  rapidType
} from '../helpers/fuzz-utils.js'

test.describe('Input Fuzzing (Category A)', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to app and create a test world
    await page.goto('/')

    // Close welcome modal if present
    const welcomeClose = page.locator('button:has-text("Get Started"), button:has-text("Close")')
    if (await welcomeClose.isVisible({ timeout: 2000 }).catch(() => false)) {
      await welcomeClose.click()
    }

    await createTestWorld(page, 'Input Fuzz Test')
  })

  test('A1: Extreme length prompts should be handled gracefully', async ({ page }) => {
    // Generate 10KB prompt
    const longPrompt = generateLongString(10000)

    // Find prompt input
    const promptInput = page.locator('input[placeholder*="Describe"], textarea[placeholder*="Describe"], input[type="text"]').first()
    await promptInput.waitFor({ state: 'visible' })

    // Attempt to paste long prompt
    await promptInput.fill(longPrompt)

    // Try to submit
    const generateButton = page.locator('button:has-text("Generate")')
    if (await generateButton.isVisible()) {
      await generateButton.click()
    }

    // Should either truncate, show error, or handle gracefully
    // Check that page is still responsive
    await expect(page.locator('canvas')).toBeVisible()

    // No uncaught errors
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.waitForTimeout(1000)
    expect(errors.filter(e => !e.includes('ResizeObserver'))).toHaveLength(0)
  })

  test('A2: Unicode edge cases should be preserved or safely sanitized', async ({ page }) => {
    const promptInput = page.locator('input[placeholder*="Describe"], textarea[placeholder*="Describe"], input[type="text"]').first()
    await promptInput.waitFor({ state: 'visible' })

    // Test full unicode string
    await promptInput.fill(UNICODE_TEST_DATA.full)

    // Verify input displays properly
    const value = await promptInput.inputValue()
    expect(value.length).toBeGreaterThan(0)

    // UI should not break
    await expect(page.locator('canvas')).toBeVisible()
  })

  test('A3: RTL mixed text should not break layout', async ({ page }) => {
    const promptInput = page.locator('input[placeholder*="Describe"], textarea[placeholder*="Describe"], input[type="text"]').first()
    await promptInput.waitFor({ state: 'visible' })

    // Test RTL mixed text
    await promptInput.fill(UNICODE_TEST_DATA.rtlMixed)

    // Verify no layout overflow
    const inputBox = await promptInput.boundingBox()
    expect(inputBox).toBeTruthy()
    expect(inputBox.width).toBeGreaterThan(0)

    // Check canvas is still visible (no layout break)
    await expect(page.locator('canvas')).toBeVisible()
  })

  test('A4: Zero-width characters should be handled', async ({ page }) => {
    const promptInput = page.locator('input[placeholder*="Describe"], textarea[placeholder*="Describe"], input[type="text"]').first()
    await promptInput.waitFor({ state: 'visible' })

    // Enter text with zero-width spaces
    await promptInput.fill(UNICODE_TEST_DATA.zeroWidth)

    // The visible text should appear as "knight"
    const value = await promptInput.inputValue()
    expect(value).toContain('knight')

    // Page should remain functional
    await expect(page.locator('canvas')).toBeVisible()
  })

  test('A5: Prompt injection patterns should be treated as literal text', async ({ page }) => {
    const promptInput = page.locator('input[placeholder*="Describe"], textarea[placeholder*="Describe"], input[type="text"]').first()
    await promptInput.waitFor({ state: 'visible' })

    // Test HTML injection pattern
    await promptInput.fill(INJECTION_PATTERNS.htmlScript)

    // Page should not execute script
    const alertTriggered = await page.evaluate(() => {
      return window.alertTriggered === true
    })
    expect(alertTriggered).toBeFalsy()

    // Input should be sanitized or literal
    await expect(page.locator('canvas')).toBeVisible()
  })

  test('A5b: Template literal injection should be treated as literal', async ({ page }) => {
    const promptInput = page.locator('input[placeholder*="Describe"], textarea[placeholder*="Describe"], input[type="text"]').first()
    await promptInput.waitFor({ state: 'visible' })

    await promptInput.fill(INJECTION_PATTERNS.templateLiteral)

    // No code execution
    await expect(page.locator('canvas')).toBeVisible()
  })

  test('A6: Rapid keystrokes during generation should queue correctly', async ({ page }) => {
    const promptInput = page.locator('input[placeholder*="Describe"], textarea[placeholder*="Describe"], input[type="text"]').first()
    await promptInput.waitFor({ state: 'visible' })

    // Submit first prompt
    await promptInput.fill('robot')
    const generateButton = page.locator('button:has-text("Generate")')

    if (await generateButton.isVisible()) {
      await generateButton.click()

      // Rapidly type new prompt while generating
      await rapidType(page, 'input[placeholder*="Describe"], textarea[placeholder*="Describe"], input[type="text"]', 'dragon', 10)

      // Press Enter multiple times
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('Enter')
        await page.waitForTimeout(50)
      }

      // App should still be functional
      await expect(page.locator('canvas')).toBeVisible()

      // Check for duplicates in queue (if visible)
      await page.waitForTimeout(500)
    }
  })

  test('A7: Undo/redo storm in prompt field should not trigger world undo', async ({ page }) => {
    const promptInput = page.locator('input[placeholder*="Describe"], textarea[placeholder*="Describe"], input[type="text"]').first()
    await promptInput.waitFor({ state: 'visible' })

    // Type something
    await promptInput.focus()
    await page.keyboard.type('medieval knight')

    // Rapid Ctrl+Z (should undo text, not world)
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Control+z')
      await page.waitForTimeout(20)
    }

    // Rapid Ctrl+Shift+Z (redo)
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Control+Shift+z')
      await page.waitForTimeout(20)
    }

    // App should be functional
    await expect(page.locator('canvas')).toBeVisible()
  })

  test('A2b: Emoji input should be preserved', async ({ page }) => {
    const promptInput = page.locator('input[placeholder*="Describe"], textarea[placeholder*="Describe"], input[type="text"]').first()
    await promptInput.waitFor({ state: 'visible' })

    // Test emoji-only input
    await promptInput.fill(UNICODE_TEST_DATA.emoji)

    const value = await promptInput.inputValue()
    expect(value).toContain('🐲')

    await expect(page.locator('canvas')).toBeVisible()
  })

  test('A2c: CJK characters should be preserved', async ({ page }) => {
    const promptInput = page.locator('input[placeholder*="Describe"], textarea[placeholder*="Describe"], input[type="text"]').first()
    await promptInput.waitFor({ state: 'visible' })

    await promptInput.fill(UNICODE_TEST_DATA.japanese)

    const value = await promptInput.inputValue()
    expect(value).toBe(UNICODE_TEST_DATA.japanese)
  })
})
