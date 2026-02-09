import { useState, useEffect } from 'preact/hooks'
import { LIGHTING_PRESETS, SHADOW_QUALITY } from '../../shared/constants'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { getSessionUsage, clearSessionUsage } from '../../generator/tokenUsage'
import { dismissAllTooltips } from '../state/tooltipState'

const SETTINGS_KEY = 'thinq-render-settings'

const DEFAULT_SETTINGS = {
  lightingPreset: 'soft',
  saturation: 1.0,
  shadowLift: 0.08,
  postProcessing: true,
  shadowQuality: 'high'
}

/**
 * Load settings from localStorage with defaults
 * @returns {Object}
 */
export function loadSettings() {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY)
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) }
    }
  } catch {
    // Ignore parse errors
  }
  return { ...DEFAULT_SETTINGS }
}

/**
 * Save settings to localStorage
 * @param {Object} settings
 */
export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Ignore storage errors
  }
}

export function SettingsModal({ isOpen, onClose, rendererRef }) {
  const [settings, setSettings] = useState(loadSettings)
  const [usage, setUsage] = useState(getSessionUsage)
  const modalRef = useFocusTrap(isOpen, onClose)

  // Apply settings to renderer when they change
  useEffect(() => {
    const renderer = rendererRef?.current
    if (!renderer) return

    renderer.applyLightingPreset(settings.lightingPreset)
    renderer.setSaturation(settings.saturation)
    renderer.setShadowLift(settings.shadowLift)
    renderer.setPostProcessingEnabled(settings.postProcessing)
    renderer.setShadowQuality(settings.shadowQuality)
    saveSettings(settings)
  }, [settings, rendererRef])

  // Apply initial settings when modal opens
  useEffect(() => {
    if (isOpen) {
      dismissAllTooltips()
      setSettings(loadSettings())
      setUsage(getSessionUsage())
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleLightingChange = (e) => {
    setSettings(prev => ({ ...prev, lightingPreset: e.target.value }))
  }

  const handleSaturationChange = (e) => {
    setSettings(prev => ({ ...prev, saturation: parseFloat(e.target.value) }))
  }

  const handleShadowLiftChange = (e) => {
    setSettings(prev => ({ ...prev, shadowLift: parseFloat(e.target.value) }))
  }

  const handlePostProcessingChange = (e) => {
    setSettings(prev => ({ ...prev, postProcessing: e.target.checked }))
  }

  const handleShadowQualityChange = (e) => {
    setSettings(prev => ({ ...prev, shadowQuality: e.target.value }))
  }

  const handleReset = () => {
    setSettings({ ...DEFAULT_SETTINGS })
  }

  return (
    <div class="modal-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        class="modal settings-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
      >
        <div class="modal-header">
          <h2 id="settings-modal-title" class="modal-title">Render Settings</h2>
          <button class="modal-close" onClick={onClose} aria-label="Close settings">&times;</button>
        </div>

        <div class="modal-body">
          {/* Lighting Preset */}
          <div class="settings-section">
            <label class="settings-label">Lighting Preset</label>
            <select
              class="input"
              value={settings.lightingPreset}
              onChange={handleLightingChange}
            >
              {Object.values(LIGHTING_PRESETS).map(preset => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>

          {/* Saturation Slider */}
          <div class="settings-section">
            <label class="settings-label">
              Saturation
              <span class="settings-value">{Math.round(settings.saturation * 100)}%</span>
            </label>
            <input
              type="range"
              class="settings-slider"
              min="0"
              max="1"
              step="0.05"
              value={settings.saturation}
              onChange={handleSaturationChange}
            />
          </div>

          {/* Shadow Lift Slider */}
          <div class="settings-section">
            <label class="settings-label">
              Shadow Lift
              <span class="settings-value">{Math.round(settings.shadowLift * 100)}%</span>
            </label>
            <input
              type="range"
              class="settings-slider"
              min="0"
              max="0.3"
              step="0.02"
              value={settings.shadowLift}
              onChange={handleShadowLiftChange}
            />
            <span class="settings-hint">Prevents pure black shadows</span>
          </div>

          {/* Shadow Quality */}
          <div class="settings-section">
            <label class="settings-label">Shadow Quality</label>
            <select
              class="input"
              value={settings.shadowQuality}
              onChange={handleShadowQualityChange}
            >
              {Object.keys(SHADOW_QUALITY).map(quality => (
                <option key={quality} value={quality}>
                  {quality.charAt(0).toUpperCase() + quality.slice(1)}
                </option>
              ))}
            </select>
          </div>

          {/* Post-Processing Toggle */}
          <div class="settings-section settings-checkbox">
            <label class="settings-checkbox-label">
              <input
                type="checkbox"
                checked={settings.postProcessing}
                onChange={handlePostProcessingChange}
              />
              <span>Post-Processing Effects</span>
            </label>
            <span class="settings-hint">Color grading and vignette</span>
          </div>

          {/* API Usage */}
          <div class="settings-section">
            <label class="settings-label">API Usage (This Session)</label>
            <div class="settings-stats">
              <span>{usage.requestCount} requests</span>
              <span class="settings-hint">
                {(usage.totalPromptTokens + usage.totalOutputTokens).toLocaleString()} tokens
                ({usage.totalPromptTokens.toLocaleString()} in, {usage.totalOutputTokens.toLocaleString()} out)
              </span>
            </div>
            <button
              class="btn btn--ghost btn--sm"
              onClick={() => { clearSessionUsage(); setUsage(getSessionUsage()) }}
              style={{ marginTop: '8px' }}
            >
              Clear Stats
            </button>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn--ghost" onClick={handleReset}>
            Reset to Defaults
          </button>
          <button class="btn btn--primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
