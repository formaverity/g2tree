/**
 * Browser-local texture crop and colour analysis utilities.
 */

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // crossOrigin needed for HTTPS sources (e.g. Supabase signed URLs) so
    // canvas.toDataURL() does not throw a SecurityError.
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

function isVegetation(r, g, b) {
  const [h, s, l] = rgbToHsl(r, g, b)
  if (h >= 55 && h <= 170 && s > 20 && l > 12 && l < 80) return true  // green/yellow-green
  if (h >= 18 && h <  55  && s > 28 && l > 16 && l < 68) return true  // brown/tan fall leaf
  return false
}

function isBackground(r, g, b) {
  const [, s, l] = rgbToHsl(r, g, b)
  return l > 83 && s < 22  // bright sky / white / pale grey
}

function toHex(r, g, b) {
  return '#' + [r, g, b]
    .map((v) => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, '0'))
    .join('')
}

function analyzePixels(data) {
  let sumR = 0, sumG = 0, sumB = 0, count = 0
  const buckets = {}
  const step = 4 // sample every 4th pixel for speed

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

function buildVegetationMask(imageData) {
  const { data, width, height } = imageData
  const out = new Uint8ClampedArray(data.length)
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    out[i] = r; out[i + 1] = g; out[i + 2] = b
    out[i + 3] = isVegetation(r, g, b) ? 255 : isBackground(r, g, b) ? 0 : 110
  }
  const mc = document.createElement('canvas')
  mc.width = width; mc.height = height
  mc.getContext('2d').putImageData(new ImageData(out, width, height), 0, 0)
  return mc
}

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

  if (sampleType === 'leaf' || sampleType === 'canopy') {
    const maskCv = buildVegetationMask(imageData)
    maskDataUrl  = maskCv.toDataURL('image/png')
    notes.push('Vegetation mask applied — green/brown pixels kept, sky pixels removed')
  }

  const dataUrl = cv.toDataURL('image/jpeg', 0.88)
  const blob    = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.88))

  return {
    sampleType,
    dataUrl,
    blob,
    maskDataUrl,
    width:  SIZE,
    height: SIZE,
    averageColor,
    dominantColors,
    notes,
    createdAt: new Date().toISOString(),
  }
}
