import { Component } from 'preact'
import { logError } from '../../shared/telemetry'

/**
 * Error boundary component for catching and displaying React errors gracefully.
 *
 * Prevents full app crashes by:
 * - Catching errors in child component tree
 * - Logging errors to telemetry
 * - Displaying user-friendly error message with recovery options
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    }
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render shows the fallback UI
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    // Log error to telemetry
    logError(
      error?.message || 'Unknown error',
      error?.stack,
      errorInfo?.componentStack?.split('\n')[1]?.trim() || 'ErrorBoundary'
    )

    this.setState({ errorInfo })

    // Also log to console for development
    console.error('[ErrorBoundary] Caught error:', error, errorInfo)
  }

  handleReload = () => {
    window.location.reload()
  }

  handleDismiss = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    })
  }

  handleCopyError = () => {
    const { error, errorInfo } = this.state
    const errorText = `
Error: ${error?.message || 'Unknown error'}
Stack: ${error?.stack || 'No stack trace'}
Component: ${errorInfo?.componentStack || 'Unknown'}
Time: ${new Date().toISOString()}
URL: ${window.location.href}
    `.trim()

    navigator.clipboard?.writeText(errorText).then(() => {
      alert('Error details copied to clipboard')
    }).catch(() => {
      // Fallback: show in prompt
      prompt('Copy this error:', errorText)
    })
  }

  render() {
    if (this.state.hasError) {
      const { error } = this.state

      // Check if this is a recoverable error
      const isRecoverable = this.props.recoverable !== false

      return (
        <div class="error-boundary">
          <div class="error-boundary-content">
            <div class="error-boundary-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>

            <h2>Something went wrong</h2>

            <p class="error-boundary-message">
              {error?.message || 'An unexpected error occurred'}
            </p>

            <div class="error-boundary-actions">
              {isRecoverable && (
                <button
                  class="error-boundary-button primary"
                  onClick={this.handleDismiss}
                >
                  Try Again
                </button>
              )}

              <button
                class="error-boundary-button"
                onClick={this.handleReload}
              >
                Reload Page
              </button>

              <button
                class="error-boundary-button secondary"
                onClick={this.handleCopyError}
              >
                Copy Error Details
              </button>
            </div>

            <p class="error-boundary-help">
              If this keeps happening, please{' '}
              <a
                href="https://github.com/bug39/thinq/issues"
                target="_blank"
                rel="noopener noreferrer"
              >
                report the issue
              </a>
            </p>
          </div>

          <style>{`
            .error-boundary {
              position: fixed;
              top: 0;
              left: 0;
              right: 0;
              bottom: 0;
              display: flex;
              align-items: center;
              justify-content: center;
              background: rgba(0, 0, 0, 0.8);
              z-index: 10000;
              padding: 20px;
            }

            .error-boundary-content {
              background: var(--dark-bg);
              border-radius: 12px;
              padding: 32px;
              max-width: 480px;
              text-align: center;
              color: var(--white);
              box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
            }

            .error-boundary-icon {
              color: var(--negative);
              margin-bottom: 16px;
            }

            .error-boundary h2 {
              margin: 0 0 12px 0;
              font-size: 24px;
              font-weight: 600;
            }

            .error-boundary-message {
              color: var(--dark-text-muted);
              margin: 0 0 24px 0;
              font-size: 14px;
              word-break: break-word;
            }

            .error-boundary-actions {
              display: flex;
              flex-wrap: wrap;
              gap: 12px;
              justify-content: center;
              margin-bottom: 20px;
            }

            .error-boundary-button {
              padding: 10px 20px;
              border-radius: 6px;
              font-size: 14px;
              font-weight: 500;
              cursor: pointer;
              border: 1px solid var(--dark-border);
              background: var(--dark-bg-alt);
              color: var(--white);
              transition: all 0.2s;
            }

            .error-boundary-button:hover {
              background: var(--dark-border);
            }

            .error-boundary-button.primary {
              background: var(--accent);
              border-color: var(--accent);
            }

            .error-boundary-button.primary:hover {
              background: var(--accent-hover);
              border-color: var(--accent-hover);
            }

            .error-boundary-button.secondary {
              background: transparent;
              border-color: var(--dark-border);
            }

            .error-boundary-help {
              font-size: 12px;
              color: var(--dark-text-muted);
              margin: 0;
            }

            .error-boundary-help a {
              color: var(--accent);
              text-decoration: none;
            }

            .error-boundary-help a:hover {
              text-decoration: underline;
            }
          `}</style>
        </div>
      )
    }

    return this.props.children
  }
}

/**
 * HOC to wrap a component with error boundary
 * @param {Function} WrappedComponent - Component to wrap
 * @param {Object} options - Error boundary options
 * @returns {Function} Wrapped component
 */
export function withErrorBoundary(WrappedComponent, options = {}) {
  return function WithErrorBoundary(props) {
    return (
      <ErrorBoundary {...options}>
        <WrappedComponent {...props} />
      </ErrorBoundary>
    )
  }
}
