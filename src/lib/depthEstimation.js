/**
 * Depth estimation service using ONNX Runtime Web.
 *
 * Expected model: Depth Anything V2 Small exported to ONNX.
 * Place the model file at:  /public/models/depth-anything-v2-small/model.onnx
 *
 * WASM backend files are served from /ort-wasm/ (copied from node_modules at
 * install time). See public/ort-wasm/ort-wasm-simd-threaded.wasm.
 *
 * If the model file is absent or inference fails the service marks itself
 * unavailable; all callers receive a graceful null result.
 */
import * as ort from 'onnxruntime-web'

// ── Constants ────────────────────────────────────────────────────────────────

const MODEL_URL  = '/models/depth-anything-v2-small/model.onnx'
const INPUT_SIZE = 518   // standard Depth Anything V2 input dimension (H = W)
const GRID_SIZE  = 32    // low-res grid for procedural reconstruction

const MEAN = [0.485, 0.456, 0.406]   // ImageNet normalisation
const STD  = [0.229, 0.224, 0.225]

// ── Singleton ────────────────────────────────────────────────────────────────

let _session     = null   // InferenceSession once loaded
let _loadPromise = null   // in-flight load promise (deduplicate concurrent calls)
let _unavailable = false  // permanently unavailable after first failure

// ── Initialisation ───────────────────────────────────────────────────────────

function _configureOrt() {
  // Serve WASM binaries from our public directory so no CDN is required.
  // numThreads = 1 keeps memory usage low and avoids SharedArrayBuffer
  // complexity on browsers without cross-origin isolation.
  ort.env.wasm.wasmPaths  = '/ort-wasm/'
  ort.env.wasm.numThreads = 1
}

/**
 * Lazily load the ONNX session. Safe to call multiple times — returns the
 * cached session on subsequent calls.
 * @returns {Promise<ort.InferenceSession>}
 * @throws if the model file is missing or ONNX Runtime fails to initialise.
 */
export async function loadDepthModel() {
  if (_session)     return _session
  if (_unavailable) throw new Error('Depth model is unavailable')
  if (_loadPromise) return _loadPromise

  _configureOrt()

  console.info('[depth load] fetching', MODEL_URL)

  _loadPromise = ort.InferenceSession
    .create(MODEL_URL, {
      executionProviders:    ['wasm'],
      graphOptimizationLevel: 'all',
    })
    .then((session) => {
      _session     = session
      _loadPromise = null
      console.info('[depth load] session ready')
      return session
    })
    .catch((err) => {
      _unavailable = true
      _loadPromise = null
      console.error('[depth load] failed:', err)
      throw err
    })

  return _loadPromise
}

export const isDepthAvailable   = () => _session !== null
export const isDepthUnavailable = () => _unavailable

// ── Preprocessing ─────────────────────────────────────────────────────────────

function _preprocessImage(imageUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()

    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width  = INPUT_SIZE
      canvas.height = INPUT_SIZE
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, INPUT_SIZE, INPUT_SIZE)

      const { data } = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE)
      const n      = INPUT_SIZE * INPUT_SIZE
      const tensor = new Float32Array(3 * n)

      for (let i = 0; i < n; i++) {
        tensor[i]         = (data[i * 4]     / 255 - MEAN[0]) / STD[0]  // R
        tensor[n + i]     = (data[i * 4 + 1] / 255 - MEAN[1]) / STD[1]  // G
        tensor[2 * n + i] = (data[i * 4 + 2] / 255 - MEAN[2]) / STD[2]  // B
      }

      resolve(tensor)
    }

    img.onerror = () => reject(new Error('Depth preprocessing: image failed to load'))
    img.src = imageUrl
  })
}

// ── Postprocessing ────────────────────────────────────────────────────────────

function _normalize(raw) {
  let min = Infinity, max = -Infinity
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] < min) min = raw[i]
    if (raw[i] > max) max = raw[i]
  }
  const range = max - min || 1
  const out   = new Float32Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = (raw[i] - min) / range
  return { normalized: out, rawMin: min, rawMax: max }
}

/** Build a GRID_SIZE × GRID_SIZE low-resolution depth grid (values 0–1). */
function _buildGrid(depthNorm, dw, dh) {
  const grid = []
  for (let gy = 0; gy < GRID_SIZE; gy++) {
    const row = []
    for (let gx = 0; gx < GRID_SIZE; gx++) {
      const px = Math.round((gx + 0.5) * dw / GRID_SIZE)
      const py = Math.round((gy + 0.5) * dh / GRID_SIZE)
      row.push(depthNorm[py * dw + px])
    }
    grid.push(row)
  }
  return grid
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run depth estimation on a single image URL.
 *
 * @param {string} imageUrl — blob: or data: URL of the primary tree photo
 * @returns {Promise<{
 *   depthMap:  Float32Array,   // normalised 0–1, length = width × height
 *   grid:      number[][],     // GRID_SIZE × GRID_SIZE low-res depth grid
 *   width:     number,
 *   height:    number,
 *   rawMin:    number,
 *   rawMax:    number,
 * }>}
 * @throws if model is unavailable or inference fails
 */
export async function estimateDepth(imageUrl) {
  const session = await loadDepthModel()

  const tensorData  = await _preprocessImage(imageUrl)
  const inputTensor = new ort.Tensor('float32', tensorData, [1, 3, INPUT_SIZE, INPUT_SIZE])

  // Use the first input/output name — handles varying export conventions
  const feeds   = { [session.inputNames[0]]: inputTensor }
  const results = await session.run(feeds)
  const output  = results[session.outputNames[0]]

  // Shape is [1, H, W] or [1, 1, H, W]
  const dims = output.dims
  const dh   = dims[dims.length - 2]
  const dw   = dims[dims.length - 1]

  const { normalized, rawMin, rawMax } = _normalize(output.data)
  const grid = _buildGrid(normalized, dw, dh)

  return { depthMap: normalized, grid, width: dw, height: dh, rawMin, rawMax }
}
