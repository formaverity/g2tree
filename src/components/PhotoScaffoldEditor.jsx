import { useEffect, useRef, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowLeft, ArrowRight, GitBranch, Layers, RefreshCw, Trash2, Sliders,
  RotateCcw, CheckCircle2,
} from 'lucide-react'
import useTreeSession from '../state/useTreeSession'
import { analyzeTreePhotoScaffold, defaultTrunkAxis } from '../lib/photoScaffold'
import { analyzeTreeImage } from '../lib/analyzeTreeImage'
import { buildScaffoldCloneGeometry } from '../lib/scaffoldGeometry'
import { buildTreeModelParams } from '../lib/treeModelParams'
import SaveTreeButton from './SaveTreeButton'

// ── Default canopy profile handles (3 per side) ───────────────────────────────

function defaultCanopyProfiles(landmarks) {
  const topY = Math.min(landmarks?.trunk_top?.y ?? 0.30, landmarks?.canopy_left?.y ?? 0.20)
  const botY = landmarks?.trunk_base?.y ?? 0.85
  const midY = topY + (botY - topY) * 0.45
  const lx   = landmarks?.canopy_left?.x  ?? 0.18
  const rx   = landmarks?.canopy_right?.x ?? 0.82
  const tx   = landmarks?.trunk_base?.x   ?? 0.50
  return {
    left: [
      { x: tx - (tx - lx) * 0.55, y: topY + 0.04 },
      { x: lx,                     y: midY         },
      { x: lx + (tx - lx) * 0.20, y: botY - 0.10  },
    ],
    right: [
      { x: tx + (rx - tx) * 0.55, y: topY + 0.04 },
      { x: rx,                     y: midY         },
      { x: rx - (rx - tx) * 0.20, y: botY - 0.10  },
    ],
  }
}

// ── Annotation SVG overlay ────────────────────────────────────────────────────
// Handles 4 annotation modes: outline, crown, trunk, branches.
// All coordinates are normalized 0–1 relative to the natural image dimensions.

function AnnotationSVG({
  natW, natH,
  mode,
  treeOutline,   onUpdateOutline,
  crownOutline,  onUpdateCrown,
  trunkLine,     onUpdateTrunk,
  primaryBranches, onUpdateBranches,
}) {
  const svgRef = useRef(null)
  const [pendingBranch, setPendingBranch] = useState(null)

  const W = natW, H = natH

  function toSVG(e) {
    const svgEl = svgRef.current
    if (!svgEl) return { x: 0.5, y: 0.5 }
    const pt = svgEl.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const local = pt.matrixTransform(svgEl.getScreenCTM().inverse())
    return {
      x: Math.max(0, Math.min(1, local.x / W)),
      y: Math.max(0, Math.min(1, local.y / H)),
    }
  }

  // Drag an existing point in any layer
  function startPointDrag(e, onMove) {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    function mv(me) { me.preventDefault(); onMove(toSVG(me)) }
    function up() {
      svgRef.current?.removeEventListener('pointermove', mv)
      svgRef.current?.removeEventListener('pointerup',   up)
      svgRef.current?.removeEventListener('pointercancel', up)
    }
    svgRef.current?.addEventListener('pointermove',  mv)
    svgRef.current?.addEventListener('pointerup',    up)
    svgRef.current?.addEventListener('pointercancel', up)
  }

  // SVG background tap → add point (outline/crown/trunk) or start branch
  function handleBgDown(e) {
    if (e.target.closest('.annot-handle')) return  // handled by point element
    e.preventDefault()
    const pos = toSVG(e)

    if (mode === 'outline') {
      onUpdateOutline((prev) => [...prev, pos])
    } else if (mode === 'crown') {
      onUpdateCrown((prev) => [...prev, pos])
    } else if (mode === 'trunk') {
      onUpdateTrunk((prev) => [...prev, pos])
    } else if (mode === 'branches') {
      e.currentTarget.setPointerCapture(e.pointerId)
      setPendingBranch({ start: pos, end: pos })
    }
  }

  function handleBgMove(e) {
    if (!pendingBranch) return
    e.preventDefault()
    setPendingBranch((prev) => prev ? { ...prev, end: toSVG(e) } : null)
  }

  function handleBgUp(e) {
    if (!pendingBranch) return
    const end = toSVG(e)
    const dx  = end.x - pendingBranch.start.x
    const dy  = end.y - pendingBranch.start.y
    if (Math.sqrt(dx * dx + dy * dy) > 0.03) {
      const mid = { x: (pendingBranch.start.x + end.x) / 2, y: (pendingBranch.start.y + end.y) / 2 }
      onUpdateBranches((prev) => [...prev, [pendingBranch.start, mid, end]])
    }
    setPendingBranch(null)
  }

  // Render a polyline or closed polygon
  function renderPolyPath(pts, closed) {
    if (pts.length < 2) return ''
    const coords = pts.map((p) => `${p.x * W},${p.y * H}`).join(' ')
    return closed ? coords + ` ${pts[0].x * W},${pts[0].y * H}` : coords
  }

  // Shared handle circle element
  function Handle({ pt, onDragMove, onDelete, active }) {
    return (
      <g
        className="annot-handle"
        style={{ cursor: 'grab' }}
        onPointerDown={(e) => startPointDrag(e, onDragMove)}
        onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete() }}
      >
        <circle
          cx={pt.x * W} cy={pt.y * H}
          r={14} fill="currentColor" fillOpacity={active ? 0.18 : 0.10}
          stroke="none"
        />
        <circle
          cx={pt.x * W} cy={pt.y * H}
          r={4.5}
          fill="currentColor"
          stroke="#12201440"
          strokeWidth={1}
        />
      </g>
    )
  }

  const isActive = (layerMode) => mode === layerMode
  const DIM_OPACITY = 0.35

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      className="scaffold-svg-overlay"
      style={{ touchAction: 'none', cursor: mode === 'branches' ? 'crosshair' : 'crosshair' }}
      onPointerDown={handleBgDown}
      onPointerMove={handleBgMove}
      onPointerUp={handleBgUp}
      onPointerCancel={handleBgUp}
    >
      {/* ── Tree outline ─────────────────────────────────────────────────────── */}
      {treeOutline.length > 1 && (
        <polyline
          points={renderPolyPath(treeOutline, treeOutline.length > 2)}
          fill="#4a8c5a"
          fillOpacity={isActive('outline') ? 0.09 : 0.04}
          stroke="#8fd49c"
          strokeWidth={isActive('outline') ? 1.5 : 0.8}
          strokeDasharray={isActive('outline') ? undefined : '5 4'}
          opacity={isActive('outline') ? 1 : DIM_OPACITY}
          style={{ color: '#8fd49c' }}
        />
      )}
      {treeOutline.length > 2 && isActive('outline') && (
        <line
          x1={treeOutline[treeOutline.length - 1].x * W}
          y1={treeOutline[treeOutline.length - 1].y * H}
          x2={treeOutline[0].x * W}
          y2={treeOutline[0].y * H}
          stroke="#8fd49c" strokeWidth={1} strokeDasharray="4 3" opacity={0.4}
        />
      )}
      {isActive('outline') && treeOutline.map((pt, i) => (
        <g key={i} style={{ color: '#8fd49c' }}>
          <Handle
            pt={pt}
            active
            onDragMove={(pos) => onUpdateOutline((prev) => { const n = [...prev]; n[i] = pos; return n })}
            onDelete={() => onUpdateOutline((prev) => prev.filter((_, j) => j !== i))}
          />
        </g>
      ))}

      {/* ── Crown outline ────────────────────────────────────────────────────── */}
      {crownOutline.length > 1 && (
        <polyline
          points={renderPolyPath(crownOutline, crownOutline.length > 2)}
          fill="#3a6a8a"
          fillOpacity={isActive('crown') ? 0.10 : 0.04}
          stroke="#7ab3d4"
          strokeWidth={isActive('crown') ? 1.5 : 0.8}
          strokeDasharray={isActive('crown') ? undefined : '5 4'}
          opacity={isActive('crown') ? 1 : DIM_OPACITY}
          style={{ color: '#7ab3d4' }}
        />
      )}
      {isActive('crown') && crownOutline.map((pt, i) => (
        <g key={i} style={{ color: '#7ab3d4' }}>
          <Handle
            pt={pt}
            active
            onDragMove={(pos) => onUpdateCrown((prev) => { const n = [...prev]; n[i] = pos; return n })}
            onDelete={() => onUpdateCrown((prev) => prev.filter((_, j) => j !== i))}
          />
        </g>
      ))}

      {/* ── Trunk line ───────────────────────────────────────────────────────── */}
      {trunkLine.length > 1 && (
        <polyline
          points={renderPolyPath(trunkLine, false)}
          fill="none"
          stroke="#c0604a"
          strokeWidth={isActive('trunk') ? 2 : 1}
          opacity={isActive('trunk') ? 0.9 : DIM_OPACITY}
          strokeLinecap="round"
        />
      )}
      {isActive('trunk') && trunkLine.map((pt, i) => (
        <g key={i} style={{ color: '#c0604a' }}>
          <Handle
            pt={pt}
            active
            onDragMove={(pos) => onUpdateTrunk((prev) => { const n = [...prev]; n[i] = pos; return n })}
            onDelete={() => onUpdateTrunk((prev) => prev.filter((_, j) => j !== i))}
          />
        </g>
      ))}
      {trunkLine.length > 0 && (
        <text
          x={trunkLine[0].x * W + 8}
          y={trunkLine[0].y * H - 6}
          fontSize={9}
          fill="#c0604a"
          opacity={isActive('trunk') ? 0.7 : 0.2}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          trunk axis
        </text>
      )}

      {/* ── Primary branches ─────────────────────────────────────────────────── */}
      {primaryBranches.map((branch, bi) => (
        <g key={bi}>
          {branch.length > 1 && (
            <polyline
              points={branch.map((p) => `${p.x * W},${p.y * H}`).join(' ')}
              fill="none"
              stroke="#c8a84a"
              strokeWidth={isActive('branches') ? 1.5 : 0.8}
              opacity={isActive('branches') ? 0.85 : DIM_OPACITY * 0.8}
              strokeLinecap="round"
            />
          )}
          {isActive('branches') && branch.map((pt, pi) => (
            <g key={pi} style={{ color: '#c8a84a' }}>
              <Handle
                pt={pt}
                active
                onDragMove={(pos) =>
                  onUpdateBranches((prev) =>
                    prev.map((b, i) => i === bi ? b.map((p, j) => j === pi ? pos : p) : b)
                  )
                }
                onDelete={() =>
                  onUpdateBranches((prev) => prev.filter((_, i) => i !== bi))
                }
              />
            </g>
          ))}
        </g>
      ))}

      {/* Pending branch while drawing */}
      {pendingBranch && (
        <line
          x1={pendingBranch.start.x * W} y1={pendingBranch.start.y * H}
          x2={pendingBranch.end.x   * W} y2={pendingBranch.end.y   * H}
          stroke="#c8a84a" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.65}
          strokeLinecap="round"
        />
      )}

      {/* Layer label when active */}
      {mode === 'outline' && (
        <text x={8} y={16} fontSize={9} fill="#8fd49c" opacity={0.55}
          style={{ pointerEvents: 'none', userSelect: 'none' }}>
          tree outline
        </text>
      )}
      {mode === 'crown' && (
        <text x={8} y={16} fontSize={9} fill="#7ab3d4" opacity={0.55}
          style={{ pointerEvents: 'none', userSelect: 'none' }}>
          crown
        </text>
      )}
      {mode === 'branches' && (
        <text x={8} y={16} fontSize={9} fill="#c8a84a" opacity={0.55}
          style={{ pointerEvents: 'none', userSelect: 'none' }}>
          primary branch — tap trunk, drag outward
        </text>
      )}
    </svg>
  )
}

// ── Scaffold SVG (existing trunk-axis / canopy-profile / branch-gesture tools) ─

function ScaffoldSVG({
  natW, natH,
  tool,
  trunkPts, onDragTrunk,
  canopyLeft, canopyRight, onDragCanopy,
  branchGestures, pendingBranch,
  onBranchDown, onBranchMove, onBranchUp,
}) {
  const svgRef = useRef(null)

  function toSVG(me) {
    const svgEl = svgRef.current
    if (!svgEl) return { x: 0.5, y: 0.5 }
    const pt = svgEl.createSVGPoint()
    pt.x = me.clientX; pt.y = me.clientY
    const local = pt.matrixTransform(svgEl.getScreenCTM().inverse())
    return {
      x: Math.max(0, Math.min(1, local.x / natW)),
      y: Math.max(0, Math.min(1, local.y / natH)),
    }
  }

  function startDrag(e, onMove) {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    function mv(me) { onMove(toSVG(me)) }
    function up() {
      svgRef.current?.removeEventListener('pointermove', mv)
      svgRef.current?.removeEventListener('pointerup',   up)
    }
    svgRef.current?.addEventListener('pointermove', mv)
    svgRef.current?.addEventListener('pointerup',   up)
  }

  function handleBranchDown(e) {
    if (tool !== 'branch') return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const origin = toSVG(e)
    onBranchDown(origin)
    function mv(me) { onBranchMove(toSVG(me)) }
    function up(me) {
      onBranchUp(toSVG(me))
      svgRef.current?.removeEventListener('pointermove', mv)
      svgRef.current?.removeEventListener('pointerup',   up)
    }
    svgRef.current?.addEventListener('pointermove', mv)
    svgRef.current?.addEventListener('pointerup',   up)
  }

  const W = natW, H = natH

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      className="scaffold-svg-overlay"
      style={{ touchAction: 'none', cursor: tool === 'branch' ? 'crosshair' : 'default' }}
      onPointerDown={tool === 'branch' ? handleBranchDown : undefined}
    >
      {/* Canopy fill */}
      {canopyLeft.length > 1 && canopyRight.length > 1 && (
        <polygon
          points={[
            ...canopyLeft.map((p) => `${p.x * W},${p.y * H}`),
            ...canopyRight.slice().reverse().map((p) => `${p.x * W},${p.y * H}`),
          ].join(' ')}
          fill="#4a8c5a" fillOpacity={0.08} stroke="none"
        />
      )}

      {/* Canopy left profile */}
      {canopyLeft.length > 1 && (
        <polyline
          points={canopyLeft.map((p) => `${p.x * W},${p.y * H}`).join(' ')}
          fill="none" stroke="#8fd49c" strokeWidth={1.5} strokeDasharray="5 3" opacity={0.6}
        />
      )}

      {/* Canopy right profile */}
      {canopyRight.length > 1 && (
        <polyline
          points={canopyRight.map((p) => `${p.x * W},${p.y * H}`).join(' ')}
          fill="none" stroke="#8fd49c" strokeWidth={1.5} strokeDasharray="5 3" opacity={0.6}
        />
      )}

      {/* Canopy handles */}
      {tool === 'canopy' && (
        <>
          {canopyLeft.map((p, i) => (
            <g key={`cl${i}`} style={{ cursor: 'ew-resize' }}
              onPointerDown={(e) => startDrag(e, (pos) => onDragCanopy('left', i, pos))}>
              <circle cx={p.x * W} cy={p.y * H} r={14} fill="#8fd49c" fillOpacity={0.14} />
              <circle cx={p.x * W} cy={p.y * H} r={5}  fill="#8fd49c" stroke="#1a2a1c" strokeWidth={1} />
            </g>
          ))}
          {canopyRight.map((p, i) => (
            <g key={`cr${i}`} style={{ cursor: 'ew-resize' }}
              onPointerDown={(e) => startDrag(e, (pos) => onDragCanopy('right', i, pos))}>
              <circle cx={p.x * W} cy={p.y * H} r={14} fill="#8fd49c" fillOpacity={0.14} />
              <circle cx={p.x * W} cy={p.y * H} r={5}  fill="#8fd49c" stroke="#1a2a1c" strokeWidth={1} />
            </g>
          ))}
        </>
      )}

      {/* Trunk axis */}
      {trunkPts.length > 1 && (
        <polyline
          points={trunkPts.map((p) => `${p.x * W},${p.y * H}`).join(' ')}
          fill="none" stroke="#c0604a" strokeWidth={2} opacity={0.8} strokeLinecap="round"
        />
      )}

      {/* Trunk handles */}
      {tool === 'trunk' && trunkPts.map((p, i) => (
        <g key={i} style={{ cursor: 'grab' }}
          onPointerDown={(e) => startDrag(e, (pos) => onDragTrunk(i, pos))}>
          <circle cx={p.x * W} cy={p.y * H} r={14} fill="#c0604a" fillOpacity={0.16} />
          <circle cx={p.x * W} cy={p.y * H} r={5}  fill="#c0604a" stroke="#1a2a1c" strokeWidth={1} />
        </g>
      ))}

      {/* Committed branch gestures */}
      {branchGestures.map((g) => (
        <g key={g.id}>
          <line
            x1={g.origin.x * W} y1={g.origin.y * H}
            x2={g.tip.x    * W} y2={g.tip.y    * H}
            stroke="#c8a84a" strokeWidth={1.8} opacity={0.75} strokeLinecap="round"
          />
          <circle cx={g.origin.x * W} cy={g.origin.y * H} r={4} fill="#c8a84a" stroke="#1a2a1c" strokeWidth={0.8} />
          <circle cx={g.tip.x    * W} cy={g.tip.y    * H} r={3} fill="#c8a84a" opacity={0.5} />
        </g>
      ))}

      {/* Pending branch gesture */}
      {pendingBranch && (
        <line
          x1={pendingBranch.origin.x * W} y1={pendingBranch.origin.y * H}
          x2={pendingBranch.tip.x    * W} y2={pendingBranch.tip.y    * H}
          stroke="#c8a84a" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.55}
          strokeLinecap="round"
        />
      )}
    </svg>
  )
}

// ── Annotation tools ──────────────────────────────────────────────────────────

const ANNOT_TOOLS = [
  { id: 'outline',  label: 'Tree outline',   hint: 'Tap to place points along the tree silhouette. Drag handles to adjust. Double-tap to remove.' },
  { id: 'crown',    label: 'Crown',          hint: 'Tap to outline the canopy edge. Drag to adjust.' },
  { id: 'trunk',    label: 'Trunk axis',     hint: 'Tap to add points along the trunk. Drag to move.' },
  { id: 'branches', label: 'Branches',       hint: 'Tap on the trunk and drag outward to draw each primary branch.' },
]

const SCAFFOLD_TOOLS = [
  { id: 'trunk',  label: 'Trunk',  hint: 'Drag handles to trace the trunk gesture' },
  { id: 'canopy', label: 'Crown',  hint: 'Drag handles to shape the crown profile' },
  { id: 'branch', label: 'Twigs',  hint: 'Tap trunk and drag outward along each main branch' },
]

const DENSITY_OPTIONS = [
  { value: 'sparse',  label: 'Sparse'  },
  { value: 'medium',  label: 'Medium'  },
  { value: 'dense',   label: 'Dense'   },
  { value: 'patchy',  label: 'Patchy'  },
]

const CHARACTER_OPTIONS = [
  { value: 'straight',   label: 'Straight'   },
  { value: 'leaning',    label: 'Leaning'    },
  { value: 'forked',     label: 'Forked'     },
  { value: 'gnarly',     label: 'Gnarly'     },
  { value: 'multi-stem', label: 'Multi-stem' },
]

// ── Main component ────────────────────────────────────────────────────────────

export default function PhotoScaffoldEditor() {
  const {
    photos, landmarks, estimates,
    speciesAIResult, treeStructureHints, textureSamples,
    photoScaffold, setPhotoScaffold,
    scaffoldGeometry, setScaffoldGeometry,
    trunkAxisOverride, setTrunkAxisOverride,
    branchGestures:   sessionGestures,   setBranchGestures,
    canopyProfiles:   sessionProfiles,   setCanopyProfiles,
    canopyDensityHint, setCanopyDensityHint,
    trunkCharacter,    setTrunkCharacter,
    calibrationPhotoIndex, setCalibrationPhotoIndex,
    annotations,       setAnnotations,
    setStep,
  } = useTreeSession()

  // Use selected calibration photo (default first)
  const photo = photos[calibrationPhotoIndex] ?? photos[0] ?? null

  // ── Scaffold editor state ─────────────────────────────────────────────────
  const [trunkPts,     setTrunkPts]     = useState(() => trunkAxisOverride ?? defaultTrunkAxis(landmarks))
  const [canopyLeft,   setCanopyLeft]   = useState(() => sessionProfiles?.left  ?? defaultCanopyProfiles(landmarks).left)
  const [canopyRight,  setCanopyRight]  = useState(() => sessionProfiles?.right ?? defaultCanopyProfiles(landmarks).right)
  const [localGestures, setLocalGestures] = useState(() => sessionGestures ?? [])
  const [pendingBranch, setPendingBranch] = useState(null)

  // ── Annotation state (local copy synced from session) ─────────────────────
  const [localOutline,   setLocalOutline]   = useState(() => annotations.treeOutline     ?? [])
  const [localCrown,     setLocalCrown]     = useState(() => annotations.crownOutline    ?? [])
  const [localTrunk,     setLocalTrunk]     = useState(() => annotations.trunkLine       ?? [])
  const [localBranches,  setLocalBranches]  = useState(() => annotations.primaryBranches ?? [])

  // ── UI state ──────────────────────────────────────────────────────────────
  const [editorMode,  setEditorMode]  = useState('annotate')  // 'annotate' | 'scaffold'
  const [annotTool,   setAnnotTool]   = useState('outline')
  const [scaffoldTool, setScaffoldTool] = useState('trunk')
  const [natSize,     setNatSize]     = useState({ w: 800, h: 600 })
  const [generating,  setGenerating]  = useState(false)
  const [generated,   setGenerated]   = useState(false)
  const [warnings,    setWarnings]    = useState([])
  const [firstPassStatus, setFirstPassStatus] = useState(null) // null | 'running' | 'done' | 'failed'

  // ── First-pass analysis on mount ──────────────────────────────────────────
  useEffect(() => {
    const hasAnnotations =
      localOutline.length > 0 ||
      localCrown.length   > 0 ||
      localTrunk.length   > 0 ||
      localBranches.length > 0

    if (!photo || hasAnnotations) return

    runFirstPass(photo.url)
  }, [photo?.id])

  function runFirstPass(imageUrl) {
    if (!imageUrl) return
    setFirstPassStatus('running')
    analyzeTreeImage(imageUrl)
      .then((result) => {
        if (!result) { setFirstPassStatus('failed'); return }
        setLocalOutline(result.treeOutline)
        setLocalCrown(result.crownOutline)
        setLocalTrunk(result.trunkLine)
        setLocalBranches(result.primaryBranches)
        setAnnotations({
          treeOutline:     result.treeOutline,
          crownOutline:    result.crownOutline,
          trunkLine:       result.trunkLine,
          primaryBranches: result.primaryBranches,
        })
        setFirstPassStatus('done')
      })
      .catch(() => setFirstPassStatus('failed'))
  }

  function rerunFirstPass() {
    if (!photo) return
    setLocalOutline([])
    setLocalCrown([])
    setLocalTrunk([])
    setLocalBranches([])
    runFirstPass(photo.url)
  }

  function clearAnnotations() {
    setLocalOutline([])
    setLocalCrown([])
    setLocalTrunk([])
    setLocalBranches([])
    setAnnotations({ treeOutline: [], crownOutline: [], trunkLine: [], primaryBranches: [] })
    setFirstPassStatus(null)
  }

  // ── Persist annotation changes to session ─────────────────────────────────
  function syncAnnotations() {
    setAnnotations({
      treeOutline:     localOutline,
      crownOutline:    localCrown,
      trunkLine:       localTrunk,
      primaryBranches: localBranches,
    })
  }

  // ── Image load ────────────────────────────────────────────────────────────
  function handleImageLoad(e) {
    setNatSize({ w: e.target.naturalWidth, h: e.target.naturalHeight })
  }

  // ── Scaffold tool handlers ────────────────────────────────────────────────
  function handleDragTrunk(idx, pos) {
    setTrunkPts((prev) => { const n = [...prev]; n[idx] = pos; return n })
  }

  function handleDragCanopy(side, idx, pos) {
    if (side === 'left') {
      setCanopyLeft((prev) => { const n = [...prev]; n[idx] = { x: pos.x, y: prev[idx].y }; return n })
    } else {
      setCanopyRight((prev) => { const n = [...prev]; n[idx] = { x: pos.x, y: prev[idx].y }; return n })
    }
  }

  function handleBranchDown(origin) { setPendingBranch({ origin, tip: origin }) }
  function handleBranchMove(tip)    { setPendingBranch((prev) => prev ? { ...prev, tip } : null) }
  function handleBranchUp(tip) {
    if (!pendingBranch) return
    const dx = tip.x - pendingBranch.origin.x
    const dy = tip.y - pendingBranch.origin.y
    if (Math.sqrt(dx * dx + dy * dy) > 0.03) {
      setLocalGestures((prev) => [...prev, { id: crypto.randomUUID(), origin: pendingBranch.origin, tip }])
    }
    setPendingBranch(null)
  }

  function clearBranches() { setLocalGestures([]) }

  // ── Sync landmarks → trunk axis ───────────────────────────────────────────
  useEffect(() => {
    if (!trunkAxisOverride) setTrunkPts(defaultTrunkAxis(landmarks))
  }, [landmarks, trunkAxisOverride])

  // ── Generate clone ────────────────────────────────────────────────────────
  async function handleGenerate() {
    if (!photo) return
    setGenerating(true)
    setWarnings([])
    syncAnnotations()

    try {
      // Bridge annotation trunk line → trunkAxisOverride for scaffold analysis
      const effectiveTrunkAxis = localTrunk.length >= 2 ? localTrunk : trunkPts

      const scaffold = await analyzeTreePhotoScaffold({
        photo, landmarks, estimates, speciesAIResult, treeStructureHints, textureSamples,
        trunkAxisOverride: effectiveTrunkAxis,
      })
      setPhotoScaffold(scaffold)
      setWarnings(scaffold.warnings ?? [])

      if (scaffold.trunkAxis?.curvaturePoints?.length) {
        setTrunkPts(scaffold.trunkAxis.curvaturePoints)
        setTrunkAxisOverride(scaffold.trunkAxis.curvaturePoints)
      } else {
        setTrunkAxisOverride(effectiveTrunkAxis)
      }

      // Use annotation branch gestures if available
      const effectiveGestures = localBranches.length > 0
        ? localBranches.map((pts) => ({ id: crypto.randomUUID(), origin: pts[0], tip: pts[pts.length - 1] }))
        : localGestures

      const profiles = { left: canopyLeft, right: canopyRight }
      const params   = buildTreeModelParams(
        estimates,
        treeStructureHints,
        { scientificName: speciesAIResult?.scientific_name ?? '', commonName: speciesAIResult?.common_name ?? '' },
        textureSamples,
      )
      const geometry = buildScaffoldCloneGeometry(scaffold, params, effectiveGestures, profiles, canopyDensityHint, estimates)
      setScaffoldGeometry(geometry)

      setBranchGestures(effectiveGestures)
      setCanopyProfiles(profiles)
      setGenerated(true)
    } catch (err) {
      setWarnings([`Generation failed: ${err.message}`])
    } finally {
      setGenerating(false)
    }
  }

  // ── Undo helpers for annotation layers ───────────────────────────────────
  function undoOutline()  { setLocalOutline((p)  => p.slice(0, -1)) }
  function undoCrown()    { setLocalCrown((p)    => p.slice(0, -1)) }
  function undoTrunk()    { setLocalTrunk((p)    => p.slice(0, -1)) }
  function undoBranch()   { setLocalBranches((p) => p.slice(0, -1)) }

  const undoForMode  = { outline: undoOutline, crown: undoCrown, trunk: undoTrunk, branches: undoBranch }
  const clearForMode = {
    outline:  () => setLocalOutline([]),
    crown:    () => setLocalCrown([]),
    trunk:    () => setLocalTrunk([]),
    branches: () => setLocalBranches([]),
  }

  const hasPhotos = photos.length > 0
  const activeAnnotTool = ANNOT_TOOLS.find((t) => t.id === annotTool)

  // Current species display
  const speciesLabel = speciesAIResult?.common_name
    ?? (speciesAIResult?.scientific_name ? speciesAIResult.scientific_name : null)
    ?? null

  return (
    <motion.div
      className="panel panel-scaffold-editor"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
    >
      <div className="panel-body">
        <h2 className="panel-title">Analyse + Correct</h2>
        <p className="panel-desc">
          Review the first-pass structure. Drag handles or add points to correct the outline before generating.
        </p>

        {!hasPhotos ? (
          <div className="scaffold-no-photos">
            No photo available — return to Capture and add a photo first.
          </div>
        ) : (
          <>
            {/* ── Calibration photo selector ─────────────────────────── */}
            {photos.length > 1 && (
              <div className="scaffold-photo-tabs">
                {photos.map((p, i) => (
                  <button
                    key={p.id}
                    className={`scaffold-photo-tab${calibrationPhotoIndex === i ? ' active' : ''}`}
                    onClick={() => {
                      setCalibrationPhotoIndex(i)
                      setFirstPassStatus(null)
                      setLocalOutline([])
                      setLocalCrown([])
                      setLocalTrunk([])
                      setLocalBranches([])
                    }}
                  >
                    Photo {i + 1}
                    {calibrationPhotoIndex === i && ' ✓'}
                  </button>
                ))}
              </div>
            )}

            {/* ── First-pass status banner ───────────────────────────── */}
            {firstPassStatus === 'running' && (
              <div className="annot-first-pass annot-first-pass--running">
                <RefreshCw size={12} className="spin" />
                Analysing image structure…
              </div>
            )}
            {firstPassStatus === 'done' && (
              <div className="annot-first-pass annot-first-pass--done">
                <CheckCircle2 size={12} />
                First pass complete — adjust the outline if needed.
                <button className="annot-rerun-btn" onClick={rerunFirstPass}>Rerun</button>
                <button className="annot-rerun-btn" onClick={clearAnnotations}>Clear</button>
              </div>
            )}
            {firstPassStatus === 'failed' && (
              <div className="annot-first-pass annot-first-pass--failed">
                Image analysis unavailable — draw the outline manually.
                <button className="annot-rerun-btn" onClick={rerunFirstPass}>Retry</button>
              </div>
            )}

            {/* ── Mode tabs: Annotate / Scaffold ────────────────────── */}
            <div className="scaffold-tool-bar scaffold-mode-bar">
              <button
                className={`scaffold-tool-btn${editorMode === 'annotate' ? ' active' : ''}`}
                onClick={() => setEditorMode('annotate')}
              >
                Outline
              </button>
              <button
                className={`scaffold-tool-btn${editorMode === 'scaffold' ? ' active' : ''}`}
                onClick={() => setEditorMode('scaffold')}
              >
                Fine-tune scaffold
              </button>
            </div>

            {/* ── Annotation tool bar ────────────────────────────────── */}
            {editorMode === 'annotate' && (
              <>
                <div className="scaffold-tool-bar">
                  {ANNOT_TOOLS.map((t) => (
                    <button
                      key={t.id}
                      className={`scaffold-tool-btn${annotTool === t.id ? ' active' : ''}`}
                      onClick={() => setAnnotTool(t.id)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                {activeAnnotTool && (
                  <p className="scaffold-tool-hint">{activeAnnotTool.hint}</p>
                )}
                <div className="annot-action-row">
                  <button className="scaffold-clear-btn" onClick={undoForMode[annotTool]}>
                    <RotateCcw size={12} /> Undo
                  </button>
                  <button className="scaffold-clear-btn" onClick={clearForMode[annotTool]}>
                    <Trash2 size={12} /> Clear layer
                  </button>
                </div>
              </>
            )}

            {/* ── Scaffold tool bar ──────────────────────────────────── */}
            {editorMode === 'scaffold' && (
              <>
                <div className="scaffold-tool-bar">
                  {SCAFFOLD_TOOLS.map((t) => (
                    <button
                      key={t.id}
                      className={`scaffold-tool-btn${scaffoldTool === t.id ? ' active' : ''}`}
                      onClick={() => setScaffoldTool(t.id)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <p className="scaffold-tool-hint">
                  {SCAFFOLD_TOOLS.find((t) => t.id === scaffoldTool)?.hint}
                </p>
              </>
            )}

            {/* ── Photo viewport + SVG overlay ──────────────────────── */}
            <div className="scaffold-viewport">
              {photo && (
                <img
                  src={photo.url}
                  alt="Calibration photo"
                  className="scaffold-photo"
                  onLoad={handleImageLoad}
                  crossOrigin="anonymous"
                  draggable={false}
                />
              )}

              {editorMode === 'annotate' ? (
                <AnnotationSVG
                  natW={natSize.w}
                  natH={natSize.h}
                  mode={annotTool}
                  treeOutline={localOutline}
                  onUpdateOutline={setLocalOutline}
                  crownOutline={localCrown}
                  onUpdateCrown={setLocalCrown}
                  trunkLine={localTrunk}
                  onUpdateTrunk={setLocalTrunk}
                  primaryBranches={localBranches}
                  onUpdateBranches={setLocalBranches}
                />
              ) : (
                <ScaffoldSVG
                  natW={natSize.w}
                  natH={natSize.h}
                  tool={scaffoldTool}
                  trunkPts={trunkPts}
                  onDragTrunk={handleDragTrunk}
                  canopyLeft={canopyLeft}
                  canopyRight={canopyRight}
                  onDragCanopy={handleDragCanopy}
                  branchGestures={localGestures}
                  pendingBranch={pendingBranch}
                  onBranchDown={handleBranchDown}
                  onBranchMove={handleBranchMove}
                  onBranchUp={handleBranchUp}
                />
              )}
            </div>

            {/* ── Branch count (scaffold mode) ───────────────────────── */}
            {editorMode === 'scaffold' && localGestures.length > 0 && (
              <div className="scaffold-branch-row">
                <span className="scaffold-branch-count">
                  {localGestures.length} branch{localGestures.length !== 1 ? 'es' : ''} drawn
                </span>
                <button className="scaffold-clear-btn" onClick={clearBranches}>
                  <Trash2 size={13} /> Clear
                </button>
              </div>
            )}

            {/* ── Crown & trunk controls (scaffold mode) ─────────────── */}
            {editorMode === 'scaffold' && (
              <div className="scaffold-controls-grid">
                <label className="scaffold-ctrl-label">
                  <Sliders size={12} /> Canopy density
                  <div className="scaffold-option-row">
                    {DENSITY_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        className={`scaffold-option-btn${canopyDensityHint === o.value ? ' active' : ''}`}
                        onClick={() => setCanopyDensityHint(o.value)}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </label>

                <label className="scaffold-ctrl-label">
                  <GitBranch size={12} /> Trunk character
                  <div className="scaffold-option-row">
                    {CHARACTER_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        className={`scaffold-option-btn${trunkCharacter === o.value ? ' active' : ''}`}
                        onClick={() => setTrunkCharacter(o.value)}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </label>
              </div>
            )}

            {/* ── Species indicator ─────────────────────────────────── */}
            {speciesLabel && (
              <div className="scaffold-species-chip">
                <span className="scaffold-species-label">Species</span>
                <span className="scaffold-species-name">{speciesLabel}</span>
                <button
                  className="scaffold-species-change"
                  onClick={() => setStep('identify')}
                >
                  Change
                </button>
              </div>
            )}

            {/* ── Generate button ───────────────────────────────────── */}
            <button
              className="btn-primary scaffold-generate-btn"
              onClick={handleGenerate}
              disabled={generating || !photo}
            >
              {generating
                ? <><RefreshCw size={14} className="spin" /> Reading the tree…</>
                : <><Layers size={14} /> Generate clone</>
              }
            </button>

            {generated && !generating && (
              <div className="scaffold-applied">
                Clone generated — continue to confirm species or go straight to the clone.
              </div>
            )}

            {warnings.length > 0 && (
              <div className="scaffold-warnings">
                {warnings.map((w, i) => (
                  <div key={i} className="scaffold-warning"><span>{w}</span></div>
                ))}
              </div>
            )}
          </>
        )}

        <SaveTreeButton />

        <div className="panel-footer">
          <button className="btn-back" onClick={() => setStep('review')}>
            <ArrowLeft size={16} /> Review
          </button>
          {generated && (
            <button className="btn-secondary" onClick={() => setStep('clone')}>
              Clone <ArrowRight size={16} />
            </button>
          )}
          <button className="btn-next" onClick={() => setStep('identify')}>
            Species <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </motion.div>
  )
}
