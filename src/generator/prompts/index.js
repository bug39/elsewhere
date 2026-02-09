/**
 * Prompt Loader Module
 *
 * Loads prompt text files at build time using Vite's ?raw import.
 * This keeps large prompts out of source files while still bundling
 * them into the final application.
 *
 * Token optimization: By keeping prompts in .txt files, AI tools
 * skip them during context gathering, saving ~6,000 tokens per session.
 */

// Scene Generation Prompts
import layeredScenePlanningPrompt from './layeredScenePlanning.txt?raw'
import scenePlanningPrompt from './scenePlanning.txt?raw'
import relationshipScenePlanningPrompt from './relationshipScenePlanning.txt?raw'
import vignetteScenePlanningPrompt from './vignetteScenePlanning.txt?raw'
import sceneEvaluationPrompt from './sceneEvaluation.txt?raw'
import sceneEvaluationWithReferencePrompt from './sceneEvaluationWithReference.txt?raw'
import sceneRefinementPrompt from './sceneRefinement.txt?raw'

// V2 Scene Prompts (explicit coordinates, simplified schema)
import scenePlanningV2Prompt from './scenePlanningV2.txt?raw'
import sceneEvaluationV2Prompt from './sceneEvaluationV2.txt?raw'
import sceneRefinementV2Prompt from './sceneRefinementV2.txt?raw'

// Asset Generation Prompts
import assetSystemPrompt from './assetSystem.txt?raw'
import planningSystemPrompt from './planningSystem.txt?raw'
import assetSystemV4Prompt from './assetSystemV4.txt?raw'
import planningSystemV4Prompt from './planningSystemV4.txt?raw'
import assetSystemV4BrightPrompt from './assetSystemV4Bright.txt?raw'

// Scene prompts
export const LAYERED_SCENE_PLANNING_PROMPT = layeredScenePlanningPrompt
export const SCENE_PLANNING_PROMPT = scenePlanningPrompt
export const RELATIONSHIP_SCENE_PLANNING_PROMPT = relationshipScenePlanningPrompt
export const VIGNETTE_SCENE_PLANNING_PROMPT = vignetteScenePlanningPrompt
export const SCENE_EVALUATION_PROMPT = sceneEvaluationPrompt
export const SCENE_EVALUATION_WITH_REFERENCE_PROMPT = sceneEvaluationWithReferencePrompt
export const SCENE_REFINEMENT_PROMPT = sceneRefinementPrompt

// V2 Scene prompts (explicit coordinates)
export const SCENE_PLANNING_PROMPT_V2 = scenePlanningV2Prompt
export const SCENE_EVALUATION_PROMPT_V2 = sceneEvaluationV2Prompt
export const SCENE_REFINEMENT_PROMPT_V2 = sceneRefinementV2Prompt

// Asset prompts
export const ASSET_SYSTEM_PROMPT = assetSystemPrompt
export const PLANNING_SYSTEM_PROMPT = planningSystemPrompt
export const ASSET_SYSTEM_PROMPT_V4 = assetSystemV4Prompt
export const PLANNING_SYSTEM_PROMPT_V4 = planningSystemV4Prompt
export const ASSET_SYSTEM_PROMPT_V4_BRIGHT = assetSystemV4BrightPrompt
