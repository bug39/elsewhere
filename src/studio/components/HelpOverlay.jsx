import { useEffect } from 'preact/hooks'
import { modKey } from '../../shared/platform'

/**
 * Help overlay showing keyboard shortcuts
 */
export function HelpOverlay({ onClose }) {
  const mod = modKey()
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Escape' || e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault()
        onClose?.()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div class="help-overlay" onClick={onClose}>
      <div class="help-modal" onClick={(e) => e.stopPropagation()}>
        <div class="help-header">
          <h2>Keyboard Shortcuts</h2>
          <button class="help-close" onClick={onClose}>×</button>
        </div>

        <div class="help-sections">
          <div class="help-section">
            <h3>Global</h3>
            <div class="help-shortcuts">
              <div class="help-shortcut"><kbd>?</kbd><span>Show help</span></div>
              <div class="help-shortcut"><kbd>{mod}+S</kbd><span>Save world</span></div>
              <div class="help-shortcut"><kbd>{mod}+Enter</kbd><span>Enter play mode</span></div>
              <div class="help-shortcut"><kbd>Esc</kbd><span>Exit play / Deselect</span></div>
              <div class="help-shortcut"><kbd>Home</kbd><span>Reset camera view</span></div>
              <div class="help-shortcut"><kbd>H</kbd><span>Toggle UI panels</span></div>
            </div>
          </div>

          <div class="help-section">
            <h3>Tools</h3>
            <div class="help-shortcuts">
              <div class="help-shortcut"><kbd>1</kbd> / <kbd>V</kbd><span>Select tool</span></div>
              <div class="help-shortcut"><kbd>2</kbd> / <kbd>T</kbd><span>Terrain tool</span></div>
              <div class="help-shortcut"><kbd>3</kbd> / <kbd>X</kbd><span>Delete tool</span></div>
              <div class="help-shortcut"><kbd>Space</kbd><span>Toggle last tool</span></div>
            </div>
          </div>

          <div class="help-section">
            <h3>Transform</h3>
            <div class="help-shortcuts">
              <div class="help-shortcut"><kbd>G</kbd><span>Move (translate)</span></div>
              <div class="help-shortcut"><kbd>R</kbd><span>Rotate</span></div>
              <div class="help-shortcut"><kbd>S</kbd><span>Scale</span></div>
              <div class="help-shortcut"><kbd>F</kbd><span>Focus on selection</span></div>
              <div class="help-shortcut"><kbd>Shift</kbd><span>Snap to grid</span></div>
              <div class="help-shortcut"><kbd>Alt</kbd><span>Lock to ground</span></div>
            </div>
          </div>

          <div class="help-section">
            <h3>Edit</h3>
            <div class="help-shortcuts">
              <div class="help-shortcut"><kbd>{mod}+Z</kbd><span>Undo</span></div>
              <div class="help-shortcut"><kbd>{mod}+Shift+Z</kbd><span>Redo</span></div>
              <div class="help-shortcut"><kbd>Delete</kbd><span>Delete selected</span></div>
              <div class="help-shortcut"><kbd>{mod}+Click</kbd><span>Select part</span></div>
              <div class="help-shortcut"><kbd>Tab</kbd><span>Next asset (nearest)</span></div>
              <div class="help-shortcut"><kbd>Shift+Tab</kbd><span>Previous asset</span></div>
            </div>
          </div>

          <div class="help-section">
            <h3>Panels</h3>
            <div class="help-shortcuts">
              <div class="help-shortcut"><kbd>[</kbd><span>Toggle library</span></div>
            </div>
          </div>

          <div class="help-section">
            <h3>Dialogue</h3>
            <div class="help-shortcuts">
              <div class="help-shortcut"><kbd>1-4</kbd><span>Select choice</span></div>
              <div class="help-shortcut"><kbd>Space</kbd><span>Continue / Skip</span></div>
            </div>
          </div>
        </div>

        <div class="help-footer">
          Press <kbd>?</kbd> or <kbd>Esc</kbd> to close
        </div>
      </div>

      <style>{`
        .help-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2000;
          animation: fadeIn 0.15s ease-out;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .help-modal {
          background: var(--surface);
          border-radius: 12px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
          max-width: 600px;
          width: 90%;
          max-height: 80vh;
          overflow: auto;
          animation: slideUp 0.2s ease-out;
        }

        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }

        .help-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid var(--line);
        }

        .help-header h2 {
          margin: 0;
          font-size: 18px;
          font-weight: 600;
          color: var(--text);
        }

        .help-close {
          background: none;
          border: none;
          font-size: 24px;
          cursor: pointer;
          color: var(--text-secondary);
          padding: 4px 8px;
          line-height: 1;
        }

        .help-close:hover {
          color: var(--text);
        }

        .help-sections {
          padding: 16px 20px;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 20px;
        }

        .help-section h3 {
          margin: 0 0 12px 0;
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-secondary);
        }

        .help-shortcuts {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .help-shortcut {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .help-shortcut kbd {
          background: var(--bg-secondary);
          border: 1px solid var(--line);
          border-radius: 4px;
          padding: 2px 8px;
          font-family: inherit;
          font-size: 12px;
          min-width: 32px;
          text-align: center;
          color: var(--text);
        }

        .help-shortcut span {
          font-size: 13px;
          color: var(--text);
        }

        .help-footer {
          padding: 12px 20px;
          border-top: 1px solid var(--line);
          text-align: center;
          font-size: 12px;
          color: var(--text-secondary);
        }

        .help-footer kbd {
          background: var(--bg-secondary);
          border: 1px solid var(--line);
          border-radius: 4px;
          padding: 1px 6px;
          font-family: inherit;
          font-size: 11px;
        }
      `}</style>
    </div>
  )
}
