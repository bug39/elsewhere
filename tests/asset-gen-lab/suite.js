import * as THREE from 'three';
import { PROMPTS } from './prompts.js';
import { CONFIGS } from './configs.js';
import { analyzeAsset, analyzeCode, summarizeWarnings, measureAnimationDrift } from './metrics.js';
import { validateDelimiterBalance } from '../../src/generator/syntaxValidator.js';

const MODEL = 'gemini-3-flash-preview';
const BASE_URL_V1BETA = 'https://generativelanguage.googleapis.com/v1beta/models';
const BASE_URL_V1 = 'https://generativelanguage.googleapis.com/v1/models';
const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
];

const apiKeyInput = document.getElementById('api-key');
const apiVersionSelect = document.getElementById('api-version');
const systemModeSelect = document.getElementById('system-mode');
const thinkingModeSelect = document.getElementById('thinking-mode');
const previewModeSelect = document.getElementById('preview-mode');
const parallelInput = document.getElementById('parallel');
const runAllBtn = document.getElementById('run-all');
const stopBtn = document.getElementById('stop');
const exportBtn = document.getElementById('export');
const matrixEl = document.getElementById('matrix');

const detailsTitle = document.getElementById('details-title');
const detailsStatus = document.getElementById('details-status');
const detailsError = document.getElementById('details-error');
const detailsMetrics = document.getElementById('details-metrics');
const detailsWarnings = document.getElementById('details-warnings');
const detailsApi = document.getElementById('details-api');
const detailsCode = document.getElementById('details-code');
const detailsPlan = document.getElementById('details-plan');
const detailsRaw = document.getElementById('details-raw');

const summaryPass = document.getElementById('summary-pass');
const summaryWarn = document.getElementById('summary-warn');
const summaryFail = document.getElementById('summary-fail');
const summaryPending = document.getElementById('summary-pending');

const cellMap = new Map();
const resultMap = new Map();
let isRunning = false;
let cancelRequested = false;

const savedKey = localStorage.getItem('thinq_lab_api_key');
if (savedKey) apiKeyInput.value = savedKey;
apiKeyInput.addEventListener('input', () => {
  localStorage.setItem('thinq_lab_api_key', apiKeyInput.value);
  updateButtons();
});

const savedApiVersion = localStorage.getItem('thinq_lab_api_version');
if (savedApiVersion) apiVersionSelect.value = savedApiVersion;
apiVersionSelect.addEventListener('change', () => {
  localStorage.setItem('thinq_lab_api_version', apiVersionSelect.value);
});

const savedSystemMode = localStorage.getItem('thinq_lab_system_mode');
if (savedSystemMode) systemModeSelect.value = savedSystemMode;
systemModeSelect.addEventListener('change', () => {
  localStorage.setItem('thinq_lab_system_mode', systemModeSelect.value);
});

const savedThinkingMode = localStorage.getItem('thinq_lab_thinking_mode');
if (savedThinkingMode) thinkingModeSelect.value = savedThinkingMode;
thinkingModeSelect.addEventListener('change', () => {
  localStorage.setItem('thinq_lab_thinking_mode', thinkingModeSelect.value);
});

const savedPreviewMode = localStorage.getItem('thinq_lab_preview_mode');
previewModeSelect.value = savedPreviewMode || 'none';
previewModeSelect.addEventListener('change', () => {
  localStorage.setItem('thinq_lab_preview_mode', previewModeSelect.value);
});

const savedParallel = localStorage.getItem('thinq_lab_parallel');
if (savedParallel) parallelInput.value = savedParallel;
parallelInput.addEventListener('input', () => {
  localStorage.setItem('thinq_lab_parallel', parallelInput.value);
});

function updateButtons() {
  const hasKey = !!apiKeyInput.value.trim();
  runAllBtn.disabled = !hasKey || isRunning;
  stopBtn.disabled = !isRunning;
  exportBtn.disabled = resultMap.size === 0;
}

function getParallelLimit() {
  const parsed = parseInt(parallelInput.value, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(parsed, 30));
}

function getBaseUrl() {
  return apiVersionSelect.value === 'v1' ? BASE_URL_V1 : BASE_URL_V1BETA;
}

function getThinkingMode() {
  return thinkingModeSelect.value || 'off';
}

function getSystemMode() {
  return systemModeSelect.value || 'systemInstruction';
}

function getPreviewMode() {
  return previewModeSelect.value || 'none';
}

function keyFor(promptId, configId) {
  return `${promptId}::${configId}`;
}

function buildMatrix() {
  const previewMode = getPreviewMode();
  matrixEl.innerHTML = '';
  matrixEl.style.gridTemplateColumns = `240px repeat(${CONFIGS.length}, 220px)`;

  matrixEl.appendChild(headerCell('Prompt'));
  CONFIGS.forEach(config => {
    const cell = headerCell(config.label);
    cell.title = config.id;
    matrixEl.appendChild(cell);
  });

  PROMPTS.forEach(prompt => {
    matrixEl.appendChild(promptCell(prompt));
    CONFIGS.forEach(config => {
      const cell = testCell(prompt, config, previewMode);
      matrixEl.appendChild(cell);
      if (previewMode === 'always') {
        ensureCellScene(prompt.id, config.id);
      }
    });
  });

  updateSummary();
}

function headerCell(text) {
  const cell = document.createElement('div');
  cell.className = 'cell header';
  cell.textContent = text;
  return cell;
}

function promptCell(prompt) {
  const cell = document.createElement('div');
  cell.className = 'cell prompt';
  cell.innerHTML = `
    <div class="status">prompt</div>
    <input data-prompt-id="${prompt.id}" value="${prompt.text}">
    <button data-run-row="${prompt.id}">Run Row</button>
  `;

  const runBtn = cell.querySelector('button');
  runBtn.addEventListener('click', () => runRow(prompt.id));
  return cell;
}

function testCell(prompt, config, previewMode) {
  const cell = document.createElement('div');
  const key = keyFor(prompt.id, config.id);
  cell.className = 'cell test';
  cell.dataset.key = key;
  const previewLabel = previewMode === 'none' ? 'preview off' : 'preview ready';
  cell.innerHTML = `
    <div class="status">pending</div>
    <button class="run-btn" data-run="${key}">Run</button>
    <div class="preview">${previewLabel}</div>
    <div class="metrics">-</div>
  `;

  cell.addEventListener('click', (e) => {
    if (e.target?.dataset?.run) return;
    showDetails(key);
  });

  const runBtn = cell.querySelector('.run-btn');
  runBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    runCell(prompt.id, config.id);
  });

  cellMap.set(key, { cell, promptId: prompt.id, configId: config.id });
  return cell;
}

function ensureCellScene(promptId, configId) {
  const keyId = keyFor(promptId, configId);
  const entry = cellMap.get(keyId);
  if (!entry || entry.renderer) return entry;

  const preview = entry.cell.querySelector('.preview');
  if (!preview) return entry;

  const canvas = document.createElement('canvas');
  preview.replaceWith(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(200, 100);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0b12);

  const camera = new THREE.PerspectiveCamera(50, 2, 0.1, 100);
  camera.position.set(2, 1.5, 2);

  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(4, 8, 6);
  scene.add(ambient, key);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(5, 5),
    new THREE.MeshStandardMaterial({ color: 0x1c1c28 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.5;
  scene.add(ground);
  entry.scene = scene;
  entry.camera = camera;
  entry.renderer = renderer;
  entry.asset = null;
  return entry;
}

function resizeAll() {
  cellMap.forEach(({ cell, camera, renderer }) => {
    if (!renderer || !camera) return;
    const canvas = cell.querySelector('canvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    renderer.setSize(rect.width, rect.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  });
}

window.addEventListener('resize', resizeAll);

function getPromptText(promptId) {
  const input = document.querySelector(`input[data-prompt-id="${promptId}"]`);
  return input ? input.value.trim() : '';
}

function updateCellStatus(key, status, metricsText) {
  const entry = cellMap.get(key);
  if (!entry) return;
  const statusEl = entry.cell.querySelector('.status');
  statusEl.className = `status ${status}`;
  statusEl.textContent = status;
  if (metricsText !== undefined) {
    entry.cell.querySelector('.metrics').textContent = metricsText;
  }
}

function updateSummary() {
  let pass = 0;
  let warn = 0;
  let fail = 0;
  let pending = 0;

  PROMPTS.forEach(prompt => {
    CONFIGS.forEach(config => {
      const key = keyFor(prompt.id, config.id);
      const result = resultMap.get(key);
      if (!result) {
        pending++;
        return;
      }
      if (result.status === 'pass') pass++;
      else if (result.status === 'warn') warn++;
      else fail++;
    });
  });

  summaryPass.textContent = `Pass: ${pass}`;
  summaryWarn.textContent = `Warn: ${warn}`;
  summaryFail.textContent = `Fail: ${fail}`;
  summaryPending.textContent = `Pending: ${pending}`;
  updateButtons();
}

function formatTimings(timings) {
  if (!timings) return 't:-';
  const total = timings.totalMs ? timings.totalMs / 1000 : 0;
  const plan = timings.planMs ? timings.planMs / 1000 : 0;
  const gen = timings.genMs ? timings.genMs / 1000 : 0;
  return `t:${total.toFixed(1)}s p:${plan.toFixed(1)}s g:${gen.toFixed(1)}s`;
}

function showDetails(key) {
  const result = resultMap.get(key);
  const entry = cellMap.get(key);
  if (!entry) return;
  const prompt = PROMPTS.find(p => p.id === entry.promptId);
  const config = CONFIGS.find(c => c.id === entry.configId);

  detailsTitle.textContent = `${prompt?.text || entry.promptId} | ${config?.label || entry.configId}`;
  if (!result) {
    detailsStatus.textContent = 'Status: pending';
    detailsError.textContent = 'Error: -';
    detailsMetrics.textContent = '-';
    detailsWarnings.textContent = '-';
    detailsApi.textContent = '-';
    detailsCode.textContent = '-';
    detailsPlan.textContent = '-';
    detailsRaw.textContent = '-';
    return;
  }

  detailsStatus.textContent = `Status: ${result.status}`;
  detailsError.textContent = `Error: ${result.error?.message || '-'}`;
  detailsMetrics.textContent = JSON.stringify({
    metrics: result.metrics || {},
    timings: result.timings || {}
  }, null, 2);
  detailsWarnings.textContent = (result.warnings || []).join('\n') || '-';
  detailsApi.textContent = JSON.stringify(result.api || {}, null, 2);
  detailsCode.textContent = result.code || '-';
  detailsPlan.textContent = result.planText || '-';
  detailsRaw.textContent = result.raw || '-';
}

function extractCode(response) {
  let code = response.trim();
  if (code.startsWith('```javascript')) code = code.slice(13);
  else if (code.startsWith('```js')) code = code.slice(5);
  else if (code.startsWith('```')) code = code.slice(3);
  if (code.endsWith('```')) code = code.slice(0, -3);
  code = code.trim();

  code = code
    .replace(/\u3002/g, '.')
    .replace(/\uff0c/g, ',')
    .replace(/\uff1a/g, ':')
    .replace(/\uff1b/g, ';')
    .replace(/\uff01/g, '!')
    .replace(/\uff1f/g, '?')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\uff08/g, '(')
    .replace(/\uff09/g, ')')
    .replace(/\uff5b/g, '{')
    .replace(/\uff5d/g, '}')
    .replace(/\uff3b/g, '[')
    .replace(/\uff3d/g, ']');

  code = code.replace(/[^\x00-\x7F]+/g, '');
  code = code.replace(/^import\s+.*?from\s+['"][^'"]+['"];?\s*\n?/gm, '');
  code = code.replace(/^import\s+['"][^'"]+['"];?\s*\n?/gm, '');

  const funcMatches = [...code.matchAll(/export\s+function\s+createAsset\s*\(\s*THREE\s*\)\s*\{/g)];
  if (funcMatches.length > 1) {
    const firstStart = funcMatches[0].index;
    const secondStart = funcMatches[1].index;
    let braceCount = 0;
    let inFunction = false;
    let funcEnd = secondStart;
    for (let i = firstStart; i < secondStart; i++) {
      if (code[i] === '{') {
        braceCount++;
        inFunction = true;
      } else if (code[i] === '}') {
        braceCount--;
        if (inFunction && braceCount === 0) {
          funcEnd = i + 1;
          break;
        }
      }
    }
    code = code.slice(firstStart, funcEnd);
  }

  return code;
}

function repairExports(code) {
  let updated = code;
  updated = updated.replace(/export\s+function\s+CreateAsset/g, 'export function createAsset');
  updated = updated.replace(/function\s+CreateAsset/g, 'function createAsset');
  updated = updated.replace(/export\s+default\s+function\s+CreateAsset/g, 'export function createAsset');
  updated = updated.replace(/export\s+default\s+function\s+createAsset/g, 'export function createAsset');

  const hasNamedExport = /export\s+function\s+createAsset\s*\(/.test(updated) ||
    /export\s*\{\s*createAsset\s*\}/.test(updated);
  if (!hasNamedExport && /function\s+createAsset\s*\(/.test(updated)) {
    updated = updated.replace(/function\s+createAsset\s*\(/, 'export function createAsset(');
  }

  const hasExportAfter = /export\s+function\s+createAsset\s*\(/.test(updated) ||
    /export\s*\{\s*createAsset\s*\}/.test(updated);
  if (!hasExportAfter && /const\s+createAsset\s*=/.test(updated)) {
    updated += '\nexport { createAsset };';
  }

  return updated;
}

function repairTubeArrayPaths(code) {
  const target = 'new THREE.TubeGeometry';
  let out = '';
  let i = 0;
  while (i < code.length) {
    const idx = code.indexOf(target, i);
    if (idx === -1) {
      out += code.slice(i);
      break;
    }
    out += code.slice(i, idx);
    let j = idx + target.length;
    while (j < code.length && /\s/.test(code[j])) j++;
    if (code[j] !== '(') {
      out += code.slice(idx, j);
      i = j;
      continue;
    }
    let k = j + 1;
    while (k < code.length && /\s/.test(code[k])) k++;
    if (code[k] !== '[') {
      out += code.slice(idx, k);
      i = k;
      continue;
    }
    out += target;
    out += '(new THREE.CatmullRomCurve3(';
    let depth = 0;
    let pos = k;
    while (pos < code.length) {
      const ch = code[pos];
      if (ch === '[') depth++;
      if (ch === ']') {
        depth--;
        if (depth === 0) {
          pos++;
          break;
        }
      }
      pos++;
    }
    out += code.slice(k, pos);
    out += ')';
    i = pos;
  }
  return out;
}

function validateCode(code) {
  if (!code.includes('createAsset')) {
    throw new Error('Generated code missing createAsset function');
  }

  const createAssetMatches = code.match(/function\s+createAsset/g);
  if (createAssetMatches && createAssetMatches.length > 1) {
    throw new Error(`Generated code has ${createAssetMatches.length} createAsset declarations`);
  }

  const balance = validateDelimiterBalance(code);
  if (!balance.valid) {
    throw new Error(`Syntax error: ${balance.errors[0]}`);
  }
}

async function loadAssetModule(code) {
  const blob = new Blob([code], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    return await import(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function fetchGemini(prompt, systemPrompt, config, apiKey) {
  const systemMode = getSystemMode();
  const thinkingMode = getThinkingMode();
  const combinedPrompt = systemMode === 'inline'
    ? `SYSTEM PROMPT:\n${systemPrompt}\n\nUSER PROMPT:\n${prompt}`
    : prompt;

  const requestBody = {
    contents: [{ role: 'user', parts: [{ text: combinedPrompt }] }],
    generationConfig: {
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens
    },
    safetySettings: SAFETY_SETTINGS
  };

  if (systemMode === 'systemInstruction') {
    requestBody.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  // Configure thinking based on mode
  if (thinkingMode === 'off') {
    // Explicitly disable thinking with thinkingBudget: 0
    requestBody.generationConfig.thinkingConfig = { thinkingBudget: 0 };
  } else if (thinkingMode === 'budget') {
    // Use thinkingBudget directly from config (or fall back to thinkingLevel mapping)
    let budget = config.thinkingBudget;
    if (budget === undefined && config.thinkingLevel) {
      const budgetMap = { 'MINIMAL': 1024, 'LOW': 4096, 'MEDIUM': 8192, 'HIGH': 16384 };
      budget = budgetMap[config.thinkingLevel] || 8192;
    }
    requestBody.generationConfig.thinkingConfig = {
      thinkingBudget: budget ?? 0
    };
  } else if (config.thinkingLevel) {
    if (thinkingMode === 'root') {
      requestBody.thinking = { thinking_level: config.thinkingLevel };
    } else if (thinkingMode === 'gen-config') {
      requestBody.generationConfig.thinking = { thinking_level: config.thinkingLevel };
    }
  }

  const response = await fetch(
    `${getBaseUrl()}/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('No response from Gemini');
  const meta = {
    finishReason: data.candidates?.[0]?.finishReason || null,
    safetyRatings: data.candidates?.[0]?.safetyRatings || null,
    promptFeedback: data.promptFeedback || null,
    usage: data.usageMetadata || null
  };
  return { text, meta };
}

function parsePlan(text) {
  let jsonText = text.trim();
  if (jsonText.startsWith('```json')) jsonText = jsonText.slice(7);
  else if (jsonText.startsWith('```')) jsonText = jsonText.slice(3);
  if (jsonText.endsWith('```')) jsonText = jsonText.slice(0, -3);
  jsonText = jsonText.trim();

  jsonText = jsonText.replace(/:\s*0x([0-9a-fA-F]+)/g, (match, hex) => {
    return ': ' + parseInt(hex, 16);
  });

  try {
    return JSON.parse(jsonText);
  } catch {
    return { raw: text };
  }
}

async function planAsset(prompt, config, apiKey) {
  const planConfig = {
    ...config.planning,
    thinkingBudget: config.planThinkingBudget ?? config.thinkingBudget ?? 4096
  };
  const { text, meta } = await fetchGemini(
    `Plan the 3D asset: ${prompt}`,
    config.planPrompt,
    planConfig,
    apiKey
  );
  return { text, plan: parsePlan(text), meta };
}

async function generateAssetCode(prompt, plan, config, apiKey) {
  let enhancedPrompt = `Create a 3D asset: ${prompt}`;
  if (plan && plan.v === 3) {
    enhancedPrompt += `\n\nPLAN JSON:\n${JSON.stringify(plan)}`;
  } else if (plan && !plan.raw) {
    enhancedPrompt += `\n\nDECOMPOSITION PLAN:\n`;
    if (plan.parts) enhancedPrompt += `Parts: ${plan.parts.join(', ')}\n`;
    if (plan.geometry) {
      enhancedPrompt += `Geometry hints: ${Object.entries(plan.geometry).map(([k, v]) => `${k}=${v}`).join(', ')}\n`;
    }
    if (plan.connections) enhancedPrompt += `Connections: ${plan.connections.join('; ')}\n`;
    if (plan.style) enhancedPrompt += `Style: ${plan.style}`;
  } else if (plan?.raw) {
    enhancedPrompt += `\n\nPLAN:\n${plan.raw}`;
  }

  const genConfig = {
    ...config.generation,
    thinkingBudget: config.thinkingBudget ?? 0
  };
  return fetchGemini(enhancedPrompt, config.systemPrompt, genConfig, apiKey);
}

function classifyError(err) {
  const message = err?.message || String(err);
  if (/createAsset/.test(message) && /missing/i.test(message)) return 'missing-createAsset';
  if (/Module does not export createAsset/i.test(message)) return 'missing-export';
  if (/Syntax error/i.test(message) || /Missing .* bracket/i.test(message)) return 'syntax-truncation';
  if (/computeFrenetFrame/i.test(message)) return 'tube-path';
  return 'runtime';
}

async function runCellInternal(promptId, configId) {
  const key = keyFor(promptId, configId);
  const config = CONFIGS.find(c => c.id === configId);
  const promptText = getPromptText(promptId);
  if (!promptText) return;
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) return;

  updateCellStatus(key, 'running', 'running...');

  const entry = cellMap.get(key);
  const previewMode = getPreviewMode();
  const start = performance.now();
  const result = {
    promptId,
    prompt: promptText,
    configId,
    configLabel: config.label,
    status: 'fail',
    error: null,
    code: null,
    raw: null,
    planText: null,
    metrics: null,
    warnings: [],
    analysis: null,
    api: { plan: null, gen: null },
    timings: {
      planMs: 0,
      genMs: 0,
      totalMs: 0,
      attempts: []
    }
  };

  try {
    let plan = null;
    if (config.usePlanning) {
      const planStart = performance.now();
      const planResult = await planAsset(promptText, config, apiKey);
      result.timings.planMs = performance.now() - planStart;
      result.planText = planResult.text;
      result.api.plan = planResult.meta;
      plan = planResult.plan;
    }

    let module = null;
    let finalCode = null;
    let rawText = null;
    let lastError = null;
    const attempts = config.attempts || 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      let genStart = 0;
      try {
        genStart = performance.now();
        const genResult = await generateAssetCode(promptText, plan, config, apiKey);
        rawText = genResult.text;
        result.api.gen = genResult.meta;
        const extracted = extractCode(rawText);
        let repaired = extracted;
        if (config.repair?.exports) repaired = repairExports(repaired);
        if (config.repair?.tubePath) repaired = repairTubeArrayPaths(repaired);
        result.raw = rawText;
        result.code = repaired;
        result.analysis = analyzeCode(repaired);
        validateCode(repaired);
        module = await loadAssetModule(repaired);
        const genMs = performance.now() - genStart;
        result.timings.genMs += genMs;
        result.timings.attempts.push({ attempt, ms: genMs, success: true });
        finalCode = repaired;
        break;
      } catch (err) {
        const genMs = performance.now() - genStart;
        result.timings.genMs += genMs;
        result.timings.attempts.push({ attempt, ms: genMs, success: false, error: err.message });
        lastError = err;
        if (attempt === attempts) throw err;
      }
    }

    result.raw = result.raw || rawText;
    result.code = result.code || finalCode;
    result.analysis = result.analysis || analyzeCode(finalCode || '');
    if (!module?.createAsset) {
      throw new Error('Module does not export createAsset function');
    }

    const asset = module.createAsset(THREE);
    if (!(asset instanceof THREE.Object3D)) {
      throw new Error('createAsset did not return a THREE.Object3D');
    }

    if (previewMode !== 'none') {
      ensureCellScene(promptId, configId);
    }

    if (entry.scene && entry.renderer) {
      if (entry.asset) {
        entry.scene.remove(entry.asset);
      }
      entry.asset = asset;
      entry.scene.add(asset);
    }

    const box = new THREE.Box3().setFromObject(asset);
    asset.position.y -= box.min.y + 0.5;

    if (entry.camera && entry.renderer) {
      const center = box.getCenter(new THREE.Vector3());
      entry.camera.position.set(center.x + 2, center.y + 1.5, center.z + 2);
      entry.camera.lookAt(center);
      entry.renderer.render(entry.scene, entry.camera);
    }

    const metrics = analyzeAsset(asset, THREE);
    const animation = measureAnimationDrift(asset);
    result.metrics = { ...metrics, animation, code: result.analysis };
    result.warnings = summarizeWarnings(metrics);
    if (animation.hasAnimation && animation.drift > 0.25 && animation.monotonic) {
      result.warnings.push('anim-drift');
    }

    result.status = result.warnings.length > 0 ? 'warn' : 'pass';
    result.timings.totalMs = performance.now() - start;

    const metricLine = `m:${metrics.meshCount} mat:${metrics.materialCount} pm:${metrics.primaryMassRatio.toFixed(2)} ov:${metrics.overlapRatio.toFixed(2)} ${formatTimings(result.timings)}`;
    updateCellStatus(key, result.status, metricLine);
  } catch (err) {
    result.status = 'fail';
    result.error = { message: err.message, type: classifyError(err) };
    result.timings.totalMs = performance.now() - start;
    updateCellStatus(key, 'fail', `${err.message} ${formatTimings(result.timings)}`);
  }

  resultMap.set(key, result);
  if (entry) {
    entry.cell.classList.toggle('selected', false);
  }

  showDetails(key);
  updateSummary();
}

async function runRow(promptId) {
  if (isRunning) return;
  cancelRequested = false;
  isRunning = true;
  updateButtons();

  const tasks = CONFIGS.map(config => () => runCellInternal(promptId, config.id));
  await runTasks(tasks, getParallelLimit());

  isRunning = false;
  updateButtons();
}

async function runAll() {
  if (isRunning) return;
  cancelRequested = false;
  isRunning = true;
  updateButtons();

  const tasks = [];
  for (const prompt of PROMPTS) {
    for (const config of CONFIGS) {
      tasks.push(() => runCellInternal(prompt.id, config.id));
    }
  }
  await runTasks(tasks, getParallelLimit());

  isRunning = false;
  updateButtons();
}

async function runTasks(tasks, concurrency) {
  let index = 0;
  const workers = new Array(concurrency).fill(null).map(async () => {
    while (true) {
      if (cancelRequested) return;
      const task = tasks[index++];
      if (!task) return;
      await task();
    }
  });
  await Promise.all(workers);
}

async function runCell(promptId, configId) {
  if (isRunning) return;
  isRunning = true;
  updateButtons();
  await runCellInternal(promptId, configId);
  isRunning = false;
  updateButtons();
}

function exportResults() {
  const results = {
    timestamp: new Date().toISOString(),
    configs: CONFIGS.map(c => ({
      id: c.id,
      label: c.label,
      promptVersion: c.promptVersion,
      usePlanning: c.usePlanning,
      thinkingBudget: c.thinkingBudget,
      planThinkingBudget: c.planThinkingBudget,
      generation: c.generation,
      planning: c.planning,
      repair: c.repair
    })),
    request: {
      apiVersion: apiVersionSelect.value,
      systemMode: getSystemMode(),
      thinkingMode: getThinkingMode()
    },
    prompts: PROMPTS.map(p => ({ id: p.id, text: p.text })),
    results: []
  };

  resultMap.forEach((value, key) => {
    results.results.push({ key, ...value });
  });

  const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `asset-gen-stress-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

runAllBtn.addEventListener('click', runAll);
stopBtn.addEventListener('click', () => { cancelRequested = true; });
exportBtn.addEventListener('click', exportResults);

buildMatrix();
setTimeout(resizeAll, 50);
updateButtons();
