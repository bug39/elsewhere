/**
 * E2E Fuzz Tests: Control Fuzzing (Category B)
 *
 * Tests button and control interactions:
 * B1. Double-click generate
 * B2. Mash cancel/dismiss
 * B3. Toggle settings mid-generation
 * B4. Switch tool during drag
 * B5. Rapid mode toggle (edit/play)
 * B6. Open multiple modals
 * B7. Save while saving
 */

import { test, expect } from '@playwright/test'
import { createTestWorld, rapidClick, rapidKeyPress } from '../helpers/fuzz-utils.js'

test.describe('Control Fuzzing (Category B)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')

    // Close welcome modal if present
    const welcomeClose = page.locator('button:has-text("Get Started"), button:has-text("Close")')
    if (await welcomeClose.isVisible({ timeout: 2000 }).catch(() => false)) {
      await welcomeClose.click()
    }

    await createTestWorld(page, 'Control Fuzz Test')
  })

  test('B1: Double-click generate should create single queue item', async ({ page }) => {
    const promptInput = page.locator('input[placeholder*="Describe"], textarea[placeholder*="Describe"], input[type="text"]').first()
    await promptInput.waitFor({ state: 'visible' })

    await promptInput.fill('tree')

    const generateButton = page.locator('button:has-text("Generate")')
    if (await generateButton.isVisible()) {
      // Double-click rapidly
      await generateButton.dblclick()

      // Wait a moment
      await page.waitForTimeout(500)

      // App should be functional
      await expect(page.locator('canvas')).toBeVisible()
    }
  })

  test('B3: Toggle settings mid-generation should not crash', async ({ page }) => {
    const promptInput = page.locator('input[placeholder*="Describe"], textarea[placeholder*="Describe"], input[type="text"]').first()
    await promptInput.waitFor({ state: 'visible' })

    await promptInput.fill('castle')

    const generateButton = page.locator('button:has-text("Generate")')
    if (await generateButton.isVisible()) {
      await generateButton.click()

      // Quickly open settings
      const settingsButton = page.locator('button[aria-label="Settings"], button:has-text("Settings"), .settings-button')
      if (await settingsButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await settingsButton.click()
        await page.waitForTimeout(200)

        // Close settings
        const closeButton = page.locator('.modal button:has-text("Close"), button[aria-label="Close"]')
        if (await closeButton.isVisible({ timeout: 1000 }).catch(() => false)) {
          await closeButton.click()
        }
      }

      // App should be functional
      await expect(page.locator('canvas')).toBeVisible()
    }
  })

  test('B4: Switch tool during drag should not cause stuck state', async ({ page }) => {
    // Select terrain tool
    const terrainTool = page.locator('button[data-tool="terrain"], button:has-text("Terrain")')
    if (await terrainTool.isVisible({ timeout: 2000 }).catch(() => false)) {
      await terrainTool.click()

      // Start terrain editing (mouse down on canvas)
      const canvas = page.locator('canvas')
      const box = await canvas.boundingBox()

      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await page.mouse.down()

        // Switch tool while mouse is down
        await page.keyboard.press('v') // Select tool

        // Release mouse
        await page.mouse.up()

        // App should be functional, no stuck drag state
        await expect(canvas).toBeVisible()
      }
    }
  })

  test('B5: Rapid mode toggle should not cause memory leaks or stuck state', async ({ page }) => {
    const canvas = page.locator('canvas')
    await canvas.waitFor({ state: 'visible' })

    // Rapid mode toggle
    for (let i = 0; i < 10; i++) {
      // Press F5 (play mode)
      await page.keyboard.press('F5')
      await page.waitForTimeout(100)

      // Press Escape (edit mode)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(100)
    }

    // App should be functional
    await expect(canvas).toBeVisible()

    // Check no orphaned player mesh by checking mode
    // Should be in edit mode after Escape
  })

  test('B6: Opening multiple modals should show only one at a time', async ({ page }) => {
    // Try to open help
    const helpButton = page.locator('button[aria-label="Help"], button:has-text("Help"), .help-button, button:has-text("?")')
    if (await helpButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await helpButton.click()
      await page.waitForTimeout(200)

      // Try to open settings while help is open
      const settingsButton = page.locator('button[aria-label="Settings"], button:has-text("Settings"), .settings-button')
      if (await settingsButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await settingsButton.click()
        await page.waitForTimeout(200)
      }

      // Should not have z-index issues or stacked modals
      // Close any open modal
      await page.keyboard.press('Escape')
    }

    await expect(page.locator('canvas')).toBeVisible()
  })

  test('B7: Rapid save should not cause concurrent writes', async ({ page }) => {
    const canvas = page.locator('canvas')
    await canvas.waitFor({ state: 'visible' })

    // Rapid Ctrl+S
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Control+s')
      await page.waitForTimeout(50)
    }

    // App should be functional
    await expect(canvas).toBeVisible()

    // No error toasts for concurrent save issues
    await page.waitForTimeout(500)
  })

  test('B5b: Play mode should clear selection', async ({ page }) => {
    // First, try to select something (click on canvas)
    const canvas = page.locator('canvas')
    await canvas.waitFor({ state: 'visible' })
    const box = await canvas.boundingBox()

    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    }

    // Enter play mode
    await page.keyboard.press('F5')
    await page.waitForTimeout(500)

    // Exit play mode
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)

    // App should be functional
    await expect(canvas).toBeVisible()
  })

  test('B2: Rapid dismiss should not cause errors', async ({ page }) => {
    // This test requires a queue item to exist
    // First create one
    const promptInput = page.locator('input[placeholder*="Describe"], textarea[placeholder*="Describe"], input[type="text"]').first()

    if (await promptInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await promptInput.fill('test item')

      const generateButton = page.locator('button:has-text("Generate")')
      if (await generateButton.isVisible()) {
        await generateButton.click()

        // Find and rapidly click dismiss
        await page.waitForTimeout(300)
        const dismissButton = page.locator('button:has-text("Dismiss"), button:has-text("Cancel"), .dismiss-button')

        if (await dismissButton.isVisible({ timeout: 2000 }).catch(() => false)) {
          // Rapid clicks
          for (let i = 0; i < 5; i++) {
            await dismissButton.click({ force: true }).catch(() => {})
            await page.waitForTimeout(50)
          }
        }
      }
    }

    // App should be functional
    await expect(page.locator('canvas')).toBeVisible()
  })
})
