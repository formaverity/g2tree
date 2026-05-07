import { useEffect, useRef, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, GitBranch, Layers, RefreshCw, Trash2, Move, Sliders } from 'lucide-react'
import useTreeSession from '../state/useTreeSession'
import { analyzeTreePhotoScaffold, defaultTrunkAxis } from '../lib/photoScaffold'
import { buildScaffoldCloneGeometry } from '../lib/scaffoldGeometry'
import { buildTreeModelParams } from '../lib/treeModelParams'
import SaveTreeButton from './SaveTreeButton'

// ── Default canopy profile handles (3 per side) ───────────────────────────────

function defaultCanopyProfiles(landmarks) {
  const topY  = Math.min(landmarks?.trunk_top?.y ?? 0.30, landmarks?.canopy_left?.y ?? 0.20)
  const botY  = landmarks?.trunk_base?.y ?? 0.85
  const midY  = topY + (botY - topY) * 0.45
  const lx    = landmarks?.canopy_left?.x  ?? 0.18
  const rx    = landmarks?.canopy_right?.x ?? 0.82
  const tx    = landmarks?.trunk_base?.x   ?? 0.50
  return {
    left:  [
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

// ── SVG overlay ───────────────────────────────────────────────────────────────

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
    const pt  = svgEl.createSVGPoint()
    pt.x = me.clientX; pt.y = me.clientY
    const local = pt.matrixTransform(svgEl.getScreenCTM().inverse())
    return {
      x: Math.max(0, Math.min(1, local.x / natW)),
      y: Math.max(0, Math.min(1, local.y / natH)),
    }
  }

  // Generic draggable handle
  function startDrag(e, onMove) {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    function mv(me) { onMove(toSVG(me)) }
    function up() {
      svgRef.current?.removeEventListener('pointermove', mv)
      svgRef.current?.removeEventListener('pointerup',  up)
    }
    svgRef.current?.addEventListener('pointermove', mv)
    svgRef.current?.addEventListener('pointerup',   up)
  }

  // Branch gesture events
  function handleBranchDown(e) {
    if (tool !== 'branch') return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const origin = toSVG(e)
    onBranchDown(origin)
    function mv(me) { onBranchMove(toSVG(me)) }
    function up(me)  { onBranchUp(toSVG(me));  svgRef.current?.removeEventListener('pointermove', mv); svgRef.current?.removeEventListener('pointerup', up) }
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
          fill="#4a8c5a"
          fillOpacity={0.12}
          stroke="none"
        />
      )}

      {/* Canopy left profile */}
      {canopyLeft.length > 1 && (
        <polyline
          points={canopyLeft.map((p) => `${p.x * W},${p.y * H}`).join(' ')}
          fill="none" stroke="#6aab74" strokeWidth={2.5} strokeDasharray="5 3" opacity={0.8}
        />
      )}

      {/* Canopy right profile */}
      {canopyRight.length > 1 && (
        <polyline
          points={canopyRight.map((p) => `${p.x * W},${p.y * H}`).join(' ')}
          fill="none" stroke="#6aab74" strokeWidth={2.5} strokeDasharray="5 3" opacity={0.8}
        />
      )}

      {/* Canopy handles */}
      {tool === 'canopy' && (
        <>
          {canopyLeft.map((p, i) => (
            <g key={`cl${i}`} style={{ cursor: 'ew-resize' }}
              onPointerDown={(e) => startDrag(e, (pos) => onDragCanopy('left', i, pos))}
            >
              <circle cx={p.x * W} cy={p.y * H} r={14} fill="#6aab74" fillOpacity={0.18} />
              <circle cx={p.x * W} cy={p.y * H} r={6}  fill="#6aab74" stroke="#fff" strokeWidth={1.8} />
            </g>
          ))}
          {canopyRight.map((p, i) => (
            <g key={`cr${i}`} style={{ cursor: 'ew-resize' }}
              onPointerDown={(e) => startDrag(e, (pos) => onDragCanopy('right', i, pos))}
            >
              <circle cx={p.x * W} cy={p.y * H} r={14} fill="#6aab74" fillOpacity={0.18} />
              <circle cx={p.x * W} cy={p.y * H} r={6}  fill="#6aab74" stroke="#fff" strokeWidth={1.8} />
            </g>
          ))}
        </>
      )}

      {/* Trunk axis polyline */}
      {trunkPts.length > 1 && (
        <polyline
          points={trunkPts.map((p) => `${p.x * W},${p.y * H}`).join(' ')}
          fill="none" stroke="#c0604a" strokeWidth={2.5} opacity={0.88}
        />
      )}

      {/* Trunk handles */}
      {tool === 'trunk' && trunkPts.map((p, i) => (
        <g key={i} style={{ cursor: 'grab' }}
          onPointerDown={(e) => startDrag(e, (pos) => onDragTrunk(i, pos))}
        >
          <circle cx={p.x * W} cy={p.y * H} r={14} fill="#c0604a" fillOpacity={0.20} />
          <circle cx={p.x * W} cy={p.y * H} r={6}  fill="#c0604a" stroke="#fff" strokeWidth={1.8} />
        </g>
      ))}

      {/* Committed branch gestures */}
      {branchGestures.map((g) => (
        <g key={g.id}>
          <line
            x1={g.origin.x * W} y1={g.origin.y * H}
            x2={g.tip.x    * W} y2={g.tip.y    * H}
            stroke="#d4b35a" strokeWidth={2.2} opacity={0.85}
          />
          <circle cx={g.origin.x * W} cy={g.origin.y * H} r={5.5} fill="#d4b35a" stroke="#fff" strokeWidth={1.5} />
          <circle cx={g.tip.x    * W} cy={g.tip.y    * H} r={3.5} fill="#d4b35a" opacity={0.7} />
        </g>
      ))}

      {/* Pending (in-progress) branch gesture */}
      {pendingBranch && (
        <g>
          <line
            x1={pendingBranch.origin.x * W} y1={pendingBranch.origin.y * H}
            x2={pendingBranch.tip.x    * W} y2={pendingBranch.tip.y    * H}
            stroke="#d4b35a" strokeWidth={2} strokeDasharray="4 3" opacity={0.6}
          />
          <circle cx={pendingBranch.origin.x * W} cy={pendingBranch.origin.y * H} r={5} fill="#d4b35a" opacity={0.5} />
        </g>
      )}
    </svg>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const TOOLS = [
  { id: 'trunk',  label: 'Trunk',    hint: 'Drag handles to trace the trunk gesture' },
  { id: 'canopy', label: 'Crown',    hint: 'Shape the crown outline' },
  { id: 'branch', label: 'Branches', hint: 'Tap trunk and drag outward along each main branch' },
]

const DENSITY_OPTIONS = [
  { value: 'sparse',  label: 'Sparse'  },
  { value: 'medium',  label: 'Medium'  },
  { value: 'dense',   label: 'Dense'   },
  { value: 'patchy',  label: 'Patchy'  },
]

const CHARACTER_OPTIONS = [
  { value: 'straight',    label: 'Straight'    },
  { value: 'leaning',     label: 'Leaning'     },
  { value: 'forked',      label: 'Forked'      },
  { value: 'gnarly',      label: 'Gnarly'      },
  { value: 'multi-stem',  label: 'Multi-stem'  },
]

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
    setStep,
  } = useTreeSession()

  const photo = photos[0] ?? null

  // Local handle state (synced to session on generate)
  const [trunkPts, setTrunkPts] = useState(() => trunkAxisOverride ?? defaultTrunkAxis(landmarks))
  const [canopyLeft,  setCanopyLeft]  = useState(() => sessionProfiles?.left  ?? defaultCanopyProfiles(landmarks).left)
  const [canopyRight, setCanopyRight] = useState(() => sessionProfiles?.right ?? defaultCanopyProfiles(landmarks).right)
  const [localGestures, setLocalGestures] = useState(() => sessionGestures ?? [])
  const [pendingBranch, setPendingBranch] = useState(null)

  const [tool,       setTool]       = useState('trunk')
  const [natSize,    setNatSize]    = useState({ w: 800, h: 600 })
  const [generating, setGenerating] = useState(false)
  const [generated,  setGenerated]  = useState(false)
  const [warnings,   setWarnings]   = useState([])

  // Sync session → local on mount if session has data
  useEffect(() => {
    if (!trunkAxisOverride) setTrunkPts(defaultTrunkAxis(landmarks))
  }, [landmarks, trunkAxisOverride])

  function handleImageLoad(e) {
    setNatSize({ w: e.target.naturalWidth, h: e.target.naturalHeight })
  }

  // Trunk drag
  function handleDragTrunk(idx, pos) {
    setTrunkPts((prev) => { const n = [...prev]; n[idx] = pos; return n })
  }

  // Canopy drag (constrain x only, keep y fixed)
  function handleDragCanopy(side, idx, pos) {
    if (side === 'left') {
      setCanopyLeft((prev) => { const n = [...prev]; n[idx] = { x: pos.x, y: prev[idx].y }; return n })
    } else {
      setCanopyRight((prev) => { const n = [...prev]; n[idx] = { x: pos.x, y: prev[idx].y }; return n })
    }
  }

  // Branch gesture events
  function handleBranchDown(origin) {
    setPendingBranch({ origin, tip: origin })
  }
  function handleBranchMove(tip) {
    setPendingBranch((prev) => prev ? { ...prev, tip } : null)
  }
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

  async function handleGenerate() {
    if (!photo) return
    setGenerating(true)
    setWarnings([])
    try {
      // Run photo analysis
      const scaffold = await analyzeTreePhotoScaffold({
        photo, landmarks, estimates, speciesAIResult, treeStructureHints, textureSamples,
        trunkAxisOverride: trunkPts,
      })
      setPhotoScaffold(scaffold)
      setWarnings(scaffold.warnings ?? [])

      // Refine trunk handles from analysis
      if (scaffold.trunkAxis?.curvaturePoints?.length) {
        setTrunkPts(scaffold.trunkAxis.curvaturePoints)
        setTrunkAxisOverride(scaffold.trunkAxis.curvaturePoints)
      } else {
        setTrunkAxisOverride(trunkPts)
      }

      // Build clone geometry from authoritative scaffold + user gestures
      const profiles = { left: canopyLeft, right: canopyRight }
      const params   = buildTreeModelParams(
        estimates,
        treeStructureHints,
        { scientificName: speciesAIResult?.scientific_name ?? '', commonName: speciesAIResult?.common_name ?? '' },
        textureSamples,
      )
      const geometry = buildScaffoldCloneGeometry(scaffold, params, localGestures, profiles, canopyDensityHint, estimates)
      setScaffoldGeometry(geometry)

      // Persist gesture + profile state
      setBranchGestures(localGestures)
      setCanopyProfiles(profiles)

      setGenerated(true)
    } catch (err) {
      setWarnings([`Generation failed: ${err.message}`])
    } finally {
      setGenerating(false)
    }
  }

  const activeTool = TOOLS.find((t) => t.id === tool)
  const hasPhotos  = photos.length > 0

  return (
    <motion.div
      className="panel panel-scaffold-editor"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
    >
      <div className="panel-body">
        <h2 className="panel-title">Scaffold Tree</h2>
        <p className="panel-desc">
          Trace the tree's gesture. The clone derives from what you draw.
        </p>

        {!hasPhotos ? (
          <div className="scaffold-no-photos">
            No photo available — return to Capture and add a photo first.
          </div>
        ) : (
          <>
            {/* ── Tool selector ──────────────────────────────────────── */}
            <div className="scaffold-tool-bar">
              {TOOLS.map((t) => (
                <button
                  key={t.id}
                  className={`scaffold-tool-btn${tool === t.id ? ' active' : ''}`}
                  onClick={() => setTool(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {activeTool && (
              <p className="scaffold-tool-hint">{activeTool.hint}</p>
            )}

            {/* ── Photo viewport + SVG overlay ───────────────────────── */}
            <div className="scaffold-viewport">
              {photo && (
                <img
                  src={photo.url}
                  alt="Source tree"
                  className="scaffold-photo"
                  onLoad={handleImageLoad}
                  crossOrigin="anonymous"
                  draggable={false}
                />
              )}
              <ScaffoldSVG
                natW={natSize.w}
                natH={natSize.h}
                tool={tool}
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
            </div>

            {/* ── Branch management ──────────────────────────────────── */}
            {localGestures.length > 0 && (
              <div className="scaffold-branch-row">
                <span className="scaffold-branch-count">{localGestures.length} branch{localGestures.length !== 1 ? 'es' : ''} suggested</span>
                <button className="scaffold-clear-btn" onClick={clearBranches}>
                  <Trash2 size={13} /> Clear branches
                </button>
              </div>
            )}

            {/* ── Crown & trunk controls ─────────────────────────────── */}
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

            {/* ── Generate button ────────────────────────────────────── */}
            <button
              className="btn-primary scaffold-generate-btn"
              onClick={handleGenerate}
              disabled={generating || !photo}
            >
              {generating
                ? <><RefreshCw size={14} className="spin" /> Reading the tree…</>
                : <><Layers size={14} /> Generate clone from scaffold</>
              }
            </button>

            {generated && !generating && (
              <div className="scaffold-applied">
                Clone generated — continue to Sample Materials or go straight to your clone.
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
          <button className="btn-back" onClick={() => setStep('calibrate')}>
            <ArrowLeft size={16} /> Calibrate
          </button>
          {generated && (
            <button className="btn-secondary" onClick={() => setStep('clone')}>
              Skip to clone <ArrowRight size={16} />
            </button>
          )}
          <button className="btn-next" onClick={() => setStep('materials')}>
            Materials <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </motion.div>
  )
}
