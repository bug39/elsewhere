import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { dismissAllTooltips } from '../state/tooltipState'
import { SceneGenerationAgent, SCENE_STATE } from '../../generator/SceneGenerationAgent'
import { showToast } from './Toast'

/**
 * Scene generation mode options
 */
const GENERATION_MODES = [
  {
    id: 'full',
    label: 'Full World',
    description: 'Replace current scene with entirely new world'
  },
  {
    id: 'zone',
    label: 'Zone/Area',
    description: 'Add to existing scene in a specific area'
  }
]

/**
 * Example prompts for inspiration
 */
const EXAMPLE_PROMPTS = [
  'A medieval village with cottages around a central well, market stalls, and a forest edge to the north',
  'A spooky graveyard with tombstones, dead trees, and a gothic mausoleum in the center',
  'A desert oasis with palm trees, a small pond, and Bedouin tents',
  'A snowy mountain camp with log cabins, pine trees, and a frozen lake',
  'A mystical forest clearing with ancient standing stones and glowing mushrooms'
]

/**
 * State descriptions for progress display
 */
const STATE_LABELS = {
  [SCENE_STATE.IDLE]: 'Ready',
  [SCENE_STATE.PLANNING]: 'Analyzing scene description...',
  [SCENE_STATE.GENERATING_ASSETS]: 'Generating assets...',
  [SCENE_STATE.PLACING]: 'Placing assets in world...',
  [SCENE_STATE.CAPTURING]: 'Capturing screenshot...',
  [SCENE_STATE.EVALUATING]: 'Evaluating scene quality...',
  [SCENE_STATE.REFINING]: 'Applying refinements...',
  [SCENE_STATE.COMPLETE]: 'Complete!',
  [SCENE_STATE.ERROR]: 'Error occurred'
}

export function SceneGeneratorModal({
  isOpen,
  onClose,
  world,
  rendererRef
}) {
  const [prompt, setPrompt] = useState('')
  const [mode, setMode] = useState('full')
  const [isGenerating, setIsGenerating] = useState(false)
  const [agentState, setAgentState] = useState(SCENE_STATE.IDLE)
  const [progress, setProgress] = useState({ message: '', percent: null, iteration: 0 })
  const [evaluationHistory, setEvaluationHistory] = useState([])
  const [generatedAssets, setGeneratedAssets] = useState([])
  const [error, setError] = useState(null)

  const agentRef = useRef(null)
  const modalRef = useFocusTrap(isOpen, onClose)
  const textareaRef = useRef(null)

  // Focus textarea when modal opens
  useEffect(() => {
    if (isOpen) {
      dismissAllTooltips()
      setError(null)
      setTimeout(() => textareaRef.current?.focus(), 100)
    }
  }, [isOpen])

  // Create agent on mount
  useEffect(() => {
    agentRef.current = new SceneGenerationAgent({
      maxIterations: 5,
      qualityThreshold: 75,
      enableRefinement: true
    })

    // Set up callbacks
    agentRef.current.onStateChange = (state, details) => {
      setAgentState(state)
      if (details?.error) {
        setError(details.error)
      }
    }

    agentRef.current.onProgress = (info) => {
      setProgress(info)
    }

    agentRef.current.onAssetGenerated = (asset, spec) => {
      setGeneratedAssets(prev => [...prev, asset])
    }

    agentRef.current.onIterationComplete = ({ iteration, evaluation }) => {
      setEvaluationHistory(prev => [...prev, { iteration, ...evaluation }])
    }

    return () => {
      if (agentRef.current) {
        agentRef.current.abort()
      }
    }
  }, [])

  // Handle generate button click
  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) {
      showToast('Please enter a scene description', 'error')
      return
    }

    if (!rendererRef?.current) {
      showToast('Renderer not available', 'error')
      return
    }

    setIsGenerating(true)
    setError(null)
    setEvaluationHistory([])
    setGeneratedAssets([])

    try {
      const threeScene = rendererRef.current.scene

      const result = await agentRef.current.generate(
        prompt,
        {
          executeScenePlan: world.executeScenePlan,
          updateInstance: world.updateInstance,
          deleteInstance: world.deleteInstance,
          getWorldData: () => world.data,
          worldRenderer: rendererRef.current
        },
        threeScene,
        { mode }
      )

      if (result.success) {
        showToast(
          `Scene generated! ${result.generatedAssets?.length || 0} assets, ${result.iterations} iterations`,
          'success'
        )
        onClose()
      } else if (result.aborted) {
        showToast('Generation cancelled', 'info')
      } else {
        setError(result.error || 'Generation failed')
        showToast(result.error || 'Scene generation failed', 'error')
      }
    } catch (err) {
      setError(err.message)
      showToast(err.message, 'error')
    } finally {
      setIsGenerating(false)
    }
  }, [prompt, mode, world, rendererRef, onClose])

  // Handle cancel
  const handleCancel = useCallback(() => {
    if (isGenerating && agentRef.current) {
      agentRef.current.abort()
    }
    onClose()
  }, [isGenerating, onClose])

  // Insert example prompt
  const handleExampleClick = (example) => {
    setPrompt(example)
    textareaRef.current?.focus()
  }

  if (!isOpen) return null

  const latestScore = evaluationHistory.length > 0
    ? evaluationHistory[evaluationHistory.length - 1].overallScore
    : null

  return (
    <div class="modal-overlay" onClick={handleCancel}>
      <div
        ref={modalRef}
        class="modal scene-generator-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="scene-generator-title"
      >
        <div class="modal-header">
          <h2 id="scene-generator-title">Generate Scene</h2>
          <button
            class="modal-close"
            onClick={handleCancel}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div class="modal-content">
          {!isGenerating ? (
            // Input phase
            <>
              <div class="form-group">
                <label for="scene-prompt">Describe your scene</label>
                <textarea
                  ref={textareaRef}
                  id="scene-prompt"
                  class="scene-prompt-input"
                  value={prompt}
                  onInput={(e) => setPrompt(e.target.value)}
                  placeholder="Describe the world you want to create... Include details about structures, nature, characters, and atmosphere."
                  rows={5}
                />
                <div class="char-count">{prompt.length} characters</div>
              </div>

              <div class="form-group">
                <label>Generation Mode</label>
                <div class="mode-options">
                  {GENERATION_MODES.map(m => (
                    <label key={m.id} class="mode-option">
                      <input
                        type="radio"
                        name="generation-mode"
                        value={m.id}
                        checked={mode === m.id}
                        onChange={() => setMode(m.id)}
                      />
                      <span class="mode-label">{m.label}</span>
                      <span class="mode-description">{m.description}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div class="examples-section">
                <label>Examples for inspiration</label>
                <div class="example-prompts">
                  {EXAMPLE_PROMPTS.map((example, i) => (
                    <button
                      key={i}
                      class="example-prompt"
                      onClick={() => handleExampleClick(example)}
                      title={example}
                    >
                      {example.slice(0, 60)}...
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <div class="error-message">
                  {error}
                </div>
              )}
            </>
          ) : (
            // Progress phase
            <div class="generation-progress">
              <div class="progress-state">
                <div class="state-indicator" data-state={agentState}>
                  {agentState === SCENE_STATE.COMPLETE ? '✓' : '⋯'}
                </div>
                <div class="state-label">{STATE_LABELS[agentState]}</div>
              </div>

              {progress.message && (
                <div class="progress-message">{progress.message}</div>
              )}

              {progress.iteration > 0 && (
                <div class="iteration-info">
                  Iteration {progress.iteration} of {agentRef.current?.config.maxIterations || 5}
                </div>
              )}

              {latestScore !== null && (
                <div class="score-display">
                  <div class="score-label">Quality Score</div>
                  <div class="score-value" data-quality={latestScore >= 75 ? 'good' : latestScore >= 50 ? 'ok' : 'low'}>
                    {latestScore}
                  </div>
                </div>
              )}

              {generatedAssets.length > 0 && (
                <div class="assets-generated">
                  <div class="assets-label">Assets Generated</div>
                  <div class="assets-thumbnails">
                    {generatedAssets.slice(-6).map(asset => (
                      <img
                        key={asset.id}
                        src={asset.thumbnail}
                        alt={asset.name}
                        title={asset.name}
                        class="asset-thumb"
                      />
                    ))}
                    {generatedAssets.length > 6 && (
                      <span class="more-assets">+{generatedAssets.length - 6}</span>
                    )}
                  </div>
                </div>
              )}

              {evaluationHistory.length > 1 && (
                <div class="score-history">
                  <div class="history-label">Score progression</div>
                  <div class="history-bars">
                    {evaluationHistory.map((evalData, i) => (
                      <div
                        key={i}
                        class="history-bar"
                        style={{ height: `${evalData.overallScore}%` }}
                        title={`Iteration ${evalData.iteration}: ${evalData.overallScore}`}
                      />
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <div class="error-message">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        <div class="modal-footer">
          {!isGenerating ? (
            <>
              <button class="btn btn-secondary" onClick={handleCancel}>
                Cancel
              </button>
              <button
                class="btn btn-primary"
                onClick={handleGenerate}
                disabled={!prompt.trim()}
              >
                Generate Scene
              </button>
            </>
          ) : (
            <button class="btn btn-secondary" onClick={handleCancel}>
              Cancel Generation
            </button>
          )}
        </div>
      </div>

      <style>{`
        .scene-generator-modal {
          width: 600px;
          max-width: 90vw;
        }

        .scene-prompt-input {
          width: 100%;
          padding: 12px;
          font-size: 14px;
          border: 1px solid var(--border-color, #333);
          border-radius: 6px;
          background: var(--input-bg, #1a1a1a);
          color: var(--text-color, #fff);
          resize: vertical;
          min-height: 120px;
          font-family: inherit;
        }

        .scene-prompt-input:focus {
          outline: none;
          border-color: var(--accent-color, #4a9eff);
        }

        .char-count {
          font-size: 12px;
          color: var(--text-muted, #666);
          text-align: right;
          margin-top: 4px;
        }

        .mode-options {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .mode-option {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 8px;
          border: 1px solid var(--border-color, #333);
          border-radius: 6px;
          cursor: pointer;
        }

        .mode-option:has(input:checked) {
          border-color: var(--accent-color, #4a9eff);
          background: rgba(74, 158, 255, 0.1);
        }

        .mode-label {
          font-weight: 500;
        }

        .mode-description {
          font-size: 12px;
          color: var(--text-muted, #666);
        }

        .examples-section {
          margin-top: 16px;
        }

        .example-prompts {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 8px;
        }

        .example-prompt {
          padding: 6px 10px;
          font-size: 12px;
          border: 1px solid var(--border-color, #333);
          border-radius: 4px;
          background: var(--bg-secondary, #1a1a1a);
          color: var(--text-muted, #888);
          cursor: pointer;
          text-align: left;
        }

        .example-prompt:hover {
          border-color: var(--accent-color, #4a9eff);
          color: var(--text-color, #fff);
        }

        .generation-progress {
          text-align: center;
          padding: 20px;
        }

        .progress-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          margin-bottom: 16px;
        }

        .state-indicator {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          background: var(--accent-color, #4a9eff);
          color: white;
        }

        .state-indicator[data-state="complete"] {
          background: #22c55e;
        }

        .state-indicator[data-state="error"] {
          background: #ef4444;
        }

        .state-label {
          font-size: 16px;
          font-weight: 500;
        }

        .progress-message {
          color: var(--text-muted, #888);
          font-size: 14px;
          margin-bottom: 12px;
        }

        .iteration-info {
          font-size: 12px;
          color: var(--text-muted, #666);
          margin-bottom: 16px;
        }

        .score-display {
          display: inline-block;
          padding: 12px 24px;
          background: var(--bg-secondary, #1a1a1a);
          border-radius: 8px;
          margin-bottom: 16px;
        }

        .score-label {
          font-size: 12px;
          color: var(--text-muted, #666);
          margin-bottom: 4px;
        }

        .score-value {
          font-size: 32px;
          font-weight: 600;
        }

        .score-value[data-quality="good"] {
          color: #22c55e;
        }

        .score-value[data-quality="ok"] {
          color: #f59e0b;
        }

        .score-value[data-quality="low"] {
          color: #ef4444;
        }

        .assets-generated {
          margin-top: 16px;
        }

        .assets-label {
          font-size: 12px;
          color: var(--text-muted, #666);
          margin-bottom: 8px;
        }

        .assets-thumbnails {
          display: flex;
          gap: 8px;
          justify-content: center;
          align-items: center;
        }

        .asset-thumb {
          width: 48px;
          height: 48px;
          border-radius: 4px;
          background: var(--bg-secondary, #1a1a1a);
          object-fit: contain;
        }

        .more-assets {
          font-size: 12px;
          color: var(--text-muted, #666);
        }

        .score-history {
          margin-top: 20px;
        }

        .history-label {
          font-size: 12px;
          color: var(--text-muted, #666);
          margin-bottom: 8px;
        }

        .history-bars {
          display: flex;
          gap: 4px;
          height: 60px;
          align-items: flex-end;
          justify-content: center;
        }

        .history-bar {
          width: 20px;
          background: var(--accent-color, #4a9eff);
          border-radius: 2px;
          min-height: 4px;
        }

        .error-message {
          color: #ef4444;
          padding: 12px;
          background: rgba(239, 68, 68, 0.1);
          border-radius: 6px;
          margin-top: 16px;
        }
      `}</style>
    </div>
  )
}
