import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import { SceneGenerationAgent, SCENE_STATE } from '../../generator/SceneGenerationAgent'
import { showToast } from './Toast'

/**
 * State descriptions for progress display
 */
const STATE_LABELS = {
  [SCENE_STATE.IDLE]: 'Ready',
  [SCENE_STATE.PLANNING]: 'Analyzing scene...',
  [SCENE_STATE.GENERATING_ASSETS]: 'Generating assets...',
  [SCENE_STATE.PLACING]: 'Placing assets...',
  [SCENE_STATE.CAPTURING]: 'Capturing screenshot...',
  [SCENE_STATE.EVALUATING]: 'Evaluating scene...',
  [SCENE_STATE.REFINING]: 'Refining...',
  [SCENE_STATE.COMPLETE]: 'Complete!',
  [SCENE_STATE.ERROR]: 'Error'
}

/**
 * Example prompts for quick start
 */
const EXAMPLE_PROMPTS = [
  'A medieval village with cottages around a central well and a forest edge',
  'A spooky graveyard with tombstones, dead trees, and a gothic mausoleum',
  'A desert oasis with palm trees, a small pond, and Bedouin tents',
  'A mystical forest clearing with ancient standing stones'
]

/**
 * Scene Generator Panel - collapsible side panel for real-time scene generation
 * Allows user to watch the viewport while generation progresses
 */
export function SceneGeneratorPanel({
  isOpen,
  onClose,
  world,
  rendererRef
}) {
  const [prompt, setPrompt] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [agentState, setAgentState] = useState(SCENE_STATE.IDLE)
  const [progress, setProgress] = useState({ message: '', percent: null, iteration: 0 })
  const [evaluationHistory, setEvaluationHistory] = useState([])
  const [generatedAssets, setGeneratedAssets] = useState([])
  const [error, setError] = useState(null)

  const agentRef = useRef(null)
  const textareaRef = useRef(null)

  // Focus textarea when panel opens
  useEffect(() => {
    if (isOpen && !isGenerating && !isMinimized) {
      setTimeout(() => textareaRef.current?.focus(), 100)
    }
  }, [isOpen, isGenerating, isMinimized])

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

      // V2 evaluation loop is now wired - enable refinement for both modes
      agentRef.current.config.enableRefinement = true
      agentRef.current.config.maxIterations = 3

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
        { mode: 'v2' }
      )

      if (result.success) {
        showToast(
          `Scene generated! ${result.generatedAssets?.length || 0} assets, ${result.iterations} iteration${result.iterations !== 1 ? 's' : ''}`,
          'success'
        )
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
  }, [prompt, world, rendererRef])

  // Handle cancel
  const handleCancel = useCallback(() => {
    if (isGenerating && agentRef.current) {
      agentRef.current.abort()
    }
  }, [isGenerating])

  // Insert example prompt
  const handleExampleClick = (example) => {
    setPrompt(example)
    textareaRef.current?.focus()
  }

  // Reset for new generation
  const handleNewGeneration = useCallback(() => {
    setPrompt('')
    setError(null)
    setEvaluationHistory([])
    setGeneratedAssets([])
    setAgentState(SCENE_STATE.IDLE)
  }, [])

  if (!isOpen) return null

  const latestScore = evaluationHistory.length > 0
    ? evaluationHistory[evaluationHistory.length - 1].overallScore
    : null

  return (
    <div class={`scene-gen-panel ${isMinimized ? 'scene-gen-panel--minimized' : ''}`}>
      {/* Header - always visible */}
      <div class="scene-gen-panel__header">
        <div class="scene-gen-panel__title">
          {isGenerating && <span class="scene-gen-panel__indicator" />}
          Scene Generator
        </div>
        <div class="scene-gen-panel__controls">
          <button
            class="btn btn--icon btn--ghost"
            onClick={() => setIsMinimized(!isMinimized)}
            title={isMinimized ? 'Expand' : 'Minimize'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width: 12px; height: 12px">
              {isMinimized ? (
                <polyline points="18 15 12 9 6 15" />
              ) : (
                <polyline points="6 9 12 15 18 9" />
              )}
            </svg>
          </button>
          <button
            class="btn btn--icon btn--ghost"
            onClick={onClose}
            title="Close"
            disabled={isGenerating}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width: 12px; height: 12px">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Collapsed view - just shows status */}
      {isMinimized && (
        <div class="scene-gen-panel__mini">
          {isGenerating ? (
            <>
              <span class="scene-gen-panel__mini-state">{STATE_LABELS[agentState]}</span>
              {progress.iteration > 0 && (
                <span class="scene-gen-panel__mini-iter">
                  {progress.iteration}/{agentRef.current?.config.maxIterations || 5}
                </span>
              )}
              {latestScore !== null && (
                <span class={`scene-gen-panel__mini-score scene-gen-panel__mini-score--${latestScore >= 75 ? 'good' : latestScore >= 50 ? 'ok' : 'low'}`}>
                  {latestScore}
                </span>
              )}
            </>
          ) : (
            <span class="scene-gen-panel__mini-state">Click to expand</span>
          )}
        </div>
      )}

      {/* Expanded view */}
      {!isMinimized && (
        <div class="scene-gen-panel__body">
          {!isGenerating && agentState !== SCENE_STATE.COMPLETE ? (
            // Input phase
            <>
              <div class="field">
                <label class="field__label">Describe your scene</label>
                <textarea
                  ref={textareaRef}
                  class="input scene-gen-panel__textarea"
                  value={prompt}
                  onInput={(e) => setPrompt(e.target.value)}
                  placeholder="Describe the world you want to create..."
                  rows={4}
                />
              </div>

              <div class="field" style="margin-top: var(--sp-3)">
                <label class="field__label">Quick examples</label>
                <div class="scene-gen-panel__chips">
                  {EXAMPLE_PROMPTS.map((example, i) => (
                    <button
                      key={i}
                      class="btn btn--sm"
                      title={example}
                      onClick={() => handleExampleClick(example)}
                    >
                      {example.slice(0, 35)}...
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <div class="scene-gen-panel__error">{error}</div>
              )}

              <button
                class="btn btn--primary"
                onClick={handleGenerate}
                disabled={!prompt.trim()}
                style="width: 100%; margin-top: var(--sp-3)"
              >
                Generate Scene
              </button>
            </>
          ) : isGenerating ? (
            // Progress phase
            <div class="scene-gen-panel__progress">
              <div class="scene-gen-panel__progress-header">
                <span class={`scene-gen-panel__badge scene-gen-panel__badge--${agentState}`}>
                  {STATE_LABELS[agentState]}
                </span>
                {progress.iteration > 0 && (
                  <span class="scene-gen-panel__badge scene-gen-panel__badge--iter">
                    {progress.iteration}/{agentRef.current?.config.maxIterations || 5}
                  </span>
                )}
              </div>

              {progress.message && (
                <div class="scene-gen-panel__progress-msg">{progress.message}</div>
              )}

              {/* Score display */}
              {latestScore !== null && (
                <div class="scene-gen-panel__score-section">
                  <div class="field__label">Quality Score</div>
                  <div class="scene-gen-panel__score-bar-wrap">
                    <div
                      class={`scene-gen-panel__score-bar scene-gen-panel__score-bar--${latestScore >= 75 ? 'good' : latestScore >= 50 ? 'ok' : 'low'}`}
                      style={{ width: `${latestScore}%` }}
                    />
                  </div>
                  <div class="scene-gen-panel__score-val">{latestScore}/100</div>
                </div>
              )}

              {/* Score history */}
              {evaluationHistory.length > 1 && (
                <div class="scene-gen-panel__history">
                  <div class="field__label">Progress</div>
                  <div class="scene-gen-panel__history-bars">
                    {evaluationHistory.map((evalData, i) => (
                      <div
                        key={i}
                        class={`scene-gen-panel__history-bar scene-gen-panel__history-bar--${evalData.overallScore >= 75 ? 'good' : evalData.overallScore >= 50 ? 'ok' : 'low'}`}
                        style={{ height: `${evalData.overallScore}%` }}
                        title={`Iteration ${evalData.iteration}: ${evalData.overallScore}`}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Generated assets */}
              {generatedAssets.length > 0 && (
                <div class="scene-gen-panel__assets">
                  <div class="field__label">{generatedAssets.length} asset{generatedAssets.length !== 1 ? 's' : ''} generated</div>
                  <div class="scene-gen-panel__assets-grid">
                    {generatedAssets.slice(-8).map(asset => (
                      <img
                        key={asset.id}
                        src={asset.thumbnail}
                        alt={asset.name}
                        title={asset.name}
                        class="scene-gen-panel__asset-thumb"
                      />
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <div class="scene-gen-panel__error">{error}</div>
              )}

              <button class="btn" onClick={handleCancel} style="width: 100%; margin-top: var(--sp-3)">
                Cancel
              </button>
            </div>
          ) : (
            // Complete phase
            <div class="scene-gen-panel__complete">
              <div class="scene-gen-panel__complete-header">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" class="scene-gen-panel__complete-icon">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>Generation Complete</span>
              </div>

              {latestScore !== null && (
                <div class="scene-gen-panel__final-score">
                  <span class="field__label">Final Score</span>
                  <span class={`scene-gen-panel__final-val scene-gen-panel__final-val--${latestScore >= 75 ? 'good' : latestScore >= 50 ? 'ok' : 'low'}`}>
                    {latestScore}
                  </span>
                </div>
              )}

              <div class="scene-gen-panel__stats">
                <div class="scene-gen-panel__stat">
                  <span class="scene-gen-panel__stat-val">{generatedAssets.length}</span>
                  <span class="scene-gen-panel__stat-label">Assets</span>
                </div>
                <div class="scene-gen-panel__stat">
                  <span class="scene-gen-panel__stat-val">{evaluationHistory.length}</span>
                  <span class="scene-gen-panel__stat-label">Iterations</span>
                </div>
              </div>

              <div class="scene-gen-panel__actions">
                <button class="btn" onClick={handleNewGeneration}>
                  New Generation
                </button>
                <button class="btn btn--primary" onClick={onClose}>
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`
        .scene-gen-panel {
          position: fixed;
          right: var(--sp-4);
          top: 60px;
          width: 320px;
          background: var(--white);
          border: 1px solid var(--line);
          border-radius: var(--radius-md);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
          z-index: var(--z-dropdown);
          display: flex;
          flex-direction: column;
          max-height: calc(100vh - 80px);
          overflow: hidden;
        }

        .scene-gen-panel--minimized {
          width: 200px;
        }

        .scene-gen-panel__header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          height: var(--h-lg);
          padding: 0 var(--sp-3);
          border-bottom: 1px solid var(--line);
        }

        .scene-gen-panel__title {
          font-size: var(--text-2xs);
          font-weight: var(--weight-medium);
          letter-spacing: var(--tracking-wide);
          text-transform: uppercase;
          color: var(--text-tertiary);
          display: flex;
          align-items: center;
          gap: var(--sp-2);
        }

        .scene-gen-panel__indicator {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent);
          animation: scene-gen-pulse 1s infinite;
        }

        @keyframes scene-gen-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        .scene-gen-panel__controls {
          display: flex;
          gap: 2px;
        }

        .scene-gen-panel__mini {
          display: flex;
          align-items: center;
          gap: var(--sp-2);
          padding: var(--sp-2) var(--sp-3);
          font-size: var(--text-xs);
        }

        .scene-gen-panel__mini-state {
          color: var(--text-tertiary);
        }

        .scene-gen-panel__mini-iter {
          color: var(--text-tertiary);
          font-family: var(--font-mono);
          font-size: var(--text-2xs);
        }

        .scene-gen-panel__mini-score {
          font-weight: var(--weight-medium);
          padding: 2px var(--sp-2);
          border-radius: var(--radius-sm);
          background: var(--gray-100);
          font-family: var(--font-mono);
          font-size: var(--text-xs);
        }

        .scene-gen-panel__mini-score--good { color: var(--positive); }
        .scene-gen-panel__mini-score--ok { color: var(--warning); }
        .scene-gen-panel__mini-score--low { color: var(--negative); }

        .scene-gen-panel__body {
          padding: var(--sp-3);
          overflow-y: auto;
          flex: 1;
        }

        .scene-gen-panel__textarea {
          min-height: 80px;
          resize: vertical;
          font-family: var(--font-sans);
        }

        .scene-gen-panel__chips {
          display: flex;
          flex-wrap: wrap;
          gap: var(--sp-1);
          margin-top: var(--sp-2);
        }

        .scene-gen-panel__error {
          color: var(--negative);
          padding: var(--sp-2) var(--sp-3);
          background: rgba(185, 28, 28, 0.08);
          border: 1px solid rgba(185, 28, 28, 0.2);
          border-radius: var(--radius-sm);
          font-size: var(--text-xs);
          margin-top: var(--sp-3);
        }

        .scene-gen-panel__progress {
          text-align: center;
        }

        .scene-gen-panel__progress-header {
          display: flex;
          justify-content: center;
          gap: var(--sp-2);
          margin-bottom: var(--sp-3);
        }

        .scene-gen-panel__badge {
          padding: 2px var(--sp-2);
          border-radius: var(--radius-sm);
          font-size: var(--text-xs);
          font-weight: var(--weight-medium);
          background: var(--gray-100);
          color: var(--text-secondary);
        }

        .scene-gen-panel__badge--complete {
          background: rgba(21, 128, 61, 0.1);
          color: var(--positive);
        }

        .scene-gen-panel__badge--error {
          background: rgba(185, 28, 28, 0.1);
          color: var(--negative);
        }

        .scene-gen-panel__badge--iter {
          font-family: var(--font-mono);
          font-size: var(--text-2xs);
          color: var(--text-tertiary);
        }

        .scene-gen-panel__progress-msg {
          color: var(--text-tertiary);
          font-size: var(--text-xs);
          margin-bottom: var(--sp-4);
        }

        .scene-gen-panel__score-section {
          margin-bottom: var(--sp-4);
          text-align: left;
        }

        .scene-gen-panel__score-bar-wrap {
          height: 6px;
          background: var(--gray-100);
          border-radius: 3px;
          overflow: hidden;
          margin: var(--sp-1) 0;
        }

        .scene-gen-panel__score-bar {
          height: 100%;
          border-radius: 3px;
          transition: width var(--duration-normal) var(--ease);
        }

        .scene-gen-panel__score-bar--good { background: var(--positive); }
        .scene-gen-panel__score-bar--ok { background: var(--warning); }
        .scene-gen-panel__score-bar--low { background: var(--negative); }

        .scene-gen-panel__score-val {
          font-size: var(--text-xs);
          font-family: var(--font-mono);
          color: var(--text-secondary);
        }

        .scene-gen-panel__history {
          margin-bottom: var(--sp-4);
          text-align: left;
        }

        .scene-gen-panel__history-bars {
          display: flex;
          gap: var(--sp-1);
          height: 40px;
          align-items: flex-end;
          justify-content: center;
          margin-top: var(--sp-2);
        }

        .scene-gen-panel__history-bar {
          width: 16px;
          border-radius: var(--radius-sm);
          min-height: 4px;
          transition: height var(--duration-normal) var(--ease);
        }

        .scene-gen-panel__history-bar--good { background: var(--positive); }
        .scene-gen-panel__history-bar--ok { background: var(--warning); }
        .scene-gen-panel__history-bar--low { background: var(--negative); }

        .scene-gen-panel__assets {
          margin-bottom: var(--sp-4);
          text-align: left;
        }

        .scene-gen-panel__assets-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: var(--sp-1);
          margin-top: var(--sp-2);
        }

        .scene-gen-panel__asset-thumb {
          width: 100%;
          aspect-ratio: 1;
          border-radius: var(--radius-sm);
          background: var(--gray-100);
          object-fit: contain;
          border: 1px solid var(--line);
        }

        .scene-gen-panel__complete {
          text-align: center;
          padding: var(--sp-4) 0;
        }

        .scene-gen-panel__complete-header {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--sp-2);
          margin-bottom: var(--sp-4);
          font-size: var(--text-md);
          font-weight: var(--weight-medium);
          color: var(--text);
        }

        .scene-gen-panel__complete-icon {
          width: 20px;
          height: 20px;
          color: var(--positive);
          stroke-width: 2;
        }

        .scene-gen-panel__final-score {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--sp-1);
          margin-bottom: var(--sp-4);
        }

        .scene-gen-panel__final-val {
          font-size: 28px;
          font-weight: var(--weight-medium);
          font-family: var(--font-mono);
        }

        .scene-gen-panel__final-val--good { color: var(--positive); }
        .scene-gen-panel__final-val--ok { color: var(--warning); }
        .scene-gen-panel__final-val--low { color: var(--negative); }

        .scene-gen-panel__stats {
          display: flex;
          justify-content: center;
          gap: var(--sp-6);
          margin-bottom: var(--sp-4);
          padding: var(--sp-3);
          background: var(--gray-50);
          border-radius: var(--radius-sm);
        }

        .scene-gen-panel__stat {
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .scene-gen-panel__stat-val {
          font-size: var(--text-lg);
          font-weight: var(--weight-medium);
          color: var(--text);
        }

        .scene-gen-panel__stat-label {
          font-size: var(--text-2xs);
          font-weight: var(--weight-medium);
          letter-spacing: var(--tracking-wide);
          text-transform: uppercase;
          color: var(--text-tertiary);
        }

        .scene-gen-panel__actions {
          display: flex;
          gap: var(--sp-2);
        }

        .scene-gen-panel__actions .btn {
          flex: 1;
        }
      `}</style>
    </div>
  )
}
