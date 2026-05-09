/**
 * SAM2 / EfficientSAM / MobileSAM wrapper for tree silhouette extraction.
 *
 * Expected model layout under /public/models/sam/:
 *   encoder.onnx   — image encoder
 *   decoder.onnx   — mask decoder (takes point prompts + encoded image)
 *
 * These are the MobileSAM or EfficientSAM ONNX exports.
 * If models are absent, every call returns null and the pipeline falls back
 * to the heuristic in analyzeTreeImage.js.
 *
 * Output: Float32Array mask (values 0–1) at model output resolution,
 *         alongside the { width, height } of that resolution.
 */

import { cachedSession, getOrt } from './runtime'

const ENCODER_URL = '/models/sam/encoder.onnx'
const DECODER_URL = '/models/sam/decoder.onnx'

// Square input size the encoder expects
const ENCODER_SIZE = 1024

const MEAN = [0.485, 0.456, 0.406]
const STD  = [0.229, 0.224, 0.225]

let _unavailable = false

function markUnavailable() { _unavailable = true }

export const isSAMAvailable   = () => !_unavailable
export const isSAMUnavailable = () => _unavailable

// ── Preprocessing ─────────────────────────────────────────────────────────────

function preprocessImage(imageUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = ENCODER_SIZE
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, ENCODER_SIZE, ENCODER_SIZE)
      const { data } = ctx.getImageData(0, 0, ENCODER_SIZE, ENCODER_SIZE)
      const n      = ENCODER_SIZE * ENCODER_SIZE
      const tensor = new Float32Array(3 * n)
      for (let i = 0; i < n; i++) {
        tensor[i]         = (data[i * 4]     / 255 - MEAN[0]) / STD[0]
        tensor[n + i]     = (data[i * 4 + 1] / 255 - MEAN[1]) / STD[1]
        tensor[2 * n + i] = (data[i * 4 + 2] / 255 - MEAN[2]) / STD[2]
      }
      resolve({ tensor, origW: img.naturalWidth, origH: img.naturalHeight })
    }
    img.onerror = () => reject(new Error('SAM: image load failed'))
    img.src = imageUrl
  })
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * v2 API: segment the tree from a Blob / File.
 *
 * @param {Blob|File} imageBlob
 * @param {{ trunkPoint?: { x: number, y: number } }} [hints]
 * @returns {Promise<{ mask: Float32Array, width: number, height: number } | null>}
 */
export async function segmentTree(imageBlob, hints = {}) {
  const url    = URL.createObjectURL(imageBlob)
  const point  = hints.trunkPoint ?? { x: 0.5, y: 0.6 }
  try {
    return await runSAM(url, point)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Run SAM silhouette extraction on a tree photo.
 *
 * @param {string}  imageUrl   — blob: or data: URL of the primary tree photo
 * @param {{ x: number, y: number }} promptPoint — normalized (0–1) point on the trunk,
 *        e.g. midpoint of the trunk axis derived from scale anchors.
 * @returns {Promise<{
 *   mask:   Float32Array,   // 0 = background, 1 = foreground, length = width * height
 *   width:  number,
 *   height: number,
 * } | null>}
 */
export async function runSAM(imageUrl, promptPoint) {
  if (_unavailable) return null

  try {
    const [encResult, decResult] = await Promise.allSettled([
      cachedSession(ENCODER_URL),
      cachedSession(DECODER_URL),
    ])

    if (encResult.status === 'rejected' || decResult.status === 'rejected') {
      markUnavailable()
      return null
    }

    const ort        = await getOrt()
    const { session: encoder } = encResult.value
    const { session: decoder } = decResult.value

    const { tensor: imgTensor, origW, origH } = await preprocessImage(imageUrl)

    // ── Encoder forward pass ──────────────────────────────────────────────────
    const encInput  = new ort.Tensor('float32', imgTensor, [1, 3, ENCODER_SIZE, ENCODER_SIZE])
    const encFeeds  = { [encoder.inputNames[0]]: encInput }
    const encOut    = await encoder.run(encFeeds)
    const imageEmb  = encOut[encoder.outputNames[0]]

    // ── Decoder forward pass with point prompt ────────────────────────────────
    // SAM decoder expects: image_embeddings, point_coords, point_labels, mask_input, has_mask_input, orig_im_size
    // Coordinates in ENCODER_SIZE space
    const px = promptPoint.x * ENCODER_SIZE
    const py = promptPoint.y * ENCODER_SIZE

    const pointCoords = new ort.Tensor('float32', new Float32Array([px, py, 0, 0]), [1, 2, 2])
    const pointLabels = new ort.Tensor('float32', new Float32Array([1, -1]),        [1, 2])
    // Dummy mask input
    const maskInput   = new ort.Tensor('float32', new Float32Array(256 * 256).fill(0), [1, 1, 256, 256])
    const hasMask     = new ort.Tensor('float32', new Float32Array([0]), [1])
    const origSize    = new ort.Tensor('float32', new Float32Array([origH, origW]), [2])

    const decFeeds = {}
    decoder.inputNames.forEach((name) => {
      if (name.includes('image_embed'))     decFeeds[name] = imageEmb
      else if (name.includes('point_coord')) decFeeds[name] = pointCoords
      else if (name.includes('point_label')) decFeeds[name] = pointLabels
      else if (name.includes('mask_input'))  decFeeds[name] = maskInput
      else if (name.includes('has_mask'))    decFeeds[name] = hasMask
      else if (name.includes('orig'))        decFeeds[name] = origSize
    })

    const decOut = await decoder.run(decFeeds)

    // Low-res mask is typically [1, 1, H, W]
    const maskTensor = decOut[decoder.outputNames[0]]
    const dims       = maskTensor.dims
    const mH         = dims[dims.length - 2]
    const mW         = dims[dims.length - 1]

    // Binarize via sigmoid > 0.5
    const raw  = maskTensor.data
    const mask = new Float32Array(raw.length)
    for (let i = 0; i < raw.length; i++) {
      mask[i] = 1 / (1 + Math.exp(-raw[i])) > 0.5 ? 1 : 0
    }

    return { mask, width: mW, height: mH }

  } catch (err) {
    console.warn('SAM inference failed, falling back to heuristic:', err.message)
    markUnavailable()
    return null
  }
}
