import { useState, useCallback, useRef, useEffect } from 'preact/hooks'
import * as THREE from 'three'
import { assetGenerator } from '../../generator/AssetGenerator'
import { legacyAssetGenerator } from '../../generator/legacy/AssetGeneratorLegacy.js'
import { generateThumbnail } from '../../generator/ThumbnailRenderer'
import { generateId } from '../state/storage'
import { PreviewRendererService } from '../services/PreviewRendererService'
import { isFeatureEnabled } from '../../shared/featureFlags'

const SUGGESTED_PROMPTS = [
  'friendly robot',
  'medieval knight',
  'wooden barrel',
  'pine tree',
  'cute dragon',
  'stone cottage',
  'treasure chest',
  'anime girl'
]

export function AssetGeneratorModal({ isOpen, onClose, onAssetGenerated }) {
  const [prompt, setPrompt] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState(null)
  const [errorSuggestions, setErrorSuggestions] = useState([])
  const [generatedAsset, setGeneratedAsset] = useState(null)
  const [generatedCode, setGeneratedCode] = useState(null)
  const [isWalkingCharacter, setIsWalkingCharacter] = useState(false)
  const [showCharacterQuestion, setShowCharacterQuestion] = useState(false)

  const previewRef = useRef(null)
  const previewInstanceRef = useRef(null)
  const getGenerator = useCallback(
    () => (isFeatureEnabled('legacyAssetGenerator') ? legacyAssetGenerator : assetGenerator),
    []
  )

  // Initialize preview renderer using shared service
  useEffect(() => {
    if (!previewRef.current || !isOpen) return

    // Acquire a preview instance from the pool
    const preview = PreviewRendererService.acquire(previewRef.current, {
      background: 0xf5f5f5
    })
    previewInstanceRef.current = preview

    return () => {
      // Release back to pool
      if (previewInstanceRef.current) {
        PreviewRendererService.release(previewInstanceRef.current)
        previewInstanceRef.current = null
      }
    }
  }, [isOpen])

  // Handle generate
  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || isGenerating) return

    setIsGenerating(true)
    setError(null)
    setErrorSuggestions([])
    setProgress('Starting...')
    setGeneratedAsset(null)
    setGeneratedCode(null)
    setShowCharacterQuestion(false)

    // Clear previous asset from preview
    if (previewInstanceRef.current) {
      previewInstanceRef.current.clearAsset()
    }

    const generator = getGenerator()
    generator.setProgressCallback((msg, phase) => {
      setProgress(msg)
    })

    try {
      const { asset, code } = await generator.generate(prompt.trim())

      // Add to preview scene (service handles positioning and camera fit)
      if (previewInstanceRef.current) {
        previewInstanceRef.current.addAsset(asset, {
          centerOnGround: true,
          fitCamera: true
        })
      }

      setGeneratedAsset(asset)
      setGeneratedCode(code)

      // Check if this might be a walking character
      const category = generator.guessCategory(prompt)
      if (category === 'characters' || category === 'creatures') {
        setShowCharacterQuestion(true)
      }

      setProgress('Asset generated successfully!')
    } catch (err) {
      console.error('Generation failed:', err)
      // Show friendly message for API errors, raw message for others
      if (err.isApiError && err.friendlyMessage) {
        setError(err.friendlyMessage)
        setErrorSuggestions([]) // Don't blame the prompt for API errors
      } else {
        setError(err.message)
        // Extract prompt suggestions if available
        if (err.promptSuggestions && err.promptSuggestions.length > 0) {
          setErrorSuggestions(err.promptSuggestions)
        }
      }
      setProgress('')
    } finally {
      setIsGenerating(false)
    }
  }, [prompt, isGenerating])

  // Handle keep asset
  const handleKeep = useCallback(() => {
    if (!generatedAsset || !generatedCode) return

    const generator = getGenerator()
    const name = generator.deriveName(prompt)
    const category = generator.guessCategory(prompt)
    const thumbnail = generateThumbnail(generatedAsset)

    const libraryAsset = {
      id: generateId('lib'),
      name,
      category,
      generatedCode: generatedCode,
      thumbnail,
      thumbnailVersion: 2,
      tags: prompt.toLowerCase().split(/\s+/).filter(t => t.length > 2),
      isWalkingCharacter
    }

    onAssetGenerated(libraryAsset)

    // Reset state
    setPrompt('')
    setGeneratedAsset(null)
    setGeneratedCode(null)
    setShowCharacterQuestion(false)
    setIsWalkingCharacter(false)
    setProgress('')

    // Clear preview
    if (previewInstanceRef.current) {
      previewInstanceRef.current.clearAsset()
    }

    onClose()
  }, [generatedAsset, generatedCode, prompt, isWalkingCharacter, onAssetGenerated, onClose])

  // Handle generate more (discard and regenerate)
  const handleGenerateMore = useCallback(() => {
    // Clear current asset
    if (previewInstanceRef.current) {
      previewInstanceRef.current.clearAsset()
    }
    setGeneratedAsset(null)
    setGeneratedCode(null)
    setShowCharacterQuestion(false)
    setIsWalkingCharacter(false)

    // Regenerate
    handleGenerate()
  }, [handleGenerate])

  if (!isOpen) return null

  return (
    <div class="modal-overlay" onClick={onClose}>
      <div class="modal modal--xl" onClick={(e) => e.stopPropagation()}>
        <div class="modal__header">
          <span class="modal__title">Generate Asset</span>
          <button class="btn btn--icon btn--ghost" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width: 14px; height: 14px">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div class="modal__body">
          {/* Prompt input */}
          <div class="field" style="margin-bottom: var(--sp-4)">
            <label class="field__label">Describe your 3D asset</label>
            <textarea
              class="input"
              value={prompt}
              onInput={(e) => setPrompt(e.target.value)}
              placeholder="e.g., friendly robot, medieval knight, wooden barrel..."
              style="height: 80px; resize: vertical"
              disabled={isGenerating}
            />
          </div>

          {/* Suggested prompts */}
          <div style="margin-bottom: var(--sp-4)">
            <div class="field__label" style="margin-bottom: var(--sp-2)">Suggestions</div>
            <div style="display: flex; flex-wrap: wrap; gap: var(--sp-1)">
              {SUGGESTED_PROMPTS.map(p => (
                <button
                  key={p}
                  class="btn btn--sm"
                  onClick={() => setPrompt(p)}
                  disabled={isGenerating}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Preview area */}
          <div
            ref={previewRef}
            class="asset-preview-container"
          >
            {isGenerating && (
              <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(23,23,23,0.7); display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 10">
                <div style="width: 24px; height: 24px; border: 2px solid var(--gray-600); border-top-color: var(--white); border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: var(--sp-3)" />
                <div style="font-size: var(--text-sm); color: var(--white)">{progress}</div>
              </div>
            )}
          </div>

          {/* Error message with suggestions */}
          {error && (
            <div style="margin-top: var(--sp-3); padding: var(--sp-3); background: rgba(185, 28, 28, 0.1); border: 1px solid var(--negative); border-radius: var(--radius-sm); font-size: var(--text-sm)">
              <div style="color: var(--negative); margin-bottom: errorSuggestions.length > 0 ? 'var(--sp-2)' : '0'">
                {error}
              </div>
              {errorSuggestions.length > 0 && (
                <div style="color: var(--text-secondary); border-top: 1px solid var(--line); padding-top: var(--sp-2); margin-top: var(--sp-2)">
                  <div style="font-weight: 500; margin-bottom: var(--sp-1)">Try:</div>
                  <ul style="margin: 0; padding-left: var(--sp-4)">
                    {errorSuggestions.map((suggestion, i) => (
                      <li key={i} style="margin-bottom: var(--sp-1)">{suggestion}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Walking character question */}
          {showCharacterQuestion && generatedAsset && (
            <div style="margin-top: var(--sp-4); padding: var(--sp-3); background: var(--gray-50); border: 1px solid var(--line); border-radius: var(--radius-sm)">
              <div style="font-size: var(--text-sm); margin-bottom: var(--sp-2); color: var(--text-secondary)">
                Does this character walk?
              </div>
              <div style="display: flex; gap: var(--sp-2)">
                <button
                  class={isWalkingCharacter ? 'btn btn--primary' : 'btn'}
                  onClick={() => setIsWalkingCharacter(true)}
                  style="flex: 1"
                >
                  Yes, it walks
                </button>
                <button
                  class={!isWalkingCharacter ? 'btn btn--primary' : 'btn'}
                  onClick={() => setIsWalkingCharacter(false)}
                  style="flex: 1"
                >
                  No, static only
                </button>
              </div>
            </div>
          )}

          {/* Success message */}
          {generatedAsset && !isGenerating && (
            <div style="margin-top: var(--sp-3); font-size: var(--text-sm); color: var(--positive)">
              {progress}
            </div>
          )}
        </div>

        <div class="modal__footer">
          <button class="btn btn--ghost" onClick={onClose} disabled={isGenerating}>
            Cancel
          </button>

          {!generatedAsset ? (
            <button
              class="btn btn--primary"
              onClick={handleGenerate}
              disabled={!prompt.trim() || isGenerating}
            >
              {isGenerating ? 'Generating...' : 'Generate'}
            </button>
          ) : (
            <>
              <button
                class="btn"
                onClick={handleGenerateMore}
                disabled={isGenerating}
                title="Discard current and generate a new asset"
              >
                Generate New
              </button>
              <button class="btn btn--primary" onClick={handleKeep}>
                Keep Asset
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
