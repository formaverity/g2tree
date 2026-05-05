/**
 * Heuristic tree structure detection from landmark positions.
 * Uses no paid AI — geometry signals only from existing landmark coordinates.
 * Confidence is intentionally low to encourage manual correction.
 *
 * Future work: feed photos to a vision model for real classification.
 */
export async function detectTreeStructureFromPhoto({ photos, landmarks }) {
  const {
    trunk_base  = { x: 0.5,  y: 0.85 },
    trunk_top   = { x: 0.5,  y: 0.35 },
    canopy_left = { x: 0.2,  y: 0.2  },
    canopy_right= { x: 0.8,  y: 0.2  },
    dbh_left    = { x: 0.47, y: 0.70 },
    dbh_right   = { x: 0.53, y: 0.70 },
  } = landmarks || {}

  // ── Trunk form ──────────────────────────────────────────────────────────────
  // Wide DBH relative to trunk height suggests forked or multi-trunk base.
  const dbhWidth       = Math.abs(dbh_right.x - dbh_left.x)
  const trunkHeightN   = Math.abs(trunk_base.y - trunk_top.y)
  const dbhRatio       = dbhWidth / Math.max(trunkHeightN, 0.01)
  const trunkForm      = dbhRatio > 0.28 ? 'forked' : 'single'

  // ── Canopy asymmetry ────────────────────────────────────────────────────────
  const trunkCenterX   = (trunk_base.x + trunk_top.x) / 2
  const canopyCenterX  = (canopy_left.x + canopy_right.x) / 2
  const asymmetryOff   = Math.abs(canopyCenterX - trunkCenterX)

  // ── Canopy density ──────────────────────────────────────────────────────────
  const canopyWidthN   = Math.abs(canopy_right.x - canopy_left.x)
  const canopyRatio    = canopyWidthN / Math.max(trunkHeightN, 0.01)

  const canopyDistribution =
    asymmetryOff > 0.12 ? 'asymmetric' :
    canopyRatio > 1.5   ? 'dense'      :
    canopyRatio < 0.55  ? 'sparse'     : 'medium'

  return {
    trunkForm,
    trunkCount: 1,
    branchDensity: 'medium',
    canopyDistribution,
    leafDistribution: 'clustered',
    detectedStructureConfidence: 0.15,
    notes: [
      'Automatic structure detection is currently heuristic. Manual correction is recommended.',
    ],
  }
}
