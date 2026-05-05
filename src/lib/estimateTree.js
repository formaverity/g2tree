/**
 * Deterministic placeholder estimation engine.
 * All values derived from landmark geometry + heuristics.
 * Replace with real inference when AI integration is ready.
 */
export function estimateTree({ landmarks, scaleRealWorldDist = 1.0, photos = [] }) {
  const { trunk_base, trunk_top, canopy_left, canopy_right, scale_a, scale_b } = landmarks

  // Pixel-space distances (normalized 0-1)
  const trunkHeightNorm = Math.abs(trunk_base.y - trunk_top.y)
  const canopyWidthNorm = Math.abs(canopy_right.x - canopy_left.x)
  const scaleRefNorm = Math.sqrt(
    Math.pow(scale_b.x - scale_a.x, 2) + Math.pow(scale_b.y - scale_a.y, 2)
  )

  // Pixels-per-meter using scale reference
  const ppm = scaleRefNorm > 0.01 ? scaleRefNorm / scaleRealWorldDist : 0.1

  // Real-world estimates (meters)
  const heightM = trunkHeightNorm / ppm
  const canopyWidthM = canopyWidthNorm / ppm

  // DBH heuristic: assume trunk is ~1% of tree height, min 5cm
  const dbhM = Math.max(0.05, heightM * 0.01 + 0.05)

  // Convert to imperial
  const height_ft = Math.round(heightM * 3.281 * 10) / 10
  const canopy_width_ft = Math.round(canopyWidthM * 3.281 * 10) / 10
  const dbh_in = Math.round(dbhM * 39.37 * 10) / 10

  // Age class from height heuristic
  let age_class = 'young'
  if (height_ft > 40) age_class = 'mature'
  else if (height_ft > 20) age_class = 'mid-age'

  // Canopy ratio heuristic for species guess
  const canopyRatio = canopyWidthNorm / Math.max(trunkHeightNorm, 0.01)
  let species_guess = 'Unknown broadleaf'
  let species_confidence = 0.2

  if (canopyRatio > 1.4) {
    species_guess = 'Oak (Quercus spp.)'
    species_confidence = 0.35
  } else if (canopyRatio < 0.6) {
    species_guess = 'Conifer / Spruce type'
    species_confidence = 0.4
  } else if (canopyRatio > 0.9 && canopyRatio < 1.3) {
    species_guess = 'Maple (Acer spp.)'
    species_confidence = 0.3
  }

  // Health heuristic based on number of photos
  const health_status = photos.length >= 3 ? 'good' : 'unknown'
  const health_confidence = photos.length >= 3 ? 0.5 : 0.15

  const confidence_overall = Math.round(
    ((species_confidence + health_confidence) / 2) * 100
  ) / 100

  const assumptions = [
    'Scale reference assumed to be ' + scaleRealWorldDist + ' meter(s)',
    'DBH estimated from height-to-diameter ratio heuristic',
    'Species inferred from canopy-to-height ratio only',
    'No crown segmentation or bark texture analysis performed',
  ]

  const warnings = []
  if (photos.length < 2) warnings.push('Only one photo provided — multi-angle increases accuracy')
  if (scaleRefNorm < 0.02) warnings.push('Scale reference points are very close together — calibrate for better results')
  if (height_ft < 2) warnings.push('Estimated height is very low — check landmark placement')
  if (height_ft > 300) warnings.push('Estimated height is unrealistically large — check scale calibration')

  return {
    species_guess,
    species_confidence,
    health_status,
    health_confidence,
    dbh_in,
    height_ft,
    canopy_width_ft,
    age_class,
    confidence_overall,
    assumptions,
    warnings,
  }
}
