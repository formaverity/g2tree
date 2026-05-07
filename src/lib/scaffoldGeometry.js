/**
 * Build 3D scaffold geometry from photo scaffold analysis.
 * Returns geometry data that TreePreview can render in photo_scaffold mode.
 *
 * All coordinates are in "tree units" where trunkHeight = params.trunkHeight.
 */

import { mulberry32 } from './photoScaffold'

// ── Helpers ───────────────────────────────────────────────────────────────────

function lerp(a, b, t) { return a + (b - a) * t }

function interpolateProfile(profile, t) {
  if (!profile || profile.length === 0) return 0.5
  if (profile.length === 1) return profile[0].x
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i]
    const b = profile[i + 1]
    if (t >= a.t && t <= b.t) {
      const local = (t - a.t) / Math.max(b.t - a.t, 0.0001)
      return lerp(a.x, b.x, local)
    }
  }
  return t < profile[0].t ? profile[0].x : profile[profile.length - 1].x
}

// Trunk lean at a given height fraction (0=base, 1=top), from curvature points
function trunkLeanAt(curvaturePoints, t, trunkHeight) {
  if (!curvaturePoints || curvaturePoints.length < 2) return 0
  const first = curvaturePoints[0]
  const last  = curvaturePoints[curvaturePoints.length - 1]
  for (let i = 0; i < curvaturePoints.length - 1; i++) {
    const a = curvaturePoints[i]
    const b = curvaturePoints[i + 1]
    const aT = i / (curvaturePoints.length - 1)
    const bT = (i + 1) / (curvaturePoints.length - 1)
    if (t >= aT && t <= bT) {
      const local = (t - aT) / Math.max(bT - aT, 0.0001)
      return lerp(a.x - first.x, b.x - first.x, local)
    }
  }
  return t < 0 ? 0 : last.x - first.x
}

// ── Trunk curve generation ────────────────────────────────────────────────────

function buildTrunkCurve(scaffold, params) {
  const { trunkAxis, silhouette, crown } = scaffold
  const { trunkHeight, trunkRadiusBase, trunkRadiusTop } = params

  const crownFrac       = crown?.crownStartRatio ?? 0.52
  const crownStartWorld = trunkHeight * (1 - crownFrac)

  let imageTreeWidth = 0.32
  if (silhouette?.widthByHeight?.length > 0) {
    const midW = silhouette.widthByHeight.filter((p) => p.t > 0.3 && p.t < 0.7)
    if (midW.length > 0) imageTreeWidth = midW.reduce((s, p) => s + p.width, 0) / midW.length
  }

  const canopyRadius = params.canopyRadius ?? trunkHeight * 0.4
  const worldPerFrac = (2 * canopyRadius) / Math.max(imageTreeWidth, 0.1)

  const pts = trunkAxis?.curvaturePoints ?? [
    { x: 0.5, y: 1 }, { x: 0.5, y: 0 },
  ]

  const baseX = pts[0].x
  const curve = []

  for (let i = 0; i < pts.length; i++) {
    const t  = i / (pts.length - 1)
    const p  = pts[i]
    const wx = (p.x - baseX) * worldPerFrac
    const wy = (1 - p.y) * trunkHeight
    let r    = lerp(trunkRadiusBase, trunkRadiusTop, t)

    // Taper radius to near-zero above crown start so trunk doesn't pole through canopy
    if (wy > crownStartWorld) {
      const aboveFrac = (wy - crownStartWorld) / Math.max(trunkHeight - crownStartWorld, 0.01)
      r = r * Math.max(0, 1 - aboveFrac * 1.5)
    }

    curve.push({ x: wx, y: wy, z: 0, r })
  }

  return curve
}

// ── Ring canopy volume ────────────────────────────────────────────────────────

function buildRings(scaffold, params, rng) {
  const { silhouette, crown, trunkAxis } = scaffold
  const { trunkHeight, canopyRadius } = params

  if (!silhouette?.widthByHeight?.length) {
    // Fallback: simple oval rings
    const rings = []
    const NUM = 12
    const crownStart = trunkHeight * 0.45
    for (let i = 0; i <= NUM; i++) {
      const t   = i / NUM
      const y   = crownStart + t * (trunkHeight - crownStart)
      const sinT = Math.sin(t * Math.PI)
      rings.push({
        y,
        centerX: 0,
        centerZ: 0,
        radiusX: canopyRadius * sinT * 0.85,
        radiusZ: canopyRadius * sinT * 0.78,
        density: sinT,
        irregularity: 0.12,
      })
    }
    return rings
  }

  const { leftProfile, rightProfile, widthByHeight, canopyTopY, canopyBottomY } = silhouette
  const crownStartY  = crown?.crownStartRatio ? canopyBottomY - crown.crownStartRatio : canopyTopY
  const crownCenterX = crown?.crownCenterOffset ?? 0

  // Estimate image tree width for scaling
  const midW = widthByHeight.filter((p) => p.t > 0.25 && p.t < 0.75)
  const meanWidth = midW.length > 0 ? midW.reduce((s, p) => s + p.width, 0) / midW.length : 0.3
  const worldPerFrac = (2 * canopyRadius) / Math.max(meanWidth, 0.08)

  const NUM = 18
  const rings = []

  // Crown bounds in image Y (0=top, 1=bottom)
  const imgCrownTop = Math.min(...widthByHeight.map((p) => p.t < 0.05 ? 1 : canopyTopY + p.t * (canopyBottomY - canopyTopY)))
  const imgCrownBot = canopyBottomY

  // Trunk lean for centering rings
  const trunkLeanTotal = trunkAxis
    ? (trunkAxis.top?.x ?? 0.5) - (trunkAxis.base?.x ?? 0.5)
    : 0

  for (let i = 0; i <= NUM; i++) {
    const t = i / NUM
    // World Y: bottom of crown = trunkHeight * crownStart, top = trunkHeight
    const crownFrac = crown?.crownStartRatio ?? 0.55
    const worldCrownBottom = trunkHeight * (1 - crownFrac)
    const y = worldCrownBottom + t * (trunkHeight - worldCrownBottom)

    // Sample profile at this crown height
    const imgT = canopyTopY + t * (canopyBottomY - canopyTopY)
    const imgRelT = widthByHeight.length > 0
      ? (imgT - widthByHeight[0].t * (canopyBottomY - canopyTopY) - canopyTopY) / Math.max(canopyBottomY - canopyTopY, 0.01)
      : t

    const lx = interpolateProfile(leftProfile,  Math.max(0, Math.min(1, imgRelT)))
    const rx = interpolateProfile(rightProfile, Math.max(0, Math.min(1, imgRelT)))

    const trunkCX     = (trunkAxis?.base?.x ?? 0.5) + trunkLeanTotal * t
    const leftRadius  = Math.max(0.01, (trunkCX - lx) * worldPerFrac)
    const rightRadius = Math.max(0.01, (rx - trunkCX) * worldPerFrac)

    const leanX    = trunkLeanTotal * worldPerFrac * t
    const centerX  = leanX + crownCenterX * worldPerFrac * 0.5

    // Taper top and bottom of crown
    const taper = Math.min(Math.sin(t * Math.PI * 0.95 + 0.05), 1)

    const density = t > 0 && t < 1
      ? silhouette.vegFraction * taper
      : 0

    rings.push({
      y,
      centerX,
      centerZ: 0,
      radiusX: leftRadius  * taper * (1 + (rng() - 0.5) * 0.08),
      radiusZ: rightRadius * taper * (1 + (rng() - 0.5) * 0.08),
      leftRadius:  leftRadius  * taper,
      rightRadius: rightRadius * taper,
      density:   Math.max(0, density),
      irregularity: 0.10 + (crown?.asymmetryScore ?? 0) * 0.18,
    })
  }

  return rings
}

// ── Leaf cloud from rings (legacy — used by buildScaffoldGeometry only) ──────

function buildRingLeafCloud(rings, modelingHints, rng, trunkHeight) {
  const { leafScale, leafDensity } = modelingHints
  const mobile    = typeof window !== 'undefined' && window.innerWidth < 768
  const maxLeaves = mobile ? 480 : 1400

  const totalDensity = rings.reduce((s, r) => s + r.density, 0)
  if (totalDensity <= 0) return []

  const leaves    = []
  const ringSpacing = rings.length > 1 ? (rings[rings.length - 1].y - rings[0].y) / rings.length : 0.1

  for (const ring of rings) {
    if (ring.density <= 0.01) continue
    const share  = ring.density / totalDensity
    const n      = Math.round(share * maxLeaves * leafDensity * 0.32)

    for (let i = 0; i < n; i++) {
      // Distribute within left/right ellipse (asymmetric if needed)
      const angle = rng() * Math.PI * 2
      const isLeft = angle > Math.PI
      const rMax   = isLeft
        ? (ring.leftRadius  ?? ring.radiusX) * (0.55 + rng() * 0.55)
        : (ring.rightRadius ?? ring.radiusZ) * (0.55 + rng() * 0.55)

      const r  = Math.sqrt(rng()) * rMax
      const x  = ring.centerX + Math.cos(angle) * r
      const z  = ring.centerZ + Math.sin(angle) * rMax * 0.72  // depth < width
      const dy = (rng() - 0.5) * ringSpacing * 0.9
      const y  = ring.y + dy

      if (y < 0 || y > trunkHeight * 1.12) continue

      const baseRadius = leafScale * Math.max(ring.leftRadius, ring.rightRadius, 0.05) * 0.16
      leaves.push({
        pos:     [x, y, z],
        radius:  baseRadius * (0.7 + rng() * 0.55),
        opacity: 0.68 + rng() * 0.18,
      })
    }
  }

  return leaves
}

// ── Branch attractors from branchGraph ────────────────────────────────────────

function buildBranchAttractors(branchGraph, trunkCurve, trunkAxis, params) {
  const { trunkHeight, trunkRadiusTop, canopyRadius } = params

  if (!branchGraph?.nodes?.length || !trunkCurve?.length) return []

  const baseX    = trunkAxis?.base?.x ?? 0.5
  const worldPerFrac = (2 * canopyRadius) / 0.35  // approximate
  const nodeMap  = new Map(branchGraph.nodes.map((n) => [n.id, n]))
  const attractors = []

  for (const edge of (branchGraph.edges ?? [])) {
    const nA = nodeMap.get(edge.from)
    const nB = nodeMap.get(edge.to)
    if (!nA || !nB) continue

    const worldA = imageToWorld(nA.x, nA.y, baseX, worldPerFrac, trunkHeight)
    const worldB = imageToWorld(nB.x, nB.y, baseX, worldPerFrac, trunkHeight)

    const heightFrac = Math.max(worldA[1], worldB[1]) / Math.max(trunkHeight, 0.01)
    const r0 = trunkRadiusTop * 0.48 * Math.max(0.2, 1 - heightFrac * 0.5)
    const r1 = r0 * 0.42

    attractors.push({ start: worldA, end: worldB, r0, r1 })
  }

  return attractors
}

function imageToWorld(nx, ny, trunkBaseX, worldPerFrac, trunkHeight) {
  const worldY = (1 - ny) * trunkHeight   // flip Y (image top = world top)
  const relX   = (nx - trunkBaseX) * worldPerFrac
  return [relX, worldY, 0]
}

// ── Scaffold clone geometry — measurement-authoritative system ────────────────

// worldPerFrac: converts image-fraction horizontal distances to scene world units.
// canopyRadius (scene) = (canopy_width_ft / height_ft) * 0.5 → from params.
// imageTreeWidth (fraction) = mean horizontal extent of crown in image coords.
// So: scene_x = image_x_fraction * worldPerFrac.
function computeWorldPerFrac(scaffold, params) {
  const { silhouette } = scaffold
  const { canopyRadius } = params
  if (silhouette?.widthByHeight?.length > 0) {
    const midW = silhouette.widthByHeight.filter((p) => p.t > 0.25 && p.t < 0.75)
    if (midW.length > 0) {
      const mean = midW.reduce((s, p) => s + p.width, 0) / midW.length
      return (2 * canopyRadius) / Math.max(mean, 0.08)
    }
  }
  return (2 * canopyRadius) / 0.32
}

function imageToWorld3(nx, ny, trunkBaseX, worldPerFrac, trunkHeight, zOffset = 0) {
  return [(nx - trunkBaseX) * worldPerFrac, (1 - ny) * trunkHeight, zOffset]
}

function getTrunkXWorld(curvePts, heightFrac, worldPerFrac) {
  if (!curvePts?.length) return 0
  const baseX = curvePts[0].x
  for (let i = 0; i < curvePts.length - 1; i++) {
    const aT = i / (curvePts.length - 1)
    const bT = (i + 1) / (curvePts.length - 1)
    if (heightFrac >= aT && heightFrac <= bT) {
      const local = (heightFrac - aT) / Math.max(bT - aT, 0.001)
      const x = lerp(curvePts[i].x, curvePts[i + 1].x, local)
      return (x - baseX) * worldPerFrac
    }
  }
  return (curvePts[curvePts.length - 1].x - baseX) * worldPerFrac
}

function interpProfileX(profile, t) {
  if (!profile?.length) return null
  const sorted = [...profile].sort((a, b) => a.y - b.y)
  if (sorted.length === 1) return sorted[0].x
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1]
    if (t >= a.y && t <= b.y) {
      const local = (t - a.y) / Math.max(b.y - a.y, 0.001)
      return lerp(a.x, b.x, local)
    }
  }
  return t < sorted[0].y ? sorted[0].x : sorted[sorted.length - 1].x
}

// ── Crown level volumes ───────────────────────────────────────────────────────

function buildCrownLevels(scaffold, params, canopyProfiles, rng) {
  const { silhouette, crown, trunkAxis } = scaffold
  const { trunkHeight, canopyRadius } = params
  const NUM_LEVELS    = 20
  const worldPerFrac  = computeWorldPerFrac(scaffold, params)
  const trunkBaseX    = trunkAxis?.base?.x ?? 0.5
  const curvePts      = trunkAxis?.curvaturePoints ?? []
  const crownFrac     = crown?.crownStartRatio ?? 0.52
  const crownBottom   = trunkHeight * (1 - crownFrac)
  const canopyTopY    = silhouette?.canopyTopY    ?? 0.08
  const canopyBottomY = silhouette?.canopyBottomY ?? 0.72

  const levels = []

  for (let i = 0; i <= NUM_LEVELS; i++) {
    const t          = i / NUM_LEVELS          // 0=crown base (world), 1=crown apex
    const y          = crownBottom + t * (trunkHeight - crownBottom)
    const heightFrac = y / trunkHeight
    const trunkCX    = getTrunkXWorld(curvePts, heightFrac, worldPerFrac)

    // Image Y decreases as world Y increases (image top = tree apex)
    const imgY = canopyBottomY - t * (canopyBottomY - canopyTopY)

    let radiusLeft, radiusRight

    if (canopyProfiles?.left?.length > 0 && canopyProfiles?.right?.length > 0) {
      const lx = interpProfileX(canopyProfiles.left,  imgY)
      const rx = interpProfileX(canopyProfiles.right, imgY)
      if (lx !== null && rx !== null) {
        radiusLeft  = Math.max(0.02, (trunkBaseX - lx) * worldPerFrac)
        radiusRight = Math.max(0.02, (rx - trunkBaseX) * worldPerFrac)
      }
    }

    if (radiusLeft == null) {
      if (silhouette?.leftProfile?.length > 0) {
        // Silhouette profiles: t=0 → crown top, t=1 → crown bottom; invert for world t
        const profT = 1 - t
        const lx = interpolateProfile(silhouette.leftProfile,  Math.max(0, Math.min(1, profT)))
        const rx = interpolateProfile(silhouette.rightProfile, Math.max(0, Math.min(1, profT)))
        radiusLeft  = Math.max(0.02, (trunkBaseX - lx) * worldPerFrac)
        radiusRight = Math.max(0.02, (rx - trunkBaseX) * worldPerFrac)
      } else {
        const sinT  = Math.sin(t * Math.PI * 0.92 + 0.04)
        radiusLeft  = canopyRadius * sinT
        radiusRight = canopyRadius * sinT
      }
    }

    const taper    = Math.sin(t * Math.PI * 0.95 + 0.025)
    const maxR     = Math.max(radiusLeft, radiusRight)
    const depthFr  = 0.65 + rng() * 0.15
    const vegFrac  = silhouette?.vegFraction ?? 0.75

    levels.push({
      y,
      centerX:     trunkCX,
      centerZ:     0,
      radiusLeft:  radiusLeft  * taper,
      radiusRight: radiusRight * taper,
      radiusFront: maxR * depthFr * taper,
      radiusBack:  maxR * depthFr * (0.82 + rng() * 0.2) * taper,
      density:     Math.max(0, vegFrac * taper),
      taper,
    })
  }

  return levels
}

// ── Branch armature from crown levels ────────────────────────────────────────

function buildBranchArmature(scaffold, params, branchGestures, crownLevels, rng) {
  const { trunkAxis } = scaffold
  const { trunkHeight, trunkRadiusTop } = params
  const worldPerFrac = computeWorldPerFrac(scaffold, params)
  const trunkBaseX   = trunkAxis?.base?.x ?? 0.5

  const segs = []

  // Phase 1: User gesture branches (always honored)
  if (branchGestures?.length > 0) {
    branchGestures.forEach((g, i) => {
      const { origin, tip } = g
      const ox = (origin.x - trunkBaseX) * worldPerFrac
      const oy = (1 - origin.y) * trunkHeight
      const tx = (tip.x   - trunkBaseX) * worldPerFrac
      const ty = (1 - tip.y)   * trunkHeight
      const dx = tx - ox, dy = ty - oy
      const bLen = Math.sqrt(dx * dx + dy * dy)
      if (bLen < 0.01) return
      const zSign = i % 2 === 0 ? 1 : -1
      const tz    = zSign * bLen * 0.48
      const hf    = oy / trunkHeight
      const r0    = trunkRadiusTop * 0.55 * Math.max(0.22, 1 - hf * 0.52)
      const r1    = r0 * 0.28
      segs.push({ start: [ox, oy, 0], end: [tx, ty, tz], r0, r1 })

      const mx = ox + dx * 0.60, my = oy + dy * 0.60, mz = tz * 0.60
      const sLen = bLen * 0.42
      const sr0 = r1 * 1.1, sr1 = sr0 * 0.38
      for (const off of [0.5, -0.52]) {
        const sa = Math.atan2(dy, dx) + off
        segs.push({
          start: [mx, my, mz],
          end:   [mx + Math.cos(sa) * sLen, my + Math.sin(sa) * sLen * 0.65, mz + zSign * sLen * 0.28],
          r0: sr0, r1: sr1,
        })
      }
    })
  }

  // Phase 2: Structural branches from crown levels to fill the entire volume.
  // Fewer auto-branches if user drew many, but always generate some structure.
  const gestureCount     = branchGestures?.length ?? 0
  const branchesPerLevel = gestureCount > 3 ? 2 : 3
  // Every 3rd level → ~7 structural tiers across the crown
  const structuralLevels = crownLevels.filter((_, i) => i > 0 && i % 3 === 1)

  structuralLevels.forEach((level, li) => {
    const heightFrac = level.y / trunkHeight
    const trunkCX    = level.centerX
    const r0base     = trunkRadiusTop * 0.52 * Math.max(0.18, 1 - heightFrac * 0.58)
    const upF        = 0.10 + heightFrac * 0.32

    for (let b = 0; b < branchesPerLevel; b++) {
      const angle  = (b / branchesPerLevel) * Math.PI * 2 + li * 0.79 + rng() * 0.22
      const isLeft = Math.sin(angle) < 0
      const sideR  = isLeft ? level.radiusLeft : level.radiusRight
      if (sideR < 0.01) continue
      const bLen  = sideR * (0.55 + rng() * 0.50)
      const zSign = b % 2 === 0 ? 1 : -1

      const tipX = trunkCX + Math.sin(angle) * bLen
      const tipY = level.y + Math.abs(Math.sin(angle)) * bLen * upF
      const tipZ = Math.cos(angle) * bLen * 0.72 * zSign

      const r0 = r0base * (0.75 + rng() * 0.50)
      const r1 = r0 * 0.30
      segs.push({ start: [trunkCX, level.y, 0], end: [tipX, tipY, tipZ], r0, r1 })

      const mx   = trunkCX + (tipX - trunkCX) * 0.60
      const my   = level.y  + (tipY - level.y) * 0.60
      const mz   = tipZ * 0.60
      const sLen = bLen * 0.44
      const sr0  = r1 * 1.05, sr1 = sr0 * 0.36
      for (const off of [0.48, -0.50]) {
        const sa = angle + off
        segs.push({
          start: [mx, my, mz],
          end:   [mx + Math.sin(sa) * sLen, my + Math.abs(Math.sin(sa)) * sLen * upF, mz + zSign * sLen * 0.28],
          r0: sr0, r1: sr1,
        })
      }
    }
  })

  return segs
}

// ── Leaf cloud: 70% crown volume + 30% branch tips ───────────────────────────

function buildLeafCloud(crownLevels, branchSegments, params, canopyDensityHint, rng) {
  const MUL        = { sparse: 0.32, medium: 1.0, dense: 1.75, patchy: 0.55 }
  const densityMul = MUL[canopyDensityHint] ?? 1.0
  const mobile     = typeof window !== 'undefined' && window.innerWidth < 768
  const maxLeaves  = Math.round((mobile ? 420 : 1600) * densityMul)
  const baseLeafSc = (params.leafScale ?? 1) * 0.12
  const leaves     = []

  // 70%: distributed through crown volume field
  const volumeTarget = Math.round(maxLeaves * 0.70)
  const totalDensity = crownLevels.reduce((s, l) => s + l.density, 0)
  const levelSpacing = crownLevels.length > 1
    ? (crownLevels[crownLevels.length - 1].y - crownLevels[0].y) / crownLevels.length
    : 0.1

  if (totalDensity > 0) {
    for (const level of crownLevels) {
      if (level.density <= 0.01) continue
      const n = Math.round((level.density / totalDensity) * volumeTarget)
      for (let i = 0; i < n && leaves.length < volumeTarget; i++) {
        const angle  = rng() * Math.PI * 2
        const isLeft = Math.sin(angle) < 0
        const rMax   = isLeft ? level.radiusLeft : level.radiusRight
        const r      = Math.sqrt(rng()) * rMax
        const depth  = Math.min(level.radiusFront, rMax * 0.88)
        leaves.push({
          pos: [
            level.centerX + Math.cos(angle) * r,
            level.y + (rng() - 0.5) * levelSpacing * 0.9,
            level.centerZ + Math.sin(angle) * Math.sqrt(rng()) * depth,
          ],
          rx:    rng() * Math.PI,
          ry:    rng() * Math.PI * 2,
          rz:    rng() * Math.PI,
          scale: baseLeafSc * (0.68 + rng() * 0.70),
        })
      }
    }
  }

  // 30%: near branch tips
  const tipTarget = maxLeaves - leaves.length
  if (branchSegments.length > 0 && tipTarget > 0) {
    const perSeg = Math.max(1, Math.ceil(tipTarget / branchSegments.length))
    for (const seg of branchSegments) {
      if (leaves.length >= maxLeaves) break
      const [sx, sy, sz] = seg.start
      const [ex, ey, ez] = seg.end
      const dx = ex - sx, dy = ey - sy, dz = ez - sz
      const bLen = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (bLen < 0.02) continue
      const n = Math.max(1, Math.round(perSeg * Math.min(bLen / (params.canopyRadius || 0.5), 2.0)))
      for (let i = 0; i < n && leaves.length < maxLeaves; i++) {
        const t  = 0.50 + rng() * 0.55
        const cx = sx + dx * t, cy = sy + dy * t, cz = sz + dz * t
        const sr = bLen * 0.18
        const r  = Math.sqrt(rng()) * sr
        const th = rng() * Math.PI * 2
        const ph = rng() * Math.PI * 0.8
        leaves.push({
          pos:   [cx + r * Math.sin(ph) * Math.cos(th), cy + r * Math.cos(ph) * 0.52, cz + r * Math.sin(ph) * Math.sin(th)],
          rx:    rng() * Math.PI,
          ry:    rng() * Math.PI * 2,
          rz:    rng() * Math.PI,
          scale: baseLeafSc * (0.60 + rng() * 0.80),
        })
      }
    }
  }

  return leaves
}

// ── New authoritative export ───────────────────────────────────────────────────

export function buildScaffoldCloneGeometry(scaffold, params, branchGestures = [], canopyProfiles = null, canopyDensityHint = 'medium', estimates = null) {
  if (!scaffold || !params) return null

  const seed = scaffold.modelingHints?.noiseSeed ?? 42

  const scaleInfo = {
    height_ft:       estimates?.height_ft       ?? null,
    canopy_width_ft: estimates?.canopy_width_ft  ?? null,
    dbh_in:          estimates?.dbh_in           ?? null,
    trunkHeight:     params.trunkHeight,
    canopyRadius:    params.canopyRadius,
    trunkRadiusBase: params.trunkRadiusBase,
    worldPerFrac:    computeWorldPerFrac(scaffold, params),
  }

  const trunkCurve     = buildTrunkCurve(scaffold, params)
  const crownLevels    = buildCrownLevels(scaffold, params, canopyProfiles, mulberry32(seed + 2))
  const branchSegments = buildBranchArmature(scaffold, params, branchGestures, crownLevels, mulberry32(seed + 3))
  const leafInstances  = buildLeafCloud(crownLevels, branchSegments, params, canopyDensityHint, mulberry32(seed + 1))

  return {
    trunkCurve,
    branchSegments,
    leafInstances,
    crownLevels,
    scaleInfo,
    modelingHints: scaffold.modelingHints,
    confidence:    scaffold.confidence ?? 0,
  }
}

// ── Legacy export (kept for backward compat) ──────────────────────────────────

export function buildScaffoldGeometry(scaffold, params) {
  if (!scaffold || !params) return null

  const seed = scaffold.modelingHints?.noiseSeed ?? 42
  const rng  = mulberry32(seed)

  const trunkCurve       = buildTrunkCurve(scaffold, params)
  const rings            = buildRings(scaffold, params, rng)
  const leafCloudPoints  = buildRingLeafCloud(rings, scaffold.modelingHints, mulberry32(seed + 1), params.trunkHeight)
  const branchAttractors = buildBranchAttractors(
    scaffold.branchGraph,
    trunkCurve,
    scaffold.trunkAxis,
    params,
  )

  return {
    trunkCurve,
    rings,
    leafCloudPoints,
    branchAttractors,
    modelingHints: scaffold.modelingHints,
    confidence:    scaffold.confidence ?? 0,
  }
}
