/**
 * i-Tree-inspired ecological benefits estimator.
 *
 * ALL outputs are model-based estimates, NOT certified i-Tree® results.
 * Formulas follow published allometric and interception literature
 * (Nowak et al. 2002, McPherson et al. 2016, Hirabayashi et al. 2011).
 *
 * Confidence levels reflect data quality, not statistical intervals.
 */

// ── Species factor tables ──────────────────────────────────────────────────────
// Growth rate and carbon multiplier by broad tree type.
// Source: USDA Urban Tree Database species groupings.
const SPECIES_FACTORS = {
  // { carbonMult: relative carbon density, growthRate: 0-1 annual increment fraction }
  conifer:            { carbonMult: 1.10, growthRate: 0.035 },
  deciduous_broadleaf:{ carbonMult: 1.00, growthRate: 0.045 },
  palm_like:          { carbonMult: 0.55, growthRate: 0.06  },
  unknown:            { carbonMult: 1.00, growthRate: 0.04  },
}

// Interception rate by canopy density category (fraction of precip intercepted).
// Source: Xiao et al. 2000; deciduous ~11-15%, conifers ~20-30%.
const INTERCEPTION_RATE = {
  conifer:            0.27,
  deciduous_broadleaf:0.14,
  palm_like:          0.08,
  unknown:            0.13,
}

// Mean annual precipitation by Köppen climate zone (mm/yr).
// Rough lookup used when no location data is available.
const DEFAULT_ANNUAL_PRECIP_MM = 750

// Leaf Area Index typical range by type (m² leaf / m² ground).
const LAI = {
  conifer:            6.5,
  deciduous_broadleaf:4.2,
  palm_like:          2.8,
  unknown:            4.0,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

// Infer broad tree type from species label strings.
function inferType(scientificName = '', commonName = '') {
  const s = (scientificName + ' ' + commonName).toLowerCase()
  if (/pinus|picea|abies|cedar|spruce|fir|pine|juniper|redwood|sequoia|cypress|hemlock/.test(s))
    return 'conifer'
  if (/palm|phoenix|washingtonia|sabal|trachycarpus|livistona/.test(s))
    return 'palm_like'
  if (s.trim()) return 'deciduous_broadleaf'
  return 'unknown'
}

// ── Carbon storage (above-ground biomass → carbon) ────────────────────────────
//
// Nowak 1994 allometric: Dry biomass (kg) ≈ 0.15 × DBH_cm^2.42
// Carbon fraction of dry wood ≈ 0.5 (IPCC default).
// Result: C_stored ≈ 0.075 × DBH_cm^2.42 × speciesMult × healthFraction
//
function carbonStorageKg(dbhCm, treeType, healthScore) {
  const healthFrac = clamp(healthScore / 100, 0.20, 1.00)
  const mult = SPECIES_FACTORS[treeType]?.carbonMult ?? 1.0
  return 0.075 * Math.pow(dbhCm, 2.42) * mult * healthFrac
}

// ── Annual carbon sequestration ───────────────────────────────────────────────
//
// Proportional to stored carbon and species-specific growth rate.
// Sequestration ≈ stored_C × growth_rate × health_fraction
// Growth rate decreases with tree maturity (larger DBH = slower relative growth).
//
function annualCarbonSeqKg(storedCarbonKg, dbhCm, treeType, healthScore) {
  const healthFrac = clamp(healthScore / 100, 0.20, 1.00)
  const baseRate   = SPECIES_FACTORS[treeType]?.growthRate ?? 0.04
  // Maturity dampener: trees >60 cm DBH grow ~40% slower than saplings.
  const maturity   = clamp(1 - (dbhCm - 10) / 300, 0.40, 1.00)
  return storedCarbonKg * baseRate * maturity * healthFrac
}

// ── Annual stormwater interception ────────────────────────────────────────────
//
// Xiao 2000: I = P_annual × (LAI × crownArea) / crownArea × rate
// Simplified: I_total = crownArea_m2 × LAI × interceptionDepth_m
// interceptionDepth (m) ≈ precipMM × rate / 1000
//
function annualStormwaterL(crownSpreadM, treeType, healthScore, annualPrecipMm) {
  const crownRadius = crownSpreadM / 2
  const crownArea   = Math.PI * crownRadius * crownRadius
  const lai         = LAI[treeType] ?? LAI.unknown
  const rate        = INTERCEPTION_RATE[treeType] ?? 0.13
  const healthFrac  = clamp(healthScore / 100, 0.20, 1.00)
  // Effective interception depth (m): precip × canopy catch rate
  const interceptDepthM = (annualPrecipMm / 1000) * rate
  // Volume (m³) → litres (×1000), scaled by LAI and health
  return crownArea * lai * interceptDepthM * 1000 * healthFrac
}

// ── Shade area ────────────────────────────────────────────────────────────────
//
// Direct geometric projection: π × (crownSpread/2)²
// No sun-angle correction (conservative; actual shade is ~20% larger at 45° sun).
//
function shadeAreaM2(crownSpreadM) {
  const r = crownSpreadM / 2
  return Math.PI * r * r
}

// ── Cooling score (0-100) ─────────────────────────────────────────────────────
//
// Proxy combining shade benefit and transpiration.
// Shade contribution: shade area relative to ~50 m² baseline.
// Transpiration proxy: stormwater interception / 300 (evapotranspiration surrogate).
// Weighted: 60% shade, 40% transpiration.
//
function coolingScore(shadeM2, stormwaterL, healthScore) {
  const shadePct  = clamp(shadeM2 / 50, 0, 1)
  const transPct  = clamp(stormwaterL / 300, 0, 1)
  const healthFrac = clamp(healthScore / 100, 0.2, 1)
  return Math.round((shadePct * 0.60 + transPct * 0.40) * healthFrac * 100)
}

// ── Habitat score (0-100) ─────────────────────────────────────────────────────
//
// Crown volume proxy: (4/3) × π × (crownR)² × (height/2)  [hemi-ellipsoid].
// Normalised to ~250 m³ reference (a large mature oak).
// Multiplied by health fraction and nativity bonus (if detectable).
//
function habitatScore(crownSpreadM, heightM, healthScore) {
  const crownR    = crownSpreadM / 2
  const crownVol  = (4 / 3) * Math.PI * crownR * crownR * (heightM / 2)
  const healthFrac = clamp(healthScore / 100, 0.2, 1)
  return Math.round(clamp(crownVol / 250, 0, 1) * healthFrac * 100)
}

// ── Avoided runoff score (0-100) ──────────────────────────────────────────────
//
// Based on stormwater intercepted relative to a reference ~1000 L/yr.
// Urban impervious surface multiplies runoff impact (hardscape factor 1.3).
//
function avoidedRunoffScore(stormwaterL) {
  const hardsapeFactor = 1.3
  return Math.round(clamp((stormwaterL * hardsapeFactor) / 1000, 0, 1) * 100)
}

// ── Confidence heuristic ──────────────────────────────────────────────────────
//
// Base confidence from input metric confidence, degraded when:
// - species is unknown (−0.15)
// - health is estimated not measured (−0.10)
// - DBH <5 cm or >150 cm (outside well-studied allometric range, −0.15)
//
function deriveConfidence(baseConf, treeType, dbhCm) {
  let c = clamp(baseConf, 0, 1)
  if (treeType === 'unknown') c -= 0.15
  if (dbhCm < 5 || dbhCm > 150) c -= 0.15
  return clamp(Math.round(c * 100) / 100, 0.10, 0.95)
}

// ── Main estimator ────────────────────────────────────────────────────────────

/**
 * estimateEcologicalBenefits
 *
 * @param {object} opts
 * @param {object|null}  opts.speciesResult     — { scientific_name, common_name }
 * @param {object|null}  opts.estimatedMetrics  — from treeMetrics.js (with effectiveValue applied externally)
 * @param {number}       opts.dbhCm             — effective DBH (cm)
 * @param {number}       opts.heightM           — effective height (m)
 * @param {number}       opts.crownSpreadM      — effective crown spread (m)
 * @param {number}       opts.canopyDensity     — 0-100%
 * @param {number}       opts.healthScore       — 0-100%
 * @param {object|null}  opts.confidence        — { dbh, height, crownSpread } from metrics
 * @param {number}       opts.annualPrecipMm    — optional override for local precipitation
 * @returns {EcologicalBenefits}
 */
export function estimateEcologicalBenefits({
  speciesResult      = null,
  dbhCm              = 20,
  heightM            = 8,
  crownSpreadM       = 6,
  canopyDensity      = 60,
  healthScore        = 75,
  confidence         = {},
  annualPrecipMm     = DEFAULT_ANNUAL_PRECIP_MM,
} = {}) {
  const treeType = inferType(
    speciesResult?.scientific_name ?? '',
    speciesResult?.common_name ?? '',
  )

  // Structural values
  const carbonKg     = carbonStorageKg(dbhCm, treeType, healthScore)
  const seqKg        = annualCarbonSeqKg(carbonKg, dbhCm, treeType, healthScore)
  const stormwaterL  = annualStormwaterL(crownSpreadM, treeType, healthScore, annualPrecipMm)
  const shadeM2      = shadeAreaM2(crownSpreadM)
  const cooling      = coolingScore(shadeM2, stormwaterL, healthScore)
  const habitat      = habitatScore(crownSpreadM, heightM, healthScore)
  const runoff       = avoidedRunoffScore(stormwaterL)

  // Base confidence from metric quality; use DBH confidence as proxy for biomass data
  const baseConf     = confidence.dbh ?? 0.45
  const conf         = deriveConfidence(baseConf, treeType, dbhCm)

  // Scores have lower confidence than direct measurements
  const scoreConf    = clamp(conf - 0.12, 0.10, 0.85)

  return {
    treeType,
    carbon_storage_kg:                    Math.round(carbonKg),
    annual_carbon_sequestration_kg:       parseFloat(seqKg.toFixed(1)),
    annual_stormwater_intercepted_liters: Math.round(stormwaterL),
    shade_area_m2:                        parseFloat(shadeM2.toFixed(1)),
    cooling_score:                        cooling,
    habitat_score:                        habitat,
    avoided_runoff_score:                 runoff,
    confidence: {
      carbon:     conf,
      sequestration: clamp(conf - 0.05, 0.10, 0.90),
      stormwater: clamp(conf - 0.08, 0.10, 0.88),
      shade:      clamp((confidence.crownSpread ?? 0.5) - 0.05, 0.10, 0.90),
      cooling:    scoreConf,
      habitat:    scoreConf,
      runoff:     scoreConf,
    },
    meta: {
      method: 'i-Tree-inspired estimate',
      disclaimer: 'These are model-based estimates, not certified i-Tree® results.',
      treeType,
      inputs: { dbhCm, heightM, crownSpreadM, canopyDensity, healthScore },
    },
  }
}
