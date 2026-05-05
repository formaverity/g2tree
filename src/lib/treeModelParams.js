/**
 * Convert tree estimates + structure hints into procedural 3D model parameters.
 * All geometry is normalized — trunk height = 1.0 unit.
 */
export function buildTreeModelParams(estimates, treeStructureHints = {}) {
  const {
    height_ft       = 30,
    canopy_width_ft = 20,
    dbh_in          = 8,
    age_class       = 'mid-age',
    health_status   = 'unknown',
  } = estimates || {}

  const {
    trunkForm: rawTrunkForm = 'unknown',
    trunkCount              = 1,
    branchDensity           = 'medium',
    canopyDistribution      = 'medium',
    leafDistribution        = 'clustered',
  } = treeStructureHints || {}

  // 'unknown' renders as single — safe default
  const trunkForm = rawTrunkForm === 'unknown' ? 'single' : rawTrunkForm

  // ── Normalized trunk geometry ─────────────────────────────────────────────
  const canopyRatio      = canopy_width_ft / Math.max(height_ft, 1)
  const trunkRadiusRatio = (dbh_in / 12) / Math.max(height_ft, 1)

  const trunkHeight     = 1.0
  const trunkRadiusBase = Math.max(0.025, trunkRadiusRatio)
  const trunkRadiusTop  = trunkRadiusBase * 0.42
  const canopyRadius    = Math.max(0.3, canopyRatio * 0.5)
  const canopyYOffset   = trunkHeight * 0.72

  // ── Branch counts ─────────────────────────────────────────────────────────
  const ageBonus = age_class === 'young' ? 0 : age_class === 'mid-age' ? 1 : 2

  const primaryBranchCount = (
    branchDensity === 'low'  ? 4 :
    branchDensity === 'high' ? 9 : 6
  ) + ageBonus

  const secondaryBranchCount =
    branchDensity === 'low'  ? 1 :
    branchDensity === 'high' ? 3 : 2

  const leafClustersPerTip =
    leafDistribution === 'sparse'      ? 1 :
    leafDistribution === 'outer_shell' ? 1 : 2

  const leafClusterRadius = canopyRadius * 0.22
  const branchLength      = trunkHeight * 0.28 * canopyRatio

  // ── Canopy density by health ──────────────────────────────────────────────
  const healthDensity =
    health_status === 'good' ? 1.0 :
    health_status === 'fair' ? 0.65 :
    health_status === 'poor' ? 0.35 : 0.8

  const distributionMod =
    canopyDistribution === 'sparse' ? 0.55 :
    canopyDistribution === 'dense'  ? 1.3  : 1.0

  const canopyDensity = healthDensity * distributionMod

  const canopyColor =
    health_status === 'good' ? '#3d7a4a' :
    health_status === 'fair' ? '#6b8c3e' :
    health_status === 'poor' ? '#8c7a3e' : '#4a7a52'

  const trunkColor = '#5c4033'

  // Legacy fields retained for any external consumers
  const branchLevels = age_class === 'young' ? 1 : age_class === 'mid-age' ? 2 : 3
  const branchCount  = primaryBranchCount

  return {
    trunkHeight,
    trunkRadiusBase,
    trunkRadiusTop,
    canopyRadius,
    canopyYOffset,
    branchLength,
    branchLevels,
    branchCount,
    primaryBranchCount,
    secondaryBranchCount,
    leafClustersPerTip,
    leafClusterRadius,
    canopyDensity,
    canopyColor,
    trunkColor,
    trunkForm,
    trunkCount: Math.max(1, Math.min(5, trunkCount || 1)),
    leafDistribution,
    canopyDistribution,
  }
}
