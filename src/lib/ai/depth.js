/**
 * Depth Anything V2 wrapper — refactored from lib/depthEstimation.js.
 * The original file is kept as a re-export for backward compatibility.
 *
 * Model: /public/models/depth-anything-v2-small/model.onnx
 */

export {
  loadDepthModel,
  estimateDepth,
  isDepthAvailable,
  isDepthUnavailable,
} from '../depthEstimation'

/**
 * Sample depth values at a set of normalized (0–1) points from a depth map.
 *
 * @param {Float32Array} depthMap   — normalized 0–1 depth values, length = w * h
 * @param {number}       mapW
 * @param {number}       mapH
 * @param {{ x: number, y: number }[]} points — normalized image coords
 * @returns {number[]}  depth values at each point
 */
export function sampleDepthAtPoints(depthMap, mapW, mapH, points) {
  return points.map(({ x, y }) => {
    const px = Math.round(Math.max(0, Math.min(1, x)) * (mapW - 1))
    const py = Math.round(Math.max(0, Math.min(1, y)) * (mapH - 1))
    return depthMap[py * mapW + px] ?? 0
  })
}

/**
 * Estimate crown horizontal extent using depth.
 *
 * Given the crown envelope polygon, samples depth at each vertex.
 * Finds the lateral extents (leftmost, rightmost) at approximately the same
 * depth plane as the trunk (dbhPoint). Returns a corrected width multiplier.
 *
 * @param {Float32Array} depthMap
 * @param {number} mapW
 * @param {number} mapH
 * @param {{ x: number, y: number }[]} crownPolygon
 * @param {{ x: number, y: number }} dbhPoint — reference depth anchor
 * @returns {number} correctionFactor — multiply pixel crown width by this for real-world
 */
export function estimateCrownDepthCorrection(depthMap, mapW, mapH, crownPolygon, dbhPoint) {
  if (!crownPolygon?.length || !dbhPoint) return 1

  const refDepth   = sampleDepthAtPoints(depthMap, mapW, mapH, [dbhPoint])[0]
  const crownDepths = sampleDepthAtPoints(depthMap, mapW, mapH, crownPolygon)

  // Average crown depth relative to reference
  const avgCrownDepth = crownDepths.reduce((s, d) => s + d, 0) / crownDepths.length

  // If crown is shallower (closer) than trunk reference, it's wider than it appears
  // If deeper (farther), it's narrower. Simple linear correction:
  const correction = refDepth > 0.01 ? avgCrownDepth / refDepth : 1
  return Math.max(0.5, Math.min(2.0, correction))
}
