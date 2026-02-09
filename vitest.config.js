import { defineConfig } from 'vitest/config'
import preact from '@preact/preset-vite'

export default defineConfig({
  plugins: [preact()],
  test: {
    // Disable watch mode by default - prevents zombie processes when run by agents
    // Use `vitest watch` or `npm run test:watch` for interactive development
    watch: false,

    // Use happy-dom for DOM emulation (faster than jsdom)
    environment: 'happy-dom',

    // Setup files run before each test file
    setupFiles: ['./tests/setup.js'],

    // Include patterns for test files
    include: [
      'tests/unit/**/*.test.js',
      'tests/integration/**/*.test.js',
      'tests/scene-generation/**/*.test.js'
    ],

    // Exclude E2E tests (run via Playwright)
    exclude: [
      'tests/e2e/**',
      'tests/asset-gen/**',
      'tests/asset-gen-lab/**',
      'tests/dev-playground/**',
      'tests/part-editor/**',
      'node_modules/**'
    ],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      reportsDirectory: './coverage',
      include: [
        'src/**/*.js',
        'src/**/*.jsx'
      ],
      exclude: [
        'src/**/*.test.js',
        'src/server/**'
      ],
      // Minimum coverage thresholds
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60
      }
    },

    // Global test timeout
    testTimeout: 10000,

    // Reporter configuration
    reporters: ['verbose'],

    // Resolve aliases to match Vite config
    alias: {
      'react': 'preact/compat',
      'react-dom': 'preact/compat',
      'react-dom/test-utils': 'preact/test-utils',
      'react/jsx-runtime': 'preact/jsx-runtime'
    }
  },

  // Resolve configuration for imports
  resolve: {
    alias: {
      'react': 'preact/compat',
      'react-dom': 'preact/compat',
      'react-dom/test-utils': 'preact/test-utils',
      'react/jsx-runtime': 'preact/jsx-runtime'
    }
  }
})
