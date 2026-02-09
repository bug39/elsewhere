# Asset Gen Stress Lab

Matrix stress test harness for the asset generator. Separate from the studio UI, focused on first-run reliability, syntax/export errors, and coherence metrics.

## Quick Start

```bash
# From repo root
npm run dev  # Starts on port 3001

# Open test suite
http://localhost:3001/tests/asset-gen-lab/
```

Or with Python:
```bash
python -m http.server 3004
# Open http://localhost:3004/tests/asset-gen-lab/
```

## Usage

1. Enter your Gemini API key
2. Select configs to test (checkboxes)
3. Select prompts to test (checkboxes)
4. Configure parallel limit (default: 30)
5. Click "Run Selected" or "Run All"
6. Export results as JSON for analysis

## Files

| File | Purpose |
|------|---------|
| `index.html` | Test harness UI |
| `suite.js` | Runner logic, API calls, metrics |
| `configs.js` | 37 generation configurations |
| `prompts.js` | 60 test prompts (8 categories) |
| `metrics.js` | Coherence metrics (no category rules) |

## Configuration Matrix

### Prompt Variants (8)

| Variant | Description |
|---------|-------------|
| v4-base | Schema-driven baseline |
| v4-bright | + color guidance (avoid dark) |
| v4-thick | + geometry guidance (min thickness) |
| v4-quality | Combined guidance |
| v4-bright-thick | Color + geometry |
| v4-minimal | Simplicity constraints |
| v4-chunky | Low-poly style guidance |
| v4-export-first | Export line emphasis |

### Hyperparameters

| Parameter | Test Values |
|-----------|-------------|
| Temperature | 0.2, 0.3, 0.4, 0.5 |
| maxOutputTokens | 8192, 12288, 16384 |
| thinkingBudget | 0 (disabled) |

### Config Groups

| Group | Count | Purpose |
|-------|-------|---------|
| recommended | 3 | Production candidates |
| promptVariants | 8 | All V4 prompt variants |
| tempSweep | 8 | Temperature optimization |
| tokenSweep | 6 | Token limit optimization |
| fullGrid | 12 | Full parameter grid |
| **Total** | **37** | |

## Test Prompts (60)

| Category | Count | Examples |
|----------|-------|----------|
| Simple Props | 10 | wooden barrel, treasure chest, gold coin |
| Complex Props | 10 | ornate lantern, magic scroll, bubbling potion |
| Humanoids | 10 | medieval knight, wizard with staff, anime fighter |
| Creatures | 10 | spider, octopus, dragon head trophy |
| Animated | 5 | spinning crystal, bobbing buoy, swaying flag |
| Architecture | 5 | stone archway, wooden door, castle tower |
| Vehicles | 5 | flying drone, race car, sailing ship |
| Edge Cases | 5 | abstract sculpture, floating islands |

## Metrics Collected

```javascript
{
  // Status
  status: 'pass' | 'warn' | 'fail',
  errorType: 'missing-createAsset' | 'missing-export' | 'syntax-truncation' | 'runtime' | 'webgl',

  // API Response
  finishReason: 'STOP' | 'MAX_TOKENS',
  usage: {
    promptTokens: number,
    outputTokens: number,
    thinkingTokens: number  // Should be 0 with thinkingBudget: 0
  },

  // Timing
  timings: {
    planMs: number,
    genMs: number,
    totalMs: number
  },

  // Asset Metrics
  meshCount: number,
  materialCount: number,
  budgetCompliance: {
    meshes: boolean,    // <= 24
    materials: boolean  // <= 5
  }
}
```

## Analyzing Results

### Export JSON
Click "Export Results" to download JSON with all test data.

### Key Metrics to Track

1. **Pass Rate**: `status === 'pass'` percentage
2. **Error Distribution**: Group by `errorType`
3. **Truncation Rate**: `finishReason === 'MAX_TOKENS'` percentage
4. **Budget Compliance**: `budgetCompliance.meshes && budgetCompliance.materials`

### Filtering WebGL Errors

WebGL context exhaustion causes false failures. Filter these out:
```javascript
const realResults = results.filter(r => r.errorType !== 'webgl');
```

## Known Limitations

### WebGL Context Limits
Browsers limit WebGL contexts to ~8-16. Running many parallel tests causes "Error creating WebGL context" failures. These are infrastructure issues, not generation failures.

**Mitigations**:
- Reduce parallel limit to 8-10
- Reload page between large batches
- Filter WebGL errors from analysis

### Token Consumption
API calls consume tokens. Full matrix (37 configs × 60 prompts = 2,220 cells) costs approximately:
- Input: ~500 tokens/call
- Output: ~2,000-8,000 tokens/call
- Total: ~$5-15 USD per full run (Gemini Flash pricing)

## Recommended Test Workflow

### 1. Quick Validation (5 min)
- Select: `prod-fast`, `prod-balanced`, `prod-quality`
- Prompts: 5 from each category (25 total)
- Parallel: 10
- Goal: Verify configs work

### 2. Prompt Variant Comparison (15 min)
- Select: All `prompt-*` configs
- Prompts: 20 diverse prompts
- Parallel: 15
- Goal: Identify best prompt variant

### 3. Hyperparameter Sweep (30 min)
- Select: `tempSweep` or `tokenSweep` group
- Prompts: 30 representative prompts
- Parallel: 20
- Goal: Fine-tune specific parameter

### 4. Full Matrix (1-2 hours)
- Select: All configs
- Prompts: All 60 prompts
- Parallel: 30
- Goal: Comprehensive data for production decision

## Future Testing Priorities

### High Priority

1. **Temperature Fine-Tuning**
   - Range: 0.25-0.35
   - Goal: Optimal consistency vs variety

2. **Token Limit Optimization**
   - Test if 6144 sufficient for simple props
   - Monitor MAX_TOKENS frequency

3. **Planning Temperature**
   - Current: 0.7
   - Test: 0.5-0.8 range

### Medium Priority

4. **Category-Specific Configs**
   - Characters: higher token limits
   - Simple props: lower limits sufficient?

5. **Retry Strategy**
   - Does 2 attempts suffice with V4 prompts?
   - Temperature adjustment on retry?

### Infrastructure

6. **Visual Quality Scoring**
   - Automated screenshot comparison
   - Perceptual hash or ML scoring

7. **Regression Tracking**
   - Store golden outputs
   - Alert on quality regression

## Session History

| Date | Focus | Key Finding |
|------|-------|-------------|
| 2026-01-21 | Initial setup | Built 37-config matrix |
| 2026-01-22 | Thinking analysis | `thinkingBudget: 0` required |
| 2026-01-22 | Prompt comparison | V4-bright wins (~57% pass) |
| 2026-01-22 | Production update | PROD Fast (v4-bright, 8192) |

See `docs/asset-gen-findings.md` for detailed session notes.
