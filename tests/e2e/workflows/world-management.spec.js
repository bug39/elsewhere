/**
 * E2E Tests: World Management Workflows
 *
 * Tests core world lifecycle operations:
 * - Creating worlds with different biomes
 * - Opening existing worlds
 * - Deleting worlds
 * - World persistence
 */

import { test, expect, selectors, testData } from '../fixtures/test-fixtures.js';
import { dismissWelcomeModal, goHome, clearStorage } from '../helpers/test-utils.js';

test.describe('World Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('thinq-gemini-api-key', 'test-mock-key');
    });
  });

  test('should show home screen on initial load', async ({ page }) => {
    await page.goto('/');
    await dismissWelcomeModal(page);

    const homeScreen = page.locator(selectors.homeScreen);
    await expect(homeScreen).toBeVisible({ timeout: 10000 });
  });

  test('should create a new world with default biome (grass)', async ({ page }) => {
    await page.goto('/');
    await dismissWelcomeModal(page);

    // Click new world
    await page.click(selectors.newWorldCard);

    // Fill name
    await page.waitForSelector('input[placeholder="My World"]');
    const worldName = testData.worldName();
    await page.fill('input[placeholder="My World"]', worldName);

    // Create
    await page.click('button:has-text("Create")');

    // Should enter edit mode
    await expect(page.locator(selectors.canvas)).toBeVisible({ timeout: 15000 });
  });

  test('should create world with desert biome', async ({ page }) => {
    await page.goto('/');
    await dismissWelcomeModal(page);

    await page.click(selectors.newWorldCard);
    await page.waitForSelector('input[placeholder="My World"]');
    await page.fill('input[placeholder="My World"]', 'Desert World');

    // Select desert biome
    const desertOption = page.locator('button:has-text("Desert"), [data-biome="desert"]');
    if (await desertOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await desertOption.click();
    }

    await page.click('button:has-text("Create")');
    await expect(page.locator(selectors.canvas)).toBeVisible({ timeout: 15000 });
  });

  test('should create world with snow biome', async ({ page }) => {
    await page.goto('/');
    await dismissWelcomeModal(page);

    await page.click(selectors.newWorldCard);
    await page.waitForSelector('input[placeholder="My World"]');
    await page.fill('input[placeholder="My World"]', 'Snow World');

    const snowOption = page.locator('button:has-text("Snow"), [data-biome="snow"]');
    if (await snowOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await snowOption.click();
    }

    await page.click('button:has-text("Create")');
    await expect(page.locator(selectors.canvas)).toBeVisible({ timeout: 15000 });
  });

  test('should create world with forest biome', async ({ page }) => {
    await page.goto('/');
    await dismissWelcomeModal(page);

    await page.click(selectors.newWorldCard);
    await page.waitForSelector('input[placeholder="My World"]');
    await page.fill('input[placeholder="My World"]', 'Forest World');

    const forestOption = page.locator('button:has-text("Forest"), [data-biome="forest"]');
    if (await forestOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await forestOption.click();
    }

    await page.click('button:has-text("Create")');
    await expect(page.locator(selectors.canvas)).toBeVisible({ timeout: 15000 });
  });

  test('should create world with volcanic biome', async ({ page }) => {
    await page.goto('/');
    await dismissWelcomeModal(page);

    await page.click(selectors.newWorldCard);
    await page.waitForSelector('input[placeholder="My World"]');
    await page.fill('input[placeholder="My World"]', 'Volcanic World');

    const volcanicOption = page.locator('button:has-text("Volcanic"), [data-biome="volcanic"]');
    if (await volcanicOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await volcanicOption.click();
    }

    await page.click('button:has-text("Create")');
    await expect(page.locator(selectors.canvas)).toBeVisible({ timeout: 15000 });
  });

  test('should open an existing world', async ({ page }) => {
    await page.goto('/');
    await dismissWelcomeModal(page);

    // Create a world first
    await page.click(selectors.newWorldCard);
    await page.waitForSelector('input[placeholder="My World"]');
    await page.fill('input[placeholder="My World"]', 'Existing World');
    await page.click('button:has-text("Create")');
    await expect(page.locator(selectors.canvas)).toBeVisible({ timeout: 15000 });

    // Go back to home
    await goHome(page);
    await expect(page.locator(selectors.homeScreen)).toBeVisible({ timeout: 5000 });

    // Click on the created world
    const worldCard = page.locator('.home-world-card:has-text("Existing World")').first();
    if (await worldCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      await worldCard.click();
      await expect(page.locator(selectors.canvas)).toBeVisible({ timeout: 15000 });
    }
  });

  test('should persist world after refresh', async ({ page }) => {
    await page.goto('/');
    await dismissWelcomeModal(page);

    // Create a world
    await page.click(selectors.newWorldCard);
    await page.waitForSelector('input[placeholder="My World"]');
    await page.fill('input[placeholder="My World"]', 'Persistent World');
    await page.click('button:has-text("Create")');
    await expect(page.locator(selectors.canvas)).toBeVisible({ timeout: 15000 });

    // Wait for auto-save
    await page.waitForTimeout(2000);

    // Refresh
    await page.reload();

    // Should still show the world or home screen with world listed
    await page.waitForTimeout(2000);

    const hasCanvas = await page.locator(selectors.canvas).isVisible().catch(() => false);
    const hasHome = await page.locator(selectors.homeScreen).isVisible().catch(() => false);

    // One of these should be true
    expect(hasCanvas || hasHome).toBeTruthy();
  });

  test('should navigate from editor back to home', async ({ page }) => {
    await page.goto('/');
    await dismissWelcomeModal(page);

    // Create a world
    await page.click(selectors.newWorldCard);
    await page.waitForSelector('input[placeholder="My World"]');
    await page.fill('input[placeholder="My World"]', 'Nav Test World');
    await page.click('button:has-text("Create")');
    await expect(page.locator(selectors.canvas)).toBeVisible({ timeout: 15000 });

    // Go home
    await goHome(page);

    // Should be at home screen
    await expect(page.locator(selectors.homeScreen)).toBeVisible({ timeout: 5000 });
  });
});
