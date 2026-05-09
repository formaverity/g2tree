/**
 * Convert a binary silhouette mask into the four annotation layers that
 * PhotoScaffoldEditor.jsx expects (normalized 0–1 coordinates):
 *
 *   treeOutline     — convex outline polygon of the full mask
 *   crownOutline    — outline of the upper ~60% of the mask (crown region)
 *   trunkLine       — medial axis of the lower portion (trunk)
 *   primaryBranches — simplified skeletonized arms from the crown region
 *
 * All returned values are in the same normalized {x, y} format used throughout
 * the session annotation layer.
 */

// ── Boundary extraction ───────────────────────────────────────────────────────

/**
 * Scan each row of the mask and return the leftmost and rightmost foreground
 * pixel, producing two arrays of boundary points.
 *
 * @param {Float32Array} mask
 * @param {number} mW
 * @param {number} mH
 * @returns {{ left: {x,y}[], right: {x,y}[] }}
 */
function maskBoundaryRows(mask, mW, mH) {
  const left  = []
  const right = []

  for (let row = 0; row < mH; row++) {
    let lx = -1, rx = -1
    for (let col = 0; col < mW; col++) {
      if (mask[row * mW + col] > 0.5) {
        if (lx < 0) lx = col
        rx = col
      }
    }
    if (lx >= 0) {
      left.push({ x: lx / mW, y: row / mH })
      right.push({ x: rx / mW, y: row / mH })
    }
  }
  return { left, right }
}

/**
 * Downsample a list of points to at most `maxPts`.
 */
function downsample(pts, maxPts) {
  if (pts.length <= maxPts) return pts
  const step = pts.length / maxPts
  return Array.from({ length: maxPts }, (_, i) => pts[Math.round(i * step)])
}

// ── Tree outline ──────────────────────────────────────────────────────────────

/**
 * Build a polygon tracing the full tree silhouette: left edge (top to bottom)
 * then right edge (bottom to top), closed.
 */
export function extractTreeOutline(mask, mW, mH, maxPts = 20) {
  const { left, right } = maskBoundaryRows(mask, mW, mH)
  if (left.length < 4) return []

  const dl = downsample(left, Math.ceil(maxPts / 2))
  const dr = downsample(right, Math.ceil(maxPts / 2)).reverse()
  return [...dl, ...dr]
}

// ── Crown outline ─────────────────────────────────────────────────────────────

/**
 * Restrict to the upper `crownFraction` of the mask (crown region) and
 * extract its outline.
 */
export function extractCrownOutline(mask, mW, mH, crownFraction = 0.60, maxPts = 16) {
  const cutRow  = Math.round(mH * crownFraction)
  const crownMask = mask.slice(0, cutRow * mW)
  const { left, right } = maskBoundaryRows(crownMask, mW, cutRow)
  if (left.length < 3) return []

  const dl = downsample(left, Math.ceil(maxPts / 2))
  const dr = downsample(right, Math.ceil(maxPts / 2)).reverse()
  return [...dl, ...dr]
}

// ── Trunk axis ────────────────────────────────────────────────────────────────

/**
 * For each row in the lower portion of the mask (trunk region), find the
 * midpoint between leftmost and rightmost foreground pixel. That series of
 * midpoints is the medial axis — the trunk axis.
 */
export function extractTrunkAxis(mask, mW, mH, trunkFraction = 0.40, maxPts = 5) {
  // Trunk = bottom (1 - trunkFraction) of the image
  const startRow = Math.round(mH * (1 - trunkFraction))
  const midpoints = []

  for (let row = startRow; row < mH; row++) {
    let lx = -1, rx = -1
    for (let col = 0; col < mW; col++) {
      if (mask[row * mW + col] > 0.5) {
        if (lx < 0) lx = col
        rx = col
      }
    }
    if (lx >= 0 && rx > lx) {
      midpoints.push({
        x: ((lx + rx) / 2) / mW,
        y: row / mH,
      })
    }
  }

  if (midpoints.length < 2) return []
  return downsample(midpoints, maxPts)
}

// ── Primary branches ──────────────────────────────────────────────────────────

/**
 * Simplified branch extraction from the crown region.
 *
 * Strategy: for each column band in the crown, find the topmost foreground
 * pixel. These extremal points represent the tips of major branches. Pair
 * each with the crown centroid (which approximates the trunk-crown junction)
 * to produce a set of branch polylines.
 */
export function extractPrimaryBranches(mask, mW, mH, crownFraction = 0.60, numBranches = 5) {
  const cutRow   = Math.round(mH * crownFraction)

  // Find crown centroid
  let sumX = 0, sumY = 0, count = 0
  for (let row = 0; row < cutRow; row++) {
    for (let col = 0; col < mW; col++) {
      if (mask[row * mW + col] > 0.5) {
        sumX += col; sumY += row; count++
      }
    }
  }
  if (count < 10) return []
  const cx = sumX / count / mW
  const cy = sumY / count / mH

  // Divide crown into `numBranches` vertical bands; find topmost pixel in each
  const bandW = mW / numBranches
  const branches = []

  for (let b = 0; b < numBranches; b++) {
    const colStart = Math.round(b * bandW)
    const colEnd   = Math.round((b + 1) * bandW)
    let topRow = -1, topCol = -1

    for (let row = 0; row < cutRow && topRow < 0; row++) {
      for (let col = colStart; col < colEnd; col++) {
        if (mask[row * mW + col] > 0.5) {
          topRow = row; topCol = col; break
        }
      }
    }

    if (topRow >= 0) {
      const tipX  = topCol / mW
      const tipY  = topRow / mH
      const midX  = (cx + tipX) / 2
      const midY  = (cy + tipY) / 2
      branches.push([
        { x: cx,   y: cy   },
        { x: midX, y: midY },
        { x: tipX, y: tipY },
      ])
    }
  }

  return branches
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

/**
 * Convert a SAM binary mask into all four annotation layers.
 *
 * @param {Float32Array} mask
 * @param {number} width
 * @param {number} height
 * @returns {{
 *   treeOutline:     {x,y}[],
 *   crownOutline:    {x,y}[],
 *   trunkLine:       {x,y}[],
 *   primaryBranches: {x,y}[][],
 * }}
 */
export function maskToAnnotations(mask, width, height) {
  return {
    treeOutline:     extractTreeOutline(mask, width, height),
    crownOutline:    extractCrownOutline(mask, width, height),
    trunkLine:       extractTrunkAxis(mask, width, height),
    primaryBranches: extractPrimaryBranches(mask, width, height),
  }
}
