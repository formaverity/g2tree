import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, ScanLine, Check, AlertTriangle, RefreshCw, Layers } from 'lucide-react'
import useTreeSession from '../state/useTreeSession'
import { analyzeTreePhotoScaffold, defaultTrunkAxis } from '../lib/photoScaffold'
import { buildScaffoldGeometry } from '../lib/scaffoldGeometry'
import { buildTreeModelParams } from '../lib/treeModelParams'
import SaveTreeButton from './SaveTreeButton'

// ── SVG overlay with draggable trunk axis handles ─────────────────────────────

function ScaffoldOverlay({ natW, natH, scaffold, trunkAxisPts, onDragHandle, photoIdx, photos }) {
  const svgRef = useRef(null)

  function startDrag(e, idx) {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)

    function onMove(me) {
      if (!svgRef.current) return
      const svgEl = svgRef.current
      const pt    = svgEl.createSVGPoint()
      pt.x = me.clientX
      pt.y = me.clientY
      const local = pt.matrixTransform(svgEl.getScreenCTM().inverse())
      const nx = Math.max(0, Math.min(1, local.x / natW))
      const ny = Math.max(0, Math.min(1, local.y / natH))
      onDragHandle(idx, { x: nx, y: ny })
    }

    function onUp() {
      svgRef.current?.removeEventListener('pointermove', onMove)
      svgRef.current?.removeEventListener('pointerup', onUp)
    }

    svgRef.current?.addEventListener('pointermove', onMove)
    svgRef.current?.addEventListener('pointerup', onUp)
  }

  const silhouette = scaffold?.silhouette
  const branches   = scaffold?.branchGraph

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${natW} ${natH}`}
      preserveAspectRatio="xMidYMid meet"
      className="scaffold-svg-overlay"
      style={{ touchAction: 'none' }}
    >
      {/* Canopy silhouette — left profile */}
      {silhouette?.leftProfile?.length > 1 && (
        <polyline
          points={silhouette.leftProfile.map((p) =>
            `${p.x * natW},${(silhouette.canopyTopY + p.t * (silhouette.canopyBottomY - silhouette.canopyTopY)) * natH}`
          ).join(' ')}
          fill="none"
          stroke="#6aab74"
          strokeWidth={2.5}
          strokeDasharray="6 3"
          opacity={0.75}
        />
      )}

      {/* Canopy silhouette — right profile */}
      {silhouette?.rightProfile?.length > 1 && (
        <polyline
          points={silhouette.rightProfile.map((p) =>
            `${p.x * natW},${(silhouette.canopyTopY + p.t * (silhouette.canopyBottomY - silhouette.canopyTopY)) * natH}`
          ).join(' ')}
          fill="none"
          stroke="#6aab74"
          strokeWidth={2.5}
          strokeDasharray="6 3"
          opacity={0.75}
        />
      )}

      {/* Branch skeleton edges */}
      {branches?.edges?.map((edge, i) => {
        const nA = branches.nodes.find((n) => n.id === edge.from)
        const nB = branches.nodes.find((n) => n.id === edge.to)
        if (!nA || !nB) return null
        return (
          <line
            key={i}
            x1={nA.x * natW} y1={nA.y * natH}
            x2={nB.x * natW} y2={nB.y * natH}
            stroke="#d4b35a"
            strokeWidth={1.5}
            opacity={0.45}
          />
        )
      })}

      {/* Branch nodes */}
      {branches?.confidence > 0.2 && branches?.nodes?.map((n) => (
        <circle
          key={n.id}
          cx={n.x * natW} cy={n.y * natH}
          r={3}
          fill="#d4b35a"
          opacity={0.55}
        />
      ))}

      {/* Trunk axis polyline */}
      {trunkAxisPts.length > 1 && (
        <polyline
          points={trunkAxisPts.map((p) => `${p.x * natW},${p.y * natH}`).join(' ')}
          fill="none"
          stroke="#c0604a"
          strokeWidth={2.5}
          opacity={0.88}
        />
      )}

      {/* Draggable trunk axis handles */}
      {trunkAxisPts.map((p, i) => (
        <g key={i} style={{ cursor: 'grab' }} onPointerDown={(e) => startDrag(e, i)}>
          <circle
            cx={p.x * natW} cy={p.y * natH}
            r={12}
            fill="#c0604a"
            fillOpacity={0.22}
          />
          <circle
            cx={p.x * natW} cy={p.y * natH}
            r={6}
            fill="#c0604a"
            stroke="#fff"
            strokeWidth={1.8}
          />
        </g>
      ))}

      {/* Crown bounds (if analyzed) */}
      {silhouette && (
        <>
          <line
            x1={silhouette.roiX1 * natW} y1={silhouette.canopyTopY * natH}
            x2={silhouette.roiX2 * natW} y2={silhouette.canopyTopY * natH}
            stroke="#8fd49c" strokeWidth={1.5} opacity={0.45} strokeDasharray="4 4"
          />
          <line
            x1={silhouette.roiX1 * natW} y1={silhouette.canopyBottomY * natH}
            x2={silhouette.roiX2 * natW} y2={silhouette.canopyBottomY * natH}
            stroke="#8fd49c" strokeWidth={1.5} opacity={0.45} strokeDasharray="4 4"
          />
        </>
      )}
    </svg>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function PhotoScaffoldPanel() {
  const {
    photos,
    landmarks,
    estimates,
    speciesAIResult,
    treeStructureHints,
    textureSamples,
    photoScaffold,
    trunkAxisOverride,
    setPhotoScaffold,
    setScaffoldGeometry,
    setTrunkAxisOverride,
    setPreviewMode,
    setStep,
  } = useTreeSession()

  const [photoIdx, setPhotoIdx]   = useState(0)
  const [analyzing, setAnalyzing] = useState(false)
  const [warnings, setWarnings]   = useState([])
  const [natSize, setNatSize]     = useState({ w: 800, h: 600 })
  const [hasApplied, setHasApplied] = useState(false)

  const photo = photos[photoIdx] ?? photos[0] ?? null

  // Initialize trunk axis handles from landmarks or existing override
  const [trunkPts, setTrunkPts] = useState(() =>
    trunkAxisOverride ?? defaultTrunkAxis(landmarks),
  )

  // Sync if landmarks change (shouldn't normally)
  useEffect(() => {
    if (!trunkAxisOverride) {
      setTrunkPts(defaultTrunkAxis(landmarks))
    }
  }, [landmarks, trunkAxisOverride])

  function handleImageLoad(e) {
    setNatSize({ w: e.target.naturalWidth, h: e.target.naturalHeight })
  }

  function handleDragHandle(idx, pos) {
    setTrunkPts((prev) => {
      const next = [...prev]
      next[idx] = pos
      return next
    })
    setTrunkAxisOverride([...trunkPts.slice(0, idx), pos, ...trunkPts.slice(idx + 1)])
  }

  async function handleAnalyze() {
    if (!photo) return
    setAnalyzing(true)
    setWarnings([])
    try {
      const scaffold = await analyzeTreePhotoScaffold({
        photo,
        landmarks,
        estimates,
        speciesAIResult,
        treeStructureHints,
        textureSamples,
        trunkAxisOverride: trunkPts,
      })
      setPhotoScaffold(scaffold)
      setWarnings(scaffold.warnings ?? [])

      // Update trunk handles to match refined axis
      if (scaffold.trunkAxis?.curvaturePoints) {
        const pts = scaffold.trunkAxis.curvaturePoints
        setTrunkPts(pts)
        setTrunkAxisOverride(pts)
      }
    } catch (err) {
      setWarnings([`Analysis failed: ${err.message}`])
    } finally {
      setAnalyzing(false)
    }
  }

  function handleUseScaffold() {
    if (!photoScaffold) return

    const params = buildTreeModelParams(estimates, treeStructureHints, {
      scientificName: speciesAIResult?.scientific_name ?? '',
      commonName:     speciesAIResult?.common_name     ?? '',
    }, textureSamples)

    const geometry = buildScaffoldGeometry(photoScaffold, params)
    setScaffoldGeometry(geometry)
    setPreviewMode('photo_scaffold')
    setHasApplied(true)
    setStep('preview')
  }

  const hasPhotos   = photos.length > 0
  const hasScaffold = !!photoScaffold
  const confidence  = photoScaffold?.confidence ?? 0

  const confLabel = confidence > 0.65 ? 'Good' : confidence > 0.3 ? 'Fair' : 'Low'
  const confCls   = confidence > 0.65 ? 'conf-high' : confidence > 0.3 ? 'conf-mid' : 'conf-low'

  return (
    <motion.div
      className="panel panel-scaffold"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
    >
      <div className="panel-body">
        <h2 className="panel-title">Photo Scaffold</h2>
        <p className="panel-desc">
          Derive trunk shape, crown silhouette, and branch structure from your source photo.
        </p>

        {!hasPhotos && (
          <div className="scaffold-no-photos">
            <AlertTriangle size={20} />
            <p>No photos available. Return to Capture and add photos first.</p>
          </div>
        )}

        {hasPhotos && (
          <>
            {/* Photo selector */}
            {photos.length > 1 && (
              <div className="scaffold-photo-tabs">
                {photos.map((p, i) => (
                  <button
                    key={p.id}
                    className={`scaffold-photo-tab${photoIdx === i ? ' active' : ''}`}
                    onClick={() => setPhotoIdx(i)}
                  >
                    Photo {i + 1}
                  </button>
                ))}
              </div>
            )}

            {/* Photo + SVG overlay */}
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
              <ScaffoldOverlay
                natW={natSize.w}
                natH={natSize.h}
                scaffold={photoScaffold}
                trunkAxisPts={trunkPts}
                onDragHandle={handleDragHandle}
                photoIdx={photoIdx}
                photos={photos}
              />
            </div>

            <p className="scaffold-drag-hint">
              Drag the red handles to adjust the trunk axis.
            </p>

            {/* Analysis controls */}
            <div className="scaffold-controls">
              <button
                className="btn-primary"
                onClick={handleAnalyze}
                disabled={analyzing || !photo}
              >
                {analyzing
                  ? <><RefreshCw size={14} className="spin" /> Analyzing…</>
                  : <><ScanLine size={14} /> Analyze Scaffold</>
                }
              </button>

              {hasScaffold && (
                <button
                  className="btn-icon finish-clone-btn"
                  onClick={handleUseScaffold}
                >
                  <Layers size={14} /> Use Scaffold for Clone
                </button>
              )}
            </div>

            {/* Analysis result */}
            {hasScaffold && (
              <div className="scaffold-result">
                <div className="scaffold-result-row">
                  <span className="scaffold-result-label">Confidence</span>
                  <span className={`conf-pill ${confCls}`}>{confLabel} ({Math.round(confidence * 100)}%)</span>
                </div>
                {photoScaffold.crown && (
                  <>
                    <div className="scaffold-result-row">
                      <span className="scaffold-result-label">Crown shape</span>
                      <span className="scaffold-result-value">{photoScaffold.crown.shape}</span>
                    </div>
                    <div className="scaffold-result-row">
                      <span className="scaffold-result-label">Asymmetry</span>
                      <span className="scaffold-result-value">
                        {Math.round((photoScaffold.silhouette?.asymmetryScore ?? 0) * 100)}%
                      </span>
                    </div>
                    <div className="scaffold-result-row">
                      <span className="scaffold-result-label">Trunk lean</span>
                      <span className="scaffold-result-value">
                        {photoScaffold.trunkAxis?.leanAngle?.toFixed(1) ?? '0'}°
                      </span>
                    </div>
                  </>
                )}
                {photoScaffold.branchGraph?.confidence != null && (
                  <div className="scaffold-result-row">
                    <span className="scaffold-result-label">Branch skeleton</span>
                    <span className="scaffold-result-value">
                      {photoScaffold.branchGraph.nodes.length} nodes,{' '}
                      {photoScaffold.branchGraph.edges.length} edges
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Warnings */}
            {warnings.length > 0 && (
              <div className="scaffold-warnings">
                {warnings.map((w, i) => (
                  <div key={i} className="scaffold-warning">
                    <AlertTriangle size={13} />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}

            {hasApplied && (
              <div className="scaffold-applied">
                <Check size={14} /> Scaffold applied — preview mode set to Photo Scaffold.
              </div>
            )}
          </>
        )}

        <SaveTreeButton />

        <div className="panel-footer">
          <button className="btn-back" onClick={() => setStep('estimate')}>
            <ArrowLeft size={16} /> Estimate
          </button>
          <button className="btn-next" onClick={() => setStep('preview')}>
            Preview <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </motion.div>
  )
}
