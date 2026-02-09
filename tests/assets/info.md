We are building a local sandbox that executes model-generated JavaScript to produce interactive 3D “games.” Even if you are not trying to jailbreak anything, generated codex is still untrusted code: it can accidentally (or via dependency compromise) leak secrets, spam the network, or exhaust CPU/GPU. The plan’s objective is to validate the minimum technical feasibility and establish a “middle-ground” safety posture that prevents obvious local harm—especially API key exposure—while preserving creativity (remote assets) and iteration speed (staging/probation).

The plan is split into:

Browser feasibility spikes: confirm the architecture works across Chrome/Firefox/Safari.

Security spike: define concrete sandbox/CSP boundaries that enforce the already-decided policy.

API key isolation: ensure the runtime cannot read or exfiltrate the key even if it tries.

Performance/VRAM: confirm staging swaps don’t degrade over repeated edits.

Genre readiness: confirm we can support multiple game types without a visible kernel menu by using implicit capability packs.

Non-negotiable safety concern: API key exposure

Risk statement: If the browser page that runs the game code also holds an API key (in DOM input, localStorage, global variables, cookies, or anywhere readable), then any code executing in that page (or in an iframe with access) can read and exfiltrate it over the network. This remains true even if you only prompt “game” content.

Therefore the plan must verify:

The generated game code cannot access the key via DOM/storage/memory.

The generated game code cannot exfiltrate via network routes you didn’t intend (including localhost/LAN, or arbitrary external URLs).

If remote assets are allowed, those requests cannot be used as a covert channel to leak secrets (e.g., embedding keys in query strings).

Deliverables your agent must produce

A) A minimal test harness web page (one repo folder) that can:

Run a sandboxed iframe (and optionally two iframes: live + staging).

Inject a candidate module into the iframe (via whichever mechanism is being tested).

Run init/update for N frames, collect timing stats, and report pass/fail.

Run repeated swap cycles (10+), collect memory/VRAM signals (best-effort), and report trends.

B) A written test report (single markdown doc) that includes:

Exact browser versions used (Chrome/Firefox/Safari).

A pass/fail table for each test (below).

Notes on any browser-specific constraints.

C) A security config draft set (pre-BFS candidates) and a post-BFS “final selection” section:

Candidate sandbox attribute strings (not final).

Candidate CSP headers (not final).

A mapping of “policy requirement → enforcement mechanism” (CSP vs runtime vs OS firewall).

D) An API key handling design note:

Where the key lives (must be outside the sandboxed execution context).

How model calls are made (host or local backend).

Proof steps showing the sandbox cannot read it.

Tests to run (what to try, and why)

4.1 Browser Feasibility Spikes (architecture blockers)

BFS-1: Blob URL ES module import inside sandboxed iframe without allow-same-origin
Why: Determines if we can load generated modules via Blob URLs while keeping strong origin isolation (opaque origin).
Method: iframe with sandbox allow-scripts only. Create Blob URL for module, attempt dynamic import inside iframe.
Pass: module executes (init/update run) in Chrome, Firefox, Safari.
Fail action: proceed to BFS-2 and/or alternative loading mechanism.

BFS-2: srcdoc with inline <script type="module"> under sandbox
Why: This is the main fallback if Blob imports don’t work under strong sandboxing.
Method: iframe srcdoc contains a module script that loads provided code via an agreed mechanism (e.g., injected text → Function/eval-like route if allowed, or import maps if used).
Pass: module executes in all three browsers.
Fail action: execute the fallback decision tree (must be specified now): enumerate the next mechanism(s) to try and how to validate them.

BFS-3: Texture/model/audio loading from opaque-origin iframe to a CORS-enabled host
Why: Remote assets are required for better visuals; we need to know the baseline success case.
Method: From inside sandbox, call loaders to a host known to return correct CORS headers.
Pass: asset loads and is usable by WebGL (texture not tainted; model renders).
Fail action: note which assets fail and why; this may force an asset gateway or strict allowlist.

BFS-4: Same asset loads to a typical host (no CORS)
Why: Confirms expected failure and clarifies how often “random URLs” will break the demo.
Pass: Expected to fail; document the failure mode (CORS error, tainted canvas, etc.).
Fail action: If it unexpectedly succeeds in some browsers, document differences.

BFS-5: Two-iframe staging swap + VRAM/memory behavior across cycles
Why: Staging swaps create peak memory usage; repeated swaps may leak GPU resources and degrade.
Method: Create live iframe, create staging iframe, load assets in staging, promote (swap visibility), destroy old. Repeat 10 cycles with identical assets.
Pass criteria: UNSPECIFIED until you decide it. Your current doc(s) contain conflicting criteria; the test report must record metrics so you can pick the criterion after seeing real behavior.
At minimum record: peak memory per cycle (if obtainable), time to settle, and whether there is monotonic growth trend.

4.2 Security Spike (enforcement feasibility)

Goal: Draft enforceable sandbox/CSP that matches your policy: allow remote assets via ctx.assets, forbid remote scripts, forbid raw module fetch/XHR (or at least forbid arbitrary network beyond assets). This must not break asset loading.

SEC-1: DOM isolation test (key leakage attempt)
Why: If iframe can read parent DOM, your API key input is compromised.
Method: Put a fake “API key” string in parent page DOM and in localStorage/sessionStorage; run sandbox code that tries to read it.
Pass: sandbox cannot read parent DOM or parent storage values.
Fail: sandbox config is unacceptable.

SEC-2: Storage isolation test (iframe origin)
Why: If iframe shares origin with host (allow-same-origin or same-origin doc), it might access localStorage/cookies for that origin.
Method: Put fake key in host origin localStorage. Attempt access from sandbox.
Pass: sandbox cannot read it.
Fail: treat as critical; requires architecture change.

SEC-3: Network exfil test (controlled)
Why: Even if sandbox can’t read the key, it may still be able to exfiltrate anything it can access.
Method: In sandbox, attempt network to (a) arbitrary external URL, (b) localhost ports, (c) LAN IP range (if feasible), (d) asset domains.
Pass: Only intended asset routes succeed; arbitrary fetch/XHR is blocked (or absent).
Fail: document exactly what is possible and whether OS firewall is required for “middle ground.”

SEC-4: Script import test
Why: If remote scripts are truly forbidden, model code should not be able to load JS from CDNs.
Method: Attempt import('https://...'), <script src=...>, dynamic insertion, etc.
Pass: blocked by CSP/sandbox constraints.

SEC-5: Covert channel via asset URLs
Why: If sandbox can issue GET requests to arbitrary URLs, it can leak secrets by encoding them into query strings—even without reading responses.
Method: In sandbox, attempt to request an image/audio URL that includes a payload in the query string.
Pass: either (a) requests are limited to allowed domains, or (b) requests are only permitted through ctx.assets with URL policy enforcement.
Fail: require stricter URL policy or OS-level network restrictions.

4.3 API Key handling design tests (critical)

KEY-1: Confirm key is never present in sandbox context
Why: If you type the key into the same page/iframe that runs code, it can be read.
Method: Implement the model-call path so the key is stored only in the host (or a local backend), never sent to the iframe.
Pass: a sandbox “red team” module cannot find the key in DOM, storage, globals, or messages.

KEY-2: Confirm key is never transmitted to the iframe via postMessage or query params
Why: A common accidental leak is passing config objects that include the key.
Method: Instrument message sending; log all postMessages and iframe src URLs.
Pass: key substring never appears.

KEY-3: Confirm module updates can be performed without key exposure
Why: The normal edit loop must not require putting the key in the same execution context.
Pass: module regeneration works while sandbox remains isolated.

4.4 Reliability and performance gating tests (middle-ground practicality)

PERF-1: Probation gate sanity
Why: Prevent obvious “accidental harm” (infinite loops, runaway spawning).
Method: test modules that (a) throw in init, (b) throw in update, (c) spawn too many meshes, (d) run slow loops.
Pass: staging rejects them and keeps last-good running.

PERF-2: Frame-time regression under heavy but acceptable loads
Why: Ensures your thresholds match reality for “rough graphics games.”
Method: load a mid-size environment + 20 enemies + projectiles with pooling.
Record: average dt, 95th percentile dt, slow-frame streaks.

Multi-genre MVP scope without a kernel menu (what to try)

Even if you don't want a visible kernel picker, you still need stable "capability packs" to avoid every game rewriting controllers/UI.

**UPDATE 2025-01-17: Vendored Controllers Architecture DECIDED**

See docs/design.md Section 19 for full details. Key decisions:

1. **Controllers are host-owned, not LLM-generated.** Flight/vehicle/FPS controllers live in `src/controllers/` and are imported by the shell.

2. **Shell provides normalized input.** `ctx.input.flightStick` gives `{x, y, throttle}` in [-1,1]/[0,1]. Sensitivity, smoothing, pointer lock → host-controlled.

3. **Shell auto-ticks controllers.** Module does NOT call controller.update(). Loop order: input → controllers → physics → module.update → render.

4. **LLM role is configuration + game logic.** Module calls `ctx.controllers.flight.createPlayer(mesh, config)` and implements gameplay (hoops, scoring, etc.), NOT control physics.

5. **Pointer lock policy via config.** `{ pointerLock: 'auto' | 'onclick' | 'never' }`

**Implementation priority:**
- Phase 1: Flight controller (current blocker)
- Phase 2: Vehicle controller (same pattern)
- Phase 3+: FPS, farming, etc.

Your agent should prototype:

An "implicit pack selection" based on first prompt intent (FPS/racing/flying/obstacle/farming).

Each pack must minimally provide: controller + camera defaults + HUD mapping + a starter environment loader hook.

Verify that switching packs does not require unsafe privileges (no extra network, no extra DOM access).

Test: Create one prompt for each genre that uses only built-in packs + remote assets via ctx.assets; confirm it produces a playable loop and does not regress the safety constraints above.

Required logging and evidence collection

For each test, record:

Browser name/version, OS.

Sandbox attributes and CSP used.

Exact code snippet used to test (small, pasted into report).

Pass/fail outcome and the observable error (console output).

For BFS-5, record cycle-by-cycle peak memory signals if possible and at least qualitative evidence (trend, settling behavior).

Decision points after tests (what decisions the report must enable)

After this plan, you should be able to decide (based on evidence):

Which module loading mechanism is viable across browsers under strong sandboxing (Blob import vs srcdoc vs other).

Whether two-iframe staging is feasible without unacceptable memory growth.

What concrete sandbox/CSP configuration enforces your chosen “middle-ground” policy without breaking asset loaders.

Whether you must use OS firewall rules to block localhost/LAN exfil in your local demo environment.

Whether your current “enter API key in browser” workflow must be replaced with host-only storage or a local backend.