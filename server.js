import express from 'express'
import cookieParser from 'cookie-parser'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const app = express()
const PORT = process.env.PORT || 8080
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const SESSION_COOKIE = 'elsewhere_session'
const SESSION_ID_COOKIE = 'elsewhere_sid'
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000
const PROXY_BODY_LIMIT = '12mb'
const PROXY_UPSTREAM_TIMEOUT_MS = 70 * 1000
const MAX_PROMPT_TEXT_CHARS = 50_000
const MAX_INLINE_IMAGE_PARTS = 8
const MAX_INLINE_IMAGE_BASE64_CHARS = 8 * 1024 * 1024
const MAX_OUTPUT_TOKENS = 4096
const MAX_THINKING_BUDGET = 2048
const ALLOWED_IMAGEN_ASPECT_RATIOS = new Set(['1:1', '3:4', '4:3', '9:16', '16:9'])
const ALLOWED_IMAGEN_IMAGE_SIZES = new Set(['1K', '2K'])
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "form-action 'self'"
].join('; ')

// Allowed proxy targets — only these model:action pairs can be forwarded
const ALLOWED_ENDPOINTS = new Set([
  'gemini-3-flash-preview:generateContent',
  'imagen-4.0-generate-001:predict'
])

// --- Rate Limiting ---

const authAttempts = new Map() // ip -> { count, resetAt }
const AUTH_WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const AUTH_MAX_ATTEMPTS = 10

const proxyRequests = new Map() // ip -> { count, resetAt }
const PROXY_WINDOW_MS = 60 * 1000 // 1 minute
const PROXY_MAX_REQUESTS = 30

function rateLimit(store, maxAttempts, windowMs, keyFn = req => req.ip || 'unknown') {
  return (req, res, next) => {
    const key = keyFn(req) || 'unknown'
    const now = Date.now()
    const record = store.get(key)

    if (store.size > 5000) {
      for (const [k, v] of store.entries()) {
        if (now > v.resetAt) store.delete(k)
      }
    }

    if (!record || now > record.resetAt) {
      store.set(key, { count: 1, resetAt: now + windowMs })
      return next()
    }

    record.count++
    if (record.count > maxAttempts) {
      return res.status(429).json({ error: 'Too many requests. Try again later.' })
    }
    next()
  }
}

// --- Middleware ---

const COOKIE_SECRET = process.env.SESSION_SECRET || process.env.GEMINI_API_KEY || crypto.randomBytes(32).toString('hex')
app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(cookieParser(COOKIE_SECRET))

// Security headers
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  })
  next()
})

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

// Static files (Vite build output)
app.use(express.static(join(__dirname, 'dist')))

function getExpectedOrigin(req) {
  const forwardedProto = req.get('x-forwarded-proto')
  const proto = forwardedProto ? forwardedProto.split(',')[0].trim() : req.protocol
  return `${proto}://${req.get('host')}`
}

function requireTrustedOrigin(req, res, next) {
  const expectedOrigin = getExpectedOrigin(req)
  const origin = req.get('origin')

  if (origin && origin !== expectedOrigin) {
    return res.status(403).json({ error: 'Forbidden origin' })
  }

  const referer = req.get('referer')
  if (!origin && referer) {
    try {
      const refererOrigin = new URL(referer).origin
      if (refererOrigin !== expectedOrigin) {
        return res.status(403).json({ error: 'Forbidden origin' })
      }
    } catch {
      return res.status(403).json({ error: 'Forbidden origin' })
    }
  }

  next()
}

function requireJsonContentType(req, res, next) {
  if (!req.is('application/json')) {
    return res.status(415).json({ error: 'Content-Type must be application/json' })
  }
  next()
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function sanitizeGenerateContentPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Invalid request body')
  }

  const payload = structuredClone(body)
  if (!Array.isArray(payload.contents) || payload.contents.length === 0) {
    throw new Error('Invalid request body')
  }

  let totalTextChars = 0
  let inlineImageParts = 0
  let inlineImageChars = 0

  function inspectParts(parts) {
    if (!Array.isArray(parts)) return
    for (const part of parts) {
      if (!part || typeof part !== 'object') continue
      if (typeof part.text === 'string') {
        totalTextChars += part.text.length
      }
      if (part.inlineData && typeof part.inlineData === 'object' && typeof part.inlineData.data === 'string') {
        inlineImageParts++
        inlineImageChars += part.inlineData.data.length
      }
    }
  }

  for (const content of payload.contents) {
    inspectParts(content?.parts)
  }
  inspectParts(payload.systemInstruction?.parts)

  if (totalTextChars > MAX_PROMPT_TEXT_CHARS) {
    throw new Error('Prompt too large')
  }
  if (inlineImageParts > MAX_INLINE_IMAGE_PARTS || inlineImageChars > MAX_INLINE_IMAGE_BASE64_CHARS) {
    throw new Error('Image payload too large')
  }

  if (!payload.generationConfig || typeof payload.generationConfig !== 'object' || Array.isArray(payload.generationConfig)) {
    payload.generationConfig = {}
  }

  payload.generationConfig.maxOutputTokens = clampInt(
    payload.generationConfig.maxOutputTokens,
    1,
    MAX_OUTPUT_TOKENS,
    2048
  )

  if ('temperature' in payload.generationConfig) {
    payload.generationConfig.temperature = clampNumber(payload.generationConfig.temperature, 0, 2, 1)
  }

  if (payload.generationConfig.thinkingConfig && typeof payload.generationConfig.thinkingConfig === 'object') {
    payload.generationConfig.thinkingConfig.thinkingBudget = clampInt(
      payload.generationConfig.thinkingConfig.thinkingBudget,
      0,
      MAX_THINKING_BUDGET,
      0
    )
  }

  if (payload.tools) delete payload.tools
  if (payload.cachedContent) delete payload.cachedContent
  return payload
}

function sanitizeImagenPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Invalid request body')
  }

  const prompt = body.instances?.[0]?.prompt
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new Error('Prompt required')
  }

  const normalizedPrompt = prompt.trim()
  if (normalizedPrompt.length > 2000) {
    throw new Error('Prompt too large')
  }

  const params = body.parameters && typeof body.parameters === 'object' ? body.parameters : {}
  const sampleCount = clampInt(params.sampleCount, 1, 4, 1)
  const aspectRatio = ALLOWED_IMAGEN_ASPECT_RATIOS.has(params.aspectRatio) ? params.aspectRatio : '1:1'
  const imageSize = ALLOWED_IMAGEN_IMAGE_SIZES.has(params.imageSize) ? params.imageSize : '1K'
  const personGeneration = params.personGeneration === 'allow_adult' ? 'allow_adult' : 'dont_allow'

  return {
    instances: [{ prompt: normalizedPrompt }],
    parameters: {
      sampleCount,
      aspectRatio,
      imageSize,
      personGeneration
    }
  }
}

function sanitizeProxyPayload(endpoint, body) {
  if (endpoint.endsWith(':generateContent')) {
    return sanitizeGenerateContentPayload(body)
  }
  if (endpoint === 'imagen-4.0-generate-001:predict') {
    return sanitizeImagenPayload(body)
  }
  throw new Error('Endpoint not allowed')
}

// --- Auth ---

app.post(
  '/api/auth',
  requireTrustedOrigin,
  rateLimit(authAttempts, AUTH_MAX_ATTEMPTS, AUTH_WINDOW_MS),
  requireJsonContentType,
  express.json({ limit: '1kb' }),
  (req, res) => {
  const { passcode } = req.body
  if (!process.env.JUDGE_PASSCODE) {
    return res.status(500).json({ error: 'Server passcode not configured' })
  }
  if (typeof passcode !== 'string' || passcode.length === 0 || passcode.length > 128) {
    return res.status(400).json({ error: 'Passcode required' })
  }

  // Timing-safe comparison to prevent side-channel attacks
  const a = Buffer.from(passcode)
  const b = Buffer.from(process.env.JUDGE_PASSCODE)
  const match = a.length === b.length && crypto.timingSafeEqual(a, b)

  if (match) {
    const cookieOptions = {
      httpOnly: true,
      signed: true,
      secure: process.env.NODE_ENV !== 'development',
      sameSite: 'strict',
      maxAge: SESSION_MAX_AGE_MS,
      path: '/'
    }

    res.cookie(SESSION_COOKIE, 'authenticated', cookieOptions)
    res.cookie(SESSION_ID_COOKIE, crypto.randomUUID(), cookieOptions)
    res.json({ ok: true })
  } else {
    res.status(401).json({ error: 'Invalid passcode' })
  }
  }
)

app.get('/api/auth/check', (req, res) => {
  const authenticated = (
    req.signedCookies[SESSION_COOKIE] === 'authenticated' &&
    typeof req.signedCookies[SESSION_ID_COOKIE] === 'string'
  )
  res.json({ authenticated })
})

function requireAuth(req, res, next) {
  const authenticated = req.signedCookies[SESSION_COOKIE] === 'authenticated'
  const sessionId = req.signedCookies[SESSION_ID_COOKIE]

  if (authenticated && typeof sessionId === 'string' && sessionId.length > 0) {
    next()
  } else {
    res.status(401).json({ error: 'Not authenticated' })
  }
}

// --- Gemini API Proxy ---

app.post('/api/proxy/*',
  requireAuth,
  requireTrustedOrigin,
  rateLimit(
    proxyRequests,
    PROXY_MAX_REQUESTS,
    PROXY_WINDOW_MS,
    req => `sid:${req.signedCookies[SESSION_ID_COOKIE] || req.ip}`
  ),
  requireJsonContentType,
  express.json({ limit: PROXY_BODY_LIMIT }),
  async (req, res) => {
    const endpoint = req.params[0]

    if (!ALLOWED_ENDPOINTS.has(endpoint)) {
      return res.status(403).json({ error: 'Endpoint not allowed' })
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return res.status(500).json({ error: 'Server API key not configured' })
    }

    let payload
    try {
      payload = sanitizeProxyPayload(endpoint, req.body)
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Invalid request' })
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), PROXY_UPSTREAM_TIMEOUT_MS)

    try {
      const response = await fetch(`${GEMINI_BASE}/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      })

      const contentType = response.headers.get('content-type') || 'application/json'
      const data = await response.text()
      res.status(response.status).set('Content-Type', contentType).send(data)
    } catch (err) {
      if (err.name === 'AbortError') {
        return res.status(504).json({ error: 'Generation service timeout' })
      }
      console.error('[proxy] Error:', err.message)
      res.status(502).json({ error: 'Generation service unavailable' })
    } finally {
      clearTimeout(timeoutId)
    }
  }
)

app.use((err, req, res, next) => {
  if (!req.path.startsWith('/api/')) return next(err)

  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large' })
  }
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON body' })
  }

  console.error('[server] Unhandled API error:', err.message)
  return res.status(500).json({ error: 'Server error' })
})

// SPA fallback — serve index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'))
})

app.listen(PORT, () => {
  console.log(`elsewhere server listening on port ${PORT}`)
  console.log(`  Passcode: ${process.env.JUDGE_PASSCODE ? 'configured' : 'NOT SET — set JUDGE_PASSCODE'}`)
  console.log(`  API key:  ${process.env.GEMINI_API_KEY ? 'configured' : 'NOT SET — set GEMINI_API_KEY'}`)
  console.log(`  Session secret: ${process.env.SESSION_SECRET ? 'configured' : 'using fallback (set SESSION_SECRET for production)'}`)
})
