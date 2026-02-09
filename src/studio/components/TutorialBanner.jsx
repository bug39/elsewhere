import { useState, useEffect, useRef, useCallback } from 'preact/hooks'
import * as THREE from 'three'

/** Tutorial step definitions — 5 steps, no fluff */
const STEPS = [
  {
    text: "Welcome to elsewhere! Right-click and drag to look around your world.",
    selector: null
  },
  {
    text: "Now just type ANYYTTHHIIINGGG you can imagine — and I'll create it for you!",
    selector: '.generation-section__input'
  },
  {
    text: "Now hit the arrow button to generate it!",
    selector: 'button[data-walkthrough="generation-submit"]'
  },
  {
    text: "When your creation is ready, review it and hit Accept! Then switch to the Library tab to drag it into the world.",
    selector: '.library-tabs button:last-child'
  },
  {
    text: "Click any object to select it. Then press G to move, R to rotate, or S to scale. Have fun building!",
    selector: null
  }
]

const STORAGE_KEY = 'elsewhere-tutorial-dismissed'

/**
 * Build the Snow Fox 3D model directly using Three.js primitives.
 * Same geometry as tutorialWorld.js snowFoxCode but built inline
 * to avoid code-as-string evaluation.
 */
function buildSnowFox() {
  const g = new THREE.Group()
  const furMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, flatShading: true })

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.2), furMat)
  body.position.set(0, 0.22, 0)
  g.add(body)

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.15, 0.16), furMat)
  head.position.set(0.3, 0.28, 0)
  g.add(head)

  const snoutMat = new THREE.MeshStandardMaterial({ color: 0xdde8f0, flatShading: true })
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.08), snoutMat)
  snout.position.set(0.4, 0.24, 0)
  g.add(snout)

  const noseMat = new THREE.MeshStandardMaterial({ color: 0x222222, flatShading: true })
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.015, 4, 4), noseMat)
  nose.position.set(0.44, 0.25, 0)
  g.add(nose)

  // Ears
  for (const oz of [-0.04, 0.04]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 4), furMat)
    ear.position.set(0.28, 0.4, oz)
    g.add(ear)
  }

  // Legs
  const legMat = new THREE.MeshStandardMaterial({ color: 0xdde8f0, flatShading: true })
  for (const [px, pz] of [[-0.15, -0.07], [-0.15, 0.07], [0.15, -0.07], [0.15, 0.07]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.05), legMat)
    leg.position.set(px, 0.06, pz)
    g.add(leg)
  }

  // Tail
  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.08, 5, 4), furMat)
  tail.position.set(-0.32, 0.26, 0)
  tail.scale.set(1.5, 0.8, 0.8)
  g.add(tail)

  let t = 0
  g.userData.animate = (dt) => {
    t += dt
    tail.rotation.y = Math.sin(t * 3) * 0.4
    tail.position.x = -0.32 + Math.sin(t * 3) * 0.02
  }

  return g
}

/**
 * Live 3D fox portrait — renders the Snow Fox in a tiny canvas.
 * 80x80 transparent background, 3/4 angle, animated tail wag.
 * Auto-centers the fox model using bounding box to prevent clipping.
 */
function FoxCanvas() {
  const canvasRef = useRef(null)
  const rendererRef = useRef(null)
  const animateRef = useRef(null)
  const rafRef = useRef(null)

  useEffect(() => {
    if (!canvasRef.current) return

    const size = 80
    const pixelRatio = Math.min(window.devicePixelRatio, 2)

    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      alpha: true,
      antialias: true
    })
    renderer.setSize(size, size)
    renderer.setPixelRatio(pixelRatio)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    rendererRef.current = renderer

    const scene = new THREE.Scene()

    const ambient = new THREE.AmbientLight(0xffffff, 0.7)
    scene.add(ambient)
    const dir = new THREE.DirectionalLight(0xffffff, 1.0)
    dir.position.set(1, 2, 1)
    scene.add(dir)

    const foxGroup = buildSnowFox()
    // Center the fox using its bounding box so it doesn't clip
    const box = new THREE.Box3().setFromObject(foxGroup)
    const center = box.getCenter(new THREE.Vector3())
    foxGroup.position.sub(center)
    scene.add(foxGroup)
    animateRef.current = foxGroup.userData.animate

    // Frame the fox: camera distance based on bounding sphere
    const sphere = box.getBoundingSphere(new THREE.Sphere())
    const fov = 40
    const dist = sphere.radius / Math.tan((fov / 2) * Math.PI / 180) * 1.15
    const camera = new THREE.PerspectiveCamera(fov, 1, 0.01, 10)
    // 3/4 angle from front-right, slightly above
    camera.position.set(dist * 0.2, dist * 0.3, dist)
    camera.lookAt(0, 0, 0)

    let lastTime = performance.now()
    function loop() {
      rafRef.current = requestAnimationFrame(loop)
      const now = performance.now()
      const dt = (now - lastTime) / 1000
      lastTime = now
      if (animateRef.current) animateRef.current(dt)
      renderer.render(scene, camera)
    }
    loop()

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      renderer.dispose()
      rendererRef.current = null
    }
  }, [])

  return <canvas ref={canvasRef} width="80" height="80" class="tutorial-fox-canvas" />
}

/**
 * Pulsing glow ring — positioned over a target DOM element.
 * Uses box-shadow for the glow effect, recalculates on resize.
 */
function GlowRing({ selector }) {
  const [rect, setRect] = useState(null)
  const rafRef = useRef(null)

  const updatePosition = useCallback(() => {
    if (!selector) { setRect(null); return }
    const el = document.querySelector(selector)
    if (!el) { setRect(null); return }
    const r = el.getBoundingClientRect()
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
  }, [selector])

  useEffect(() => {
    updatePosition()

    const ro = new ResizeObserver(() => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(updatePosition)
    })
    ro.observe(document.body)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [selector, updatePosition])

  if (!rect) return null

  return (
    <div
      class="tutorial-glow-ring"
      style={{
        position: 'fixed',
        top: `${rect.top - 3}px`,
        left: `${rect.left - 3}px`,
        width: `${rect.width + 6}px`,
        height: `${rect.height + 6}px`,
        zIndex: 10001,
        pointerEvents: 'none',
        borderRadius: '8px'
      }}
    />
  )
}

/** Steps where the Create tab needs to be active for the glow target to exist */
const CREATE_TAB_STEPS = new Set([1, 2]) // indices: prompt input, generate button

/**
 * Checks if the Library tab is currently active (Create tab content not visible).
 * When the Library tab is selected, .generation-section__input won't be in the DOM.
 */
function isLibraryTabActive() {
  // If the generation input isn't visible, user is on the Library tab
  return !document.querySelector('.generation-section__input')
}

/**
 * TutorialBanner — game-style speech bubble with live 3D fox mascot.
 * 5-step guided walkthrough with pulsing glow rings on target elements.
 * Detects when user navigates to Library tab during Create-focused steps
 * and shows a nudge to switch back.
 */
export function TutorialBanner() {
  const [stepIndex, setStepIndex] = useState(0)
  const [visible, setVisible] = useState(false)
  const [showCreateNudge, setShowCreateNudge] = useState(false)
  const [dismissed, setDismissed] = useState(() => {
    return sessionStorage.getItem(STORAGE_KEY) === 'true'
  })

  // Bounce in on mount
  useEffect(() => {
    if (!dismissed) {
      const t = setTimeout(() => setVisible(true), 100)
      return () => clearTimeout(t)
    }
  }, [dismissed])

  // Auto-advance when the user performs the step's action
  useEffect(() => {
    if (dismissed) return

    let cleanup = null
    switch (stepIndex) {
      case 0: {
        // "Right-click and drag to look around" → advance on right-click
        const handler = (e) => {
          if (e.button === 2) setStepIndex(1)
        }
        document.addEventListener('mousedown', handler)
        cleanup = () => document.removeEventListener('mousedown', handler)
        break
      }
      case 1: {
        // "Type anything" → advance when generation input has text
        const handler = (e) => {
          if (e.target.closest('.generation-section__input') && e.target.value?.trim()) {
            setStepIndex(2)
          }
        }
        document.addEventListener('input', handler)
        cleanup = () => document.removeEventListener('input', handler)
        break
      }
      case 2: {
        // "Hit the arrow button to generate" → advance on generate click
        const handler = (e) => {
          if (e.target.closest('[data-walkthrough="generation-submit"]')) {
            setStepIndex(3)
          }
        }
        document.addEventListener('click', handler)
        cleanup = () => document.removeEventListener('click', handler)
        break
      }
      case 3: {
        // "Switch to Library tab" → advance on library tab click
        const handler = (e) => {
          if (e.target.closest('.library-tabs button:last-child')) {
            setStepIndex(4)
          }
        }
        document.addEventListener('click', handler)
        cleanup = () => document.removeEventListener('click', handler)
        break
      }
      // Step 4: manual "Got it!" only
    }

    return () => { if (cleanup) cleanup() }
  }, [stepIndex, dismissed])

  // Watch for Library tab activation during Create-focused steps
  useEffect(() => {
    if (dismissed || !CREATE_TAB_STEPS.has(stepIndex)) {
      setShowCreateNudge(false)
      return
    }

    // Poll for tab changes (MutationObserver would be heavier for this)
    const interval = setInterval(() => {
      const onLibrary = isLibraryTabActive()
      setShowCreateNudge(onLibrary)
    }, 300)

    return () => clearInterval(interval)
  }, [stepIndex, dismissed])

  const handleNext = useCallback(() => {
    if (stepIndex < STEPS.length - 1) {
      setStepIndex(stepIndex + 1)
    } else {
      handleDismiss()
    }
  }, [stepIndex])

  const handleDismiss = useCallback(() => {
    setVisible(false)
    setTimeout(() => {
      setDismissed(true)
      sessionStorage.setItem(STORAGE_KEY, 'true')
    }, 300)
  }, [])

  if (dismissed) return null

  const step = STEPS[stepIndex]
  const isLastStep = stepIndex === STEPS.length - 1

  // Override text and selector when user is on Library tab during Create steps
  const displayText = showCreateNudge
    ? "Switch to the Create tab first — that's where you can make new things!"
    : step.text
  const displaySelector = showCreateNudge
    ? '.library-tabs button:first-child'
    : step.selector

  return (
    <>
      <div class={`tutorial-banner ${visible ? 'tutorial-banner--visible' : ''}`}>
        <div class="tutorial-banner__fox">
          <FoxCanvas />
        </div>
        <div class="tutorial-banner__bubble">
          <button class="tutorial-banner__dismiss" onClick={handleDismiss} aria-label="Dismiss tutorial" title="Dismiss">
            ×
          </button>
          <div class="tutorial-banner__text">{displayText}</div>
          <div class="tutorial-banner__footer">
            <div class="tutorial-banner__dots">
              {STEPS.map((_, i) => (
                <div
                  key={i}
                  class={`tutorial-banner__dot${i < stepIndex ? ' tutorial-banner__dot--done' : ''}${i === stepIndex ? ' tutorial-banner__dot--current' : ''}`}
                />
              ))}
            </div>
            {!showCreateNudge && (
              <button class="tutorial-banner__next" onClick={handleNext}>
                {isLastStep ? 'Got it!' : 'Next →'}
              </button>
            )}
          </div>
        </div>
      </div>
      {displaySelector && <GlowRing selector={displaySelector} />}
    </>
  )
}
