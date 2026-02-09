import { Tooltip } from './Tooltip'

const TRANSFORM_MODES = [
  {
    id: 'translate',
    label: 'Move',
    shortcut: 'G',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l3-3-3-3M19 9l-3 3 3 3M12 3v18M3 12h18"/>
      </svg>
    )
  },
  {
    id: 'rotate',
    label: 'Rotate',
    shortcut: 'R',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M21 12a9 9 0 11-6.2-8.6"/>
        <path d="M21 3v5h-5"/>
      </svg>
    )
  },
  {
    id: 'scale',
    label: 'Scale',
    shortcut: 'S',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M21 21l-6-6m6 6v-5m0 5h-5"/>
        <path d="M3 3l6 6M3 3v5m0-5h5"/>
        <rect x="8" y="8" width="8" height="8" rx="1"/>
      </svg>
    )
  }
]

const TOOLS = [
  {
    id: 'select',
    label: 'Select',
    shortcut: 'V',
    hint: null,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
      </svg>
    )
  },
  {
    id: 'terrain',
    label: 'Terrain',
    shortcut: 'T',
    hint: 'L-click raise, R-click lower',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M3 20l5-10 4 6 4-8 5 12H3z"/>
      </svg>
    )
  },
  {
    id: 'delete',
    label: 'Delete',
    shortcut: 'X',
    hint: null,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
      </svg>
    )
  }
]

export function Toolbar({ currentTool, onToolChange, selection, transformMode, onTransformModeChange }) {
  const showTransformModes = selection?.instanceId && currentTool === 'select'

  return (
    <div class={`toolbar ${showTransformModes ? 'toolbar--expanded' : ''}`}>
      {/* First row: Select tool + transform modes when expanded */}
      <div class="toolbar-row">
        <Tooltip content="Select" shortcut="V" position="right">
          <button
            class={`tool-btn ${currentTool === 'select' ? 'tool-btn--active' : ''}`}
            onClick={() => onToolChange('select')}
            aria-label="Select (V)"
          >
            {TOOLS[0].icon}
          </button>
        </Tooltip>

        {/* Transform modes extend from the toolbar when asset selected */}
        {showTransformModes && (
          <div class="toolbar-transform-modes">
            <div class="toolbar-divider--vertical" />
            {TRANSFORM_MODES.map(mode => (
              <Tooltip
                key={mode.id}
                content={mode.label}
                shortcut={mode.shortcut}
                position="bottom"
                delay={150}
              >
                <button
                  class={`tool-btn tool-btn--sm ${transformMode === mode.id ? 'tool-btn--active' : ''}`}
                  onClick={() => onTransformModeChange(mode.id)}
                  aria-label={`${mode.label} (${mode.shortcut})`}
                >
                  {mode.icon}
                </button>
              </Tooltip>
            ))}
          </div>
        )}
      </div>

      <div class="toolbar-divider" />

      {/* Remaining tools */}
      {TOOLS.slice(1).map(tool => (
        <Tooltip
          key={tool.id}
          content={tool.label}
          shortcut={tool.shortcut}
          hint={tool.hint}
          position="right"
        >
          <button
            class={`tool-btn ${currentTool === tool.id ? 'tool-btn--active' : ''}`}
            onClick={() => onToolChange(tool.id)}
            aria-label={`${tool.label} (${tool.shortcut})`}
          >
            {tool.icon}
          </button>
        </Tooltip>
      ))}
    </div>
  )
}
