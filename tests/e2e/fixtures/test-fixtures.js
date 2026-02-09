/**
 * Playwright test fixtures for E2E tests.
 *
 * Provides reusable test setup including:
 * - Cleared storage state (fresh start)
 * - Mock API key configured
 * - API mocking set up
 * - Pre-created test world
 */

import { test as base, expect } from '@playwright/test';
import { mockGeminiAPI, setMockApiKey } from './api-mocks.js';

/**
 * Extended test type with custom fixtures.
 */
export const test = base.extend({
  /**
   * Page with cleared storage - use for tests that need a fresh start.
   */
  cleanPage: async ({ page }, use) => {
    // Clear storage before navigation
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    await use(page);
  },

  /**
   * Page with mock API key set - use for most tests.
   */
  authedPage: async ({ page }, use) => {
    // Set mock API key before page loads
    await setMockApiKey(page);

    await use(page);
  },

  /**
   * Page with API mocking enabled - use for generation tests.
   */
  mockedPage: async ({ page }, use) => {
    await setMockApiKey(page);
    await mockGeminiAPI(page);

    await use(page);
  },

  /**
   * Pre-created world in edit mode - for tests that need to start in editor.
   * Skips the home screen and world creation flow.
   */
  editModePage: async ({ page }, use) => {
    await setMockApiKey(page);
    await mockGeminiAPI(page);

    await page.goto('/');

    // Dismiss welcome modal if present
    const welcomeClose = page.locator('button:has-text("Get Started"), button:has-text("Close")');
    if (await welcomeClose.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await welcomeClose.first().click();
    }

    // Create a test world
    await page.click('.home-new-world');
    await page.waitForSelector('input[placeholder="My World"]', { timeout: 5000 });
    await page.fill('input[placeholder="My World"]', 'E2E Test World');
    await page.click('button:has-text("Create")');

    // Wait for editor to fully load
    await page.waitForSelector('canvas', { timeout: 15000 });
    await page.waitForTimeout(500);

    await use(page);
  },

  /**
   * Page with a library asset pre-added - for placement and inspector tests.
   */
  pageWithAsset: async ({ page }, use) => {
    await setMockApiKey(page);
    await mockGeminiAPI(page, { delayMs: 50 });

    await page.goto('/');

    // Dismiss welcome modal
    const welcomeClose = page.locator('button:has-text("Get Started"), button:has-text("Close")');
    if (await welcomeClose.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await welcomeClose.first().click();
    }

    // Create world
    await page.click('.home-new-world');
    await page.waitForSelector('input[placeholder="My World"]', { timeout: 5000 });
    await page.fill('input[placeholder="My World"]', 'Asset Test World');
    await page.click('button:has-text("Create")');
    await page.waitForSelector('canvas', { timeout: 15000 });

    // Generate and accept an asset
    const input = page.locator('[data-walkthrough="generation-input"]').first();
    await input.fill('simple rock');

    const generateButton = page.locator('[data-walkthrough="generation-submit"]').first();
    await generateButton.click();

    // Wait for either review modal or Review button in queue
    const result = await Promise.race([
      page.waitForSelector('[data-walkthrough="review-modal"]', { timeout: 30000 }).then(() => 'modal'),
      page.waitForSelector('button:has-text("Review")', { timeout: 30000 }).then(() => 'review-button')
    ]).catch(() => 'timeout');

    // If Review button, click it to open modal
    if (result === 'review-button') {
      await page.locator('button:has-text("Review")').first().click();
      await page.waitForSelector('[data-walkthrough="review-modal"]', { timeout: 5000 });
    }

    // Accept the asset
    const acceptButton = page.locator('[data-walkthrough="review-modal"] button:has-text("Accept")').first();
    await acceptButton.click();

    // Wait for asset to appear in library
    await page.waitForSelector('.library-item', { timeout: 5000 });

    await use(page);
  },

  /**
   * Page with a character NPC asset - for NPC-specific tests.
   */
  pageWithNPC: async ({ page }, use) => {
    await setMockApiKey(page);
    await mockGeminiAPI(page, { delayMs: 50 });

    await page.goto('/');

    // Dismiss welcome modal
    const welcomeClose = page.locator('button:has-text("Get Started"), button:has-text("Close")');
    if (await welcomeClose.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await welcomeClose.first().click();
    }

    // Create world
    await page.click('.home-new-world');
    await page.waitForSelector('input[placeholder="My World"]', { timeout: 5000 });
    await page.fill('input[placeholder="My World"]', 'NPC Test World');
    await page.click('button:has-text("Create")');
    await page.waitForSelector('canvas', { timeout: 15000 });

    // Generate and accept a character asset
    const input = page.locator('[data-walkthrough="generation-input"]').first();
    await input.fill('simple knight character');

    const generateButton = page.locator('[data-walkthrough="generation-submit"]').first();
    await generateButton.click();

    // Wait for either review modal or Review button in queue
    const result = await Promise.race([
      page.waitForSelector('[data-walkthrough="review-modal"]', { timeout: 30000 }).then(() => 'modal'),
      page.waitForSelector('button:has-text("Review")', { timeout: 30000 }).then(() => 'review-button')
    ]).catch(() => 'timeout');

    // If Review button, click it to open modal
    if (result === 'review-button') {
      await page.locator('button:has-text("Review")').first().click();
      await page.waitForSelector('[data-walkthrough="review-modal"]', { timeout: 5000 });
    }

    // Accept the asset
    const acceptButton = page.locator('[data-walkthrough="review-modal"] button:has-text("Accept")').first();
    await acceptButton.click();

    // Wait for asset to appear in library
    await page.waitForSelector('.library-item', { timeout: 5000 });

    await use(page);
  }
});

/**
 * Re-export expect for convenience.
 */
export { expect };

/**
 * Test configuration presets.
 */
export const testConfig = {
  /**
   * Shorter timeout for fast tests.
   */
  fast: {
    timeout: 30000
  },

  /**
   * Longer timeout for generation tests.
   */
  generation: {
    timeout: 60000
  },

  /**
   * Extended timeout for complex workflows.
   */
  workflow: {
    timeout: 120000
  }
};

/**
 * Common selectors used across tests.
 */
export const selectors = {
  // Home screen
  homeScreen: '.home-screen',
  newWorldCard: '.home-new-world',
  worldCard: '.home-world-card',

  // Editor
  canvas: 'canvas',
  toolbar: '.toolbar',
  libraryPanel: '.library-panel',
  inspectorPanel: '.inspector-panel',

  // Generation
  generationInput: '[data-walkthrough="generation-input"]',
  generateButton: '[data-walkthrough="generation-submit"]',
  reviewModal: '[data-walkthrough="review-modal"]',

  // Library
  libraryItem: '.library-item',
  libraryEmpty: '.library-empty',

  // Inspector
  inspectorContent: '.inspector-content',
  inspectorEmpty: '.inspector-empty',

  // Play mode
  playButton: '[data-walkthrough="play-button"]',
  stopButton: 'button:has-text("Stop")',

  // Modals
  settingsModal: '.settings-modal',
  dialogueEditor: '.dialogue-editor, .react-flow',
  partEditor: '.part-editor, .parts-editor',

  // Common
  toast: '.toast-message',
  modalClose: '.modal-close, button[aria-label*="Close"]'
};

/**
 * Test data generators.
 */
export const testData = {
  /**
   * Generate a unique world name.
   */
  worldName: () => `Test World ${Date.now().toString(36)}`,

  /**
   * Asset prompts by category.
   */
  prompts: {
    rock: 'simple rock boulder',
    tree: 'leafy tree with trunk',
    character: 'knight with armor',
    dragon: 'red dragon creature',
    building: 'small cottage house'
  }
};
