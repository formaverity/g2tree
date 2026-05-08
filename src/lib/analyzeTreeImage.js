import { analyzeImage } from './visionAnalysis'

/**
 * Derives annotation geometry from a tree photo URL via canvas pixel analysis.
 * Returns normalized (0–1) annotation structures suitable for SVG overlay rendering.
 *
 * On failure returns null — callers must handle the null case gracefully.
 */
export async function analyzeTreeImage(imageUrl) {
  try {
    const a = await analyzeImage(imageUrl)
    const { subjectBounds: sb, canopyEllipse: ce, trunkLine: tl } = a

    const tx   = tl.x1          // trunk horizontal center
    const tTop = tl.y1          // upper trunk (crown junction)
    const tBot = tl.y2          // trunk base

    // ── Tree outline — 7-point convex polygon ─────────────────────────────────
    const treeOutline = [
      { x: sb.x,                    y: Math.min(tBot + 0.04, 0.98) },
      { x: sb.x,                    y: sb.y + sb.height * 0.40     },
      { x: sb.x + sb.width * 0.12,  y: sb.y                        },
      { x: tx,                       y: Math.max(sb.y - 0.02, 0.01)},
      { x: sb.x + sb.width * 0.88,  y: sb.y                        },
      { x: sb.x + sb.width,         y: sb.y + sb.height * 0.40     },
      { x: sb.x + sb.width,         y: Math.min(tBot + 0.04, 0.98) },
    ]

    // ── Crown outline — ellipse approximated as 9-point polygon ──────────────
    const { cx, cy, rx, ry } = ce
    const crownOutline = Array.from({ length: 9 }, (_, i) => {
      const angle = (i / 9) * Math.PI * 2 - Math.PI / 2
      return {
        x: Math.max(0, Math.min(1, cx + Math.cos(angle) * rx)),
        y: Math.max(0, Math.min(1, cy + Math.sin(angle) * ry)),
      }
    })

    // ── Trunk line — 3 points ─────────────────────────────────────────────────
    const trunkLine = [
      { x: tx, y: tTop },
      { x: tx, y: tTop + (tBot - tTop) * 0.5 },
      { x: tx, y: tBot },
    ]

    // ── Primary branches — 5 polylines radiating from mid-upper trunk ─────────
    const crownL = sb.x
    const crownR = sb.x + sb.width
    const primaryBranches = Array.from({ length: 5 }, (_, i) => {
      const t    = i / 4
      const side = i % 2 === 0 ? -1 : 1   // alternate left / right
      const sY   = tTop + (tBot - tTop) * (0.12 + t * 0.36)  // up to mid-trunk
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
      notes: confidence < 0.4 ? ['Low vegetation signal — check and adjust the outline'] : [],
    }
  } catch {
    return null
  }
}

function clamp(v) { return Math.max(0, Math.min(1, v)) }
