/**
 * Ecological tree metrics estimator.
 *
 * Uses a tiered evidence model — user overrides beat calibrated measurements
 * beat vision-analysis pixel ratios beat species allometry beat the default
 * species prior. Every output carries an explicit confidence score.
 *
 * All outputs are in SI (m / cm). Crown spread and height are additionally
 * available via the helper `toImperial(metrics)`.
 */

// ── Species trait table ───────────────────────────────────────────────────────
// Format: [typicalHeightM, typicalDbhCm, typicalCrownM, isConifer]
// Source: temperate North American urban / forest averages at near-maturity.
const SPECIES_TABLE = {
  // Broadleaf
  'white oak':        [21, 75, 18, false],
  'red oak':          [24, 85, 20, false],
  'bur oak':          [18, 95, 21, false],
  'pin oak':          [20, 65, 16, false],
  'sugar maple':      [28, 65, 15, false],
  'red maple':        [20, 52, 13, false],
  'silver maple':     [24, 78, 20, false],
  'norway maple':     [16, 55, 14, false],
  'american elm':     [24, 80, 24, false],
  'white ash':        [22, 65, 18, false],
  'green ash':        [18, 52, 15, false],
  'american beech':   [25, 68, 17, false],
  'tulip poplar':     [30, 88, 18, false],
  'sweetgum':         [22, 62, 14, false],
  'black walnut':     [25, 88, 20, false],
  'shagbark hickory': [22, 70, 16, false],
  'hackberry':        [18, 58, 16, false],
  'cottonwood':       [30, 115, 26, false],
  'sycamore':         [28, 125, 26, false],
  'black cherry':     [22, 58, 14, false],
  'river birch':      [18, 48, 14, false],
  'paper birch':      [20, 38, 12, false],
  'willow':           [22, 85, 25, false],
  'linden':           [20, 60, 18, false],
  'honeylocust':      [18, 55, 16, false],
  'black locust':     [16, 50, 12, false],
  'ginkgo':           [22, 60, 12, false],
  'catalpa':          [15, 60, 14, false],
  'magnolia':         [14, 45, 12, false],
  // Conifers
  'eastern white pine': [30, 75, 12, true],
  'loblolly pine':      [28, 68, 10, true],
  'shortleaf pine':     [22, 58, 10, true],
  'ponderosa pine':     [35, 90, 12, true],
  'douglas fir':        [45, 95, 13, true],
  'blue spruce':        [15, 38, 8,  true],
  'norway spruce':      [25, 58, 10, true],
  'white spruce':       [22, 50, 9,  true],
  'eastern hemlock':    [20, 52, 12, true],
  'bald cypress':       [30, 95, 11, true],
  'giant sequoia':      [75, 250, 15, true],
  'western red cedar':  [30, 80, 12, true],
  // Genus-level fallbacks (lower in priority than exact matches)
  'oak':     [20, 80, 18, false],
  'maple':   [22, 60, 14, false],
  'pine':    [25, 60, 10, true],
  'spruce':  [20, 48, 9,  true],
  'elm':     [22, 72, 20, false],
  'birch':   [18, 38, 12, false],
  'poplar':  [25, 78, 16, false],
  'ash':     [20, 58, 16, false],
  'cedar':   [18, 42, 8,  true],
  'cherry':  [18, 42, 13, false],
  'walnut':  [22, 72, 18, false],
  'beech':   [24, 65, 17, false],
  'hickory': [20, 65, 16, false],
  'fir':     [30, 70, 12, true],
  'hemlock': [20, 50, 12, true],
  'alder':   [14, 30, 10, false],
  'willow':  [22, 80, 24, false],
  'locust':  [17, 52, 14, false],
}

const DEFAULT_TRAITS = [16, 50, 13, false]  // fallback for unknown species

// Approximate angular scene extents for a full-tree smartphone photo.
// Calibrated so that: a 15m tree filling ~65% of the frame → 15m estimate.
const SCENE_H = 25   // metres of visible height in a typical full-tree shot
const SCENE_W = 32   // metres of visible width

// Allometric coefficients: dbhCm = A * heightM^B
const ALLOM_BROAD   = { A: 3.0, B: 0.90 }
const ALLOM_CONIFER = { A: 2.0, B: 0.95 }

// ── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

function lookupTraits(commonName) {
  if (!commonName) return { traits: DEFAULT_TRAITS, matchConf: 0.10 }
  const lower = commonName.toLowerCase().trim()

  if (SPECIES_TABLE[lower]) return { traits: SPECIES_TABLE[lower], matchConf: 0.40 }

  // Multi-word species: try progressively shorter key fragments
  const words = lower.split(/[\s,]+/)
  for (let len = words.length - 1; len >= 1; len--) {
    for (let start = 0; start <= words.length - len; start++) {
      const key = words.slice(start, start + len).join(' ')
      if (SPECIES_TABLE[key]) return { traits: SPECIES_TABLE[key], matchConf: 0.30 }
    }
  }

  // Substring: any single word from the name contained in a table key
  for (const [key, val] of Object.entries(SPECIES_TABLE)) {
    if (words.some((w) => w.length > 3 && key.includes(w))) {
      return { traits: val, matchConf: 0.22 }
    }
  }

  return { traits: DEFAULT_TRAITS, matchConf: 0.12 }
}

function dbhFromHeight(heightM, isConifer) {
  const { A, B } = isConifer ? ALLOM_CONIFER : ALLOM_BROAD
  return A * Math.pow(heightM, B)
}

function ageClassFromDbh(dbhCm) {
  if (dbhCm < 2)   return 'seedling'
  if (dbhCm < 10)  return 'sapling'
  if (dbhCm < 25)  return 'young'
  if (dbhCm < 55)  return 'mid-age'
  if (dbhCm < 90)  return 'mature'
  return 'old-growth'
}

function round1(v) { return Math.round(v * 10) / 10 }

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Estimate ecological tree metrics from capture inputs.
 *
 * @param {{
 *   speciesResult?: {common_name?:string, scientific_name?:string, confidence?:number, confirmed?:boolean},
 *   visionAnalysis?: {crownPixelWidth:number, crownPixelHeight:number, imageWidth:number, imageHeight:number,
 *                     canopyDensity:number, asymmetry:number, skyGap:number},
 *   visionDepth?:    {grid:number[][], width:number, height:number},
 *   selectedLocation?: {lat:number, lng:number, source:string},
 *   scaleHintFt?:   number|null,
 *   userHints?:     {known_dbh_in?:string, known_height_ft?:string, known_species?:string},
 * }} opts
 *
 * @returns {{
 *   dbhCm, heightM, crownSpreadM, crownRadiusM,
 *   canopyDensity, ageClass, healthScore,
 *   confidence: {dbh, height, crownSpread, species, health},
 *   overrides: {dbhCm:null, heightM:null, crownSpreadM:null},
 *   notes: string[],
 * }}
 */
export function estimateTreeMetrics({
  speciesResult  = null,
  visionAnalysis = null,
  visionDepth    = null,
  selectedLocation = null,
  scaleHintFt    = null,
  userHints      = {},
} = {}) {
  const notes   = []
  const conf    = { dbh: 0.15, height: 0.15, crownSpread: 0.15, species: 0.10, health: 0.30 }

  // ── 1. Species resolution ─────────────────────────────────────────────────
  const speciesName = speciesResult?.common_name
    ?? userHints.known_species
    ?? null

  const { traits, matchConf } = lookupTraits(speciesName)
  const [typH, typDbh, typCrown, isConifer] = traits

  conf.species = speciesResult?.confirmed && speciesResult?.confidence > 0
    ? clamp(speciesResult.confidence, 0.5, 0.95)
    : speciesResult?.confidence > 0
      ? clamp(speciesResult.confidence * 0.85, 0.25, 0.80)
      : matchConf

  if (speciesName) notes.push(`Species: ${speciesName}`)

  // ── 2. Height ─────────────────────────────────────────────────────────────
  let heightM, heightSource

  const knownHeightFt = parseFloat(userHints.known_height_ft)
  if (knownHeightFt > 0) {
    heightM      = knownHeightFt * 0.3048
    conf.height  = 0.95
    heightSource = 'user-provided'
    notes.push(`Height from field measurement: ${knownHeightFt} ft`)

  } else if (visionAnalysis) {
    const hFrac = visionAnalysis.crownPixelHeight / visionAnalysis.imageHeight
    // Adjust for species size relative to the "average" tree
    const speciesFactor = clamp(typH / 16, 0.6, 2.2)
    heightM      = clamp(hFrac * SCENE_H * speciesFactor, 2, 70)
    conf.height  = 0.30
    heightSource = 'vision'
    notes.push(`Height from image analysis (${Math.round(hFrac * 100)}% frame fill)`)

  } else {
    heightM      = typH * 0.75   // assume younger/smaller than max
    conf.height  = 0.15
    heightSource = 'species-prior'
    notes.push('Height from species prior — no image analysis or measurements available')
  }

  if (heightSource !== 'user-provided') {
    notes.push('Add a known height or scale reference to improve accuracy.')
  }

  // ── 3. DBH ────────────────────────────────────────────────────────────────
  let dbhCm, dbhSource

  const knownDbhIn = parseFloat(userHints.known_dbh_in)
  if (knownDbhIn > 0) {
    dbhCm      = knownDbhIn * 2.54
    conf.dbh   = 0.95
    dbhSource  = 'user-provided'
    notes.push(`DBH from field measurement: ${knownDbhIn} in`)

  } else {
    // Allometric from height — confidence inherits from height source
    dbhCm = dbhFromHeight(heightM, isConifer)
    dbhCm = clamp(dbhCm, 1, 300)

    if (heightSource === 'user-provided') {
      conf.dbh  = 0.55
      dbhSource = 'allometry-from-measured-height'
      notes.push('DBH estimated via allometry from known height')
    } else if (heightSource === 'vision') {
      conf.dbh  = 0.28
      dbhSource = 'allometry-from-vision'
      notes.push('DBH estimated via allometry from image-derived height — low confidence')
    } else {
      conf.dbh  = 0.15
      dbhSource = 'species-prior'
      notes.push('DBH from species prior only — no reliable scale')
    }
  }

  // ── 4. Crown spread ───────────────────────────────────────────────────────
  let crownSpreadM, crownSource

  if (visionAnalysis) {
    const wFrac = visionAnalysis.crownPixelWidth / visionAnalysis.imageWidth
    const speciesFactor = clamp(typCrown / 13, 0.5, 2.5)
    crownSpreadM  = clamp(wFrac * SCENE_W * speciesFactor, 0.5, 40)
    conf.crownSpread = 0.32
    crownSource   = 'vision'
  } else {
    // Scale species typical crown by the DBH ratio vs species typical DBH
    const dbhRatio   = dbhCm / Math.max(typDbh, 1)
    crownSpreadM     = clamp(typCrown * clamp(dbhRatio, 0.3, 1.8), 1, 35)
    conf.crownSpread = 0.20
    crownSource      = 'allometry'
  }

  // Sanity: crown ≥ 2× trunk diameter
  const minCrown = (dbhCm / 100) * 2
  if (crownSpreadM < minCrown) crownSpreadM = minCrown

  const crownRadiusM = crownSpreadM / 2

  // ── 5. Depth grid refinement ──────────────────────────────────────────────
  // Use variance in the crown region of the depth grid to refine canopy density.
  let depthCrownDensity = null
  if (visionDepth?.grid && visionAnalysis) {
    const { grid } = visionDepth
    const rows = grid.length, cols = grid[0]?.length ?? 0
    if (rows > 0 && cols > 0) {
      // Sample the upper-centre region (canopy zone)
      const r0 = Math.round(rows * 0.05), r1 = Math.round(rows * 0.60)
      const c0 = Math.round(cols * 0.15), c1 = Math.round(cols * 0.85)
      let sum = 0, count = 0, sumSq = 0
      for (let r = r0; r < r1; r++) {
        for (let c = c0; c < c1; c++) {
          const v = grid[r][c]
          sum += v; sumSq += v * v; count++
        }
      }
      if (count > 0) {
        const mean = sum / count
        const variance = sumSq / count - mean * mean
        // Low variance in foreground region = dense, even canopy
        // High variance = many gaps (sky visible through canopy)
        depthCrownDensity = clamp(1 - variance * 8, 0.2, 1.0)
      }
    }
  }

  // ── 6. Canopy density ─────────────────────────────────────────────────────
  let canopyDensity  // 0-100 integer
  if (visionAnalysis) {
    const visDensity = clamp(visionAnalysis.canopyDensity, 0, 1)
    const base = depthCrownDensity != null
      ? visDensity * 0.6 + depthCrownDensity * 0.4
      : visDensity
    canopyDensity = Math.round(base * 100)
  } else {
    canopyDensity = 65   // neutral default
  }

  // ── 7. Health score ───────────────────────────────────────────────────────
  let healthScore
  if (visionAnalysis) {
    const { canopyDensity: cd, asymmetry, skyGap } = visionAnalysis
    // Dense symmetric canopy with moderate sky gap = healthy
    const skyHealth = clamp(1 - Math.max(0, skyGap - 0.15) * 3, 0, 1)
    const raw = cd * 0.50 + (1 - asymmetry) * 0.30 + skyHealth * 0.20
    healthScore   = Math.round(clamp(raw, 0, 1) * 100)
    conf.health   = 0.60
  } else {
    healthScore = 65   // neutral default
    conf.health = 0.20
  }

  // ── 8. Age class ──────────────────────────────────────────────────────────
  const ageClass = ageClassFromDbh(dbhCm)

  // ── 9. Scale-reference warning ────────────────────────────────────────────
  const hasScaleRef   = !!scaleHintFt
  const hasUserHeight = knownHeightFt > 0
  const hasUserDbh    = knownDbhIn > 0

  if (!hasScaleRef && !hasUserHeight && !hasUserDbh) {
    notes.push('No scale reference — DBH and height are low-confidence estimates.')
  }

  // ── Assemble result ───────────────────────────────────────────────────────
  return {
    dbhCm:        round1(dbhCm),
    heightM:      round1(heightM),
    crownSpreadM: round1(crownSpreadM),
    crownRadiusM: round1(crownRadiusM),
    canopyDensity,
    ageClass,
    healthScore,
    confidence: {
      dbh:        round1(conf.dbh),
      height:     round1(conf.height),
      crownSpread: round1(conf.crownSpread),
      species:    round1(conf.species),
      health:     round1(conf.health),
    },
    overrides: {
      dbhCm:        null,
      heightM:      null,
      crownSpreadM: null,
    },
    notes,
    _meta: { heightSource, dbhSource, crownSource, hasScaleRef, isConifer },
  }
}

/**
 * Returns the effective value for a metric — override if set, otherwise estimate.
 * @param {object} metrics — result from estimateTreeMetrics
 * @param {'dbhCm'|'heightM'|'crownSpreadM'} key
 */
export function effectiveValue(metrics, key) {
  return metrics.overrides[key] ?? metrics[key]
}

/** Quick imperial conversion helper for display. */
export function toImperial(metrics) {
  return {
    heightFt:  round1(effectiveValue(metrics, 'heightM')      * 3.2808),
    dbhIn:     round1(effectiveValue(metrics, 'dbhCm')        / 2.54),
    crownFt:   round1(effectiveValue(metrics, 'crownSpreadM') * 3.2808),
  }
}
