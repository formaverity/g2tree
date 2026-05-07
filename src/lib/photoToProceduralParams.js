/**
 * Converts photo-capture measurements and vision analysis into normalized
 * procedural 3-D tree parameters (trunkHeight = 1.0 unit throughout).
 *
 * Returns the requested new schema AND the legacy compat fields expected
 * by the existing renderers (ScaffoldClone, ProceduralTree), so either
 * renderer can use this as a drop-in replacement for buildTreeModelParams.
 */

import { inferTreeType } from './treeModelParams'
import { effectiveValue } from './treeMetrics'

// ── Tiny utilities ─────────────────────────────────────────────────────────────

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v }

function hashDJB2(str) {
  let h = 5381
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

function slugify(str) {
  return (str ?? 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown'
}

// ── Crown habit ────────────────────────────────────────────────────────────────

const COLUMNAR_GENERA = new Set(['Juniperus','Thuja','Chamaecyparis','Cupressus','Calocedrus'])

function deriveCrownHabit(genus, treeType, isAsymmetric) {
  if (treeType === 'conifer')   return COLUMNAR_GENERA.has(genus) ? 'columnar' : 'conical'
  if (treeType === 'palm_like') return 'palm_crown'
  if (isAsymmetric)             return 'broad_irregular'
  if (genus === 'Quercus')      return 'broad_irregular'
  if (genus === 'Fagus')        return 'oval'
  if (genus === 'Betula')       return 'open_airy'
  return 'rounded'
}

// ── Trunk lean from visionAnalysis.trunkLine ───────────────────────────────────

function trunkLeanFromLine(trunkLine) {
  if (!trunkLine) return 0
  // trunkLine: {x1,y1} = base, {x2,y2} = apex, all in 0-1 image-space coords.
  // Image y-axis is flipped: y=1 is bottom, y=0 is top.
  const dx = trunkLine.x2 - trunkLine.x1
  const dy = trunkLine.y1 - trunkLine.y2  // positive = apex above base
  if (Math.abs(dy) < 0.01) return 0
  return clamp(Math.atan2(dx, dy), -0.35, 0.35)  // radians from vertical, ±20°
}

// ── Health mapping ─────────────────────────────────────────────────────────────

function healthToTint(score) {
  if (score >= 70) return '#3d7a4a'
  if (score >= 45) return '#6b8c3e'
  return '#7a6038'
}

// Fraction of leaf clusters rendered as bare gaps (matches existing patchiness scale).
function healthToPatchiness(score) {
  return clamp((70 - score) / 155, 0, 0.45)
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * @param {object} o
 * @param {object|null} o.speciesResult    — scanState.speciesResult
 * @param {object|null} o.estimatedMetrics — scanState.estimatedMetrics (overrides respected)
 * @param {object|null} o.visionAnalysis   — scanState.visionAnalysis
 * @param {object|null} o.visionDepth      — scanState.visionDepth { grid, width, height }
 * @param {object}      o.textureSamples   — { bark?, leaf?, canopy? }
 */
export function photoToProceduralParams({
  speciesResult    = null,
  estimatedMetrics = null,
  visionAnalysis   = null,
  visionDepth      = null,
  textureSamples   = {},
} = {}) {
  const m = estimatedMetrics ?? {}

  // ── Override-aware metric values ─────────────────────────────────────────
  const heightM  = clamp(effectiveValue(m, 'heightM')      ?? 12,  2,  80)
  const dbhCm    = clamp(effectiveValue(m, 'dbhCm')        ?? 20,  2, 300)
  const crownM   = clamp(effectiveValue(m, 'crownSpreadM') ??  8,  1,  40)
  const health   = clamp(m.healthScore ?? 70, 0, 100)
  const vizDens  = clamp(m.canopyDensity ?? 0.7, 0.05, 1)
  const ageClass = m.ageClass ?? 'mid-age'

  // ── Species ──────────────────────────────────────────────────────────────
  const sciName    = speciesResult?.scientific_name ?? ''
  const comName    = speciesResult?.common_name     ?? ''
  const genus      = sciName.trim().split(/\s+/)[0] || ''
  const treeType   = inferTreeType(sciName, comName)
  const speciesKey = slugify(comName || sciName || 'unknown')

  // ── Trunk (normalized; trunkHeight = 1.0) ────────────────────────────────
  const trunkHeight = 1.0

  // trunkRadius = half-diameter (m) / height (m), normalized to unit height
  const trunkRadius = clamp((dbhCm / 200) / heightM, 0.025, 0.18)

  // Fraction of base radius lost toward apex
  const trunkTaper =
    treeType === 'conifer'   ? 0.78 :
    treeType === 'palm_like' ? 0.18 : 0.54

  const trunkRadiusTop = trunkRadius * (1 - trunkTaper)

  // Lean angle (radians from vertical) extracted from the trunk silhouette line
  const trunkLean = trunkLeanFromLine(visionAnalysis?.trunkLine)

  // ── Crown ────────────────────────────────────────────────────────────────
  // Normalized crown half-width; capped to avoid wild shapes from noisy data
  const crownRadius = clamp((crownM / 2) / heightM, 0.18, 0.90)

  // Fraction of trunk height occupied by the crown (axial extent)
  const crownHeight =
    treeType === 'conifer'   ? 0.88 :
    treeType === 'palm_like' ? 0.12 : 0.55

  // canopyYOffset — legacy: vertical centre of crown mass in normalized units
  const canopyYOffset = trunkHeight * (1.0 - crownHeight * 0.42)

  // ── Canopy density refined by depth grid ─────────────────────────────────
  let crownDensity = vizDens
  const grid = visionDepth?.grid
  if (grid?.length) {
    const rows = visionDepth.height ?? 32
    const cols = visionDepth.width  ?? 32
    const r0 = Math.floor(rows * 0.05), r1 = Math.floor(rows * 0.60)
    const c0 = Math.floor(cols * 0.15), c1 = Math.floor(cols * 0.85)
    let sum = 0, sum2 = 0, n = 0
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) {
        const v = grid[r * cols + c] ?? 0
        sum += v; sum2 += v * v; n++
      }
    }
    if (n > 0) {
      const variance = (sum2 / n) - (sum / n) ** 2
      // Low variance in crown region = dense canopy, high = gap-heavy
      const depthDensity = clamp(1 - variance * 8, 0.2, 1.0)
      crownDensity = vizDens * 0.6 + depthDensity * 0.4
    }
  }
  crownDensity = clamp(crownDensity, 0.1, 1.0)

  // ── Health → visual ──────────────────────────────────────────────────────
  const deadBranchRatio = healthToPatchiness(health)
  const healthTint      = healthToTint(health)
  const patchiness      = deadBranchRatio   // same scale; existing renderers read patchiness

  // ── Branch angles ────────────────────────────────────────────────────────
  // Positive = branches angle upward from horizontal (radians)
  const branchAngleBias =
    treeType === 'conifer'   ? -0.32 :
    treeType === 'palm_like' ?  0.50 :  0.26

  // ── Asymmetry ─────────────────────────────────────────────────────────────
  const branchAsymmetry = clamp((visionAnalysis?.asymmetry ?? 0) * 1.4, 0, 1)
  const isAsymmetric    = branchAsymmetry > 0.4

  // ── Branch counts ─────────────────────────────────────────────────────────
  const ageBonus =
    ageClass === 'seedling' || ageClass === 'sapling' ? -1 :
    ageClass === 'young'   ? 0 :
    ageClass === 'mid-age' ? 1 : 2

  const primaryBranchCount = clamp(
    (treeType === 'conifer' ? 5 : 6) + ageBonus,
    4, 10
  )
  const secondaryBranchCount = health < 40 ? 1 : health < 65 ? 2 : 3
  const leafClustersPerTip   = treeType === 'conifer' || health < 50 ? 1 : 2

  // Conifer tier count (whorls along the leader)
  const branchTierCount = treeType === 'conifer'
    ? clamp(5 + ageBonus + (health > 60 ? 1 : 0), 4, 13)
    : 0

  // ── Leaf cluster geometry ─────────────────────────────────────────────────
  const leafClusterRadius = crownRadius * (treeType === 'conifer' ? 0.14 : 0.22)
  const leafClusterCount  = treeType === 'conifer'
    ? branchTierCount * 5 * 2
    : primaryBranchCount * secondaryBranchCount * leafClustersPerTip

  const leafScale =
    treeType === 'conifer'   ? 0.52 :
    treeType === 'palm_like' ? 1.85 : 1.0

  // Informational leaf count for export / debug
  const leafCount = clamp(Math.round(crownDensity * crownRadius ** 2 * 380), 40, 900)

  // ── Branch length ─────────────────────────────────────────────────────────
  const branchLengthScale = crownRadius * 0.58  // trunkHeight=1, so this IS branchLength

  // ── Colors ────────────────────────────────────────────────────────────────
  const barkSample = textureSamples?.bark
  const leafSample = textureSamples?.leaf ?? textureSamples?.canopy

  const trunkColor = barkSample?.averageColor ??
    (treeType === 'conifer'   ? '#4a3a2a' :
     treeType === 'palm_like' ? '#8a7a5a' : '#5a4a3a')

  const canopyColor = leafSample?.averageColor ?? healthTint

  // ── Texture source ────────────────────────────────────────────────────────
  const barkTextureSource = (barkSample?.dataUrl ?? barkSample?.url) || null

  // ── Deterministic seed from stable measurements ───────────────────────────
  const seed = hashDJB2(`${Math.round(dbhCm)}x${Math.round(heightM * 10)}x${speciesKey}`)

  // ── Crown habit and architecture (legacy) ─────────────────────────────────
  const crownHabit = deriveCrownHabit(genus, treeType, isAsymmetric)

  const trunkArchitecture =
    treeType === 'palm_like' ? 'palm' :
    treeType === 'conifer'   ? 'single_leader' : 'branching_leader'

  const branchArchitecture =
    treeType === 'conifer'   ? 'whorled' :
    treeType === 'palm_like' ? 'fronds'  : 'alternate'

  const foliageType =
    treeType === 'conifer'   ? 'needle_masses' :
    treeType === 'palm_like' ? 'frond_arches'  : 'broadleaf_clusters'

  return {
    // ── New schema (as requested) ──────────────────────────────────────────
    speciesKey,
    trunkHeight,
    trunkRadius,
    trunkLean,
    trunkTaper,
    primaryBranchCount,
    branchAngleBias,
    branchLengthScale,
    branchAsymmetry,
    crownRadius,
    crownHeight,
    crownDensity,
    leafScale,
    leafCount,
    deadBranchRatio,
    healthTint,
    barkTextureSource,
    seed,

    // ── Legacy compat (renderers read these) ──────────────────────────────
    trunkRadiusBase:     trunkRadius,
    trunkRadiusTop,
    canopyRadius:        crownRadius,
    canopyYOffset,
    canopyDensity:       crownDensity,
    canopyColor,
    trunkColor,
    branchLength:        branchLengthScale,
    patchiness,
    treeType,
    genus,
    crownHabit,
    secondaryBranchCount,
    leafClustersPerTip,
    leafClusterRadius,
    branchTierCount,
    leafClusterCount,
    canopyDistribution:  isAsymmetric ? 'asymmetric' : 'medium',
    branchDensity:       health < 50 ? 'low' : health > 75 ? 'high' : 'medium',
    leafDistribution:    treeType === 'conifer' ? 'outer_shell' : 'clustered',
    trunkForm:           'single',
    trunkCount:          1,
    trunkArchitecture,
    branchArchitecture,
    foliageType,
    branchCount:         primaryBranchCount,
    branchLevels:        ageBonus + 2,
  }
}
