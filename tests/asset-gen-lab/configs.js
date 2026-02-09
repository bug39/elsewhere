import {
  ASSET_SYSTEM_PROMPT,
  PLANNING_SYSTEM_PROMPT,
  ASSET_SYSTEM_PROMPT_V4,
  PLANNING_SYSTEM_PROMPT_V4
} from '../../src/generator/systemPrompts.js';

// ============================================================
// V4 PROMPT VARIANTS - Expanded testing
// ============================================================

const V4_BASE = {
  asset: ASSET_SYSTEM_PROMPT_V4,
  planning: PLANNING_SYSTEM_PROMPT_V4
};

const V4_BRIGHT = {
  asset: ASSET_SYSTEM_PROMPT_V4 + `

COLOR GUIDANCE
- Avoid very dark colors (value < 0.3)
- Wood: use warm browns (0x8B6914, 0xA0522D, 0xCD853F)
- Metal: use lighter grays (0x708090, 0x778899, 0xA9A9A9)
- Prefer saturation > 0.3 for colored materials`,
  planning: PLANNING_SYSTEM_PROMPT_V4
};

const V4_THICK = {
  asset: ASSET_SYSTEM_PROMPT_V4 + `

GEOMETRY GUIDANCE
- Avoid paper-thin surfaces (min thickness 0.05 units)
- For flat items (coins, keys, shields): use Box with minimum Y dimension 0.1
- For curved surfaces: ensure adequate segments for smooth normals`,
  planning: PLANNING_SYSTEM_PROMPT_V4
};

const V4_QUALITY = {
  asset: ASSET_SYSTEM_PROMPT_V4 + `

QUALITY REQUIREMENTS
- Colors: avoid very dark (value < 0.3), prefer warm browns for wood, lighter grays for metal
- Geometry: minimum thickness 0.05 units, no paper-thin surfaces
- Materials: use roughness 0.5-0.8 for natural materials`,
  planning: PLANNING_SYSTEM_PROMPT_V4
};

// New variants to test
const V4_BRIGHT_THICK = {
  asset: ASSET_SYSTEM_PROMPT_V4 + `

COLOR GUIDANCE
- Avoid very dark colors (value < 0.3)
- Wood: use warm browns (0x8B6914, 0xA0522D, 0xCD853F)
- Metal: use lighter grays (0x708090, 0x778899, 0xA9A9A9)

GEOMETRY GUIDANCE
- Avoid paper-thin surfaces (min thickness 0.05 units)
- For flat items: use Box with minimum Y dimension 0.1`,
  planning: PLANNING_SYSTEM_PROMPT_V4
};

const V4_MINIMAL = {
  asset: ASSET_SYSTEM_PROMPT_V4 + `

SIMPLICITY
- Prefer fewer, larger parts over many small ones
- Maximum 8 meshes for simple props
- Maximum 16 meshes for characters/creatures`,
  planning: PLANNING_SYSTEM_PROMPT_V4
};

const V4_CHUNKY = {
  asset: ASSET_SYSTEM_PROMPT_V4 + `

STYLE GUIDANCE
- Low-poly chunky aesthetic
- Exaggerate proportions slightly
- Avoid fine details, prefer bold forms
- Minimum dimension on any axis: 0.1 units`,
  planning: PLANNING_SYSTEM_PROMPT_V4
};

const V4_EXPORT_FIRST = {
  asset: `CRITICAL: First line of output MUST be: export function createAsset(THREE) {

` + ASSET_SYSTEM_PROMPT_V4,
  planning: PLANNING_SYSTEM_PROMPT_V4
};

const PROMPT_VERSIONS = {
  'v4-base': V4_BASE,
  'v4-bright': V4_BRIGHT,
  'v4-thick': V4_THICK,
  'v4-quality': V4_QUALITY,
  'v4-bright-thick': V4_BRIGHT_THICK,
  'v4-minimal': V4_MINIMAL,
  'v4-chunky': V4_CHUNKY,
  'v4-export-first': V4_EXPORT_FIRST
};

// ============================================================
// HYPERPARAMETERS - No thinking, focus on other variables
// ============================================================

const TEMPERATURES = [0.2, 0.3, 0.4, 0.5];
const TOKEN_LIMITS = [8192, 12288, 16384];

// ============================================================
// CONFIG BUILDER
// ============================================================

const DEFAULT_REPAIR = { exports: true, tubePath: true };

const PLAN_DEFAULT = {
  temperature: 0.7,
  maxOutputTokens: 16384
};

function buildConfig({
  id,
  label,
  promptVersion,
  temperature,
  maxOutputTokens,
  usePlanning = true,
  attempts = 1,
  repair = DEFAULT_REPAIR
}) {
  const prompts = PROMPT_VERSIONS[promptVersion];
  return {
    id,
    label,
    usePlanning,
    promptVersion,
    systemPrompt: prompts.asset,
    planPrompt: prompts.planning,
    generation: { temperature, maxOutputTokens },
    planning: { temperature: PLAN_DEFAULT.temperature, maxOutputTokens: PLAN_DEFAULT.maxOutputTokens },
    thinkingBudget: 0,  // No thinking for all configs
    planThinkingBudget: 0,
    attempts,
    repair
  };
}

// ============================================================
// TEST MATRIX 1: All V4 Prompt Variants (fixed temp/tokens)
// 8 prompts × 1 temp × 1 tokens = 8 configs
// ============================================================
const promptVariantConfigs = [];
for (const promptVersion of Object.keys(PROMPT_VERSIONS)) {
  const id = `prompt-${promptVersion}`;
  const label = `PROMPT ${promptVersion}`;
  promptVariantConfigs.push(buildConfig({
    id,
    label,
    promptVersion,
    temperature: 0.3,
    maxOutputTokens: 12288
  }));
}

// ============================================================
// TEST MATRIX 2: Temperature Sweep on top performers
// 2 prompts × 4 temps = 8 configs
// ============================================================
const tempSweepConfigs = [];
for (const promptVersion of ['v4-bright', 'v4-thick']) {
  for (const temperature of TEMPERATURES) {
    const id = `temp-${promptVersion}-t${temperature}`;
    const label = `TEMP ${promptVersion} t${temperature}`;
    tempSweepConfigs.push(buildConfig({
      id,
      label,
      promptVersion,
      temperature,
      maxOutputTokens: 12288
    }));
  }
}

// ============================================================
// TEST MATRIX 3: Token Sweep on top performers
// 2 prompts × 3 tokens = 6 configs
// ============================================================
const tokenSweepConfigs = [];
for (const promptVersion of ['v4-bright', 'v4-thick']) {
  for (const maxOutputTokens of TOKEN_LIMITS) {
    const id = `tokens-${promptVersion}-${maxOutputTokens}`;
    const label = `TOKENS ${promptVersion} ${maxOutputTokens}`;
    tokenSweepConfigs.push(buildConfig({
      id,
      label,
      promptVersion,
      temperature: 0.3,
      maxOutputTokens
    }));
  }
}

// ============================================================
// TEST MATRIX 4: Full Grid on v4-bright-thick (combined best)
// 4 temps × 3 tokens = 12 configs
// ============================================================
const fullGridConfigs = [];
for (const temperature of TEMPERATURES) {
  for (const maxOutputTokens of TOKEN_LIMITS) {
    const id = `grid-t${temperature}-${maxOutputTokens}`;
    const label = `GRID t${temperature} ${maxOutputTokens}`;
    fullGridConfigs.push(buildConfig({
      id,
      label,
      promptVersion: 'v4-bright-thick',
      temperature,
      maxOutputTokens
    }));
  }
}

// ============================================================
// RECOMMENDED PRODUCTION CONFIGS
// ============================================================
const recommendedConfigs = [
  buildConfig({
    id: 'prod-fast',
    label: 'PROD Fast (v4-bright, 8192)',
    promptVersion: 'v4-bright',
    temperature: 0.3,
    maxOutputTokens: 8192
  }),
  buildConfig({
    id: 'prod-balanced',
    label: 'PROD Balanced (v4-bright-thick, 12288)',
    promptVersion: 'v4-bright-thick',
    temperature: 0.3,
    maxOutputTokens: 12288
  }),
  buildConfig({
    id: 'prod-quality',
    label: 'PROD Quality (v4-bright-thick, 16384)',
    promptVersion: 'v4-bright-thick',
    temperature: 0.3,
    maxOutputTokens: 16384
  })
];

// ============================================================
// EXPORTS
// ============================================================

export const CONFIGS = [
  ...recommendedConfigs,
  ...promptVariantConfigs,
  ...tempSweepConfigs,
  ...tokenSweepConfigs,
  ...fullGridConfigs
];

export const CONFIG_GROUPS = {
  recommended: recommendedConfigs,
  promptVariants: promptVariantConfigs,
  tempSweep: tempSweepConfigs,
  tokenSweep: tokenSweepConfigs,
  fullGrid: fullGridConfigs
};

export const CONFIG_COUNTS = {
  recommended: recommendedConfigs.length,      // 3
  promptVariants: promptVariantConfigs.length, // 8
  tempSweep: tempSweepConfigs.length,          // 8
  tokenSweep: tokenSweepConfigs.length,        // 6
  fullGrid: fullGridConfigs.length,            // 12
  total: CONFIGS.length                        // 37
};

export { TEMPERATURES, TOKEN_LIMITS, PROMPT_VERSIONS };
