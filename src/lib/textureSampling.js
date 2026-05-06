/**
 * Browser-local texture crop and colour analysis utilities.
 */

// ── Mask presets ──────────────────────────────────────────────────────────────

const MASK_PRESETS = {
  leaf: {
    saturationMin:        0.16,
    valueMin:             0.12,
    whiteValueCutoff:     0.88,
    graySaturationCutoff: 0.12,
    blueHueRange:         [185, 255],
    edgeCleanPasses:      2,
  },
  canopy: {
    saturationMin:        0.12,
    valueMin:             0.10,
    whiteValueCutoff:     0.90,
    graySaturationCutoff: 0.10,
    blueHueRange:         [185, 260],
    edgeCleanPasses:      1,
  },
}

// ── Colour space helpers ──────────────────────────────────────────────────────

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (!src.startsWith('blob:') && !src.startsWith('data:')) {
      img.crossOrigin = 'anonymous'
    }
    img.onload  = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l * 100]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if      (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else                h = ((r - g) / d + 4) / 6
  return [h * 360, s * 100, l * 100]
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const v = max
  const d = max - min
  const s = max === 0 ? 0 : d / max
  let h = 0
  if (d !== 0) {
    if      (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else                h = (r - g) / d + 4
    h = h * 60
    if (h < 0) h += 360
  }
  return [h, s, v]
}

function toHex(r, g, b) {
  return '#' + [r, g, b]
    .map((v) => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, '0'))
    .join('')
}

// ── Pixel classifiers ─────────────────────────────────────────────────────────

function isVegetationHSV(r, g, b, preset) {
  const [h, s, v] = rgbToHsv(r, g, b)
  // Reject definite background: too bright and desaturated
  if (v > preset.whiteValueCutoff && s < preset.graySaturationCutoff) return false
  // Desaturated / neutral background
  if (s < preset.graySaturationCutoff) return false
  // Too dark
  if (v < preset.valueMin) return false
  // Sky blue
  if (h >= preset.blueHueRange[0] && h <= preset.blueHueRange[1]) return false
  // Green / yellow-green
  if (h >= 55 && h <= 170 && s >= preset.saturationMin && v >= preset.valueMin) return true
  // Yellow / yellow-green edge (stressed leaves)
  if (h >= 45 && h < 65 && s >= preset.saturationMin * 0.75 && v >= preset.valueMin) return true
  // Brown / tan fall leaf
  if (h >= 18 && h < 55 && s >= 0.20 && v >= preset.valueMin && v <= 0.78) return true
  return false
}

function isBackgroundHSV(r, g, b, preset) {
  const [h, s, v] = rgbToHsv(r, g, b)
  if (v > preset.whiteValueCutoff && s < preset.graySaturationCutoff) return true
  if (s < preset.graySaturationCutoff) return true
  // Saturated sky blue
  if (h >= preset.blueHueRange[0] && h <= preset.blueHueRange[1] && s > 0.20) return true
  return false
}

// ── Mask cleanup helpers ──────────────────────────────────────────────────────
// All helpers operate on a flat Uint8ClampedArray where each element is the
// alpha for one pixel (index = y * width + x).

function cleanSpeckles(alphaMap, width, height) {
  const out = new Uint8ClampedArray(alphaMap)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x
      const a = alphaMap[idx]
      if (a !== 255 && a !== 0) continue
      let opaqueCount = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          if (alphaMap[(y + dy) * width + (x + dx)] === 255) opaqueCount++
        }
      }
      if (a === 255 && opaqueCount < 2) out[idx] = 0    // isolated opaque speck → transparent
      if (a === 0   && opaqueCount > 6) out[idx] = 255  // hole inside solid region → opaque
    }
  }
  return out
}

function erode(alphaMap, width, height) {
  const out = new Uint8ClampedArray(alphaMap)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x
      if (alphaMap[idx] !== 255) continue
      outer: for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          if (alphaMap[(y + dy) * width + (x + dx)] === 0) { out[idx] = 0; break outer }
        }
      }
    }
  }
  return out
}

function dilate(alphaMap, width, height) {
  const out = new Uint8ClampedArray(alphaMap)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x
      if (alphaMap[idx] !== 0) continue
      outer: for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          if (alphaMap[(y + dy) * width + (x + dx)] === 255) { out[idx] = 255; break outer }
        }
      }
    }
  }
  return out
}

function featherEdge(alphaMap, width, height) {
  const out = new Uint8ClampedArray(alphaMap)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x
      if (alphaMap[idx] !== 255) continue
      let hasTrans = false
      outer: for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          if (alphaMap[(y + dy) * width + (x + dx)] === 0) { hasTrans = true; break outer }
        }
      }
      if (hasTrans) out[idx] = 128
    }
  }
  return out
}

// ── Vegetation mask ───────────────────────────────────────────────────────────

function buildVegetationMask(imageData, sampleType) {
  const { data, width, height } = imageData
  const preset = MASK_PRESETS[sampleType] ?? MASK_PRESETS.leaf
  const notes = []

  // First pass: classify each pixel into an alpha value
  const alphaMap = new Uint8ClampedArray(width * height)
  let removedBg = 0

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    if (isVegetationHSV(r, g, b, preset)) {
      alphaMap[p] = 255
    } else if (isBackgroundHSV(r, g, b, preset)) {
      alphaMap[p] = 0
      removedBg++
    } else {
      alphaMap[p] = 110  // ambiguous — semi-transparent
    }
  }

  if (removedBg > 0) notes.push('Removed low-saturation background pixels.')

  // Speckle cleanup (N passes per preset)
  let cleaned = alphaMap
  for (let i = 0; i < preset.edgeCleanPasses; i++) {
    cleaned = cleanSpeckles(cleaned, width, height)
  }

  // Erode then dilate to remove thin noisy borders (leaf only)
  if (sampleType === 'leaf') {
    cleaned = erode(cleaned, width, height)
    cleaned = dilate(cleaned, width, height)
    notes.push('Applied leaf mask cleanup pass.')
  }

  // Feather boundary pixels
  cleaned = featherEdge(cleaned, width, height)

  // Build output RGBA data from original colour + computed alpha
  const out = new Uint8ClampedArray(data.length)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    out[i] = data[i]; out[i + 1] = data[i + 1]; out[i + 2] = data[i + 2]
    out[i + 3] = cleaned[p]
  }

  const mc = document.createElement('canvas')
  mc.width = width; mc.height = height
  mc.getContext('2d').putImageData(new ImageData(out, width, height), 0, 0)

  let opaqueCount = 0
  for (let p = 0; p < cleaned.length; p++) {
    if (cleaned[p] > 127) opaqueCount++
  }
  const maskCoverage = opaqueCount / (width * height)

  return { canvas: mc, maskCoverage, notes }
}

// ── Pixel analysis ────────────────────────────────────────────────────────────

function analyzePixels(data) {
  let sumR = 0, sumG = 0, sumB = 0, count = 0
  const buckets = {}
  const step = 4

  for (let i = 0; i < data.length; i += 4 * step) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
    if (a < 60) continue
    sumR += r; sumG += g; sumB += b; count++
    const key = `${Math.round(r / 64) * 64},${Math.round(g / 64) * 64},${Math.round(b / 64) * 64}`
    buckets[key] = (buckets[key] || 0) + 1
  }

  if (count === 0) return { averageColor: '#808080', dominantColors: ['#808080'] }

  const averageColor = toHex(sumR / count, sumG / count, sumB / count)
  const dominantColors = Object.entries(buckets)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => { const [r, g, b] = k.split(',').map(Number); return toHex(r, g, b) })

  return { averageColor, dominantColors }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Crop a region from an image and analyse its colour profile.
 *
 * Coordinates (imgX, imgY, imgW, imgH) are in the source image's own pixel
 * space — call sites are responsible for mapping from screen/viewport coords.
 *
 * Returns null if the crop region is too small (< 4 px on either side).
 */
export async function cropTextureSample(imageUrl, imgX, imgY, imgW, imgH, sampleType) {
  const img = await loadImage(imageUrl)

  const sx = Math.max(0, Math.round(imgX))
  const sy = Math.max(0, Math.round(imgY))
  const sw = Math.min(Math.round(imgW), img.naturalWidth  - sx)
  const sh = Math.min(Math.round(imgH), img.naturalHeight - sy)
  if (sw < 4 || sh < 4) return null

  const SIZE = 256
  const cv  = document.createElement('canvas')
  cv.width  = SIZE; cv.height = SIZE
  const ctx = cv.getContext('2d')
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, SIZE, SIZE)

  const imageData = ctx.getImageData(0, 0, SIZE, SIZE)
  const { averageColor, dominantColors } = analyzePixels(imageData.data)

  const notes = []
  let maskDataUrl = null
  let maskCoverage = null

  if (sampleType === 'leaf' || sampleType === 'canopy') {
    const { canvas: maskCv, maskCoverage: cov, notes: maskNotes } =
      buildVegetationMask(imageData, sampleType)
    maskDataUrl  = maskCv.toDataURL('image/png')
    maskCoverage = cov
    notes.push(...maskNotes)
  }

  const dataUrl = cv.toDataURL('image/jpeg', 0.88)
  const blob    = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.88))

  return {
    sampleType,
    dataUrl,
    blob,
    maskDataUrl,
    maskCoverage,
    width:  SIZE,
    height: SIZE,
    averageColor,
    dominantColors,
    notes,
    createdAt: new Date().toISOString(),
  }
}

// Keep legacy HSL export so any external callers don't break
export { rgbToHsl }
