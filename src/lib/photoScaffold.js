/**
 * Photo-informed tree scaffold analysis.
 * Runs entirely in the browser via Canvas pixel operations — no paid APIs.
 *
 * analyzeTreePhotoScaffold({ photo, landmarks, estimates, speciesAIResult,
 *                             treeStructureHints, textureSamples })
 * → ScaffoldResult
 */

// ── Seeded PRNG ───────────────────────────────────────────────────────────────

export function mulberry32(seed) {
  let s = (seed >>> 0) || 1
  return function () {
    s = (s + 0x6D2B79F5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── Pixel classification ──────────────────────────────────────────────────────

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else                h = ((r - g) / d + 4) / 6
  return { h: h * 360, s, l }
}

// Returns 0=sky, 1=vegetation, 2=trunk/dark, 3=other
function classifyPixel(r, g, b) {
  const { h, s, l } = rgbToHsl(r, g, b)
  if (l > 0.80 && s < 0.16) return 0               // overcast / white sky
  if (h >= 170 && h <= 262 && l > 0.40 && s > 0.06) return 0  // blue sky
  if (h >= 52  && h <= 165 && s > 0.11 && l > 0.07 && l < 0.85) return 1  // green veg
  if (h >= 22  && h <= 52  && s > 0.20 && l > 0.17 && l < 0.76) return 1  // autumn
  if (l < 0.38 && (s < 0.22 || (h >= 12 && h <= 58 && s > 0.06))) return 2 // bark/trunk
  return 3
}

// ── Image loading ─────────────────────────────────────────────────────────────

async function loadPixels(photo, targetSize = 256) {
  let src = null
  let blobUrl = null

  if (photo.file) {
    blobUrl = URL.createObjectURL(photo.file)
    src = blobUrl
  } else if (photo.url) {
    src = photo.url
  } else {
    return null
  }

  return new Promise((resolve) => {
    const img = new Image()
    if (!src.startsWith('blob:') && !src.startsWith('data:')) {
      img.crossOrigin = 'anonymous'
    }

    img.onload = () => {
      const scale = Math.min(targetSize / img.naturalWidth, targetSize / img.naturalHeight, 1)
      const w = Math.max(1, Math.round(img.naturalWidth  * scale))
      const h = Math.max(1, Math.round(img.naturalHeight * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      try {
        ctx.drawImage(img, 0, 0, w, h)
        const { data } = ctx.getImageData(0, 0, w, h)
        if (blobUrl) URL.revokeObjectURL(blobUrl)
        resolve({ data, w, h, natW: img.naturalWidth, natH: img.naturalHeight })
      } catch {
        if (blobUrl) URL.revokeObjectURL(blobUrl)
        resolve(null)
      }
    }

    img.onerror = () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl)
      resolve(null)
    }

    img.src = src
  })
}

// ── Pixel classification array ────────────────────────────────────────────────

function classifyAll(data, w, h) {
  const classes = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    if (data[o + 3] < 64) { classes[i] = 0; continue }  // transparent → sky
    classes[i] = classifyPixel(data[o], data[o + 1], data[o + 2])
  }
  return classes
}

// ── Silhouette extraction ─────────────────────────────────────────────────────

function extractSilhouette(classes, w, h, lm) {
  // Map landmarks (normalized 0-1) to pixel coords
  const tbX = Math.round(lm.trunk_base.x   * w)
  const tbY = Math.round(lm.trunk_base.y   * h)
  const ttX = Math.round(lm.trunk_top.x    * w)
  const ttY = Math.round(lm.trunk_top.y    * h)
  const clX = Math.round(lm.canopy_left.x  * w)
  const clY = Math.round(lm.canopy_left.y  * h)
  const crX = Math.round(lm.canopy_right.x * w)
  const crY = Math.round(lm.canopy_right.y * h)

  const roiY1 = Math.max(0, Math.min(clY, crY, ttY) - Math.round(h * 0.03))
  const roiY2 = Math.min(h - 1, tbY + Math.round(h * 0.04))
  const roiX1 = Math.max(0, Math.min(clX, tbX) - Math.round(w * 0.06))
  const roiX2 = Math.min(w - 1, Math.max(crX, tbX) + Math.round(w * 0.06))

  const leftProfile  = []
  const rightProfile = []
  const widthByHeight = []

  let vegPx = 0
  let roiPx = 0

  for (let row = roiY1; row <= roiY2; row++) {
    let leftEdge  = -1
    let rightEdge = -1

    for (let col = roiX1; col <= roiX2; col++) {
      const cls = classes[row * w + col]
      if (cls === 1 || cls === 2) {  // vegetation or trunk
        if (leftEdge === -1) leftEdge = col
        rightEdge = col
        vegPx++
      }
      roiPx++
    }

    const t = roiY2 === roiY1 ? 0 : (row - roiY1) / (roiY2 - roiY1)
    if (leftEdge >= 0) {
      leftProfile.push({ t, x: leftEdge / w })
      rightProfile.push({ t, x: rightEdge / w })
      widthByHeight.push({ t, width: (rightEdge - leftEdge) / w })
    }
  }

  // Asymmetry score: compare left vs right spread from trunk center
  const trunkCX = (tbX + ttX) / 2 / w
  let leftArea = 0, rightArea = 0
  for (let i = 0; i < widthByHeight.length; i++) {
    const lx = leftProfile[i]?.x  ?? trunkCX
    const rx = rightProfile[i]?.x ?? trunkCX
    const mid = (lx + rx) / 2
    leftArea  += mid - lx
    rightArea += rx - mid
  }
  const asymmetryScore = leftArea + rightArea > 0
    ? Math.abs(leftArea - rightArea) / (leftArea + rightArea)
    : 0

  return {
    leftProfile,
    rightProfile,
    widthByHeight,
    canopyTopY:    roiY1 / h,
    canopyBottomY: roiY2 / h,
    asymmetryScore,
    vegFraction: roiPx > 0 ? vegPx / roiPx : 0,
    roiX1: roiX1 / w, roiX2: roiX2 / w,
    roiY1: roiY1 / h, roiY2: roiY2 / h,
  }
}

// ── Crown shape analysis ──────────────────────────────────────────────────────

function analyzeCrown(silhouette, lm) {
  const { widthByHeight, leftProfile, rightProfile, canopyTopY, asymmetryScore } = silhouette

  let maxWidth = 0
  let maxWidthT = 0
  widthByHeight.forEach(({ width, t }) => {
    if (width > maxWidth) { maxWidth = width; maxWidthT = t }
  })

  let shape = 'oval'
  if (maxWidthT < 0.25) shape = 'conical'
  else if (maxWidthT > 0.65) shape = 'rounded'
  if (asymmetryScore > 0.28) shape = 'irregular'

  // Crown center offset relative to trunk center
  const midSlice = widthByHeight.slice(
    Math.floor(widthByHeight.length * 0.3),
    Math.floor(widthByHeight.length * 0.7),
  )
  const trunkCX = (lm.trunk_base.x + lm.trunk_top.x) / 2

  let crownCenterOffset = 0
  if (midSlice.length > 0) {
    const mid = Math.floor(widthByHeight.length * 0.5)
    const lx  = leftProfile[mid]?.x  ?? trunkCX
    const rx  = rightProfile[mid]?.x ?? trunkCX
    crownCenterOffset = (lx + rx) / 2 - trunkCX
  }

  const crownStartRatio = lm.trunk_base.y - canopyTopY

  return {
    heightRatio:       crownStartRatio,
    widthRatio:        maxWidth,
    crownStartRatio,
    crownCenterOffset,
    densityEstimate:   Math.min(silhouette.vegFraction * 1.9, 1.0),
    shape,
  }
}

// ── Branch skeleton approximation ─────────────────────────────────────────────

function buildBranchSkeleton(classes, w, h, silhouette, lm, rng) {
  const { roiY1, roiY2, roiX1, roiX2 } = silhouette

  // Grid-based approach: 16x16 cells over the ROI
  const GRID = 16
  const roiW = roiX2 - roiX1
  const roiH = roiY2 - roiY1
  if (roiW <= 0 || roiH <= 0) return { nodes: [], edges: [], confidence: 0 }

  const cellW = Math.max(1 / w, roiW / GRID)
  const cellH = Math.max(1 / h, roiH / GRID)

  // For each grid cell: mean luminance and vegetation fraction
  const cells = []
  let vegTotal = 0
  let vegCellCount = 0

  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const x1 = Math.round((roiX1 + gx * cellW) * w)
      const y1 = Math.round((roiY1 + gy * cellH) * h)
      const x2 = Math.min(w - 1, Math.round(x1 + cellW * w))
      const y2 = Math.min(h - 1, Math.round(y1 + cellH * h))

      let vegCount = 0
      let sumLum = 0
      let pixCount = 0

      for (let py = y1; py <= y2; py++) {
        for (let px = x1; px <= x2; px++) {
          if (px < 0 || py < 0 || px >= w || py >= h) continue
          const cls = classes[py * w + px]
          if (cls === 1 || cls === 2) vegCount++
          const o = (py * w + px) * 4
          // Use data directly not available here, approximate: cls 2 (trunk) = dark
          const lum = cls === 2 ? 0.25 : cls === 1 ? 0.55 : 0.80
          sumLum += lum
          pixCount++
        }
      }

      const vegFrac  = pixCount > 0 ? vegCount / pixCount : 0
      const meanLum  = pixCount > 0 ? sumLum / pixCount : 1.0
      const cx       = (roiX1 + (gx + 0.5) * cellW)
      const cy       = (roiY1 + (gy + 0.5) * cellH)

      cells.push({ gx, gy, cx, cy, vegFrac, meanLum })
      if (vegFrac > 0.25) { vegTotal += meanLum; vegCellCount++ }
    }
  }

  const vegMeanLum = vegCellCount > 0 ? vegTotal / vegCellCount : 0.55

  // Mark dark vegetation cells as branch candidates
  const candidateIds = new Set()
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]
    if (c.vegFrac > 0.25 && c.meanLum < vegMeanLum * 0.73) {
      candidateIds.add(i)
    }
  }

  if (candidateIds.size < 3) return { nodes: [], edges: [], confidence: 0.08 }

  // Build graph: connect nearby candidates
  const trunkCX = (lm.trunk_base.x + lm.trunk_top.x) / 2
  const nodes   = []
  const idxMap  = new Map()

  for (const idx of candidateIds) {
    const c = cells[idx]
    const id = nodes.length
    idxMap.set(idx, id)
    nodes.push({ id, x: c.cx, y: c.cy })
  }

  const edges = []
  const candidateArr = [...candidateIds]

  for (let i = 0; i < candidateArr.length; i++) {
    const ci = cells[candidateArr[i]]
    for (let j = i + 1; j < candidateArr.length; j++) {
      const cj = cells[candidateArr[j]]
      const dx = Math.abs(ci.gx - cj.gx)
      const dy = Math.abs(ci.gy - cj.gy)
      if (dx <= 2 && dy <= 2 && dx + dy > 0) {
        edges.push({
          from: idxMap.get(candidateArr[i]),
          to:   idxMap.get(candidateArr[j]),
          confidence: 0.4,
        })
      }
    }
  }

  // Add fallback procedural skeleton anchored to trunk if confidence is very low
  if (nodes.length < 5) {
    const baseX = lm.trunk_base.x
    const topX  = lm.trunk_top.x
    const baseY = lm.trunk_base.y
    const topY  = lm.trunk_top.y
    for (let k = 0; k < 6; k++) {
      const t   = 0.35 + k * 0.11
      const ax  = baseX + (topX - baseX) * t + (rng() - 0.5) * 0.08
      const ay  = baseY + (topY - baseY) * t
      const bx  = ax + (rng() - 0.5) * 0.18
      const by  = ay + (rng() - 0.5) * 0.06
      const aid = nodes.length
      nodes.push({ id: aid, x: ax, y: ay })
      nodes.push({ id: aid + 1, x: bx, y: by })
      edges.push({ from: aid, to: aid + 1, confidence: 0.2 })
    }
  }

  const confidence = Math.min(0.85, candidateIds.size / (GRID * GRID) * 4)
  return { nodes, edges, confidence }
}

// ── Species-aware modeling hints ──────────────────────────────────────────────

function inferModelingHints(speciesAIResult, estimates, treeStructureHints, crown) {
  const cn  = (speciesAIResult?.common_name     ?? '').toLowerCase()
  const sci = (speciesAIResult?.scientific_name ?? '').toLowerCase()

  let leafScale   = 1.0
  let leafDensity = 1.0
  let treeType    = 'deciduous_broadleaf'

  // Conifers
  if (/pine|spruce|fir|cedar|hemlock|larch|cypress|redwood|yew|thuja|arborvit/i.test(cn + sci)) {
    leafScale = 0.45; leafDensity = 1.55; treeType = 'conifer'
  }
  // Palms
  else if (/palm|palmetto/i.test(cn + sci)) {
    leafScale = 2.1; leafDensity = 0.28; treeType = 'palm_like'
  }
  // Large broadleaf
  else if (/maple|beech|oak|sycamore|catalpa|magnolia|walnut|linden|horse.?chestnut/i.test(cn + sci)) {
    leafScale = 1.25; leafDensity = 0.82
  }
  // Small/dense broadleaf
  else if (/willow|birch|alder|poplar|aspen|cherry|hazel|hornbeam/i.test(cn + sci)) {
    leafScale = 0.68; leafDensity = 1.38
  }

  // Scale by actual tree size
  const heightFt  = estimates?.height_ft    ?? 30
  const canopyFt  = estimates?.canopy_width_ft ?? 20
  const sizeScale = Math.sqrt(((heightFt / 30) + (canopyFt / 20)) / 2)

  if (heightFt < 16) { leafScale *= 0.62; leafDensity *= 0.72 }

  const noiseSeed = Math.round(
    (estimates?.dbh_in ?? 10) * 113 + (estimates?.height_ft ?? 30) * 71,
  )

  return {
    treeType,
    leafScale:       Math.max(0.2, leafScale * sizeScale),
    leafDensity:     Math.max(0.1, leafDensity),
    branchDensity:   treeStructureHints?.branchDensity ?? 'medium',
    trunkGnarliness: 0.25 + (crown?.asymmetryScore ?? 0) * 0.4,
    asymmetry:       crown?.asymmetryScore ?? 0.1,
    noiseSeed,
  }
}

// ── Trunk curvature points ────────────────────────────────────────────────────

function buildTrunkAxis(lm, trunkAxisOverride) {
  if (trunkAxisOverride?.length >= 2) {
    return {
      base:             trunkAxisOverride[0],
      top:              trunkAxisOverride[trunkAxisOverride.length - 1],
      leanAngle:        Math.atan2(
        trunkAxisOverride[trunkAxisOverride.length - 1].x - trunkAxisOverride[0].x,
        trunkAxisOverride[0].y - trunkAxisOverride[trunkAxisOverride.length - 1].y,
      ) * (180 / Math.PI),
      curvaturePoints:  trunkAxisOverride,
    }
  }

  const base = { x: lm.trunk_base.x, y: lm.trunk_base.y }
  const top  = { x: lm.trunk_top.x,  y: lm.trunk_top.y  }
  const pts  = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    x: base.x + (top.x - base.x) * t,
    y: base.y + (top.y - base.y) * t,
  }))

  return {
    base,
    top,
    leanAngle: Math.atan2(top.x - base.x, base.y - top.y) * (180 / Math.PI),
    curvaturePoints: pts,
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function analyzeTreePhotoScaffold({
  photo,
  landmarks,
  estimates,
  speciesAIResult,
  treeStructureHints,
  trunkAxisOverride = null,
}) {
  const warnings = []

  if (!photo) {
    return {
      scaffoldVersion: 1,
      sourcePhotoId: null,
      trunkAxis: null,
      silhouette: null,
      crown: null,
      branchGraph: { nodes: [], edges: [], confidence: 0 },
      modelingHints: inferModelingHints(speciesAIResult, estimates, treeStructureHints, null),
      warnings: ['No photo provided'],
      confidence: 0,
    }
  }

  const pixels = await loadPixels(photo, 256)
  if (!pixels) {
    warnings.push('Could not load photo for analysis (possible CORS restriction). Using procedural fallback.')
    const trunkAxis = buildTrunkAxis(landmarks, trunkAxisOverride)
    const rng = mulberry32(42)
    return {
      scaffoldVersion: 1,
      sourcePhotoId:  photo.id ?? null,
      trunkAxis,
      silhouette:     null,
      crown:          null,
      branchGraph:    { nodes: [], edges: [], confidence: 0 },
      modelingHints:  inferModelingHints(speciesAIResult, estimates, treeStructureHints, null),
      warnings,
      confidence:     0,
    }
  }

  const { data, w, h } = pixels
  const classes = classifyAll(data, w, h)

  const silhouette   = extractSilhouette(classes, w, h, landmarks)
  const crown        = analyzeCrown(silhouette, landmarks)
  const trunkAxis    = buildTrunkAxis(landmarks, trunkAxisOverride)
  const rng          = mulberry32(
    Math.round((estimates?.dbh_in ?? 10) * 100 + (estimates?.height_ft ?? 30) * 70),
  )
  const branchGraph  = buildBranchSkeleton(classes, w, h, silhouette, landmarks, rng)
  const modelingHints = inferModelingHints(speciesAIResult, estimates, treeStructureHints, crown)

  if (silhouette.vegFraction < 0.06) {
    warnings.push('Low vegetation signal — color segmentation may be inaccurate. Try a photo with clear foliage.')
  }
  if (branchGraph.confidence < 0.15) {
    warnings.push('Branch skeleton is low confidence; using procedural branches as fallback.')
  }
  if (Math.abs(trunkAxis.leanAngle) > 15) {
    warnings.push(`Trunk lean detected: ${trunkAxis.leanAngle.toFixed(1)}°`)
  }

  const overallConfidence = Math.min(1, (
    (silhouette.vegFraction > 0.05 ? 0.5 : 0.1) +
    (branchGraph.confidence * 0.25) +
    (silhouette.leftProfile.length > 10 ? 0.25 : 0.05)
  ))

  return {
    scaffoldVersion: 1,
    sourcePhotoId:   photo.id ?? null,
    trunkAxis,
    silhouette: {
      canopyTopY:    silhouette.canopyTopY,
      canopyBottomY: silhouette.canopyBottomY,
      leftProfile:   silhouette.leftProfile,
      rightProfile:  silhouette.rightProfile,
      widthByHeight: silhouette.widthByHeight,
      asymmetryScore: silhouette.asymmetryScore,
      roiX1: silhouette.roiX1, roiX2: silhouette.roiX2,
      roiY1: silhouette.roiY1, roiY2: silhouette.roiY2,
    },
    crown,
    branchGraph,
    modelingHints,
    warnings,
    confidence: overallConfidence,
  }
}

// ── Default trunk axis from landmarks (for panel initialization) ─────────────

export function defaultTrunkAxis(landmarks) {
  if (!landmarks) return []
  const base = landmarks.trunk_base
  const top  = landmarks.trunk_top
  return [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    x: base.x + (top.x - base.x) * t,
    y: base.y + (top.y - base.y) * t,
  }))
}
