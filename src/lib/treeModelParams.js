/**
 * Convert tree estimates into procedural 3D model parameters.
 * All geometry is normalized — trunk height = 1.0 unit.
 */
export function buildTreeModelParams(estimates) {
  const {
    height_ft = 30,
    canopy_width_ft = 20,
    dbh_in = 8,
    age_class = 'mid-age',
    health_status = 'unknown',
  } = estimates || {}

  // Normalize to trunk height = 1.0
  const canopyRatio = canopy_width_ft / Math.max(height_ft, 1)
  const trunkRadiusRatio = (dbh_in / 12) / Math.max(height_ft, 1)

  const trunkHeight = 1.0
  const trunkRadiusBase = Math.max(0.025, trunkRadiusRatio)
  const trunkRadiusTop = trunkRadiusBase * 0.45
  const canopyRadius = Math.max(0.3, canopyRatio * 0.5)
  const canopyYOffset = trunkHeight * 0.72

  // Branch complexity by age
  const branchLevels = age_class === 'young' ? 1 : age_class === 'mid-age' ? 2 : 3
  const branchCount = age_class === 'young' ? 4 : age_class === 'mid-age' ? 6 : 8
  const branchLength = trunkHeight * 0.3 * canopyRatio

  // Canopy density by health
  const canopyDensity =
    health_status === 'good' ? 1.0 :
    health_status === 'fair' ? 0.65 :
    health_status === 'poor' ? 0.35 : 0.8

  const canopyColor =
    health_status === 'good' ? '#3d7a4a' :
    health_status === 'fair' ? '#6b8c3e' :
    health_status === 'poor' ? '#8c7a3e' : '#4a7a52'

  const trunkColor = '#5c4033'

  return {
    trunkHeight,
    trunkRadiusBase,
    trunkRadiusTop,
    canopyRadius,
    canopyYOffset,
    branchLevels,
    branchCount,
    branchLength,
    canopyDensity,
    canopyColor,
    trunkColor,
  }
}
