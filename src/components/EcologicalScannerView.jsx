import { useState, useEffect, useRef, useMemo, Suspense } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { ArrowLeft, ArrowRight, RotateCcw } from 'lucide-react'
import * as THREE from 'three'
import useTreeSession from '../state/useTreeSession'
import { photoToProceduralParams } from '../lib/photoToProceduralParams'
import { buildTreeModelParams } from '../lib/treeModelParams'
import { loadTextureSafe } from '../lib/threeTextureUtils'
import { ProceduralTree } from './TreePreview'
import PreviewErrorBoundary from './PreviewErrorBoundary'
import SaveTreeButton from './SaveTreeButton'

// ── Constants ─────────────────────────────────────────────────────────────────

const MODES = ['PHOTO', 'MASK', 'DEPTH', 'SKELETON', 'CLONE']
const isMobile = typeof window !== 'undefined' && window.innerWidth < 768

// ── Pixel utilities ────────────────────────────────────────────────────────────

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else                h = ((r - g) / d + 4) / 6
  return [h * 360, s, l]
}

// Returns: 0=sky  1=foliage  2=trunk  3=other
function classifyPixel(h, s, l) {
  if ((l > 0.52 && s < 0.38 && h > 170 && h < 275) || (l > 0.82 && s < 0.22)) return 0
  if (h > 55 && h < 168 && s > 0.10 && l > 0.04 && l < 0.78) return 1
  if (s < 0.28 && l > 0.08 && l < 0.68) return 2
  return 3
}

// RGBA for each class
const MASK_RGBA = [
  [80,  160, 215, 155],  // sky — cool blue
  [75,  200, 100, 165],  // foliage — green
  [210, 145,  65, 165],  // trunk — amber
  [0,     0,   0,   0],  // other — transparent
]

async function generateMaskDataUrl(imageUrl) {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const W = 160, H = Math.round(160 * img.naturalHeight / img.naturalWidth)
      const src_c = document.createElement('canvas')
      src_c.width = W; src_c.height = H
      const sx = src_c.getContext('2d')
      sx.drawImage(img, 0, 0, W, H)
      const src = sx.getImageData(0, 0, W, H).data

      const dst = new Uint8ClampedArray(W * H * 4)
      let counts = [0, 0, 0, 0]
      for (let i = 0; i < W * H; i++) {
        const [hh, ss, ll] = rgbToHsl(src[i*4], src[i*4+1], src[i*4+2])
        const cls = classifyPixel(hh, ss, ll)
        counts[cls]++
        const col = MASK_RGBA[cls]
        dst[i*4]=col[0]; dst[i*4+1]=col[1]; dst[i*4+2]=col[2]; dst[i*4+3]=col[3]
      }
      const total = W * H
      const pct = counts.map(c => Math.round(c / total * 100))

      const out = document.createElement('canvas')
      out.width = W; out.height = H
      out.getContext('2d').putImageData(new ImageData(dst, W, H), 0, 0)
      resolve({ url: out.toDataURL(), pct })  // pct: [sky%, foliage%, trunk%, other%]
    }
    img.onerror = () => resolve(null)
    img.src = imageUrl
  })
}

// ── Depth utilities ────────────────────────────────────────────────────────────

function turboColor(t) {
  t = Math.max(0, Math.min(1, t))
  const r = Math.round(255 * Math.max(0, Math.min(1,
    t < 0.25 ? 0.18 + 3.20*t : t < 0.50 ? 1.0 : t < 0.75 ? 2.0 - 2.1*t : Math.max(0, 0.48 - 0.48*(t-0.75)*4)
  )))
  const g = Math.round(255 * Math.max(0, Math.min(1,
    t < 0.25 ? 3.8*t : t < 0.55 ? 0.95 : t < 0.80 ? 2.4 - 2.4*(t-0.55)/0.25 : Math.max(0, 0.9*(1-(t-0.80)/0.20))
  )))
  const b = Math.round(255 * Math.max(0, Math.min(1,
    t < 0.30 ? 0.55 - 1.0*t : t < 0.55 ? 0.25 + 2.6*(t-0.30) : t < 0.75 ? 0.90 - 2.0*(t-0.55) : 0.50
  )))
  return [r, g, b]
}

function renderDepthToCanvas(grid, gw, gh, canvas, W, H) {
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(W, H)
  const d   = img.data
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const gx = (px / (W - 1)) * (gw - 1), gy = (py / (H - 1)) * (gh - 1)
      const gxi = Math.floor(gx), gyi = Math.floor(gy)
      const gxf = gx - gxi, gyf = gy - gyi
      const v = (grid[gyi*gw + gxi]       * (1-gxf)*(1-gyf) +
                 grid[gyi*gw + Math.min(gxi+1,gw-1)] * gxf*(1-gyf) +
                 grid[Math.min(gyi+1,gh-1)*gw + gxi] * (1-gxf)*gyf +
                 grid[Math.min(gyi+1,gh-1)*gw + Math.min(gxi+1,gw-1)] * gxf*gyf)
      const [r, g, b] = turboColor(1 - v) // invert: larger=closer
      const pi = (py * W + px) * 4
      d[pi]=r; d[pi+1]=g; d[pi+2]=b; d[pi+3]=215
    }
  }
  ctx.putImageData(img, 0, 0)
}

// Marching squares iso-contour paths (returns SVG path data string in 0-1 space)
function isoContourPath(grid, gw, gh, level) {
  const segs = []
  for (let gy = 0; gy < gh - 1; gy++) {
    for (let gx = 0; gx < gw - 1; gx++) {
      const v00=grid[gy*gw+gx], v10=grid[gy*gw+(gx+1)], v01=grid[(gy+1)*gw+gx], v11=grid[(gy+1)*gw+(gx+1)]
      const c = ((v00>=level?1:0)<<3)|((v10>=level?1:0)<<2)|((v11>=level?1:0)<<1)|(v01>=level?1:0)
      if (c===0||c===15) continue
      const x0=gx/(gw-1), x1=(gx+1)/(gw-1), y0=gy/(gh-1), y1=(gy+1)/(gh-1)
      function li(a,b,va,vb){return a+(b-a)*(level-va)/(vb-va+1e-9)}
      const T=[li(x0,x1,v00,v10),y0], B=[li(x0,x1,v01,v11),y1]
      const L=[x0,li(y0,y1,v00,v01)], R=[x1,li(y0,y1,v10,v11)]
      const s=(a,b)=>segs.push(`M${a[0].toFixed(3)},${a[1].toFixed(3)} L${b[0].toFixed(3)},${b[1].toFixed(3)}`)
      switch(c){
        case 1:case 14:s(L,B);break; case 2:case 13:s(B,R);break
        case 3:case 12:s(L,R);break; case 4:case 11:s(T,R);break
        case 5:s(T,L);s(B,R);break;  case 6:case 9:s(T,B);break
        case 7:case 8:s(T,L);break;  case 10:s(T,R);s(L,B);break
      }
    }
  }
  return segs.join(' ')
}

// Synthetic branch lines for skeleton visualization
function skeletonBranches(tl, ce, n = 7) {
  if (!tl || !ce) return []
  const dx = tl.x2 - tl.x1, dy = tl.y2 - tl.y1
  return Array.from({ length: n }, (_, i) => {
    const t = 0.28 + (i / (n - 1)) * 0.58
    const side = i % 2 === 0 ? 1 : -1
    const taper = 1 - t * 0.35
    const ax = tl.x1 + dx * t, ay = tl.y1 + dy * t
    return {
      x1: ax, y1: ay,
      x2: ax + side * ce.rx * (0.55 + taper * 0.38),
      y2: ay - ce.ry * 0.20 * taper,
      op: 0.35 + taper * 0.30,
      delay: i * 0.06,
    }
  })
}

// ── Three.js helpers for CloneLayer ───────────────────────────────────────────

const Y_UP = new THREE.Vector3(0, 1, 0)
function cylSeg(from, to, r0, r1) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to)
  const dir = b.clone().sub(a), len = dir.length()
  if (len < 0.003) return null
  const mid = a.clone().lerp(b, 0.5)
  return { pos: [mid.x,mid.y,mid.z], q: new THREE.Quaternion().setFromUnitVectors(Y_UP, dir.normalize()), len, r0, r1 }
}
function SegMesh({ seg, color }) {
  return (
    <mesh position={seg.pos} quaternion={seg.q}>
      <cylinderGeometry args={[seg.r0, seg.r1, seg.len, 7, 1]} />
      <meshStandardMaterial color={color} roughness={0.92} />
    </mesh>
  )
}

// ── Photo overlay (PHOTO mode) ────────────────────────────────────────────────

function PhotoOverlay({ va, metrics }) {
  const sb  = va?.subjectBounds
  const tl  = va?.trunkLine
  const ce  = va?.canopyEllipse
  const hM  = metrics?.overrides?.heightM    ?? metrics?.heightM
  const dCm = metrics?.overrides?.dbhCm      ?? metrics?.dbhCm
  const cM  = metrics?.overrides?.crownSpreadM ?? metrics?.crownSpreadM

  return (
    <svg className="esv-svg-overlay" viewBox="0 0 1 1" preserveAspectRatio="xMidYMid slice">
      {/* Fine analysis grid */}
      <defs>
        <pattern id="esv-grid" width="0.1" height="0.1" patternUnits="userSpaceOnUse">
          <path d="M0.1,0 L0,0 L0,0.1" fill="none" stroke="var(--green-dim)" strokeWidth="0.003" opacity="0.22" />
        </pattern>
        <filter id="esv-glow">
          <feGaussianBlur stdDeviation="0.006" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <rect width="1" height="1" fill="url(#esv-grid)" />

      {/* Subject bounds corner brackets */}
      {sb && (() => {
        const { x, y, width: w, height: h } = sb
        const r = 0.03  // bracket arm length
        const corners = [[x,y,r,0,0,r],[x+w,y,-r,0,0,r],[x,y+h,r,0,0,-r],[x+w,y+h,-r,0,0,-r]]
        return corners.map(([cx,cy,ax,ay,bx,by],i) => (
          <g key={i} stroke="#8fd49c" strokeWidth="0.005" fill="none" opacity="0.70">
            <line x1={cx} y1={cy} x2={cx+ax} y2={cy+ay} />
            <line x1={cx} y1={cy} x2={cx+bx} y2={cy+by} />
          </g>
        ))
      })()}

      {/* Trunk line */}
      {tl && <line x1={tl.x1} y1={tl.y1} x2={tl.x2} y2={tl.y2} stroke="#d4b35a" strokeWidth="0.006" opacity="0.50" strokeLinecap="round" filter="url(#esv-glow)" />}

      {/* Canopy ellipse */}
      {ce && <ellipse cx={ce.cx} cy={ce.cy} rx={ce.rx} ry={ce.ry} fill="none" stroke="#8fd49c" strokeWidth="0.005" strokeDasharray="0.02 0.01" opacity="0.55" />}

      {/* Measurement glyphs */}
      {tl && hM != null && sb && (
        <g fill="#d4b35a" stroke="#d4b35a" fontSize="0.032" fontFamily="Inter, system-ui" fontWeight="600">
          {/* Height arrow — left of subject */}
          <line x1={sb.x-0.055} y1={ce ? ce.cy-ce.ry : sb.y} x2={sb.x-0.055} y2={tl.y1} strokeWidth="0.004" />
          <polygon points={`${sb.x-0.055},${ce ? ce.cy-ce.ry : sb.y} ${sb.x-0.065},${(ce ? ce.cy-ce.ry : sb.y)+0.02} ${sb.x-0.045},${(ce ? ce.cy-ce.ry : sb.y)+0.02}`} />
          <polygon points={`${sb.x-0.055},${tl.y1} ${sb.x-0.065},${tl.y1-0.02} ${sb.x-0.045},${tl.y1-0.02}`} />
          <text x={sb.x-0.075} y={(tl.y1 + (ce ? ce.cy-ce.ry : sb.y)) / 2 + 0.012} textAnchor="end" fill="#d4b35a" fontSize="0.030">{hM.toFixed(1)} m</text>
        </g>
      )}

      {/* Crown span bracket */}
      {ce && cM != null && (
        <g stroke="#8fd49c" strokeWidth="0.004" fill="none">
          <line x1={ce.cx-ce.rx} y1={ce.cy-ce.ry-0.04} x2={ce.cx+ce.rx} y2={ce.cy-ce.ry-0.04} />
          <line x1={ce.cx-ce.rx} y1={ce.cy-ce.ry-0.06} x2={ce.cx-ce.rx} y2={ce.cy-ce.ry-0.02} />
          <line x1={ce.cx+ce.rx} y1={ce.cy-ce.ry-0.06} x2={ce.cx+ce.rx} y2={ce.cy-ce.ry-0.02} />
          <text x={ce.cx} y={ce.cy-ce.ry-0.065} textAnchor="middle" fill="#8fd49c" stroke="none" fontSize="0.028" fontFamily="Inter, system-ui" fontWeight="600">{cM.toFixed(1)} m</text>
        </g>
      )}

      {/* DBH circle */}
      {tl && dCm != null && (() => {
        const r = Math.max(0.018, 0.022)
        return (
          <g>
            <circle cx={tl.x1} cy={tl.y1} r={r} fill="none" stroke="#d4b35a" strokeWidth="0.005" opacity="0.70" />
            <text x={tl.x1+r+0.015} y={tl.y1+0.010} fill="#d4b35a" fontSize="0.026" fontFamily="Inter, system-ui" fontWeight="600">⌀ {dCm.toFixed(0)} cm</text>
          </g>
        )
      })()}
    </svg>
  )
}

// ── Mask overlay (MASK mode) ──────────────────────────────────────────────────

function MaskOverlay({ maskData }) {
  if (!maskData) {
    return (
      <div className="esv-placeholder">
        <span className="esv-placeholder-dot" />
        <span>Classifying…</span>
      </div>
    )
  }
  return (
    <>
      <img src={maskData.url} className="esv-mask-canvas" alt="" aria-hidden />
      <svg className="esv-svg-overlay esv-svg-contour" viewBox="0 0 1 1" preserveAspectRatio="xMidYMid slice">
        {/* Subtle grid over mask */}
        <rect width="1" height="1" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="0.001" />
      </svg>
    </>
  )
}

// ── Depth overlay (DEPTH mode) ────────────────────────────────────────────────

function DepthOverlayLayer({ visionDepth }) {
  const canvasRef = useRef()
  const W = 256, H = 192

  const contours = useMemo(() => {
    if (!visionDepth?.grid) return []
    const { grid, width: gw = 32, height: gh = 32 } = visionDepth
    return [0.20, 0.35, 0.50, 0.65, 0.80].map((level, i) => ({
      d:     isoContourPath(grid, gw, gh, level),
      color: `rgb(${turboColor(1 - level).join(',')})`,
      dash:  `${0.015 + i * 0.003} ${0.008}`,
    }))
  }, [visionDepth])

  useEffect(() => {
    if (!visionDepth?.grid || !canvasRef.current) return
    const { grid, width: gw = 32, height: gh = 32 } = visionDepth
    renderDepthToCanvas(grid, gw, gh, canvasRef.current, W, H)
  }, [visionDepth])

  if (!visionDepth?.grid) {
    return (
      <div className="esv-placeholder esv-placeholder--depth">
        <span className="esv-placeholder-dot esv-placeholder-dot--depth" />
        <span>Depth estimation unavailable</span>
        <span className="esv-placeholder-sub">Place model.onnx in /public/models/depth-anything-v2-small/</span>
      </div>
    )
  }

  return (
    <>
      <canvas ref={canvasRef} width={W} height={H} className="esv-depth-canvas" />
      <svg className="esv-svg-overlay" viewBox="0 0 1 1" preserveAspectRatio="xMidYMid slice">
        <defs>
          {contours.map((c, i) => (
            <filter key={i} id={`esv-depth-glow-${i}`}>
              <feGaussianBlur stdDeviation="0.004" result="b"/>
              <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          ))}
        </defs>
        {contours.map((c, i) => c.d && (
          <path
            key={i}
            d={c.d}
            fill="none"
            stroke={c.color}
            strokeWidth="0.006"
            strokeDasharray={c.dash}
            opacity="0.72"
            className="esv-contour-path"
            style={{ animationDelay: `${i * 0.3}s` }}
          />
        ))}
      </svg>
    </>
  )
}

// ── Skeleton overlay (SKELETON mode) ─────────────────────────────────────────

function SkeletonOverlay({ va, metrics }) {
  const tl = va?.trunkLine
  const ce = va?.canopyEllipse
  const sb = va?.subjectBounds
  const hM  = metrics?.overrides?.heightM    ?? metrics?.heightM
  const dCm = metrics?.overrides?.dbhCm      ?? metrics?.dbhCm
  const cM  = metrics?.overrides?.crownSpreadM ?? metrics?.crownSpreadM
  const branches = useMemo(() => skeletonBranches(tl, ce), [tl, ce])

  return (
    <svg className="esv-svg-overlay" viewBox="0 0 1 1" preserveAspectRatio="xMidYMid slice">
      <defs>
        <filter id="skel-glow-amber">
          <feGaussianBlur stdDeviation="0.007" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="skel-glow-green">
          <feGaussianBlur stdDeviation="0.005" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        {/* Subtle fine grid */}
        <pattern id="skel-grid" width="0.05" height="0.05" patternUnits="userSpaceOnUse">
          <path d="M0.05,0 L0,0 L0,0.05" fill="none" stroke="#4a7a52" strokeWidth="0.002" opacity="0.30" />
        </pattern>
      </defs>
      <rect width="1" height="1" fill="url(#skel-grid)" />

      {/* Branch skeleton lines */}
      {branches.map((b, i) => (
        <line
          key={i}
          x1={b.x1} y1={b.y1} x2={b.x2} y2={b.y2}
          stroke="#6aab74" strokeWidth="0.006" strokeLinecap="round"
          opacity={b.op}
          className="esv-skel-branch"
          style={{ animationDelay: `${b.delay}s` }}
        />
      ))}

      {/* Canopy ellipse */}
      {ce && (
        <>
          <ellipse cx={ce.cx} cy={ce.cy} rx={ce.rx} ry={ce.ry}
            fill="rgba(143,212,156,0.05)" stroke="#8fd49c" strokeWidth="0.007"
            strokeDasharray="0.025 0.012" opacity="0.80" filter="url(#skel-glow-green)"
            className="esv-skel-ellipse" />
          <circle cx={ce.cx} cy={ce.cy} r="0.012" fill="#8fd49c" opacity="0.70" />
        </>
      )}

      {/* Trunk axis */}
      {tl && (
        <>
          <line x1={tl.x1} y1={tl.y1} x2={tl.x2} y2={tl.y2}
            stroke="#d4b35a" strokeWidth="0.010" strokeLinecap="round"
            opacity="0.90" filter="url(#skel-glow-amber)"
            className="esv-skel-trunk" />
          <circle cx={tl.x1} cy={tl.y1} r="0.016" fill="none" stroke="#d4b35a" strokeWidth="0.006" opacity="0.80" />
          <circle cx={tl.x2} cy={tl.y2} r="0.008" fill="#d4b35a" opacity="0.70" />
        </>
      )}

      {/* Subject bounding box */}
      {sb && (() => {
        const { x, y, width: w, height: h } = sb
        const arm = 0.04
        const corners = [[x,y,arm,0,0,arm],[x+w,y,-arm,0,0,arm],[x,y+h,arm,0,0,-arm],[x+w,y+h,-arm,0,0,-arm]]
        return corners.map(([cx,cy,ax,ay,bx,by],i) => (
          <g key={i} stroke="#4a7a52" strokeWidth="0.005" fill="none" opacity="0.60">
            <line x1={cx} y1={cy} x2={cx+ax} y2={cy+ay}/>
            <line x1={cx} y1={cy} x2={cx+bx} y2={cy+by}/>
          </g>
        ))
      })()}

      {/* Measurement annotations */}
      {tl && hM != null && (
        <g fill="#d4b35a" fontFamily="Inter, system-ui" fontWeight="700" fontSize="0.034">
          {/* Height label on trunk */}
          <rect x={tl.x2+0.015} y={tl.y2-0.005} width="0.12" height="0.038" rx="0.008" fill="rgba(7,13,8,0.82)" />
          <text x={tl.x2+0.022} y={tl.y2+0.022}>{hM.toFixed(1)} m</text>
        </g>
      )}
      {tl && dCm != null && (
        <g fill="#d4b35a" fontFamily="Inter, system-ui" fontWeight="700" fontSize="0.030">
          <rect x={tl.x1+0.028} y={tl.y1-0.022} width="0.115" height="0.035" rx="0.007" fill="rgba(7,13,8,0.82)" />
          <text x={tl.x1+0.035} y={tl.y1-0.004}>⌀ {dCm.toFixed(0)} cm</text>
        </g>
      )}
      {ce && cM != null && (
        <g fill="#8fd49c" fontFamily="Inter, system-ui" fontWeight="700" fontSize="0.028" stroke="none">
          <rect x={ce.cx-0.065} y={ce.cy-ce.ry-0.086} width="0.130" height="0.033" rx="0.007" fill="rgba(7,13,8,0.82)" />
          <text x={ce.cx} y={ce.cy-ce.ry-0.065} textAnchor="middle">{cM.toFixed(1)} m crown</text>
        </g>
      )}
    </svg>
  )
}

// ── Clone layer (CLONE mode) ──────────────────────────────────────────────────

function ScaffoldCloneScene({ scaffoldGeometry, params }) {
  const geo = useMemo(() => {
    if (!scaffoldGeometry) return null
    const trunks = [], branches = []
    const { trunkCurve, branchSegments } = scaffoldGeometry
    if (trunkCurve?.length > 1) {
      for (let i = 0; i < trunkCurve.length - 1; i++) {
        const a = trunkCurve[i], b = trunkCurve[i+1]
        const seg = cylSeg([a.x,a.y,a.z],[b.x,b.y,b.z], a.r ?? params.trunkRadiusBase, b.r ?? params.trunkRadiusTop)
        if (seg) trunks.push(seg)
      }
    } else {
      const seg = cylSeg([0,0,0],[0,params.trunkHeight,0], params.trunkRadiusBase, params.trunkRadiusTop)
      if (seg) trunks.push(seg)
    }
    for (const att of (branchSegments ?? [])) {
      const seg = cylSeg(att.start, att.end, att.r0 ?? 0.025, att.r1 ?? 0.012)
      if (seg) branches.push(seg)
    }
    return { trunks, branches }
  }, [scaffoldGeometry, params])

  if (!geo) return null
  const leaves = scaffoldGeometry?.leafInstances ?? []
  const lean   = params.trunkLean ?? 0

  return (
    <group rotation={[0, 0, lean]}>
      <group position={[0, -params.trunkHeight / 2, 0]}>
        {geo.trunks.map((s,i) => <SegMesh key={`t${i}`} seg={s} color={params.trunkColor} />)}
        {geo.branches.map((s,i) => <SegMesh key={`b${i}`} seg={s} color={params.trunkColor} />)}
        {leaves.length > 0 && (
          <instancedMesh args={[undefined, undefined, leaves.length]}>
            <planeGeometry args={[1,1]}/>
            <meshStandardMaterial color={params.canopyColor} side={THREE.DoubleSide} transparent opacity={params.canopyDensity * 0.86} alphaTest={0} depthWrite={false} roughness={0.86}/>
          </instancedMesh>
        )}
        <mesh rotation={[-Math.PI/2,0,0]} position={[0,0.002,0]}>
          <circleGeometry args={[params.canopyRadius * 0.52, 24]}/>
          <meshStandardMaterial color="#1b2e1d" transparent opacity={0.28}/>
        </mesh>
      </group>
    </group>
  )
}

function CloneLayer({ params, scaffoldGeometry }) {
  const hasScaffold = !!scaffoldGeometry
  return (
    <PreviewErrorBoundary>
      <Canvas
        style={{ width:'100%', height:'100%' }}
        camera={{ position: [1.6, 1.0, 1.6], fov: 46 }}
        gl={{ antialias: !isMobile, alpha: true }}
      >
        <color attach="background" args={['#070d08']} />
        <ambientLight intensity={0.48} />
        <directionalLight position={[3, 6, 4]} intensity={1.15} />
        <directionalLight position={[-2, 1.5, -2]} intensity={0.28} />
        <Suspense fallback={null}>
          {hasScaffold ? (
            <ScaffoldCloneScene scaffoldGeometry={scaffoldGeometry} params={params} />
          ) : (
            <ProceduralTree params={params} mode={isMobile ? 'structured' : 'structured'} />
          )}
        </Suspense>
        <OrbitControls enablePan={false} minDistance={0.7} maxDistance={5.5} />
      </Canvas>
    </PreviewErrorBoundary>
  )
}

// ── Scrubber ──────────────────────────────────────────────────────────────────

function ScanScrubber({ modeIdx, onChange }) {
  return (
    <div className="esv-scrubber">
      <div className="esv-scrubber-track" />
      {MODES.map((m, i) => (
        <button
          key={m}
          className={`esv-mode-btn${i === modeIdx ? ' active' : ''}`}
          onClick={() => onChange(i)}
          aria-label={`Switch to ${m} mode`}
        >
          <span className="esv-mode-dot" />
          <span className="esv-mode-label">{m}</span>
        </button>
      ))}
    </div>
  )
}

// ── Mode info panel ────────────────────────────────────────────────────────────

function ModeInfo({ mode, metrics, species, maskData, visionDepth }) {
  const hM  = metrics?.overrides?.heightM    ?? metrics?.heightM
  const dCm = metrics?.overrides?.dbhCm      ?? metrics?.dbhCm
  const cM  = metrics?.overrides?.crownSpreadM ?? metrics?.crownSpreadM

  if (mode === 'PHOTO') return (
    <div className="esv-info-row">
      {species?.common_name
        ? <><span className="esv-info-species">{species.common_name}</span><em className="esv-info-sci">{species.scientific_name}</em></>
        : <span className="esv-info-dim">Species not identified — run AI scan to classify</span>}
    </div>
  )

  if (mode === 'MASK') return (
    <div className="esv-info-row">
      {maskData
        ? <>
            <span className="esv-info-chip esv-info-sky">{maskData.pct[0]}% sky</span>
            <span className="esv-info-chip esv-info-veg">{maskData.pct[1]}% veg</span>
            <span className="esv-info-chip esv-info-trunk">{maskData.pct[2]}% bark</span>
          </>
        : <span className="esv-info-dim">Generating segmentation…</span>}
    </div>
  )

  if (mode === 'DEPTH') return (
    <div className="esv-info-row">
      {visionDepth?.grid
        ? <span className="esv-info-dim">Monocular depth — {visionDepth.width ?? 32}×{visionDepth.height ?? 32} grid · iso-contours at 5 levels</span>
        : <span className="esv-info-dim">Depth unavailable · place ONNX model to enable</span>}
    </div>
  )

  if (mode === 'SKELETON') return (
    <div className="esv-info-row esv-info-metrics">
      {hM  != null && <span className="esv-metric-chip"><span className="esv-mc-label">H</span>{hM.toFixed(1)} m</span>}
      {dCm != null && <span className="esv-metric-chip"><span className="esv-mc-label">DBH</span>{dCm.toFixed(0)} cm</span>}
      {cM  != null && <span className="esv-metric-chip"><span className="esv-mc-label">Crown</span>{cM.toFixed(1)} m</span>}
      {metrics?.healthScore != null && <span className="esv-metric-chip"><span className="esv-mc-label">Health</span>{metrics.healthScore}%</span>}
    </div>
  )

  if (mode === 'CLONE') return (
    <div className="esv-info-row">
      <span className="esv-info-dim">Drag to orbit · pinch to zoom</span>
      {species?.common_name && <span className="esv-info-species esv-info-species--sm">{species.common_name}</span>}
    </div>
  )

  return null
}

// ── Main component ────────────────────────────────────────────────────────────

export default function EcologicalScannerView() {
  const {
    scanState, scaffoldGeometry, textureSamples, setStep,
    estimates, treeStructureHints, speciesAIResult, userHints,
  } = useTreeSession()

  const [modeIdx, setModeIdx] = useState(0)
  const [maskData, setMaskData]   = useState(null)
  const [imgAspect, setImgAspect] = useState(4 / 3)

  const mode = MODES[modeIdx]

  const primaryUrl = scanState?.primaryImage?.url ?? null

  // Compute 3D params from scan data (live-reactive to metric changes)
  const params = useMemo(() => {
    const m = scanState?.estimatedMetrics
    if (m?.dbhCm != null) {
      return photoToProceduralParams({
        speciesResult:    scanState.speciesResult,
        estimatedMetrics: m,
        visionAnalysis:   scanState.visionAnalysis,
        visionDepth:      scanState.visionDepth,
        textureSamples,
      })
    }
    return buildTreeModelParams(
      estimates, treeStructureHints,
      { scientificName: speciesAIResult?.scientific_name ?? '', commonName: speciesAIResult?.common_name ?? userHints?.known_species ?? '' },
      textureSamples,
    )
  }, [scanState, textureSamples, estimates, treeStructureHints, speciesAIResult, userHints])

  // Generate mask lazily on first MASK mode visit
  useEffect(() => {
    if (mode !== 'MASK' || maskData || !primaryUrl) return
    generateMaskDataUrl(primaryUrl).then(setMaskData)
  }, [mode, primaryUrl, maskData])

  // CSS class for photo brightness per mode
  const photoClass = `esv-photo esv-photo--${mode.toLowerCase()}`

  const va      = scanState?.visionAnalysis
  const vDepth  = scanState?.visionDepth
  const metrics = scanState?.estimatedMetrics
  const species = scanState?.speciesResult

  return (
    <motion.div
      className="panel panel-scanner"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
    >
      <div className="panel-body">

        {/* ── Image / canvas area ──────────────────────────────────────── */}
        <div className="esv-image-area" style={{ aspectRatio: imgAspect }}>

          {/* Base photo — brightness changes per mode via CSS class */}
          {primaryUrl && (
            <img
              src={primaryUrl}
              className={photoClass}
              onLoad={e => setImgAspect(e.target.naturalWidth / e.target.naturalHeight)}
              alt=""
              aria-hidden
            />
          )}

          {!primaryUrl && (
            <div className="esv-placeholder">
              <span className="esv-placeholder-dot" />
              <span>No photo captured</span>
            </div>
          )}

          {/* Mode-specific overlay */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={mode}
              className="esv-overlay-wrap"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: mode === 'CLONE' ? 0.35 : 0.20 }}
            >
              {mode === 'PHOTO'    && primaryUrl && <PhotoOverlay va={va} metrics={metrics} />}
              {mode === 'MASK'     && <MaskOverlay maskData={maskData} />}
              {mode === 'DEPTH'    && <DepthOverlayLayer visionDepth={vDepth} />}
              {mode === 'SKELETON' && primaryUrl && <SkeletonOverlay va={va} metrics={metrics} />}
              {mode === 'CLONE'    && <CloneLayer params={params} scaffoldGeometry={scaffoldGeometry} />}
            </motion.div>
          </AnimatePresence>

          {/* Scan sweep (hidden in CLONE) */}
          {mode !== 'CLONE' && primaryUrl && (
            <div className={`esv-sweep esv-sweep--${mode.toLowerCase()}`} />
          )}

          {/* Corner mode label */}
          <div className="esv-mode-badge">{mode}</div>
        </div>

        {/* ── Mode scrubber ────────────────────────────────────────────── */}
        <ScanScrubber modeIdx={modeIdx} onChange={setModeIdx} />

        {/* ── Mode info ───────────────────────────────────────────────── */}
        <div className="esv-info-panel">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={mode}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              <ModeInfo
                mode={mode}
                metrics={metrics}
                species={species}
                maskData={maskData}
                visionDepth={vDepth}
              />
            </motion.div>
          </AnimatePresence>
        </div>

        <SaveTreeButton />

        <div className="panel-footer">
          <button className="btn-back" onClick={() => setStep('materials')}>
            <ArrowLeft size={16} /> Materials
          </button>
          <button className="btn-next" onClick={() => setStep('export')}>
            Export <ArrowRight size={16} />
          </button>
        </div>

      </div>
    </motion.div>
  )
}
