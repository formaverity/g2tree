import { createPortal } from 'react-dom'

const DIAMETER = 120
const RADIUS   = DIAMETER / 2
const ZOOM     = 2.5
const OFFSET_X = 40   // px to the side of the finger
const OFFSET_Y = 80   // px above the finger

/**
 * CSS background-image loupe rendered into a portal.
 *
 * Props:
 *   photoUrl     — src URL of the photo being zoomed
 *   touchX/touchY — viewport-space coordinates of the touch/pointer
 *   imageRect    — DOMRect of the photo element (from getBoundingClientRect)
 *   visible      — whether to render
 */
export default function Loupe({ photoUrl, touchX, touchY, imageRect, visible }) {
  if (!visible || !photoUrl || !imageRect) return null

  // Normalized position within the image (0–1)
  const nx = (touchX - imageRect.left) / imageRect.width
  const ny = (touchY - imageRect.top)  / imageRect.height

  // Background-size at zoom level
  const bgW = imageRect.width  * ZOOM
  const bgH = imageRect.height * ZOOM

  // Background-position: shift so the sampled point lands at loupe center
  const bgX = -(nx * bgW - RADIUS)
  const bgY = -(ny * bgH - RADIUS)

  // Loupe anchor in viewport space (above-left of finger)
  let lx = touchX - OFFSET_X - RADIUS
  let ly = touchY - OFFSET_Y - RADIUS

  // Mirror if it would clip viewport edges
  if (lx < 8) lx = touchX + OFFSET_X - RADIUS
  if (ly < 8) ly = touchY + OFFSET_Y - RADIUS + DIAMETER

  const style = {
    position:          'fixed',
    left:              Math.round(lx),
    top:               Math.round(ly),
    width:             DIAMETER,
    height:            DIAMETER,
    borderRadius:      '50%',
    backgroundImage:   `url(${photoUrl})`,
    backgroundSize:    `${Math.round(bgW)}px ${Math.round(bgH)}px`,
    backgroundPosition:`${Math.round(bgX)}px ${Math.round(bgY)}px`,
    backgroundRepeat:  'no-repeat',
    border:            '1.5px solid rgba(255,255,255,0.55)',
    boxShadow:         '0 2px 14px rgba(0,0,0,0.45)',
    overflow:          'hidden',
    pointerEvents:     'none',
    zIndex:            9999,
    isolation:         'isolate',
  }

  return createPortal(
    <div style={style}>
      {/* Crosshair */}
      <div style={{
        position:   'absolute',
        inset:      0,
        display:    'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}>
        <svg width={20} height={20} viewBox="0 0 20 20" style={{ opacity: 0.65 }}>
          <line x1={10} y1={2}  x2={10} y2={8}  stroke="white" strokeWidth={1} />
          <line x1={10} y1={12} x2={10} y2={18} stroke="white" strokeWidth={1} />
          <line x1={2}  y1={10} x2={8}  y2={10} stroke="white" strokeWidth={1} />
          <line x1={12} y1={10} x2={18} y2={10} stroke="white" strokeWidth={1} />
          <circle cx={10} cy={10} r={1.5} fill="white" />
        </svg>
      </div>
    </div>,
    document.body,
  )
}
