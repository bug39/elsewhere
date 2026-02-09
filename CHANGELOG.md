# Changelog

All notable changes to thinq are documented in this file.

## [0.3.10] - 2026-01-28

### Reverted - Experimental Attachment & Limb Features

Reverted uncommitted experimental features that caused severe asset generation quality regressions.

#### Features Reverted
- **Attachment-based positioning:** Parts could specify `attach: { to, at, offset }` instead of explicit coordinates
- **Limb geometry type:** New `g: "Limb"` for articulated multi-segment limbs with bends
- **Budget increases:** Mesh limit 24→32, material limit 5→6, higher segment counts

#### Why Reverted
The LLM (Gemini) didn't reliably use the new features correctly, causing:
- Humanoid limbs disconnected from bodies
- Body parts positioned incorrectly
- Mixed old/new positioning styles breaking layouts

#### Lessons Learned
- Test LLM integration with live generation before committing schema changes
- Position values are sacred (LLM expects meshes placed exactly at specified coordinates)
- Features that modify LLM-specified positions need extensive testing

See: `docs/audits/2026-01-28-attachment-limb-revert.md`

## [0.3.9] - 2026-01-27

### Performance - Shadow Update Gating

Implemented shadow map gating to eliminate redundant GPU work in static scenes.

#### Changes
- **LightingSystem**: Added `shadowNeedsUpdate` flag with `markShadowDirty()` and `updateShadowsIfNeeded()` methods
- **WorldRenderer**: Disabled `shadowMap.autoUpdate`, calls `updateShadowsIfNeeded()` in render loop
- **TransformSystem**: Added `onTransformComplete` callback to mark shadows dirty after transforms

#### How It Works
Three.js normally recalculates the 4096×4096 shadow map every frame. With gating, shadows only update when:
- World geometry changes (terrain, instances added/removed)
- Transform drag completes (object moved/scaled)

**Expected Impact:** 20-40% GPU frame-time reduction in static scenes (user viewing without making changes)

### Performance - Async Thumbnail Generation

Moved thumbnail PNG encoding off the main thread to eliminate UI stalls during asset generation.

#### Changes
- **ThumbnailRenderer**: Added `renderAsync()` method using `canvas.toBlob()` + FileReader
- **queueProcessor**: Marks items complete immediately with `thumbnailPending: true`, generates thumbnail async

#### How It Works
Previously, `toDataURL()` blocked the main thread for 50-100ms while encoding PNG. Now:
1. Generation completes → item marked "Ready for review" immediately
2. `toBlob()` encodes PNG in browser's background thread
3. Thumbnail updates asynchronously (usually within 100ms)

**Expected Impact:** Eliminates 50-100ms main-thread stalls per generation

### Performance - Scene Generation Phase Yields

Added main-thread yields during scene generation to prevent UI freezing.

#### Changes
- **SceneGenerationAgent**: Added `yieldToMain()` utility using `requestIdleCallback`
- Yields inserted: after planning, between each asset generation, after placement

#### How It Works
Long-running JS blocks the UI thread. `requestIdleCallback` tells the browser "run this when free", breaking work into smaller chunks. The browser can process input and paint between chunks.

**Expected Impact:** Smooth UI during scene generation (no "frozen" feel)

### Added - Frame Timing Telemetry

Integrated frame timing into telemetry system for FPS monitoring.

- **WorldRenderer**: Calls `recordFrameTime(dt * 1000)` in animate loop
- FPS metrics logged every 5 seconds via existing telemetry infrastructure

### Added - Performance Feature Flags

Added feature flags for upcoming performance optimizations:

```javascript
enableInstancing: true,        // GPU instancing for repeated assets (3+)
enableRenderOnDemand: false,   // Render only when scene changes (disabled for safe rollout)
```

### Files Changed

| File | Changes |
|------|---------|
| `src/engine/WorldRenderer.js` | Shadow gating, frame telemetry, disabled autoUpdate |
| `src/engine/systems/LightingSystem.js` | Shadow dirty flag and methods |
| `src/engine/systems/TransformSystem.js` | onTransformComplete callback |
| `src/generator/ThumbnailRenderer.js` | Async renderAsync() method |
| `src/generator/SceneGenerationAgent.js` | yieldToMain() and phase yields |
| `src/studio/state/queueProcessor.js` | Async thumbnail with pending state |
| `src/shared/featureFlags.js` | enableInstancing, enableRenderOnDemand flags |

---

## [0.3.8] - 2026-01-27

### Fixed - OrbitControls Zoom Trap

Fixed sluggish zoom/pan when camera is very close to target. OrbitControls scales zoom speed by distance, so at the previous `minDistance` of 5 units, each scroll step was only ~0.5 units — making zoom feel stuck. Increased `minDistance` from 5 to 10 to match `focusOnInstance()` floor, ensuring zoom always feels responsive.

### Improved - Rendering Quality & Anti-Aliasing

Comprehensive rendering improvements for sharper visuals and better lighting.

#### Anti-Aliasing
- **SMAA post-processing**: Added SMAA pass to post-processing pipeline, replacing reliance on unreliable WebGL2 render target MSAA (which often fails on macOS Metal backend)
- **Removed redundant MSAA**: Dropped `samples: 4` from render target since SMAA now handles edge smoothing
- SMAA chosen over FXAA for sharpness - FXAA caused noticeable blur on low-poly assets

#### Procedural Grid Shader
- **Replaced GridHelper**: Geometry-based grid lines caused moiré patterns at distance
- **New shader-based grid**: Uses `fwidth()` for screen-space anti-aliasing - crisp lines at any distance/angle
- **Tunable line width**: Set to 0.003 (fraction of cell) for sharp appearance matching original aesthetic

#### Lighting Enhancements
- **Added rim light**: Presets defined rim light but it was never created! Now properly initialized and applied
- **Preset rim support**: `applyLightingPreset()` now handles rim light settings (with fallback for presets without rim)
- **Shadow bias tuning**: Adjusted from -0.0005 → -0.0003 to reduce peter-panning
- **Explicit shadow radius**: Set to 1.5 for controlled soft edges

#### Why These Matter for Low-Poly
- Low-poly assets have large flat faceted surfaces that need contrast to read as 3D
- Rim light creates bright edges on silhouettes, making objects "pop" from backgrounds
- The "dramatic" preset works well because: low ambient (contrast), warm/cool color contrast, and rim lighting
- Shadow lift (~8%) essential to prevent pure black shadows crushing detail

### Files Changed
| File | Changes |
|------|---------|
| `src/engine/WorldRenderer.js` | Procedural grid shader, removed GridHelper |
| `src/engine/systems/LightingSystem.js` | SMAA pass, rim light, shadow tuning |

---

### Fixed - Asset Generation Z-Fighting

Added anti-pattern rules to `planningSystemV4.txt` to prevent z-fighting in generated assets:
- Prohibit grid/tile/checker patterns using multiple small boxes on surfaces
- Require decorative parts to offset 0.02+ units from parent surfaces
- Guide toward single offset accents or inset geometry for flat surface decoration

This fixes the stuttery/broken texture appearance when AI generates checkerboard or tile patterns on building walls.

### Fixed - Scene Generation Eval/Refine Pipeline

Fixed 6 audit findings that made the iterative refinement loop non-functional.

#### Refinement Plumbing
- **worldHooks incomplete**: `SceneGeneratorPanel` and `SceneGeneratorModal` now pass `updateInstance`, `deleteInstance`, `getWorldData()`, and `worldRenderer` — previously only `executeScenePlan` and a stale `data` snapshot were passed
- **Stale data snapshot**: Replaced all `worldHooks.data` reads with live `getWorldData()` accessor so refinement iterations see the current world state, not the state at generation start (including `executeInitialPlacement` which was missed in initial fix)

#### V2 Refinement Bug Fixes
- **`_structureId` access**: Fixed from `inst.userData?._v2StructureId` to `inst._structureId` (top-level instance property, not nested under userData)
- **Instance ID field**: Fixed from `existingInstance.id` to `existingInstance.instanceId`
- **Position format**: Fixed from `{x, y, z}` object to `[x, y, z]` array (matching instance data model)
- **Rotation format**: Fixed from `{x: 0, y: val, z: 0}` object to single number (yaw in radians)
- **Adds/removes handling**: V2 refinements now generate and place structures added in revised plans, and delete instances for structures removed from revised plans

#### Parser & Execution Gaps
- **structureId dropped**: `parseRefinementPlan` now accepts `structureId` as a valid identifier in all three filter blocks (rescale, remove, move)
- **moveAssets never executed**: Implemented `processMoves()` method and wired it into `applyRefinements` between removals and asset generation

#### Overview Camera
- **Coverage insufficient**: Overview camera was hardcoded at 70m altitude (~146m coverage). Now scales with `SCENE_GENERATION.SIZE` (altitude ~209m, ~434m coverage for 380m scene)

### Changed

- **Buildings MAX_SCALE**: Raised from 160 to 200 (50m max real-world size, up from 40m). A 50m skyscraper and 40m house now render at distinct scales instead of both clamping to 160
- **V2 prompt guidance**: Added mega-structure tip (use `nature` category for structures >50m)

### Docs
- Fixed world size: 200m × 200m → 400m × 400m (40×40 tiles × 10m)
- Fixed grid constants: GRID_SIZE 20 → 40, WORLD_SIZE 200 → 400
- Updated Phase 2 (iterative refinement loop) status: Pending → Implemented

### Files Changed
| File | Changes |
|------|---------|
| `src/generator/SceneGenerationAgent.js` | worldHooks plumbing, `processMoves()`, V2 refinement fixes |
| `src/generator/scenePrompts.js` | structureId in parser, move position validation |
| `src/generator/SceneCaptureService.js` | Overview camera scales with SIZE |
| `src/generator/sizeInvariants.js` | buildings MAX_SCALE 160→200 |
| `src/generator/prompts/scenePlanningV2.txt` | Mega-structure guidance |
| `src/studio/components/SceneGeneratorPanel.jsx` | Full worldHooks |
| `src/studio/components/SceneGeneratorModal.jsx` | Full worldHooks |
| `docs/studio-design.md` | World size fix, session log |
| `docs/studio-subsystems.md` | Grid constants, Phase 2 status |
| `tests/scene-generation/unit/sizeInvariants.test.js` | Updated scale assertions |

---

## [0.3.7] - 2026-01-24

### Added - World Thumbnails on Home Screen

Worlds now display preview thumbnails on the home screen, making it easy to visually identify each world at a glance.

#### How It Works
- When saving a world (manual save only), the system captures a 256×256 screenshot from the overview camera angle
- The thumbnail is stored as a base64 data URL in `WorldMeta.thumbnail`
- HomeScreen displays the thumbnail instead of the default globe icon

#### Implementation
- **SceneCaptureService**: Added `WORLD_THUMBNAIL_SIZE` (256px) constant and `captureWorldThumbnail(scene)` export function
- **App.jsx**: `handleSave` now captures thumbnail before calling `world.save()`
- Error handling ensures thumbnail capture failures don't block saves

#### Design Decisions
| Decision | Choice | Rationale |
|----------|--------|-----------|
| Thumbnail size | 256×256 | Matches asset thumbnails, ~40KB each, good for retina |
| Camera angle | 'overview' preset | Bird's eye view shows world layout clearly |
| Capture timing | Manual save only | Auto-save (60s) doesn't need visual update every time |
| Error handling | Swallow errors | Thumbnail failure shouldn't block save |

### Files Changed
| File | Changes |
|------|---------|
| `src/generator/SceneCaptureService.js` | Added `WORLD_THUMBNAIL_SIZE`, `captureWorldThumbnail()` |
| `src/studio/App.jsx` | Capture thumbnail in `handleSave` before save |

---

## [0.3.6] - 2026-01-23

### Performance - Transform Gizmo Drag Optimization

Removed expensive `computeBoundingSphere()` call from the ground projection line update loop, eliminating 60+ per-second geometry recalculations during transform gizmo drags.

#### Problem
When dragging assets with the transform gizmo, `showGroundProjection()` was called every frame to update the dashed vertical line showing height above terrain. This function called `computeBoundingSphere()` on the line geometry, which iterates through all 300 position values (50 dashes × 6 coordinates) to recalculate the bounding sphere—completely unnecessary since the sphere is computed once at geometry creation and only needs updating when the geometry structure changes, not when vertex positions are modified.

#### Fix
Removed the `computeBoundingSphere()` call. The bounding sphere computed at geometry creation is sufficient for frustum culling purposes.

### Files Changed
| File | Changes |
|------|---------|
| `src/engine/WorldRenderer.js` | Removed `computeBoundingSphere()` from `showGroundProjection()` |

---

## [0.3.5] - 2026-01-23

### Added - Custom Confirm Modal Component

Replaced all 7 native browser `confirm()` dialogs with a styled `ConfirmModal` component that matches the app's design system.

#### Features
- **Signal-based singleton pattern** following the existing Toast architecture
- **Promise-based API** for async/await compatibility: `const confirmed = await showConfirm({ ... })`
- **Danger mode styling** for destructive actions (red confirm button)
- **Multi-line message support** (splits on `\n` into paragraphs)
- **Keyboard accessibility** via existing `useFocusTrap` hook (Escape cancels, Tab cycles focus)

#### Confirmations Migrated
| Location | Title | Danger? |
|----------|-------|---------|
| App.jsx | Switch World | No |
| HomeScreen.jsx | Delete World | Yes |
| AssetReviewModal.jsx | Different World | No |
| AssetReviewModal.jsx | Generate New Asset | Yes |
| InspectorPanel.jsx | Delete Instance | Yes |
| LibraryPanel.jsx | Delete Asset | Yes |
| PartEditorModal.jsx | Discard Changes | Yes |

### Files Added
| File | Purpose |
|------|---------|
| `src/studio/components/ConfirmModal.jsx` | Signal-based modal with Promise API |

### Files Changed
| File | Changes |
|------|---------|
| `src/studio/styles/design-system.css` | Added `.modal--confirm` and `.modal--danger` styles |
| `src/studio/App.jsx` | Mounted `<ConfirmModal />`, migrated world-switch warning |
| `src/studio/components/HomeScreen.jsx` | Mounted `<ConfirmModal />`, migrated delete world |
| `src/studio/components/AssetReviewModal.jsx` | Migrated cross-world and regenerate warnings |
| `src/studio/components/InspectorPanel.jsx` | Migrated delete instance confirmation |
| `src/studio/components/LibraryPanel.jsx` | Migrated delete asset confirmation |
| `src/studio/components/PartEditorModal.jsx` | Migrated discard changes confirmation |

---

## [0.3.4] - 2026-01-21

### Fixed - Part Editor Material Corruption

- **Part Editor Rapid-Click Bug**: Parts no longer vanish when clicking rapidly between selections in the Part Editor 3D preview
  - Root cause: Highlight materials were incorrectly stored as "original" during rapid selection changes
  - Fix: Store true original materials by mesh UUID when asset loads, always restore from this immutable map
  - File: `src/studio/components/PartEditorPreview.jsx`

### Documentation
- Added `docs/session-2026-01-21-bugfix-3.md` with full details

## [0.3.3] - 2026-01-21

### Fixed - Second Bug Audit (7 fixes)

Follow-up audit addressing bugs that persisted after the initial [0.3.2] audit.

#### Critical
- **Asset Placement Y-Position**: Assets now place with bottom at ground level (was placing center at ground, causing floating)
  - Set Y=0 in both drag-drop and click-to-place handlers; WorldRenderer handles terrain height
- **Part Editor Click Deletes Part**: Tweaks no longer reset when clicking elsewhere in the part editor
  - Added initialization ref to prevent useEffect from re-running on prop reference changes
- **Generation Queue World Persistence**: Cross-world asset generation now warns before adding to wrong world
  - Added worldId validation in AssetReviewModal with confirmation dialog
  - Added warning when switching worlds with pending generations

#### Medium
- **Part Editor Gizmo Lock**: Transform gizmo mode now resets to translate when closing part editor
  - Reset in both cancel and save handlers for instance and template modes
- **Library Thumbnail Sizing**: Thumbnails now show full asset without cropping
  - Changed `object-fit: cover` to `object-fit: contain`
  - Added scrollbar padding to prevent clipping

#### Low
- **Part Editor Sidebar Overflow**: Increased sidebar width from 320px to 360px to fit X/Y/Z inputs

### Documentation
- Added `docs/session-2026-01-21-bugfix-2.md` with full details

## [0.3.2] - 2026-01-21

### Fixed - Comprehensive Bug Audit

Addressed 31 bugs across the studio, organized by severity.

#### Critical (Data Loss Prevention)
- **C1**: Assets no longer disappear when dragging with gizmo attached
- **C2**: Generation queue now tracks world ID, items cleaned up on world switch
- **C3**: NPC controller state cleared when switching worlds
- **C4**: Auto-save timer no longer resets on every edit (was restarting 60s countdown)
- **C8/H10**: Undo/redo no longer corrupts nested arrays (uses `structuredClone`)
- **C9**: Transform gizmo no longer attaches to loading placeholder meshes
- **C10**: Terrain drag state properly reset on mouse leave
- **C11/H13**: Fixed return type handling for world import/export

#### High Priority (Functional)
- **H1**: Assets now sit on ground correctly (removed incorrect Y-offset)
- **H2**: Inspector position changes now update gizmo position
- **H3**: NPC behavior changes properly reset animation state
- **H4**: Player can no longer walk off world edges (0-200m bounds)
- **H5/H6/H7**: Terrain editing has proper bounds (height max 25, indices clamped)
- **H8**: Delete tool highlighting clears when instance deleted
- **H11**: Selection clears when selected library asset is deleted
- **H12**: Added world delete button to home screen

#### Medium Priority (UX)
- **M3**: Camera cannot rotate during NPC dialogue
- **M4**: Dialogue navigation validates nodes before advancing
- **M7**: Dialogue state clears safely if NPC deleted during conversation
- **M8**: NPCs respect world bounds when wandering
- **M15**: Selection cleared when entering play mode
- **M16**: Queue operations now await saves (prevents data loss on quick close)

#### Low Priority (Polish)
- **L1/L2**: Fixed overflow issues in library panel and part editor sidebar
- **L3**: NPCs now face player when dialogue starts
- **L5**: NPC wander radius validated (minimum 1m)

### Documentation
- Added `docs/session-2026-01-21-bugfix.md` with full bug fix details

## [0.3.1] - 2026-01-20

### Added - Asset Part Editor Prototype

Standalone prototype for editing individual parts of AI-generated 3D assets. Solves the challenge of working with messy, inconsistently-structured AI output.

#### Smart Part Detection
- **Animation Parts**: Auto-discovers parts from `userData.parts` (AI animation rig)
- **Named Groups/Meshes**: Falls back to objects with `.name` property
- **Orphan Meshes**: Individual meshes as last resort fallback
- Parts auto-named from `userData.parts` keys when unnamed

#### Part Selection
- Click any mesh to select its containing logical part
- Parent group selection via raycast + hierarchy walk
- Visual highlighting with cloned materials (avoids shared material issues)
- Explicit mesh tracking prevents parts disappearing after transform

#### Transform Controls
- Three.js TransformControls integration
- Toggle Translate (T) / Rotate (R) / Scale (S) modes
- Live position/rotation/scale value inputs
- Reset Part / Reset All functionality

#### Export System
- `partTweaks` JSON format with name, type, position, rotation, scale
- Only modified parts included in export
- Only changed properties per part
- Part renaming for stable export identifiers

#### UI Features
- Parts list with type icons: `🎬` animation, `📦` group, `◆` mesh
- Hierarchy depth via indentation
- Orange highlight for animation parts
- Inline rename button for custom part names
- Custom names shown in green

#### Test Assets
- Simple Character, Robot, Tree (named structure)
- Messy AI Output (unnamed/nested simulation)
- Dragon (real AI output with `userData.parts`)

### Files Added
| File | Purpose |
|------|---------|
| `tests/part-editor/index.html` | Standalone prototype (no build step) |
| `docs/session-asset-editor.md` | Full session documentation |

### Technical Notes
- Single HTML file with inline CSS/JS
- ES modules via CDN (Three.js r160)
- No build step required
- Ready for studio integration in next session

---

## [0.3.0] - 2026-01-20

### Performance Optimization Release

Major performance overhaul addressing 14 critical issues identified in performance audit. Focus on memory management, rendering efficiency, and UI responsiveness.

#### Phase 1: Critical Fixes (Memory Leaks & Blocking)

**Event Listener Leak Fix**
- `PlayerController.js`: Store bound listener references, proper `dispose()` cleanup
- `Viewport.jsx`: Call `playerController.dispose()` when exiting play mode
- Eliminates zombie listeners accumulating across mode switches

**Delta-Based Undo/Redo**
- `useWorld.js`: Complete rewrite replacing JSON.stringify snapshots with operation deltas
- Operations stored as ~100 byte objects vs ~500KB full state snapshots
- 50 undo levels now uses <5MB vs previous 25-100MB
- New operation types: terrain_height, terrain_texture, instance_add/update/delete, library_add/remove

**Terrain Mesh Memoization**
- `WorldRenderer.js`: Added `hashTerrain()` function and `lastTerrainHash` tracking
- Terrain only rebuilt when heightmap or biome actually changes
- Eliminates full mesh rebuild on every asset move/property change

#### Phase 2: Allocation Optimizations

**Pooled Raycasting Objects**
- `WorldRenderer.js`: Class-level pooled `_raycaster`, `_mouseVec`, `_groundPlane`, `_intersectionVec`
- Eliminates 240+ temporary objects/second during terrain painting

**Pooled Movement Vectors**
- `PlayerController.js`: Added `_moveDir` Vector3 (60 allocations/second eliminated)
- `NPCController.js`: Added `_direction` Vector3 per NPC instance (1200 allocations/second with 20 NPCs)

#### Phase 3: Rendering Optimizations

**Frustum Culling for Animations**
- `WorldRenderer.js`: Added `_frustum` and `_projScreenMatrix` pooled objects
- Animation `update()` only called for meshes within camera frustum
- 100 off-screen NPCs no longer waste CPU cycles

**Shadow Frustum Optimization**
- `WorldRenderer.js`: Tightened shadow camera bounds from 240m to 220m
- Better shadow map resolution utilization for 200m world

#### Phase 4: UI Optimizations

**Component Memoization**
- `LibraryPanel.jsx`: Wrapped with `memo()`, `useMemo` for filtered list, stable callbacks
- `InspectorPanel.jsx`: Wrapped with `memo()`, `useMemo` for instance/asset lookups

**Batched Selection State**
- `useSelection.js`: Combined 3 `useState` calls into single object
- Reduces render passes from 3 to 1 per selection change

**Terrain Painting Debounce**
- `Viewport.jsx`: Track `lastPaintedTileRef` to skip same-tile repaints during drag
- Significantly reduces state updates during continuous painting

#### Phase 5: Resource Disposal

**Complete WorldRenderer.dispose()**
- Properly disposes all lights (ambient, sun, fill, frontFill, backFill, hemiLight)
- Disposes shadow map
- Disposes grid helper geometry/material
- Clears asset module cache
- Resets terrain hash

### Files Changed

| File | Changes |
|------|---------|
| `src/engine/PlayerController.js` | Bound listeners, pooled `_moveDir`, proper `dispose()` |
| `src/engine/NPCController.js` | Pooled `_direction` vector |
| `src/engine/WorldRenderer.js` | Terrain memoization, pooled objects, frustum culling, complete disposal |
| `src/studio/hooks/useWorld.js` | Delta-based undo/redo system |
| `src/studio/hooks/useSelection.js` | Batched state object |
| `src/studio/components/Viewport.jsx` | Dispose call, terrain debounce |
| `src/studio/components/LibraryPanel.jsx` | memo(), useMemo, useCallback |
| `src/studio/components/InspectorPanel.jsx` | memo(), useMemo |

### Expected Improvements

| Metric | Before | After |
|--------|--------|-------|
| Undo stack memory | 25-100MB | <5MB |
| Terrain paint frame drops | Frequent | Rare |
| Mode switch memory leak | Unbounded | None |
| 100 asset world FPS | ~30-40 | 55-60 |
| Time to choppiness | Minutes | Hours+ |

---

## [0.2.2] - 2026-01-20

### Added

#### Persona 3 Reload Style Rendering
- Added color grading post-process shader for stylized cool blue tones
- `WorldRenderer.js`: New `ColorGradingShader` with desaturation and blue tint
- Adjusted fog to cooler color (`0xc8d8e8`) with closer range (100-400m)
- Tunable uniforms: `saturation` (0.7), `tintStrength` (0.15), `tintColor` (0.4, 0.5, 0.7)

---

## [0.2.1] - 2026-01-20

### Fixed - Critical & High Priority Issues

#### C2: beforeunload Warning
- Added browser warning when closing tab with unsaved changes
- `App.jsx`: useEffect hook listens to `beforeunload` event when `world.isDirty`

#### H1: Removed Broken Paint Tool
- Removed non-functional paint tool from toolbar (UI existed, no handler)
- `Toolbar.jsx`: Reduced TOOLS array from 5 to 4, adjusted divider index

#### H3: Gemini Safety Settings
- Added explicit safety thresholds to prevent content blocking on benign prompts
- `GeminiClient.js`: Added `safetySettings` array with `BLOCK_ONLY_HIGH` for all categories

#### C1: Save Failure Notifications
- Users now see toast feedback for save success/failure
- Created `Toast.jsx` component with signal-based queue
- Added toast CSS styles to `app.css`
- `App.jsx`: handleSave shows success/error toasts
- `useWorld.js`: Auto-save failures logged to console

#### H2: Dialogue Editor Integration
- Wired existing DialogueEditor component to Inspector panel
- `App.jsx`: Added dialogueEditor state, handleOpenDialogue/handleSaveDialogue callbacks
- `InspectorPanel.jsx`: "Edit Dialogue" button now opens the editor modal

#### H4: World Export/Import
- Added JSON export/import for world sharing and backup
- `storage.js`: Added `exportWorldAsJSON()` and `importWorldFromJSON()` functions
- `HomeScreen.jsx`: Added Import button and Export button on each world card

### Files Changed
| File | Changes |
|------|---------|
| `src/studio/App.jsx` | beforeunload, toast, dialogue editor, save feedback |
| `src/studio/components/Toolbar.jsx` | Removed paint tool, fixed divider |
| `src/generator/GeminiClient.js` | Added safetySettings |
| `src/studio/components/Toast.jsx` | **NEW** - Toast notification system |
| `src/studio/styles/app.css` | Toast CSS |
| `src/studio/hooks/useWorld.js` | Auto-save error handling |
| `src/studio/components/InspectorPanel.jsx` | Wired dialogue button |
| `src/studio/state/storage.js` | Export/import functions |
| `src/studio/components/HomeScreen.jsx` | Import/export UI |

### Deferred
- **C3: Code Execution Timeout** - Requires Web Worker architecture, separate task

---

## [0.2.0] - 2026-01-19

### Added - V1 Studio Implementation

Complete rewrite from sandbox game generator to world-building studio.

#### UI Framework
- Preact + Vite build system replacing vanilla HTML
- React Flow integration for visual dialogue editing
- CSS variables design system with dark theme
- Responsive panel layout (library, viewport, inspector)

#### New Source Structure
```
src/studio/      # Preact UI application
src/engine/      # Three.js runtime (WorldRenderer, controllers)
src/generator/   # AI asset generation pipeline
src/shared/      # Types and constants
```

#### Home Screen
- World selection grid with thumbnails
- New world creation with name + biome picker
- API key configuration modal

#### Editor Mode
- **Terrain System**
  - 20×20 grid of 10m tiles (200m world)
  - 5 biome presets: grass, desert, snow, forest, volcanic
  - Click/drag elevation editing (raise/lower)
  - Minecraft-style stepped terrain visualization

- **Asset Library**
  - Category filtering (characters, creatures, buildings, props, nature, vehicles)
  - Search by name and tags
  - Drag-and-drop placement to viewport
  - Auto-generated thumbnails

- **Asset Generation**
  - Two-pass Gemini integration (plan → generate)
  - 3D preview in generation modal
  - Walking character detection prompt
  - Automatic name/category derivation from prompt

- **Transform Controls**
  - Three.js TransformControls for gizmo manipulation
  - Position, rotation, scale editing in inspector
  - Grid snapping for placement

- **Inspector Panel**
  - Transform properties (position, rotation, scale)
  - NPC behavior configuration (idle, wander with radius)
  - Dialogue editor access

- **Undo/Redo**
  - Command stack pattern with 50-level history
  - Keyboard shortcuts (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z)

#### Play Mode
- **Third-Person Controller**
  - WASD movement relative to camera
  - Shift to run, Space to jump
  - Gravity and ground collision

- **Camera System**
  - Fixed follow by default
  - Right-click drag to orbit
  - Smooth position interpolation

- **NPC Interaction**
  - Click NPCs to start dialogue
  - NPCs pause behavior during conversation
  - Typewriter text effect
  - Branching choice buttons

- **Dialogue Display**
  - Bottom-centered dialogue box
  - NPC name header
  - Space/Enter to advance
  - ESC to close

#### NPC System
- **Behaviors**
  - Idle: stand in place with idle animation
  - Wander: random movement within configurable radius

- **Procedural Animation**
  - Walk cycle using pivot groups
  - Arm swing opposite to legs
  - Smooth transitions idle↔walk

- **Dialogue Editor**
  - React Flow node graph
  - Add/connect dialogue nodes
  - Edit text inline
  - Add choice branches

#### Persistence
- IndexedDB storage via idb-keyval
- Multi-world support with metadata index
- Auto-save every 60 seconds
- JSON export/import capability

#### Rendering Pipeline
- Three.js with ACES Filmic tone mapping
- PCFSoftShadowMap shadows (2048×2048)
- Post-processing: bloom (subtle), vignette
- Biome-aware sky, fog, and lighting

### Dependencies Added
- preact: ^10.19.3
- @preact/signals: ^1.2.2
- @xyflow/react: ^12.0.0
- three: ^0.171.0
- idb-keyval: ^6.2.1
- vite: ^5.4.0
- @preact/preset-vite: ^2.8.2

### Legacy Code Preserved
- `src/parent/` - Original sandbox UI
- `src/shell/` - Iframe execution shell
- `src/controllers/` - Flight controller
- `tests/` - Browser feasibility and Gemini tests

---

## [0.1.0] - Previous

Initial sandbox architecture for prompt-to-game generation.

- Parent window with prompt input and Gemini API client
- Shell iframe with Three.js renderer and `ctx` object
- Flight controller for arcade/realistic flight games
- Environment presets (flying, space)
- Asset generation test suite
