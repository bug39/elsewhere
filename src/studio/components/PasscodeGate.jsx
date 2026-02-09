import { useState } from 'preact/hooks'

export function PasscodeGate({ onAuthenticated }) {
  const [passcode, setPasscode] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!passcode.trim() || loading) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: passcode.trim() })
      })

      if (res.ok) {
        onAuthenticated()
      } else {
        setError('Invalid passcode')
        setPasscode('')
      }
    } catch {
      setError('Connection error — please try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div class="passcode-gate">
      <div class="passcode-gate__card">
        <h1 class="passcode-gate__title">elsewhere</h1>
        <p class="passcode-gate__subtitle">3D Studio for Living Worlds</p>

        <form onSubmit={handleSubmit} class="passcode-gate__form">
          <input
            type="password"
            class="input"
            placeholder="Enter passcode"
            value={passcode}
            onInput={(e) => setPasscode(e.target.value)}
            autoFocus
            disabled={loading}
          />

          {error && (
            <p class="passcode-gate__error">{error}</p>
          )}

          <button
            type="submit"
            class="btn btn--primary"
            disabled={!passcode.trim() || loading}
            style="width: 100%"
          >
            {loading ? 'Verifying...' : 'Enter'}
          </button>
        </form>
      </div>
    </div>
  )
}
