/**
 * Legacy system prompts for asset generation (snapshot from de8025b).
 * Keeps prompt text isolated from current pipeline changes.
 */

import assetSystemV4Prompt from './prompts/assetSystemV4.txt?raw'
import planningSystemV4Prompt from './prompts/planningSystemV4.txt?raw'
import assetSystemV4BrightPrompt from './prompts/assetSystemV4Bright.txt?raw'
import { CATEGORY_PALETTES, CATEGORY_PROPORTIONS } from '../systemPrompts.js'

export const ASSET_SYSTEM_PROMPT_V4 = assetSystemV4Prompt
export const PLANNING_SYSTEM_PROMPT_V4 = planningSystemV4Prompt
export const ASSET_SYSTEM_PROMPT_V4_BRIGHT = assetSystemV4BrightPrompt

export { CATEGORY_PALETTES, CATEGORY_PROPORTIONS }
