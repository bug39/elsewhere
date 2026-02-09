Write a single markdown document named asset_and_security_test.md.

Goal: Produce a test + design spike plan for a local web sandbox that executes model-generated JavaScript to create interactive 3D “games,” with remote assets allowed for better graphics. The plan must be thorough, detailed, and precise. It must explicitly explain WHY each test is being performed. It must include safety concerns and especially API key exposure risks.

Scope constraints:

Assume we are running locally and will not publish publicly.

We are not intentionally prompting for malicious behavior, but generated code is still “untrusted by default” due to accidents and supply-chain risk.

We want a “middle ground” safety posture: prevent obvious local harm (esp. API key leaks) while keeping creativity via remote asset loading.

Do NOT invent system details that aren’t part of the plan. If something is a design choice, label it clearly as “UNSPECIFIED” or “Decision needed.”

Required output structure (headings verbatim):

Purpose and Threat Model

Explain why we need these tests even for local-only demos.

Explicitly state API key exposure as the central risk.

Define what “middle ground safety” means for this plan.

Deliverables
List exactly what artifacts the agent must produce:

Minimal test harness repo/folder (describe contents)

A written test report (describe required fields)

A pre-BFS security config draft set (candidate sandbox/CSP configs) and a post-BFS “final selection” section

An API key handling design note

Test Harness Requirements
Specify what the harness must support:

sandboxed iframe (and optionally two iframes: live + staging)

injecting candidate module code

running init/update for N frames and collecting timing stats

running repeated swap cycles (10+) and collecting memory/VRAM signals best-effort

reporting pass/fail with reproducible evidence

Browser Feasibility Spikes (BFS)
For each test, include: Test ID, why, setup, steps, pass criteria, fail action.

Include at least:

BFS-1: Blob URL ES module import in sandbox without allow-same-origin across Chrome/Firefox/Safari

BFS-2: srcdoc + <script type="module"> in sandbox across Chrome/Firefox/Safari

BFS-3: Texture/model/audio load from opaque-origin iframe to CORS-enabled host

BFS-4: Same loads to typical host with no CORS (expected failure)

BFS-5: Two-iframe staging swap cycles + memory/VRAM behavior across 10 cycles

Important: BFS-5 pass criterion is UNSPECIFIED at plan time because we have conflicting candidate criteria in earlier drafts. Require the report to capture metrics that allow deciding later (peak usage, settling behavior, monotonic growth trend). Make this explicit.

Security Spike
Goal: Draft enforceable sandbox attributes + CSP that match policy (“remote scripts forbidden,” “remote assets allowed via ctx.assets,” “raw module fetch/XHR forbidden by policy”) without breaking asset loaders.

Include tests:

SEC-1: Parent DOM isolation (fake API key in DOM)

SEC-2: Storage isolation (fake key in localStorage/sessionStorage)

SEC-3: Network exfil attempts (arbitrary external URL, localhost ports, LAN IP range if feasible)

SEC-4: Remote script import attempts (import('https://...'), script tag injection)

SEC-5: Covert exfil via asset URLs with query parameters

For each, define why, steps, and pass/fail criteria.

Explicitly call out the “localhost/LAN” risk for local demos and state that OS firewall mitigation may be required if browser-level controls are insufficient.

API Key Handling Design + Tests (Critical)
State the required design goal: the sandbox must never see the key.

Include:

KEY-1: Prove key never exists in sandbox context (DOM/storage/globals/messages)

KEY-2: Prove key never transmitted via postMessage/query params

KEY-3: Prove module regeneration works without key exposure (host-only or local backend)

Reliability/Performance Gates Sanity Tests
Include:

modules that throw in init/update

runaway spawning / object count explosion

slow loop / frame time regression
Define expected behavior: staging rejects and last-good continues (if applicable).

Multi-Genre MVP Readiness (No Kernel Menu)
We want to support demos for: FPS, racing, flying, obstacle/obby, and farming simulator.
We do not want a visible kernel picker; we will test “implicit capability pack selection” based on the first prompt intent.

Define a test per genre that verifies:

playable loop appears

uses remote assets only through ctx.assets

does not require unsafe privileges (no remote scripts, no direct DOM access)

does not violate the key isolation constraints

Evidence Collection and Reporting Format
For every test, require:

Browser version + OS

sandbox attributes + CSP used

exact minimal code snippet used

console output / errors

pass/fail

for BFS-5, per-cycle metrics table and a qualitative trend statement

Decision Points After Tests
List what decisions the test report must enable:

module loading mechanism viability

staging feasibility without unacceptable memory growth

concrete sandbox/CSP selection compatible with asset loading

whether OS firewall is required to block localhost/LAN exfil

whether “enter API key in browser UI” must be replaced by host-only or local backend

Tone and style requirements:

Write like a principal engineer giving a precise task to another engineer/agent.

Use checklists and tables where it increases clarity.

Use “UNSPECIFIED” when something must be decided later.

Do not assume results; define what must be measured.

Output only the markdown content for asset_and_security_test.md (no extra commentary).