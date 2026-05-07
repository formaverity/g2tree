import { useEffect, useRef, useState } from 'react'

const G_DIM    = 'rgba(106,171,116,0.18)'
const G_MID    = 'rgba(130,210,140,0.55)'
const G_BRIGHT = 'rgba(180,255,190,0.82)'

export default function InterpretationOverlay({ analysis }) {
  const [scanY, setScanY] = useState(0.06)
  const tRef    = useRef(0)
  const frameRef = useRef()

  useEffect(() => {
    function tick() {
      tRef.current += 0.005
      setScanY(0.06 + 0.88 * ((Math.sin(tRef.current) + 1) / 2))
      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameRef.current)
  }, [])

  if (!analysis) return null

  const { subjectBounds: b, canopyEllipse: el, trunkLine: tl, debugOverlayData: d } = analysis

  // Four L-shaped corner brackets around subject bounds
  const L  = Math.min(0.08, b.width * 0.22, b.height * 0.22)
  const corners = [
    // [hStart, hEnd, vStart, vEnd]
    [b.x,           b.x + L,           b.y,            b.y + L           ],  // TL
    [b.x + b.width, b.x + b.width - L, b.y,            b.y + L           ],  // TR
    [b.x,           b.x + L,           b.y + b.height, b.y + b.height - L],  // BL
    [b.x + b.width, b.x + b.width - L, b.y + b.height, b.y + b.height - L],  // BR
  ]

  // Column profile sparkline — mapped to a strip at y 0.90–0.97
  const maxCol = d ? Math.max(...d.columnProfile, 1) : 1
  const colPoints = d
    ? d.columnProfile.map((v, i) => {
        const px = (i / Math.max(d.analysisWidth - 1, 1)).toFixed(4)
        const py = (0.97 - (v / maxCol) * 0.07).toFixed(4)
        return `${px},${py}`
      }).join(' ')
    : ''

  return (
    <svg
      className="interp-overlay"
      viewBox="0 0 1 1"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern id="io-grid" width="0.1" height="0.1" patternUnits="userSpaceOnUse">
          <path d="M 0.1 0 L 0 0 0 0.1" fill="none" stroke={G_DIM} strokeWidth="0.003" />
        </pattern>
        <linearGradient id="io-scan-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={G_BRIGHT} stopOpacity="0"   />
          <stop offset="50%"  stopColor={G_BRIGHT} stopOpacity="0.4" />
          <stop offset="100%" stopColor={G_BRIGHT} stopOpacity="0"   />
        </linearGradient>
      </defs>

      {/* Soft grid */}
      <rect width="1" height="1" fill="url(#io-grid)" />

      {/* Subject bounds — four L-shaped corner brackets */}
      {corners.map(([hx1, hx2, vy, vy2], i) => (
        <g key={i}>
          <line x1={hx1} y1={vy} x2={hx2} y2={vy}  stroke={G_MID} strokeWidth="0.006" strokeLinecap="round" />
          <line x1={hx1} y1={vy} x2={hx1} y2={vy2} stroke={G_MID} strokeWidth="0.006" strokeLinecap="round" />
        </g>
      ))}

      {/* Canopy ellipse — dashed */}
      <ellipse
        cx={el.cx} cy={el.cy} rx={Math.max(el.rx, 0.01)} ry={Math.max(el.ry, 0.01)}
        fill="none"
        stroke={G_BRIGHT}
        strokeWidth="0.004"
        strokeDasharray="0.028 0.014"
        opacity="0.65"
      />

      {/* Trunk axis line with endpoint handles */}
      <line
        x1={tl.x1} y1={tl.y1} x2={tl.x2} y2={tl.y2}
        stroke={G_MID} strokeWidth="0.003" strokeLinecap="round" opacity="0.8"
      />
      <circle cx={tl.x1} cy={tl.y1} r="0.014"
        fill="none" stroke={G_BRIGHT} strokeWidth="0.003" opacity="0.7" />
      <circle cx={tl.x2} cy={tl.y2} r="0.014"
        fill="none" stroke={G_BRIGHT} strokeWidth="0.003" opacity="0.7" />

      {/* Animated scan sweep */}
      <rect x="0" y={scanY - 0.04} width="1" height="0.08" fill="url(#io-scan-grad)" />
      <line
        x1="0" y1={scanY} x2="1" y2={scanY}
        stroke={G_BRIGHT} strokeWidth="0.0025" opacity="0.4"
      />

      {/* Column profile sparkline */}
      {colPoints && (
        <>
          <line x1="0" y1="0.97" x2="1" y2="0.97" stroke={G_DIM} strokeWidth="0.002" opacity="0.5" />
          <polyline
            points={colPoints}
            fill="none"
            stroke={G_MID}
            strokeWidth="0.0025"
            strokeLinejoin="round"
            opacity="0.55"
          />
        </>
      )}
    </svg>
  )
}
