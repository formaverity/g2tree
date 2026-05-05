/**
 * Estimation engine.
 * DBH confidence tiers (highest → lowest):
 *   A. scale reference + dbh_left/dbh_right landmarks
 *   B. known_height_ft + trunk pixel height as proxy
 *   C. species/age/canopy heuristics only
 * User-confirmed values (known_dbh_in, known_species) always take precedence.
 */
export function estimateTree({
  landmarks,
  scaleRealWorldDist = 1.0,
  showScaleRef = false,
  photos = [],
  userHints = {},
}) {
  const {
    trunk_base, trunk_top,
    canopy_left, canopy_right,
    dbh_left, dbh_right,
    scale_a, scale_b,
  } = landmarks

  const {
    known_dbh_in,
    known_height_ft,
    known_species,
    site_type,
    photo_distance_hint = 'unknown',
  } = userHints

  // ── Normalized distances ──────────────────────────────────────────────────
  const trunkHeightNorm = Math.abs(trunk_base.y - trunk_top.y)
  const canopyWidthNorm = Math.abs(canopy_right.x - canopy_left.x)
  const scaleRefNorm = Math.sqrt(
    (scale_b.x - scale_a.x) ** 2 + (scale_b.y - scale_a.y) ** 2
  )
  const dbhWidthNorm = Math.abs(dbh_right.x - dbh_left.x)

  // Scale reference in inches
  const referenceLengthInches = scaleRealWorldDist * 39.37

  // ── Height & canopy (unchanged) ───────────────────────────────────────────
  const hasScale = showScaleRef && scaleRefNorm > 0.02
  const ppm = hasScale ? scaleRefNorm / scaleRealWorldDist : 0.1
  const heightM = trunkHeightNorm / ppm
  const canopyWidthM = canopyWidthNorm / ppm

  const height_ft = known_height_ft && parseFloat(known_height_ft) > 0
    ? parseFloat(known_height_ft)
    : Math.round(heightM * 3.281 * 10) / 10

  const canopy_width_ft = Math.round(canopyWidthM * 3.281 * 10) / 10

  // ── DBH — tiered calculation ──────────────────────────────────────────────
  let dbh_in, dbh_method, dbh_confidence

  if (known_dbh_in && parseFloat(known_dbh_in) > 0) {
    // User-confirmed — highest authority
    dbh_in = parseFloat(known_dbh_in)
    dbh_method = 'user_confirmed'
    dbh_confidence = 0.95

  } else if (hasScale && dbhWidthNorm > 0.005) {
    // Tier A: scale reference + DBH landmark pair
    const pixelsPerInch = scaleRefNorm / referenceLengthInches
    dbh_in = dbhWidthNorm / pixelsPerInch
    // Quality depends on both scale distance and trunk width being meaningful
    const goodScale = scaleRefNorm > 0.05
    const goodTrunk = dbhWidthNorm > 0.02
    dbh_confidence = goodScale && goodTrunk ? 0.75 : 0.5
    dbh_method = 'landmark_scaled'

  } else if (known_height_ft && parseFloat(known_height_ft) > 0 && trunkHeightNorm > 0.01) {
    // Tier B: known height as pixel-to-real proxy
    const knownHeight = parseFloat(known_height_ft)
    const pixelsPerFt = trunkHeightNorm / knownHeight
    const dbhFt = dbhWidthNorm / pixelsPerFt
    dbh_in = dbhFt * 12
    dbh_confidence = 0.45
    dbh_method = 'known_height_proxy'

  } else {
    // Tier C: heuristic fallback from height estimate
    const dbhM = Math.max(0.05, (heightM * 0.012) + 0.04)
    dbh_in = Math.round(dbhM * 39.37 * 10) / 10
    dbh_confidence = 0.2
    dbh_method = 'heuristic'
  }

  dbh_in = Math.round(dbh_in * 10) / 10

  // ── Age class ─────────────────────────────────────────────────────────────
  let age_class = 'young'
  if (height_ft > 40) age_class = 'mature'
  else if (height_ft > 20) age_class = 'mid-age'

  // ── Species guess ─────────────────────────────────────────────────────────
  let species_guess, species_confidence, species_method

  if (known_species && known_species.trim()) {
    species_guess = known_species.trim()
    species_confidence = 0.95
    species_method = 'user_provided'
  } else {
    const canopyRatio = canopyWidthNorm / Math.max(trunkHeightNorm, 0.01)
    species_confidence = 0.2

    if (canopyRatio > 1.4) {
      species_guess = 'Oak (Quercus spp.)'
      species_confidence = 0.35
    } else if (canopyRatio < 0.6) {
      species_guess = 'Conifer / Spruce type'
      species_confidence = 0.4
    } else if (canopyRatio > 0.9 && canopyRatio < 1.3) {
      species_guess = 'Maple (Acer spp.)'
      species_confidence = 0.3
    } else {
      species_guess = 'Unknown broadleaf'
    }
    species_method = 'canopy_ratio_heuristic'
  }

  // ── Health ────────────────────────────────────────────────────────────────
  const health_status = photos.length >= 3 ? 'good' : 'unknown'
  const health_confidence = photos.length >= 3 ? 0.5 : 0.15

  // ── Overall confidence ────────────────────────────────────────────────────
  const confidence_overall = Math.round(
    ((species_confidence + health_confidence + dbh_confidence) / 3) * 100
  ) / 100

  // ── Assumptions ───────────────────────────────────────────────────────────
  const assumptions = []

  if (dbh_method === 'user_confirmed') {
    assumptions.push('DBH taken from user-provided measurement (confirmed)')
  } else if (dbh_method === 'landmark_scaled') {
    assumptions.push(`DBH measured from DBH landmark pair via scale reference (${scaleRealWorldDist}m = ${referenceLengthInches.toFixed(1)}in)`)
  } else if (dbh_method === 'known_height_proxy') {
    assumptions.push(`DBH scaled from DBH landmarks using known height (${known_height_ft}ft) as pixel proxy`)
  } else {
    assumptions.push('DBH estimated from height-to-diameter ratio heuristic — add scale reference or known height for accuracy')
  }

  if (species_method === 'user_provided') {
    assumptions.push('Species taken from user-provided identification')
  } else {
    assumptions.push('Species inferred from canopy-to-height ratio only')
  }

  if (hasScale) {
    assumptions.push(`Scale reference: ${scaleRealWorldDist}m real-world distance`)
  }

  if (photo_distance_hint !== 'unknown') {
    assumptions.push(`Photo distance hint: ${photo_distance_hint.replace(/_/g, ' ')}`)
  }

  if (site_type) {
    assumptions.push(`Site type: ${site_type}`)
  }

  assumptions.push('No crown segmentation or bark texture analysis performed')

  // ── Warnings ──────────────────────────────────────────────────────────────
  const warnings = []

  if (photos.length < 2) {
    warnings.push('Only one photo provided — multi-angle increases accuracy')
  }
  if (!hasScale && dbh_method !== 'user_confirmed') {
    warnings.push('No scale reference set — enable Scale Reference in Calibrate for accurate DBH')
  }
  if (dbhWidthNorm < 0.005 && dbh_method !== 'user_confirmed') {
    warnings.push('DBH landmark points are very close together — spread them to trunk edges at breast height')
  }
  if (scaleRefNorm < 0.02 && showScaleRef) {
    warnings.push('Scale reference points are very close together — spread them further apart')
  }
  if (height_ft < 2) {
    warnings.push('Estimated height is very low — check trunk landmark placement')
  }
  if (height_ft > 300) {
    warnings.push('Estimated height is unrealistically large — check scale calibration')
  }
  if (dbh_in > 120) {
    warnings.push('DBH estimate is very large — verify DBH landmark placement and scale')
  }

  return {
    species_guess,
    species_confidence,
    species_method,
    health_status,
    health_confidence,
    dbh_in,
    dbh_method,
    dbh_confidence,
    height_ft,
    canopy_width_ft,
    age_class,
    confidence_overall,
    assumptions,
    warnings,
  }
}
