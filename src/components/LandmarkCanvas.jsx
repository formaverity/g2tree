import { useRef, useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, ArrowLeft, Ruler } from 'lucide-react'
import useTreeSession from '../state/useTreeSession'

const LANDMARK_CONFIG = [
  { key: 'trunk_base', label: 'Trunk Base', color: '#a8d8a8' },
  { key: 'trunk_top', label: 'Trunk Top', color: '#a8d8a8' },
  { key: 'canopy_left', label: 'Canopy Left', color: '#7ec8a4' },
  { key: 'canopy_right', label: 'Canopy Right', color: '#7ec8a4' },
  { key: 'scale_a', label: 'Scale A', color: '#d4b896' },
  { key: 'scale_b', label: 'Scale B', color: '#d4b896' },
]

const POINT_RADIUS = 14

export default function LandmarkCanvas() {
  const { photos, landmarks, setLandmark, showScaleRef, toggleScaleRef,
          scaleRealWorldDist, setScaleRealWorldDist, setStep } = useTreeSession()

  const containerRef = useRef()
  const imgRef = useRef()
  const [imgRect, setImgRect] = useState(null)
  const [dragging, setDragging] = useState(null)
  const [selected, setSelected] = useState('trunk_base')

  const calibPhoto = photos[0]

  // Track rendered image bounds
  useEffect(() => {
    function measure() {
      if (!imgRef.current) return
      const r = imgRef.current.getBoundingClientRect()
      setImgRect({ x: r.left, y: r.top, w: r.width, h: r.height })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  function toNorm(clientX, clientY, rect) {
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.x) / rect.w)),
      y: Math.max(0, Math.min(1, (clientY - rect.y) / rect.h)),
    }
  }

  function toPixel(norm, rect) {
    return { x: norm.x * rect.w, y: norm.y * rect.h }
  }

  // Mouse events
  function onMouseDown(e, key) {
    e.preventDefault()
    setDragging(key)
    setSelected(key)
  }

  const onMouseMove = useCallback((e) => {
    if (!dragging || !imgRect) return
    setLandmark(dragging, toNorm(e.clientX, e.clientY, imgRect))
  }, [dragging, imgRect])

  const onMouseUp = useCallback(() => setDragging(null), [])

  // Touch events
  function onTouchStart(e, key) {
    setDragging(key)
    setSelected(key)
  }

  const onTouchMove = useCallback((e) => {
    if (!dragging || !imgRect) return
    const t = e.touches[0]
    setLandmark(dragging, toNorm(t.clientX, t.clientY, imgRect))
  }, [dragging, imgRect])

  const onTouchEnd = useCallback(() => setDragging(null), [])

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [onMouseMove, onMouseUp, onTouchMove, onTouchEnd])

  const visibleLandmarks = showScaleRef
    ? LANDMARK_CONFIG
    : LANDMARK_CONFIG.filter((l) => !l.key.startsWith('scale_'))

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

        <div className="landmark-img-container" ref={containerRef}>
          {calibPhoto ? (
            <>
              <img
                ref={imgRef}
                src={calibPhoto.url}
                alt="calibration"
                className="landmark-img"
                onLoad={() => {
                  if (!imgRef.current) return
                  const r = imgRef.current.getBoundingClientRect()
                  setImgRect({ x: r.left, y: r.top, w: r.width, h: r.height })
                }}
                draggable={false}
              />
              {imgRect && (
                <svg className="landmark-svg" style={{ left: 0, top: 0 }}>
                  {/* Lines: trunk */}
                  <LandmarkLine a={landmarks.trunk_base} b={landmarks.trunk_top} rect={imgRect} color="#a8d8a880" />
                  {/* Lines: canopy */}
                  <LandmarkLine a={landmarks.canopy_left} b={landmarks.canopy_right} rect={imgRect} color="#7ec8a440" />
                  {/* Scale line */}
                  {showScaleRef && (
                    <LandmarkLine a={landmarks.scale_a} b={landmarks.scale_b} rect={imgRect} color="#d4b89660" dashed />
                  )}

                  {visibleLandmarks.map((lm) => {
                    const px = toPixel(landmarks[lm.key], imgRect)
                    return (
                      <g
                        key={lm.key}
                        transform={`translate(${px.x},${px.y})`}
                        onMouseDown={(e) => onMouseDown(e, lm.key)}
                        onTouchStart={(e) => onTouchStart(e, lm.key)}
                        style={{ cursor: 'grab' }}
                      >
                        <circle r={POINT_RADIUS} fill={lm.color} fillOpacity={selected === lm.key ? 0.9 : 0.6} stroke="#fff" strokeWidth={2} />
                        <circle r={4} fill="#fff" />
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
          <button className={`btn-icon ${showScaleRef ? 'active' : ''}`} onClick={toggleScaleRef}>
            <Ruler size={16} /> Scale Reference
          </button>
          {showScaleRef && (
            <label className="scale-input-label">
              Known distance:
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={scaleRealWorldDist}
                onChange={(e) => setScaleRealWorldDist(parseFloat(e.target.value) || 1)}
                className="scale-input"
              />
              m
            </label>
          )}
        </div>

        <div className="panel-footer">
          <button className="btn-back" onClick={() => setStep('review')}>
            <ArrowLeft size={16} /> Back
          </button>
          <button className="btn-next" onClick={() => setStep('estimate')}>
            Estimate <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </motion.div>
  )
}

function LandmarkLine({ a, b, rect, color, dashed }) {
  const ax = a.x * rect.w
  const ay = a.y * rect.h
  const bx = b.x * rect.w
  const by = b.y * rect.h
  return (
    <line
      x1={ax} y1={ay} x2={bx} y2={by}
      stroke={color}
      strokeWidth={2}
      strokeDasharray={dashed ? '6 4' : undefined}
    />
  )
}
