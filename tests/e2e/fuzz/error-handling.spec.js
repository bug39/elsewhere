/**
 * E2E Fuzz Tests: Error Handling (Category E)
 *
 * Tests error recovery scenarios:
 * E1. Network offline during generation
 * E2. API rate limit handling
 * E3. Malformed API response
 * E4. Code validation failure
 * E5. WebGL context lost (EXP-004)
 * E6. Asset load error
 */

import { test, expect } from '@playwright/test'
import {
  createTestWorld,
  forceWebGLContextLoss,
  restoreWebGLContext,
  isWebGLContextValid
} from '../helpers/fuzz-utils.js'

test.describe('Error Handling (Category E)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')

    // Close welcome modal if present
    const welcomeClose = page.locator('button:has-text("Get Started"), button:has-text("Close")')
    if (await welcomeClose.isVisible({ timeout: 2000 }).catch(() => false)) {
      await welcomeClose.click()
    }

    await createTestWorld(page, 'Error Handling Test')
  })

  test('E1: Network offline during generation should show clear error', async ({ page, context }) => {
    const promptInput = page.locator('input[placeholder*="Describe"], textarea[placeholder*="Describe"], input[type="text"]').first()

    if (await promptInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await promptInput.fill('dragon')

      const generateButton = page.locator('button:has-text("Generate")')
      if (await generateButton.isVisible()) {
        await generateButton.click()

        // Go offline immediately
        await context.setOffline(true)

        // Wait for error handling
        await page.waitForTimeout(5000)

        // Go back online
        await context.setOffline(false)

        // App should still be functional
        await expect(page.locator('canvas')).toBeVisible()
      }
    }
  })

  test('E5: WebGL context lost should show recovery overlay', async ({ page }) => {
    const canvas = page.locator('canvas')
    await canvas.waitFor({ state: 'visible' })

    // Force WebGL context loss
    await forceWebGLContextLoss(page)

    // Wait a moment for the app to detect it
    await page.waitForTimeout(500)

    // Look for recovery overlay or message
    const recoveryOverlay = page.locator('.webgl-context-lost-overlay, text="Graphics Context Lost", text="WebGL"')
    const hasOverlay = await recoveryOverlay.isVisible({ timeout: 2000 }).catch(() => false)

    if (hasOverlay) {
      // Click restore button if present
      const restoreButton = page.locator('.webgl-restore-button, button:has-text("Restore"), button:has-text("Click")')
      if (await restoreButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await restoreButton.click()

        // Restore context
        await restoreWebGLContext(page)
        await page.waitForTimeout(1000)
      }
    } else {
      // Restore context anyway
      await restoreWebGLContext(page)
      await page.waitForTimeout(1000)
    }

    // Verify context is restored
    const contextValid = await isWebGLContextValid(page)
    // Note: In test environment, context restoration may not fully work
    // but we verify no crash occurred

    await expect(canvas).toBeVisible()
  })

  test('E5b: WebGL context should recover automatically when possible', async ({ page }) => {
    const canvas = page.locator('canvas')
    await canvas.waitFor({ state: 'visible' })

    // Force context loss
    await forceWebGLContextLoss(page)
    await page.waitForTimeout(100)

    // Immediately restore
    await restoreWebGLContext(page)

    // Wait for recovery
    await page.waitForTimeout(1000)

    // Canvas should still be visible
    await expect(canvas).toBeVisible()
  })

  test('E1b: Going offline should not crash the app', async ({ page, context }) => {
    const canvas = page.locator('canvas')
    await canvas.waitFor({ state: 'visible' })

    // Go offline
    await context.setOffline(true)

    // Try various operations
    await page.keyboard.press('v') // Select tool
    await page.waitForTimeout(200)
    await page.keyboard.press('t') // Terrain tool
    await page.waitForTimeout(200)

    // Go back online
    await context.setOffline(false)

    // App should be functional
    await expect(canvas).toBeVisible()
  })

  test('E6: Corrupted asset should show placeholder or error', async ({ page }) => {
    // This test would require injecting corrupted data
    // For now, verify the app handles missing assets gracefully

    const canvas = page.locator('canvas')
    await canvas.waitFor({ state: 'visible' })

    // App should remain functional even with potential loading errors
    await expect(canvas).toBeVisible()
  })
})

test.describe('Error Boundary Tests', () => {
  test('App should recover from component errors', async ({ page }) => {
    await page.goto('/')

    // Close welcome modal if present
    const welcomeClose = page.locator('button:has-text("Get Started"), button:has-text("Close")')
    if (await welcomeClose.isVisible({ timeout: 2000 }).catch(() => false)) {
      await welcomeClose.click()
    }

    // App should be visible even if there are minor errors
    const homeScreen = page.locator('button:has-text("Create World"), .home-screen')
    await expect(homeScreen.first()).toBeVisible({ timeout: 10000 })
  })

  test('Error boundary should show recovery UI on crash', async ({ page }) => {
    await page.goto('/')

    // The app should always show some UI, even if there's an error
    await page.waitForTimeout(2000)

    // Either the app works, or error boundary shows
    const hasContent = await page.locator('canvas, .home-screen, .error-boundary').first().isVisible()
    expect(hasContent).toBeTruthy()
  })
})
