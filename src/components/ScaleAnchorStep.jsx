import { useRef, useState, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Cpu } from 'lucide-react'
import useTreeSession from '../state/useTreeSession'
import Loupe from './Loupe'
import { segmentTree } from '../lib/ai/sam'
import { estimateDepth } from '../lib/depthEstimation'
import { analyzeTreeImage } from '../lib/analyzeTreeImage'

const DEFAULTS = {
  base: { x: 0.50, y: 0.85 },
  dbh:  { x: 0.50, y: 0.70 },
  top:  { x: 0.50, y: 0.10 },
}

const HANDLE_LABELS = { base: 'Base', dbh: 'DBH', top: 'Top' }
const HANDLE_COLORS = { base: '#c0604a', dbh: '#7ab3d4', top: '#8fd49c' }
const DBH_REAL_HEIGHT_FT = 4.5

// Median x of foreground pixels in the bottom 30% of the mask → trunk x
function trunkXFromMask(mask, mW, mH) {
  const startRow = Math.floor(mH * 0.70)
  const xs = []
  for (let row = startRow; row < mH; row++) {
    for (let col = 0; col < mW; col++) {
      if (mask[row * mW + col] > 0.5) xs.push(col / mW)
    }
  }
  if (!xs.length) return 0.5
  xs.sort((a, b) => a - b)
  return xs[Math.floor(xs.length / 2)]
}

// Topmost foreground row → canopy apex y
function apexYFromMask(mask, mW, mH) {
  for (let row = 0; row < mH; row++) {
    for (let col = 0; col < mW; col++) {
      if (mask[row * mW + col] > 0.5) return row / mH
    }
  }
  return 0.10
}

export default function ScaleAnchorStep() {
  const photos              = useTreeSession((s) => s.photos)
  const mainPhotoId         = useTreeSession((s) => s.mainPhotoId)
  const basePointStore      = useTreeSession((s) => s.basePoint)
  const dbhPointStore       = useTreeSession((s) => s.dbhPoint)
  const topPointStore       = useTreeSession((s) => s.topPoint)
  const estimatedHeightFt   = useTreeSession((s) => s.estimatedHeightFt)
  const samMaskCache        = useTreeSession((s) => s.samMaskCache)
  const setScaleHandle      = useTreeSession((s) => s.setScaleHandle)
  const setEstimatedHeight  = useTreeSession((s) => s.setEstimatedHeight)
  const setScaleFactor      = useTreeSession((s) => s.setScaleFactor)
  const setSamMask              = useTreeSession((s) => s.setSamMask)
  const setDepthMap             = useTreeSession((s) => s.setDepthMap)
  const setDetectedHeight       = useTreeSession((s) => s.setDetectedHeight)
  const acceptDetectedHeight    = useTreeSession((s) => s.acceptDetectedHeight)
  const setDetectionConfidence  = useTreeSession((s) => s.setDetectionConfidence)
  const setStructureDetection   = useTreeSession((s) => s.setStructureDetectionResult)
  const setAnnotations          = useTreeSession((s) => s.setAnnotations)
  const detectionConfidence     = useTreeSession((s) => s.detectionConfidence)
  const userHints               = useTreeSession((s) => s.userHints)
  const setUserHints            = useTreeSession((s) => s.setUserHints)
  const setStep                 = useTreeSession((s) => s.setStep)
  const setReturnStep           = useTreeSession((s) => s.setReturnStep)

  const mainPhoto = photos.find((p) => p.id === mainPhotoId)
    ?? photos.find((p) => p.organLabels?.includes('Tree'))
    ?? photos[0]

  const [handles, setHandles] = useState({
    base: basePointStore ?? DEFAULTS.base,
    dbh:  dbhPointStore  ?? DEFAULTS.dbh,
    top:  topPointStore  ?? DEFAULTS.top,
  })
  const [heightFt, setHeightFt]     = useState(estimatedHeightFt ?? '')
  const [heightUnit, setHeightUnit] = useState('ft')
  const [dbhIn, setDbhIn]           = useState(userHints?.known_dbh_in ?? '')
  const [dragging, setDragging]     = useState(null)
  const [loupePt,  setLoupePt]      = useState(null)
  const [imageRect, setImageRect]   = useState(null)
  const [samPlacing, setSamPlacing] = useState(false)
  // { ft: number, dismissed: boolean } | null
  const [detectedBanner, setDetectedBanner] = useState(null)

  const imgRef       = useRef(null)
  const containerRef = useRef(null)
  // Guard: only auto-place from SAM once per mount
  const samRanRef    = useRef(false)

  // ── imageRect tracking ──────────────────────────────────────────────────────

  useEffect(() => {
    const update = () => {
      if (imgRef.current) setImageRect(imgRef.current.getBoundingClientRect())
    }
    const ro = new ResizeObserver(update)
    if (imgRef.current) ro.observe(imgRef.current)
    return () => ro.disconnect()
  }, [mainPhoto?.id])

  // ── SAM auto-placement on mount ─────────────────────────────────────────────

  function autoPlaceFromMask({ mask, width, height }) {
    const tx = trunkXFromMask(mask, width, height)
    const ty = Math.max(0.04, apexYFromMask(mask, width, height))
    setHandles({
      base: { x: tx, y: 0.85 },
      dbh:  { x: tx, y: 0.70 },
      top:  { x: tx, y: ty   },
    })
  }

  useEffect(() => {
    if (!mainPhoto || samRanRef.current) return
    samRanRef.current = true

    // If a prior run cached the mask, reuse it
    if (samMaskCache) {
      autoPlaceFromMask(samMaskCache)
      return
    }

    const blob = mainPhoto.normalizedBlob ?? mainPhoto.file
    if (!blob) return

    setSamPlacing(true)
    segmentTree(blob, { trunkPoint: { x: 0.5, y: 0.6 } })
      .then((result) => {
        if (result) {
          setSamMask(result)
          autoPlaceFromMask(result)
        }
        // Run full structure analysis to seed scaffold and compute confidence
        return analyzeTreeImage(mainPhoto.url, { x: 0.5, y: 0.6 })
      })
      .then((analysis) => {
        if (!analysis) return
        setStructureDetection(analysis)
        setDetectionConfidence(analysis.confidence ?? 0)
        setAnnotations({
          treeOutline:     analysis.treeOutline     ?? [],
          crownOutline:    analysis.crownOutline     ?? [],
          trunkLine:       analysis.trunkLine        ?? [],
          primaryBranches: analysis.primaryBranches  ?? [],
        })
      })
      .catch(() => {})
      .finally(() => setSamPlacing(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scale factor derivation ─────────────────────────────────────────────────

  useEffect(() => {
    if (!imageRect) return
    const basePx = handles.base.y * imageRect.height
    const dbhPx  = handles.dbh.y  * imageRect.height
    const dist   = Math.abs(basePx - dbhPx)
    if (dist > 4) setScaleFactor(dist / DBH_REAL_HEIGHT_FT)
  }, [handles, imageRect, setScaleFactor])

  // ── Detected height banner from handle positions + scale ────────────────────

  useEffect(() => {
    if (!imageRect) return
    const pxPerFt = (() => {
      const d = Math.abs(handles.base.y - handles.dbh.y) * imageRect.height
      return d > 4 ? d / DBH_REAL_HEIGHT_FT : null
    })()
    if (!pxPerFt) return

    const pixH = Math.abs(handles.top.y - handles.base.y) * imageRect.height
    const ft   = Math.round((pixH / pxPerFt) * 10) / 10
    if (ft > 2 && ft < 300) {
      setDetectedHeight(ft)
      setDetectedBanner((prev) => (prev?.dismissed ? prev : { ft, dismissed: false }))
    }
  }, [handles, imageRect, setDetectedHeight])

  // ── Background depth estimation once scale is known ─────────────────────────

  useEffect(() => {
    if (!mainPhoto) return
    estimateDepth(mainPhoto.url)
      .then((r) => setDepthMap({ data: r.depthMap, width: r.width, height: r.height }))
      .catch(() => {})
  }, [mainPhoto?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pointer interaction ─────────────────────────────────────────────────────

  function toNorm(clientX, clientY) {
    const rect = imgRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0.5, y: 0.5 }
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top)  / rect.height)),
    }
  }

  const handlePointerDown = useCallback((e, key) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(key)
    setLoupePt({ x: e.clientX, y: e.clientY })
  }, [])

  const handlePointerMove = useCallback((e) => {
    if (!dragging) return
    e.preventDefault()
    const norm = toNorm(e.clientX, e.clientY)
    setHandles((prev) => ({ ...prev, [dragging]: norm }))
    setLoupePt({ x: e.clientX, y: e.clientY })
  }, [dragging]) // eslint-disable-line react-hooks/exhaustive-deps

  const handlePointerUp = useCallback((e) => {
    if (!dragging) return
    const norm = toNorm(e.clientX, e.clientY)
    setHandles((prev) => ({ ...prev, [dragging]: norm }))
    setScaleHandle(dragging, norm)
    setDragging(null)
    setLoupePt(null)
  }, [dragging, setScaleHandle]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Height input ────────────────────────────────────────────────────────────

  function handleHeightChange(e) {
    const raw = e.target.value
    setHeightFt(raw)
    const num = parseFloat(raw)
    if (!isNaN(num) && num > 0) setEstimatedHeight(num, heightUnit)
  }

  function handleUnitToggle() {
    const next = heightUnit === 'ft' ? 'm' : 'ft'
    setHeightUnit(next)
    const num = parseFloat(heightFt)
    if (!isNaN(num) && num > 0) setEstimatedHeight(num, heightUnit)
  }

  // ── Banner actions ──────────────────────────────────────────────────────────

  function handleUseDetected() {
    acceptDetectedHeight()
    const ft = detectedBanner?.ft
    if (ft != null) setHeightFt(String(ft))
    setDetectedBanner((b) => ({ ...b, dismissed: true }))
  }

  function handleKeepMine() {
    setDetectedBanner((b) => ({ ...b, dismissed: true }))
  }

  // ── Proceed ─────────────────────────────────────────────────────────────────

  function handleProceed() {
    setScaleHandle('base', handles.base)
    setScaleHandle('dbh',  handles.dbh)
    setScaleHandle('top',  handles.top)
    // Route through scaffold if detection quality is too low to trust
    const conf = detectionConfidence ?? 0
    if (conf >= 0.65) {
      setStep('identify')
    } else {
      setReturnStep('identify')
      setStep('scaffold')
    }
  }

  // ── No photo guard ──────────────────────────────────────────────────────────

  if (!mainPhoto) {
    return (
      <motion.div className="panel" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <div className="panel-body">
          <p className="panel-desc">No main photo found. Go back and add a full-tree photo first.</p>
          <div className="panel-footer">
            <button className="btn-back" onClick={() => setStep('label')}><ArrowLeft size={16} /> Back</button>
          </div>
        </div>
      </motion.div>
    )
  }

  const rect = imgRef.current?.getBoundingClientRect()

  return (
    <motion.div
      className="panel panel-scale-anchor"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
    >
      <div className="panel-body">
        <h2 className="panel-title">
          Scale anchor
          {samPlacing && (
            <span className="scale-sam-badge">
              <Cpu size={11} /> Placing…
            </span>
          )}
        </h2>
        <p className="panel-desc">
          Drag the handles to the trunk base, DBH (~4.5 ft above ground), and canopy apex.
          Handles are placed automatically — adjust as needed.
        </p>

        {/* Photo + handle overlay */}
        <div
          ref={containerRef}
          className="scale-anchor-viewport"
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{ touchAction: 'none' }}
        >
          <img
            ref={imgRef}
            src={mainPhoto.url}
            alt="Tree photo"
            className="scale-anchor-photo"
            onLoad={() => setImageRect(imgRef.current?.getBoundingClientRect())}
            draggable={false}
            style={{ display: 'block', width: '100%', userSelect: 'none' }}
          />

          {rect && (
            <svg
              className="scale-anchor-svg"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none', overflow: 'visible' }}
              viewBox={`0 0 ${rect.width} ${rect.height}`}
              preserveAspectRatio="none"
            >
              {/* Connecting line */}
              {['base', 'dbh', 'top'].reduce((lines, key, i, arr) => {
                if (i === 0) return lines
                const prev = arr[i - 1]
                return [...lines,
                  <line
                    key={`line-${key}`}
                    x1={handles[prev].x * rect.width}  y1={handles[prev].y * rect.height}
                    x2={handles[key].x  * rect.width}  y2={handles[key].y  * rect.height}
                    stroke="rgba(255,255,255,0.35)" strokeWidth={1.5} strokeDasharray="4 3"
                  />
                ]
              }, [])}

              {/* Handles */}
              {Object.entries(handles).map(([key, pos]) => (
                <g key={key} style={{ cursor: 'grab', touchAction: 'none' }} onPointerDown={(e) => handlePointerDown(e, key)}>
                  <rect x={pos.x * rect.width - 22} y={pos.y * rect.height - 22} width={44} height={44} fill="transparent" />
                  <circle
                    cx={pos.x * rect.width} cy={pos.y * rect.height} r={18}
                    fill={HANDLE_COLORS[key]} fillOpacity={dragging === key ? 0.22 : 0.12}
                    stroke={HANDLE_COLORS[key]} strokeWidth={1} strokeOpacity={0.5}
                  />
                  <circle
                    cx={pos.x * rect.width} cy={pos.y * rect.height} r={4}
                    fill={HANDLE_COLORS[key]} stroke="rgba(0,0,0,0.3)" strokeWidth={1}
                  />
                  <text
                    x={pos.x * rect.width + 14} y={pos.y * rect.height - 8}
                    fontSize={9} fill={HANDLE_COLORS[key]}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {HANDLE_LABELS[key]}
                  </text>
                </g>
              ))}
            </svg>
          )}
        </div>

        {/* Detected height banner */}
        {detectedBanner && !detectedBanner.dismissed && (
          <div className="scale-detected-banner">
            <span className="scale-detected-label">
              Detected height: <strong>{detectedBanner.ft} ft</strong>
            </span>
            <div className="scale-detected-actions">
              <button className="scale-detected-btn scale-detected-btn--accept" onClick={handleUseDetected}>
                Use detected
              </button>
              <button className="scale-detected-btn scale-detected-btn--keep" onClick={handleKeepMine}>
                Keep mine
              </button>
            </div>
          </div>
        )}

        {/* Measurements */}
        <div className="scale-measurements-group">
          <div className="scale-height-row">
            <label className="scale-height-label">
              Tree height
              <div className="scale-height-input-wrap">
                <input
                  type="number"
                  min="1"
                  max="200"
                  step="0.5"
                  value={heightFt}
                  onChange={handleHeightChange}
                  className="scale-height-input"
                  style={{ fontSize: 16 }}
                  placeholder="e.g. 45"
                />
                <button className="scale-unit-toggle" onClick={handleUnitToggle}>
                  {heightUnit}
                </button>
              </div>
            </label>
          </div>

          <div className="scale-height-row">
            <label className="scale-height-label">
              Trunk diameter at DBH
              <div className="scale-height-input-wrap">
                <input
                  type="number"
                  min="0.5"
                  max="500"
                  step="0.5"
                  value={dbhIn}
                  onChange={(e) => {
                    setDbhIn(e.target.value)
                    const num = parseFloat(e.target.value)
                    if (!isNaN(num) && num > 0) setUserHints({ known_dbh_in: String(num) })
                  }}
                  className="scale-height-input"
                  style={{ fontSize: 16 }}
                  placeholder="e.g. 12"
                />
                <span className="scale-unit-static">in</span>
              </div>
              <span className="scale-dbh-hint">measured at the blue handle</span>
            </label>
          </div>
        </div>

        {/* Loupe */}
        <Loupe
          photoUrl={mainPhoto.url}
          touchX={loupePt?.x ?? 0}
          touchY={loupePt?.y ?? 0}
          imageRect={imageRect}
          visible={!!dragging && !!loupePt}
        />

        <div className="panel-footer">
          <button className="btn-back" onClick={() => setStep('label')}>
            <ArrowLeft size={16} /> Back
          </button>
          <button className="btn-next" onClick={handleProceed}>
            See your tree <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </motion.div>
  )
}
