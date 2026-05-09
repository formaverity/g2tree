import { analyzeImage } from './visionAnalysis'
import { runSAM, isSAMUnavailable } from './ai/sam'
import { maskToAnnotations } from './ai/structureFromMask'

/**
 * Derives annotation geometry from a tree photo URL.
 *
 * Pipeline:
 *   1. SAM2 / EfficientSAM (if models present) → maskToAnnotations
 *   2. Heuristic canvas analysis fallback → visionAnalysis
 *
 * Returns normalized (0–1) annotation structures for SVG overlay rendering,
 * or null on total failure.
 *
 * @param {string} imageUrl — blob: or data: URL
 * @param {{ x: number, y: number } | null} [promptPoint] — normalized trunk point
 *        for SAM. Derived from scale anchor handles when available.
 */
export async function analyzeTreeImage(imageUrl, promptPoint = null) {
  // ── Attempt 1: SAM-based mask extraction ─────────────────────────────────────
  if (!isSAMUnavailable()) {
    try {
      const pt     = promptPoint ?? { x: 0.5, y: 0.6 }
      const result = await runSAM(imageUrl, pt)

      if (result) {
        const annotations = maskToAnnotations(result.mask, result.width, result.height)
        if (annotations.treeOutline.length >= 4) {
          return {
            ...annotations,
            confidence: 0.85,
            source:     'sam',
            notes:      [],
          }
        }
      }
    } catch {
      // fall through
    }
  }

  // ── Attempt 2: Heuristic canvas pixel analysis ─────────────────────────────
  return _heuristicAnalysis(imageUrl)
}

async function _heuristicAnalysis(imageUrl) {
  try {
    const a = await analyzeImage(imageUrl)
    const { subjectBounds: sb, canopyEllipse: ce, trunkLine: tl } = a

    const tx   = tl.x1
    const tTop = tl.y1
    const tBot = tl.y2

    const treeOutline = [
      { x: sb.x,                    y: Math.min(tBot + 0.04, 0.98) },
      { x: sb.x,                    y: sb.y + sb.height * 0.40     },
      { x: sb.x + sb.width * 0.12,  y: sb.y                        },
      { x: tx,                       y: Math.max(sb.y - 0.02, 0.01)},
      { x: sb.x + sb.width * 0.88,  y: sb.y                        },
      { x: sb.x + sb.width,         y: sb.y + sb.height * 0.40     },
      { x: sb.x + sb.width,         y: Math.min(tBot + 0.04, 0.98) },
    ]

    const { cx, cy, rx, ry } = ce
    const crownOutline = Array.from({ length: 9 }, (_, i) => {
      const angle = (i / 9) * Math.PI * 2 - Math.PI / 2
      return {
        x: Math.max(0, Math.min(1, cx + Math.cos(angle) * rx)),
        y: Math.max(0, Math.min(1, cy + Math.sin(angle) * ry)),
      }
    })

    const trunkLine = [
      { x: tx, y: tTop },
      { x: tx, y: tTop + (tBot - tTop) * 0.5 },
      { x: tx, y: tBot },
    ]

    const crownL = sb.x
    const crownR = sb.x + sb.width
    const primaryBranches = Array.from({ length: 5 }, (_, i) => {
      const t    = i / 4
      const side = i % 2 === 0 ? -1 : 1
      const sY   = tTop + (tBot - tTop) * (0.12 + t * 0.36)
      const reach = 0.65 + t * 0.25
      const eX   = side < 0
        ? Math.max(crownL, tx - (tx - crownL) * reach)
        : Math.min(crownR, tx + (crownR - tx) * reach)
      const eY   = sb.y + (cy - sb.y) * (0.45 + t * 0.45)
      const mX   = (tx + eX) / 2 + side * 0.01
      const mY   = (sY + eY) / 2 - 0.025
      return [
        { x: clamp(tx),  y: clamp(sY)  },
        { x: clamp(mX),  y: clamp(mY)  },
        { x: clamp(eX),  y: clamp(eY)  },
      ]
    })

    const confidence = a.canopyDensity > 0.12 ? 0.65 : 0.30

    return {
      treeOutline,
      crownOutline,
      trunkLine,
      primaryBranches,
      canopyEllipse: { cx, cy, rx, ry },
      subjectBounds: sb,
      confidence,
      source: 'heuristic',
      notes:  confidence < 0.4 ? ['Low vegetation signal — adjust the outline manually'] : [],
    }
  } catch {
    return null
  }
}

function clamp(v) { return Math.max(0, Math.min(1, v)) }
