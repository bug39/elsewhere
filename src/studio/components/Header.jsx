import { useState, useEffect, useRef } from 'preact/hooks'
import { Tooltip } from './Tooltip'
import { InlineEditableText } from './InlineEditableText'
import { modSymbol } from '../../shared/platform'

/**
 * Format relative time (e.g., "just now", "30s ago", "2m ago")
 */
function formatRelativeTime(timestamp) {
  if (!timestamp) return ''
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.floor(minutes / 60)}h ago`
}

function SaveStatus({ isSaving, isDirty }) {
  const [lastSaveTime, setLastSaveTime] = useState(null)
  const [saveAnimating, setSaveAnimating] = useState(false)
  const wasUnsavedRef = useRef(isDirty || isSaving)

  // Track transitions to saved state
  useEffect(() => {
    const wasUnsaved = wasUnsavedRef.current
    wasUnsavedRef.current = isDirty || isSaving

    // Just finished saving (was unsaved/saving, now is clean)
    if (wasUnsaved && !isDirty && !isSaving) {
      setLastSaveTime(Date.now())
      setSaveAnimating(true)
      const timer = setTimeout(() => setSaveAnimating(false), 1000)
      return () => clearTimeout(timer)
    }
  }, [isDirty, isSaving])

  // Update relative time every 10 seconds
  const [, forceUpdate] = useState(0)
  useEffect(() => {
    if (!lastSaveTime) return
    const interval = setInterval(() => forceUpdate(n => n + 1), 10000)
    return () => clearInterval(interval)
  }, [lastSaveTime])

  if (isSaving) {
    return (
      <span class="save-status save-status--saving" title="Saving...">
        <span class="save-status__dot" />
        <span>Saving</span>
      </span>
    )
  }

  if (isDirty) {
    return (
      <Tooltip content="Auto-saves every 60s" position="bottom">
        <span class="save-status save-status--unsaved" title="Unsaved changes">
          <span class="save-status__dot" />
          <span>Unsaved</span>
        </span>
      </Tooltip>
    )
  }

  return (
    <span
      class={`save-status save-status--saved ${saveAnimating ? 'save-status--animating' : ''}`}
      title="All changes saved"
    >
      <span class="save-status__dot" />
      <span>Saved</span>
      {lastSaveTime && (
        <span class="save-status__time">{formatRelativeTime(lastSaveTime)}</span>
      )}
    </span>
  )
}

export function Header({ worldName, mode, onPlay, onStopPlay, onSave, onHome, onShowHelp, onShowSettings, onShowSceneGenerator, onWorldNameChange, isSaving, isDirty }) {
  return (
    <header class="header">
      <div class="header-left">
        <span class="header-logo" onClick={onHome} role="button" tabIndex={0} aria-label="Go to home screen">elsewhere</span>
        <span class="header-world-name">
          <InlineEditableText
            value={worldName}
            onSave={onWorldNameChange}
            placeholder="Untitled"
            maxLength={50}
          />
        </span>
        {mode === 'edit' && <SaveStatus isSaving={isSaving} isDirty={isDirty} />}
        <span class={`header-mode-badge header-mode-badge--${mode}`}>
          {mode === 'edit' ? 'EDIT' : 'PLAY'}
        </span>
      </div>

      <div class="header-right">
        {mode === 'edit' && (
          <>
            <Tooltip content="Render settings" position="bottom">
              <button
                class="btn btn--ghost"
                onClick={onShowSettings}
                aria-label="Render settings"
              >
                ⚙
              </button>
            </Tooltip>
          </>
        )}
        <Tooltip content="Keyboard shortcuts" shortcut="?" position="bottom">
          <button
            class="btn btn--ghost header-help-btn"
            onClick={onShowHelp}
            aria-label="Help"
          >
            ?
          </button>
        </Tooltip>
        {mode === 'edit' && (
          <>
            <Tooltip content="Save world" shortcut={`${modSymbol()}S`} position="bottom">
              <button
                class={`btn btn--ghost ${isSaving ? 'btn--loading' : ''}`}
                onClick={onSave}
                disabled={isSaving}
                aria-label={isSaving ? 'Saving...' : 'Save world'}
              >
                {isSaving && <span class="btn__spinner" />}
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </Tooltip>
            {/* Play button removed for hackathon demo */}
          </>
        )}
        {mode === 'play' && (
          <Tooltip content="Exit play mode" shortcut="Esc" position="bottom">
            <button class="btn btn--secondary" onClick={onStopPlay} aria-label="Stop playing">Stop</button>
          </Tooltip>
        )}
      </div>
    </header>
  )
}
