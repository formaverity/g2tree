import { useRef, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, ArrowLeft, Ruler, RotateCcw } from 'lucide-react'
import useTreeSession from '../state/useTreeSession'

// Groups: trunk (green), dbh (orange), canopy (teal), scale (amber)
const LANDMARK_CONFIG = [
  { key: 'trunk_base',   label: 'Trunk Base',   color: '#a8d8a8', group: 'trunk'  },
  { key: 'trunk_top',    label: 'Trunk Top',    color: '#a8d8a8', group: 'trunk'  },
  { key: 'dbh_left',     label: 'DBH Left',     color: '#e8a87c', group: 'dbh'   },
  { key: 'dbh_right',    label: 'DBH Right',    color: '#e8a87c', group: 'dbh'   },
  { key: 'canopy_left',  label: 'Canopy Left',  color: '#7ec8a4', group: 'canopy' },
  { key: 'canopy_right', label: 'Canopy Right', color: '#7ec8a4', group: 'canopy' },
  { key: 'scale_a',      label: 'Scale A',      color: '#d4b896', group: 'scale' },
  { key: 'scale_b',      label: 'Scale B',      color: '#d4b896', group: 'scale' },
]

const POINT_RADIUS = 14

export default function LandmarkCanvas() {
  const {
    photos, landmarks, setLandmark, resetLandmarks,
    showScaleRef, toggleScaleRef,
    scaleRealWorldDist, setScaleRealWorldDist,
    setStep,
  } = useTreeSession()

  const imgRef = useRef()
  const [imgRect, setImgRect] = useState(null)
  // dragging state drives cursor style and body-scroll lock
  const [dragging, setDragging] = useState(null)
  // ref for synchronous drag check inside pointer handlers (avoids React async-state race)
  const draggingRef = useRef(null)
  const [selected, setSelected] = useState('trunk_base')

  // Local string state so the user can clear/edit without snapping back to 1
  const [distRaw, setDistRaw] = useState(String(scaleRealWorldDist))
  useEffect(() => { setDistRaw(String(scaleRealWorldDist)) }, [scaleRealWorldDist])

  const calibPhoto = photos[0]

  function measure() {
    if (!imgRef.current) return
    const r = imgRef.current.getBoundingClientRect()
    setImgRect({ x: r.left, y: r.top, w: r.width, h: r.height })
  }

  useEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // Lock body scroll while a point is actively dragged
  useEffect(() => {
    if (!dragging) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [dragging])

  function toPixel(norm, rect) {
    return { x: norm.x * rect.w, y: norm.y * rect.h }
  }

  function handlePointerDown(e, key) {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    draggingRef.current = key
    setDragging(key)
    setSelected(key)
  }

  function handlePointerMove(e, key) {
    // Guard: only update when this exact point is being dragged (blocks hover updates)
    if (!draggingRef.current) return
    e.preventDefault()
    if (!imgRef.current) return
    const r = imgRef.current.getBoundingClientRect()
    setLandmark(key, {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    })
  }

  function handlePointerUp(e) {
    e.currentTarget.releasePointerCapture(e.pointerId)
    draggingRef.current = null
    setDragging(null)
  }

  const visibleLandmarks = LANDMARK_CONFIG.filter(
    (l) => l.group !== 'scale' || showScaleRef
  )

  return (
    <motion.div
      className="panel"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
    >
      <div className="panel-body">
        <h2 className="panel-title">Calibrate</h2>
        <p className="panel-desc">Drag points to match tree features in the photo.</p>

        <div className="landmark-point-list">
          {visibleLandmarks.map((lm) => (
            <button
              key={lm.key}
              className={`landmark-chip ${selected === lm.key ? 'active' : ''}`}
              style={{ '--chip-color': lm.color }}
              onClick={() => setSelected(lm.key)}
            >
              {lm.label}
            </button>
          ))}
        </div>

        {/* DBH-specific instruction */}
        <div className="dbh-instruction">
          <span className="dbh-instruction-dot" />
          Place <strong>DBH Left</strong> and <strong>DBH Right</strong> on the left and right
          trunk edges at approximately breast height (~4.5ft / 1.4m from ground).
          If photographed from the base looking up, use the clearest visible trunk width.
        </div>

        <div className="landmark-img-container">
          {calibPhoto ? (
            <>
              <img
                ref={imgRef}
                src={calibPhoto.url}
                alt="calibration"
                className="landmark-img"
                onLoad={measure}
                draggable={false}
              />
              {imgRect && (
                <svg className="landmark-svg">
                  {/* Trunk axis line */}
                  <LandmarkLine
                    a={landmarks.trunk_base} b={landmarks.trunk_top}
                    rect={imgRect} color="#a8d8a860"
                  />
                  {/* Canopy span */}
                  <LandmarkLine
                    a={landmarks.canopy_left} b={landmarks.canopy_right}
                    rect={imgRect} color="#7ec8a440"
                  />
                  {/* DBH span — always shown */}
                  <LandmarkLine
                    a={landmarks.dbh_left} b={landmarks.dbh_right}
                    rect={imgRect} color="#e8a87c80"
                  />
                  {/* Scale reference */}
                  {showScaleRef && (
                    <LandmarkLine
                      a={landmarks.scale_a} b={landmarks.scale_b}
                      rect={imgRect} color="#d4b89660" dashed
                    />
                  )}

                  {visibleLandmarks.map((lm) => {
                    const px = toPixel(landmarks[lm.key], imgRect)
                    const isActive = selected === lm.key
                    return (
                      <g
                        key={lm.key}
                        transform={`translate(${px.x},${px.y})`}
                        onPointerDown={(e) => handlePointerDown(e, lm.key)}
                        onPointerMove={(e) => handlePointerMove(e, lm.key)}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={handlePointerUp}
                        style={{ cursor: dragging === lm.key ? 'grabbing' : 'grab' }}
                      >
                        <circle
                          r={POINT_RADIUS}
                          fill={lm.color}
                          fillOpacity={isActive ? 0.9 : 0.6}
                          stroke="#fff"
                          strokeWidth={2}
                        />
                        <circle r={4} fill="#fff" />
                        {isActive && (
                          <text
                            y={-POINT_RADIUS - 4}
                            textAnchor="middle"
                            fill="#fff"
                            fontSize="10"
                            fontWeight="600"
                            style={{ pointerEvents: 'none', userSelect: 'none' }}
                          >
                            {lm.label}
                          </text>
                        )}
                      </g>
                    )
                  })}
                </svg>
              )}
            </>
          ) : (
            <div className="landmark-no-photo">No photo available</div>
          )}
        </div>

        <div className="scale-row">
          <button
            className={`btn-icon ${showScaleRef ? 'active' : ''}`}
            onClick={toggleScaleRef}
          >
            <Ruler size={16} /> Scale Reference
          </button>
          {showScaleRef && (
            <label className="scale-input-label">
              Known distance:
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={distRaw}
                onChange={(e) => {
                  setDistRaw(e.target.value)
                  const v = parseFloat(e.target.value)
                  if (v > 0) setScaleRealWorldDist(v)
                }}
                onBlur={() => {
                  const v = parseFloat(distRaw)
                  if (!(v > 0)) { setScaleRealWorldDist(1); setDistRaw('1') }
                }}
                className="scale-input"
              />
              m
            </label>
          )}
        </div>

        <div className="panel-footer">
          <button className="btn-back" onClick={() => setStep('identify')}>
            <ArrowLeft size={16} /> Identify
          </button>
          <button className="btn-icon" onClick={resetLandmarks}>
            <RotateCcw size={14} /> Reset Points
          </button>
          <button className="btn-next" onClick={() => setStep('scaffold')}>
            Scaffold <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </motion.div>
  )
}

function LandmarkLine({ a, b, rect, color, dashed }) {
  return (
    <line
      x1={a.x * rect.w} y1={a.y * rect.h}
      x2={b.x * rect.w} y2={b.y * rect.h}
      stroke={color}
      strokeWidth={2}
      strokeDasharray={dashed ? '6 4' : undefined}
    />
  )
}
