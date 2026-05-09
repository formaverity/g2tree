/**
 * Centralized ONNX Runtime Web setup.
 *
 * Provides:
 *  - getOrt()            — lazily imported ort module
 *  - createSession()     — load an ONNX model with WebGPU → WASM fallback
 *  - cachedSession()     — load once, cache forever (keyed by URL)
 *  - cacheModel()        — pre-cache model bytes via Cache API
 */

let _ort = null

/** Lazy-import onnxruntime-web once. */
export async function getOrt() {
  if (_ort) return _ort
  _ort = await import('onnxruntime-web')
  // Serve WASM binaries from /ort-wasm/ — no CDN dependency
  _ort.env.wasm.wasmPaths  = '/ort-wasm/'
  _ort.env.wasm.numThreads = 1
  return _ort
}

/**
 * Create an InferenceSession.
 * Tries WebGPU first, falls back to WASM.
 *
 * @param {string} modelUrl  — path to .onnx file under /public/
 * @param {object} [opts]    — additional InferenceSession options
 */
export async function createSession(modelUrl, opts = {}) {
  const ort = await getOrt()

  // Try WebGPU
  try {
    const session = await ort.InferenceSession.create(modelUrl, {
      executionProviders:     ['webgpu'],
      graphOptimizationLevel: 'all',
      ...opts,
    })
    return { session, backend: 'webgpu' }
  } catch {
    // fall through to WASM
  }

  const session = await ort.InferenceSession.create(modelUrl, {
    executionProviders:     ['wasm'],
    graphOptimizationLevel: 'all',
    ...opts,
  })
  return { session, backend: 'wasm' }
}

// In-memory cache: modelUrl → { session, backend }
const _sessionCache = new Map()

/**
 * Load a session once and return the cached copy on subsequent calls.
 * Thread-safe: concurrent calls for the same URL share a single in-flight promise.
 */
const _inFlight = new Map()

export async function cachedSession(modelUrl, opts = {}) {
  if (_sessionCache.has(modelUrl)) return _sessionCache.get(modelUrl)

  if (_inFlight.has(modelUrl)) return _inFlight.get(modelUrl)

  const promise = createSession(modelUrl, opts)
    .then((entry) => {
      _sessionCache.set(modelUrl, entry)
      _inFlight.delete(modelUrl)
      return entry
    })
    .catch((err) => {
      _inFlight.delete(modelUrl)
      throw err
    })

  _inFlight.set(modelUrl, promise)
  return promise
}

// SAM model URLs — same as sam.js uses
const SAM_ENCODER = '/models/sam/encoder.onnx'
const SAM_DECODER = '/models/sam/decoder.onnx'
const DEPTH_MODEL  = '/models/depth/model.onnx'

let _warmupDone = false
let _warmupPromise = null

/**
 * Pre-load ONNX sessions for SAM and Depth models in the background.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function warmup() {
  if (_warmupDone || _warmupPromise) return
  _warmupPromise = Promise.allSettled([
    cachedSession(SAM_ENCODER),
    cachedSession(SAM_DECODER),
    cachedSession(DEPTH_MODEL),
  ]).then(() => { _warmupDone = true; _warmupPromise = null })
}

/** True once warmup sessions have all settled (success or failure). */
export function isReady() { return _warmupDone }

/**
 * Pre-fetch a model file into the browser Cache API so the first inference
 * call doesn't stall on a cold network fetch.
 *
 * @param {string} modelUrl
 * @param {(progress: number) => void} [onProgress]  — 0–1
 */
export async function cacheModel(modelUrl, onProgress) {
  const cache = await caches.open('g2tree-ai-models')
  const existing = await cache.match(modelUrl)
  if (existing) { onProgress?.(1); return }

  const res = await fetch(modelUrl)
  if (!res.ok) throw new Error(`Failed to fetch model: ${res.status}`)

  const total  = parseInt(res.headers.get('content-length') ?? '0', 10)
  const reader = res.body.getReader()
  const chunks = []
  let received = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    if (total > 0) onProgress?.(received / total)
  }

  const blob     = new Blob(chunks)
  const cached   = new Response(blob, { headers: res.headers })
  await cache.put(modelUrl, cached)
  onProgress?.(1)
}
