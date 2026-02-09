/**
 * Common test utilities for E2E tests.
 *
 * Extends fuzz-utils.js with higher-level actions for workflow testing.
 * These helpers encapsulate common multi-step operations.
 */

// Re-export everything from fuzz-utils
export * from './fuzz-utils.js';

/**
 * Dismiss the welcome modal if it appears.
 * Safe to call even if modal isn't present.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
export async function dismissWelcomeModal(page) {
  const welcomeClose = page.locator('button:has-text("Get Started"), button:has-text("Close")');
  if (await welcomeClose.first().isVisible({ timeout: 2000 }).catch(() => false)) {
    await welcomeClose.first().click();
    await page.waitForTimeout(300); // Wait for modal animation
  }
}

/**
 * Enter edit mode by creating a new world or opening an existing one.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} options
 * @param {string} [options.worldName='Test World'] - Name for new world
 * @param {string} [options.biome='grass'] - Biome for new world
 * @param {boolean} [options.openExisting=false] - If true, opens first existing world
 * @returns {Promise<void>}
 */
export async function enterEditMode(page, options = {}) {
  const { worldName = 'Test World', biome = 'grass', openExisting = false } = options;

  await page.goto('/');
  await dismissWelcomeModal(page);

  if (openExisting) {
    // Click on first existing world card
    const worldCard = page.locator('.home-world-card').first();
    if (await worldCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      await worldCard.click();
    } else {
      // No existing world, create one
      await createNewWorld(page, worldName, biome);
    }
  } else {
    await createNewWorld(page, worldName, biome);
  }

  // Wait for editor to load
  await page.waitForSelector('canvas', { timeout: 15000 });
  // Additional wait for Three.js initialization
  await page.waitForTimeout(500);
}

/**
 * Create a new world from the home screen.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} name - World name
 * @param {string} biome - Biome type
 * @returns {Promise<void>}
 */
async function createNewWorld(page, name, biome) {
  // Click the New World card
  await page.click('.home-new-world');

  // Wait for and fill the modal
  await page.waitForSelector('input[placeholder="My World"]', { timeout: 5000 });
  await page.fill('input[placeholder="My World"]', name);

  // Select biome if not default
  if (biome !== 'grass') {
    const biomeButton = page.locator(`button:has-text("${biome}"), [data-biome="${biome}"]`);
    if (await biomeButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await biomeButton.click();
    }
  }

  // Create world
  await page.click('button:has-text("Create")');
}

/**
 * Enter play mode from edit mode.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
export async function enterPlayMode(page) {
  const playButton = page.locator('[data-walkthrough="play-button"], button:has-text("Play")');
  await playButton.click();

  // Wait for play mode to initialize (player controller spawns)
  await page.waitForTimeout(1000);

  // Verify we're in play mode by checking for stop button
  await page.waitForSelector('button:has-text("Stop")', { timeout: 5000 });
}

/**
 * Exit play mode back to edit mode.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
export async function exitPlayMode(page) {
  const stopButton = page.locator('button:has-text("Stop")');
  await stopButton.click();

  // Wait for edit mode UI to return
  await page.waitForSelector('[data-walkthrough="play-button"], button:has-text("Play")', { timeout: 5000 });
}

/**
 * Generate an asset using the generation panel.
 * Does NOT accept the asset - use acceptAsset() after.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} prompt - Asset description
 * @returns {Promise<void>}
 */
export async function generateAsset(page, prompt) {
  // Find and fill the generation input
  const input = page.locator('[data-walkthrough="generation-input"], input[placeholder*="Describe"]').first();
  await input.fill(prompt);

  // Click generate
  const generateButton = page.locator('[data-walkthrough="generation-submit"], button:has-text("Generate")').first();
  await generateButton.click();
}

/**
 * Wait for asset generation to complete and open review modal.
 * The app shows a "Ready" state in queue with Review button - we click it.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} timeout - Max wait time in ms
 * @returns {Promise<void>}
 */
export async function waitForGeneration(page, timeout = 30000) {
  // First wait for either the review button in queue, review modal, or error
  const result = await Promise.race([
    page.waitForSelector('[data-walkthrough="review-modal"]', { timeout }).then(() => 'modal'),
    page.waitForSelector('button:has-text("Review")', { timeout }).then(() => 'review-button'),
    page.waitForSelector('.toast-error, .toast-message:has-text("Error")', { timeout }).then(() => 'error')
  ]).catch(() => 'timeout');

  // If we got the review button, click it to open modal
  if (result === 'review-button') {
    const reviewButton = page.locator('button:has-text("Review")').first();
    await reviewButton.click();
    // Wait for review modal to open
    await page.waitForSelector('[data-walkthrough="review-modal"]', { timeout: 5000 });
  }
  // If modal or error, we're done (or will handle error elsewhere)
}

/**
 * Accept an asset from the review modal.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
export async function acceptAsset(page) {
  // Click the Accept button in the review modal
  const acceptButton = page.locator('[data-walkthrough="review-modal"] button:has-text("Accept")').first();
  await acceptButton.click();

  // Wait for modal to close
  await page.waitForSelector('[data-walkthrough="review-modal"]', { state: 'hidden', timeout: 5000 });
}

/**
 * Reject an asset from the review modal.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
export async function rejectAsset(page) {
  const rejectButton = page.locator('[data-walkthrough="review-modal"] button:has-text("Discard")').first();
  await rejectButton.click();

  // Wait for modal to close
  await page.waitForSelector('[data-walkthrough="review-modal"]', { state: 'hidden', timeout: 5000 });
}

/**
 * Close the review modal (X button).
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
export async function closeReviewModal(page) {
  const closeButton = page.locator('[data-walkthrough="review-modal"] button[aria-label*="Close"]').first();
  await closeButton.click();

  await page.waitForSelector('[data-walkthrough="review-modal"]', { state: 'hidden', timeout: 5000 });
}

/**
 * Place an asset from the library into the viewport.
 * Uses drag and drop or click-to-place depending on UI mode.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string|number} assetIdentifier - Asset name or index (0-based)
 * @returns {Promise<void>}
 */
export async function placeAsset(page, assetIdentifier) {
  let assetItem;

  if (typeof assetIdentifier === 'number') {
    assetItem = page.locator('.library-item').nth(assetIdentifier);
  } else {
    assetItem = page.locator(`.library-item:has-text("${assetIdentifier}")`).first();
  }

  // Double-click to place at center, or drag to viewport
  const canvas = page.locator('canvas');
  const canvasBox = await canvas.boundingBox();
  const itemBox = await assetItem.boundingBox();

  if (canvasBox && itemBox) {
    // Drag from library to center of viewport
    await page.mouse.move(itemBox.x + itemBox.width / 2, itemBox.y + itemBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2, { steps: 10 });
    await page.mouse.up();
  }

  // Wait for placement
  await page.waitForTimeout(300);
}

/**
 * Select an instance in the viewport by clicking on it.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} options
 * @param {number} [options.x] - Click X position (viewport coords)
 * @param {number} [options.y] - Click Y position (viewport coords)
 * @param {number} [options.index] - Instance index (uses center if no coords)
 * @returns {Promise<void>}
 */
export async function selectInstance(page, options = {}) {
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();

  if (!box) throw new Error('Canvas not found');

  // Default to center of viewport
  const x = options.x ?? box.x + box.width / 2;
  const y = options.y ?? box.y + box.height / 2;

  // Select tool first
  await selectTool(page, 'select');

  await page.mouse.click(x, y);
  await page.waitForTimeout(200);
}

/**
 * Select an editor tool by clicking its button.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'select' | 'place' | 'paint' | 'terrain' | 'delete'} tool
 * @returns {Promise<void>}
 */
export async function selectTool(page, tool) {
  // Try data-tool attribute first, then button text
  const toolButton = page.locator(`button[data-tool="${tool}"], button:has-text("${tool}")`).first();
  if (await toolButton.isVisible({ timeout: 1000 }).catch(() => false)) {
    await toolButton.click();
  } else {
    // Use keyboard shortcut
    const shortcuts = { select: 'v', place: 'p', paint: 'b', terrain: 't', delete: 'x' };
    if (shortcuts[tool]) {
      await page.keyboard.press(shortcuts[tool]);
    }
  }
}

/**
 * Open the part editor for the selected instance.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
export async function openPartEditor(page) {
  const editPartsButton = page.locator('button:has-text("Edit Parts")');
  await editPartsButton.click();

  // Wait for part editor to open
  await page.waitForSelector('.part-editor, .parts-editor', { timeout: 5000 });
}

/**
 * Open the dialogue editor for the selected NPC.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
export async function openDialogueEditor(page) {
  const editDialogueButton = page.locator('button:has-text("Edit Dialogue")');
  await editDialogueButton.click();

  // Wait for dialogue editor to open
  await page.waitForSelector('.dialogue-editor, .react-flow', { timeout: 5000 });
}

/**
 * Close any open modal/editor.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
export async function closeModal(page) {
  // Try various close methods
  const closeButton = page.locator('.modal-close, button[aria-label*="Close"], button:has-text("Close")').first();

  if (await closeButton.isVisible({ timeout: 1000 }).catch(() => false)) {
    await closeButton.click();
  } else {
    // Try pressing Escape
    await page.keyboard.press('Escape');
  }

  await page.waitForTimeout(300);
}

/**
 * Wait for a toast message to appear.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} text - Text to match (partial)
 * @param {number} timeout - Max wait time
 * @returns {Promise<void>}
 */
export async function waitForToast(page, text, timeout = 5000) {
  await page.waitForSelector(`.toast-message:has-text("${text}")`, { timeout });
}

/**
 * Wait for toast to disappear.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} timeout
 * @returns {Promise<void>}
 */
export async function waitForToastDismiss(page, timeout = 10000) {
  await page.waitForSelector('.toast-message', { state: 'hidden', timeout });
}

/**
 * Perform undo action.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
export async function undo(page) {
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(200);
}

/**
 * Perform redo action.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
export async function redo(page) {
  await page.keyboard.press('Meta+Shift+z');
  await page.waitForTimeout(200);
}

/**
 * Delete the currently selected instance.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
export async function deleteSelected(page) {
  await page.keyboard.press('Delete');
  await page.waitForTimeout(200);
}

/**
 * Get the count of items in the asset library.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number>}
 */
export async function getLibraryItemCount(page) {
  return await page.locator('.library-item').count();
}

/**
 * Get the count of placed instances in the world.
 * Uses evaluation in browser context.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number>}
 */
export async function getInstanceCount(page) {
  return await page.evaluate(() => {
    // Access world state if available
    const worldState = window.__thinqWorld?.placedAssets?.length;
    if (worldState !== undefined) return worldState;

    // Fallback: count instance markers
    return document.querySelectorAll('.instance-marker').length;
  });
}

/**
 * Check if an element is focused.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} selector
 * @returns {Promise<boolean>}
 */
export async function isFocused(page, selector) {
  return await page.evaluate((sel) => {
    return document.activeElement === document.querySelector(sel);
  }, selector);
}

/**
 * Navigate to home screen from edit mode.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
export async function goHome(page) {
  const homeButton = page.locator('.header-logo, [aria-label="Go to home screen"]').first();
  await homeButton.click();

  // Wait for home screen
  await page.waitForSelector('.home-screen, .home-new-world', { timeout: 5000 });
}

/**
 * Open settings modal.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
export async function openSettings(page) {
  const settingsButton = page.locator('[aria-label="Settings"], button:has-text("Settings")').first();
  await settingsButton.click();

  await page.waitForSelector('.settings-modal, [aria-labelledby="settings-modal-title"]', { timeout: 5000 });
}

/**
 * Collapse a panel by clicking its collapse button.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'library' | 'inspector'} panel
 * @returns {Promise<void>}
 */
export async function collapsePanel(page, panel) {
  const selector = panel === 'library'
    ? '.library-panel [aria-label*="Collapse"], .library-header button'
    : '.inspector-panel [aria-label*="Collapse"], .inspector-header button';

  const button = page.locator(selector).first();
  await button.click();
  await page.waitForTimeout(300);
}

/**
 * Expand a collapsed panel.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'library' | 'inspector'} panel
 * @returns {Promise<void>}
 */
export async function expandPanel(page, panel) {
  const selector = panel === 'library'
    ? '.library-panel [aria-label*="Expand"], .library-collapsed'
    : '.inspector-panel [aria-label*="Expand"], .inspector-collapsed';

  const button = page.locator(selector).first();
  if (await button.isVisible({ timeout: 1000 }).catch(() => false)) {
    await button.click();
    await page.waitForTimeout(300);
  }
}

/**
 * Clear all browser storage (localStorage, IndexedDB).
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
export async function clearStorage(page) {
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();

    // Clear IndexedDB
    const databases = await indexedDB.databases?.() || [];
    for (const db of databases) {
      if (db.name) {
        indexedDB.deleteDatabase(db.name);
      }
    }
  });
}

/**
 * Verify the canvas is rendering (WebGL context is valid).
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<boolean>}
 */
export async function isCanvasRendering(page) {
  return await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return false;

    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return gl && !gl.isContextLost();
  });
}

/**
 * Simulate player movement in play mode.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'w' | 'a' | 's' | 'd'} direction
 * @param {number} durationMs
 * @returns {Promise<void>}
 */
export async function movePlayer(page, direction, durationMs = 500) {
  await page.keyboard.down(direction);
  await page.waitForTimeout(durationMs);
  await page.keyboard.up(direction);
}
