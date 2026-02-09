/**
 * API mocking utilities for E2E tests.
 *
 * Provides route handlers that intercept Gemini API calls and return
 * deterministic mock responses for fast, reliable E2E testing.
 */

import { getMockAssetCode } from './mock-assets.js';

// Base URL for Gemini API
const GEMINI_API_PATTERN = '**/generativelanguage.googleapis.com/**';

/**
 * Create a mock Gemini API response for asset generation.
 * Returns raw Three.js code that the generator can execute directly.
 *
 * The generator pipeline tries schema compilation first, then falls back
 * to direct code execution. By returning code in a javascript code block,
 * we bypass schema compilation and use the direct code path.
 *
 * @param {string} prompt - The generation prompt
 * @returns {object} - Mock API response body
 */
function createMockAssetResponse(prompt) {
  const assetCode = getMockAssetCode(prompt);

  // Return raw Three.js code wrapped in a javascript code block
  // This triggers the direct code execution path in AssetGenerator
  const codeResponse = '```javascript\n' + assetCode.trim() + '\n```';

  // Wrap in Gemini API response format
  return {
    candidates: [{
      content: {
        parts: [{
          text: codeResponse
        }]
      },
      finishReason: 'STOP'
    }],
    usageMetadata: {
      promptTokenCount: 100,
      candidatesTokenCount: 200,
      totalTokenCount: 300
    }
  };
}

/**
 * Create an error response from the Gemini API.
 *
 * @param {'rate_limit' | 'server_error' | 'bad_request' | 'auth'} errorType
 * @returns {{ status: number, body: object }}
 */
function createMockErrorResponse(errorType) {
  switch (errorType) {
    case 'rate_limit':
      return {
        status: 429,
        body: {
          error: {
            code: 429,
            message: 'Resource exhausted. Please try again later.',
            status: 'RESOURCE_EXHAUSTED'
          }
        }
      };

    case 'server_error':
      return {
        status: 503,
        body: {
          error: {
            code: 503,
            message: 'Service temporarily unavailable.',
            status: 'UNAVAILABLE'
          }
        }
      };

    case 'bad_request':
      return {
        status: 400,
        body: {
          error: {
            code: 400,
            message: 'Invalid request: prompt cannot be empty.',
            status: 'INVALID_ARGUMENT'
          }
        }
      };

    case 'auth':
      return {
        status: 401,
        body: {
          error: {
            code: 401,
            message: 'API key not valid.',
            status: 'UNAUTHENTICATED'
          }
        }
      };

    default:
      return {
        status: 500,
        body: {
          error: {
            code: 500,
            message: 'Internal server error.',
            status: 'INTERNAL'
          }
        }
      };
  }
}

/**
 * Mock the Gemini API to return successful asset generation responses.
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {object} options - Configuration options
 * @param {number} [options.delayMs=100] - Response delay in ms
 * @param {string} [options.defaultCategory='props'] - Default asset category
 * @returns {Promise<void>}
 */
export async function mockGeminiAPI(page, options = {}) {
  const { delayMs = 100 } = options;

  await page.route(GEMINI_API_PATTERN, async (route, request) => {
    // Extract prompt from request body if possible
    let prompt = 'generic';
    try {
      const body = request.postDataJSON();
      if (body?.contents?.[0]?.parts?.[0]?.text) {
        prompt = body.contents[0].parts[0].text;
      }
    } catch {
      // Ignore parse errors
    }

    // Add artificial delay to simulate network
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    const response = createMockAssetResponse(prompt);

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response)
    });
  });
}

/**
 * Mock the Gemini API to return error responses.
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {'rate_limit' | 'server_error' | 'bad_request' | 'auth'} errorType - Type of error
 * @returns {Promise<void>}
 */
export async function mockGeminiError(page, errorType) {
  await page.route(GEMINI_API_PATTERN, async (route) => {
    const { status, body } = createMockErrorResponse(errorType);

    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body)
    });
  });
}

/**
 * Mock the Gemini API to timeout after a delay.
 * Simulates slow/hanging requests.
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {number} delayMs - Delay before aborting (default: 30000)
 * @returns {Promise<void>}
 */
export async function mockGeminiTimeout(page, delayMs = 30000) {
  await page.route(GEMINI_API_PATTERN, async (route) => {
    // Never respond - simulates timeout
    await new Promise(resolve => setTimeout(resolve, delayMs));
    await route.abort('timedout');
  });
}

/**
 * Mock the Gemini API to return responses in sequence.
 * Useful for testing retry behavior.
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {Array<{type: 'success' | 'error', errorType?: string}>} sequence - Response sequence
 * @returns {Promise<void>}
 */
export async function mockGeminiSequence(page, sequence) {
  let callCount = 0;

  await page.route(GEMINI_API_PATTERN, async (route, request) => {
    const responseConfig = sequence[callCount] || sequence[sequence.length - 1];
    callCount++;

    if (responseConfig.type === 'error') {
      const { status, body } = createMockErrorResponse(responseConfig.errorType || 'server_error');
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body)
      });
    } else {
      let prompt = 'generic';
      try {
        const body = request.postDataJSON();
        if (body?.contents?.[0]?.parts?.[0]?.text) {
          prompt = body.contents[0].parts[0].text;
        }
      } catch {
        // Ignore
      }

      const response = createMockAssetResponse(prompt);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response)
      });
    }
  });
}

/**
 * Clear all API route handlers.
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 * @returns {Promise<void>}
 */
export async function clearApiMocks(page) {
  await page.unroute(GEMINI_API_PATTERN);
}

/**
 * Set up a mock API key in localStorage.
 * This prevents the app from showing the API key prompt.
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {string} [key='test-mock-api-key'] - Mock API key value
 * @returns {Promise<void>}
 */
export async function setMockApiKey(page, key = 'test-mock-api-key') {
  await page.addInitScript((apiKey) => {
    localStorage.setItem('thinq-gemini-api-key', apiKey);
  }, key);
}

/**
 * Count API calls made during a test.
 * Useful for verifying retry behavior.
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 * @returns {{ getCount: () => number }}
 */
export function trackApiCalls(page) {
  let count = 0;

  page.on('request', (request) => {
    if (request.url().includes('generativelanguage.googleapis.com')) {
      count++;
    }
  });

  return {
    getCount: () => count
  };
}
