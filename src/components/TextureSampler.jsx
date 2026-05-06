import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown, ChevronUp, Scissors,
  ZoomIn, ZoomOut, RefreshCw, Move, Crop, Check, X,
} from 'lucide-react'
import useTreeSession from '../state/useTreeSession'
import { cropTextureSample } from '../lib/textureSampling'

const TYPES = ['bark', 'leaf', 'canopy']

// ── View-transform helpers ────────────────────────────────────────────────────

function calcFit(nw, nh, cw, ch) {
  const scale = Math.min(cw / nw, ch / nh)
  return { scale, tx: (cw - nw * scale) / 2, ty: (ch - nh * scale) / 2 }
}

const MIN_RATIO = 0.75
const MAX_RATIO = 5.0

// ── TextureSampler ────────────────────────────────────────────────────────────

export default function TextureSampler() {
  const { photos, textureSamples, setTextureSample, clearTextureSample } = useTreeSession()

  const [open, setOpen]             = useState(false)
  const [activeType, setActiveType] = useState('bark')
  const [photoIdx, setPhotoIdx]     = useState(0)
  const [mode, setMode]             = useState('pan')   // 'pan' | 'crop'

  // Viewport transform — { scale, tx, ty } where tx/ty are container px offsets
  const [transform, setTransform]   = useState(null)
  const [fitT, setFitT]             = useState(null)
  const [natSize, setNatSize]       = useState(null)    // { nw, nh }

  // Drag state (container px, live while pointer is held)
  const [dragStart, setDragStart]   = useState(null)
  const [dragEnd, setDragEnd]       = useState(null)

  // Committed sample box (image px) + auto-generated preview
  const [pendingRect, setPendingRect] = useState(null)
  const [preview, setPreview]         = useState(null)
  const [generating, setGenerating]   = useState(false)
  const [appliedMsg, setAppliedMsg]   = useState(null)

  // Whether to use the masked PNG (vs original JPEG) when applying
  // Default to masked for leaf/canopy, original for bark
  const [useMasked, setUseMasked] = useState(false)

  const containerRef = useRef(null)
  const pointerRef   = useRef({ down: false, lastX: 0, lastY: 0 })

  const photo = photos[photoIdx] ?? photos[0] ?? null

  // Reset viewport whenever the selected photo changes
  useEffect(() => {
    setNatSize(null)
    setTransform(null)
    setFitT(null)
    setPendingRect(null)
    setDragStart(null)
    setDragEnd(null)
    setPreview(null)
  }, [photo?.id])

  // Reset masked preference whenever active type changes
  useEffect(() => {
    setUseMasked(activeType !== 'bark')
  }, [activeType])

  function handleImageLoad(e) {
    const nw = e.target.naturalWidth
    const nh = e.target.naturalHeight
    if (!containerRef.current || nw === 0 || nh === 0) return
    const r   = containerRef.current.getBoundingClientRect()
    const fit = calcFit(nw, nh, r.width, r.height)
    setNatSize({ nw, nh })
    setFitT(fit)
    setTransform(fit)
  }

  function resetView() {
    if (!containerRef.current || !natSize) return
    const r   = containerRef.current.getBoundingClientRect()
    const fit = calcFit(natSize.nw, natSize.nh, r.width, r.height)
    setFitT(fit)
    setTransform(fit)
  }

  function zoomBy(factor) {
    if (!transform || !fitT || !containerRef.current) return
    const r  = containerRef.current.getBoundingClientRect()
    const cx = r.width / 2
    const cy = r.height / 2
    setTransform((t) => {
      const minS = fitT.scale * MIN_RATIO
      const maxS = fitT.scale * MAX_RATIO
      const ns   = Math.min(maxS, Math.max(minS, t.scale * factor))
      return {
        scale: ns,
        tx:    cx - (cx - t.tx) * (ns / t.scale),
        ty:    cy - (cy - t.ty) * (ns / t.scale),
      }
    })
  }

  // ── Pointer events ──────────────────────────────────────────────────────────

  function getCC(e) {
    const r = containerRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function handlePointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const { x, y } = getCC(e)
    pointerRef.current = { down: true, lastX: x, lastY: y }
    if (mode === 'crop') {
      setDragStart({ x, y })
      setDragEnd({ x, y })
      setPendingRect(null)
      setPreview(null)
    }
  }

  function handlePointerMove(e) {
    if (!pointerRef.current.down) return
    const { x, y } = getCC(e)
    if (mode === 'pan') {
      const dx = x - pointerRef.current.lastX
      const dy = y - pointerRef.current.lastY
      setTransform((t) => t ? { ...t, tx: t.tx + dx, ty: t.ty + dy } : t)
    } else {
      setDragEnd({ x, y })
    }
    pointerRef.current.lastX = x
    pointerRef.current.lastY = y
  }

  async function handlePointerUp(e) {
    if (!pointerRef.current.down) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    pointerRef.current.down = false

    if (mode !== 'crop' || !dragStart || !dragEnd || !transform || !natSize) return

    const { tx, ty, scale } = transform
    const toImg = (cx, cy) => ({ x: (cx - tx) / scale, y: (cy - ty) / scale })
    const a = toImg(dragStart.x, dragStart.y)
    const b = toImg(dragEnd.x,   dragEnd.y)

    const ix = Math.max(0, Math.min(a.x, b.x))
    const iy = Math.max(0, Math.min(a.y, b.y))
    const iw = Math.min(natSize.nw - ix, Math.abs(b.x - a.x))
    const ih = Math.min(natSize.nh - iy, Math.abs(b.y - a.y))

    setDragStart(null)
    setDragEnd(null)

    if (iw < 4 || ih < 4) return

    setPendingRect({ x: ix, y: iy, w: iw, h: ih })
    setGenerating(true)
    try {
      const result = await cropTextureSample(photo.url, ix, iy, iw, ih, activeType)
      if (result) {
        setPreview(result)
        // Reset useMasked to default for this type on new crop
        setUseMasked(activeType !== 'bark' && !!result.maskDataUrl)
      }
    } catch (err) {
      console.warn('Texture crop failed:', err)
    } finally {
      setGenerating(false)
    }
  }

  // ── Apply / clear ───────────────────────────────────────────────────────────

  function handleApply() {
    if (!preview) return
    // Use masked PNG as dataUrl if user chose masked and mask is available
    const sample = {
      ...preview,
      dataUrl: (useMasked && preview.maskDataUrl) ? preview.maskDataUrl : preview.dataUrl,
    }
    setTextureSample(activeType, sample)
    setAppliedMsg(`${activeType.charAt(0).toUpperCase() + activeType.slice(1)} sample applied to clone`)
    setPreview(null)
    setPendingRect(null)
    setMode('pan')
    setTimeout(() => setAppliedMsg(null), 3000)
  }

  function handleClear(type) {
    clearTextureSample(type)
  }

  // ── Derived display values ──────────────────────────────────────────────────

  const liveRect = dragStart && dragEnd ? {
    left:   Math.min(dragStart.x, dragEnd.x),
    top:    Math.min(dragStart.y, dragEnd.y),
    width:  Math.abs(dragEnd.x  - dragStart.x),
    height: Math.abs(dragEnd.y  - dragStart.y),
  } : null

  const committedRect = pendingRect && transform ? {
    left:   pendingRect.x * transform.scale + transform.tx,
    top:    pendingRect.y * transform.scale + transform.ty,
    width:  pendingRect.w * transform.scale,
    height: pendingRect.h * transform.scale,
  } : null

  if (photos.length === 0) return null

  return (
    <div className="texture-sampler hints-section">
      <button className="hints-toggle" onClick={() => setOpen((o) => !o)}>
        <Scissors size={14} />
        Texture samples
        {TYPES.some((t) => textureSamples[t]) && <span className="texture-dot" />}
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div className="hints-body texture-sampler-body">
          <p className="hints-desc">
            Pan and zoom the photo, then draw a sample box for bark, leaf, or canopy.
          </p>

          {/* Sample type selector */}
          <div className="texture-type-tabs">
            {TYPES.map((t) => (
              <button
                key={t}
                className={`texture-type-btn${activeType === t ? ' active' : ''}`}
                onClick={() => { setActiveType(t); setPreview(null); setPendingRect(null) }}
              >
                {t}
                {textureSamples[t] && <span className="texture-dot" />}
              </button>
            ))}
          </div>

          {/* Photo thumbnail selector */}
          {photos.length > 1 && (
            <div className="texture-photo-thumbs">
              {photos.map((p, i) => (
                <button
                  key={p.id}
                  className={`texture-photo-thumb${photoIdx === i ? ' active' : ''}`}
                  onClick={() => setPhotoIdx(i)}
                >
                  <img src={p.url} alt={`Photo ${i + 1}`} />
                </button>
              ))}
            </div>
          )}

          {/* Viewport toolbar */}
          <div className="texture-toolbar">
            <div className="texture-toolbar-left">
              <button
                className={`btn-icon texture-mode-btn${mode === 'pan' ? ' active' : ''}`}
                onClick={() => { setMode('pan'); setDragStart(null); setDragEnd(null) }}
                title="Pan mode — drag to move"
              >
                <Move size={13} /> Pan
              </button>
              <button
                className={`btn-icon texture-mode-btn${mode === 'crop' ? ' active' : ''}`}
                onClick={() => { setMode('crop'); setPreview(null); setPendingRect(null) }}
                title="Draw a sample box"
              >
                <Crop size={13} /> Draw box
              </button>
            </div>
            <div className="texture-toolbar-right">
              <button className="btn-icon texture-zoom-btn" onClick={() => zoomBy(1.4)} disabled={!transform} title="Zoom in">
                <ZoomIn size={13} />
              </button>
              <button className="btn-icon texture-zoom-btn" onClick={() => zoomBy(1 / 1.4)} disabled={!transform} title="Zoom out">
                <ZoomOut size={13} />
              </button>
              <button className="btn-icon texture-zoom-btn" onClick={resetView} disabled={!transform} title="Reset view">
                <RefreshCw size={13} />
              </button>
            </div>
          </div>

          {/* Image viewport */}
          {photo && (
            <div
              ref={containerRef}
              className={`texture-viewport texture-viewport--${mode}`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              <img
                src={photo.url}
                alt="Sample source"
                draggable={false}
                onLoad={handleImageLoad}
                style={{
                  position:        'absolute',
                  top:             0,
                  left:            0,
                  width:           natSize ? `${natSize.nw}px` : 'auto',
                  height:          natSize ? `${natSize.nh}px` : 'auto',
                  maxWidth:        'none',
                  maxHeight:       'none',
                  display:         'block',
                  pointerEvents:   'none',
                  userSelect:      'none',
                  transformOrigin: '0 0',
                  transform:       transform
                    ? `translate(${transform.tx}px,${transform.ty}px) scale(${transform.scale})`
                    : 'none',
                  opacity: transform ? 1 : 0,
                }}
              />

              {liveRect && (
                <div className="texture-crop-rect" style={liveRect} />
              )}

              {committedRect && !liveRect && (
                <div className="texture-crop-rect texture-crop-rect--committed" style={committedRect} />
              )}

              {generating && (
                <div className="texture-crop-overlay">Generating sample…</div>
              )}
              {!natSize && !generating && (
                <div className="texture-crop-overlay">Loading…</div>
              )}
              {mode === 'crop' && !pendingRect && natSize && !generating && (
                <div className="texture-viewport-hint">
                  Drag to draw a sample box
                </div>
              )}
            </div>
          )}

          {/* Preview panel */}
          {preview && (
            <div className="texture-preview-card">
              <div className="texture-preview-row">
                {/* Original crop */}
                <div className="texture-preview-img-wrap">
                  <img src={preview.dataUrl} alt="Original" className="texture-preview-img" />
                  <span className="texture-preview-label">Original</span>
                </div>

                {/* Masked result (leaf/canopy only) */}
                {preview.maskDataUrl && (
                  <div className="texture-preview-img-wrap">
                    <img
                      src={preview.maskDataUrl}
                      alt="Masked"
                      className="texture-preview-img texture-preview-img--checker"
                    />
                    <span className="texture-preview-label">
                      Masked
                      {preview.maskCoverage != null
                        ? ` (${Math.round(preview.maskCoverage * 100)}%)`
                        : ''}
                    </span>
                  </div>
                )}

                <div className="texture-preview-colors">
                  <div
                    className="texture-preview-color texture-preview-color--avg"
                    style={{ background: preview.averageColor }}
                    title={`Average: ${preview.averageColor}`}
                  />
                  {preview.dominantColors?.slice(0, 3).map((c, i) => (
                    <div
                      key={i}
                      className="texture-preview-color"
                      style={{ background: c }}
                      title={c}
                    />
                  ))}
                  <span className="texture-preview-color-label">Colours</span>
                </div>
              </div>

              {/* Original / Masked toggle (only when mask exists) */}
              {preview.maskDataUrl && (
                <div className="texture-use-toggle">
                  <button
                    className={`btn-secondary texture-toggle-btn${!useMasked ? ' active' : ''}`}
                    onClick={() => setUseMasked(false)}
                  >
                    Use original crop
                  </button>
                  <button
                    className={`btn-secondary texture-toggle-btn${useMasked ? ' active' : ''}`}
                    onClick={() => setUseMasked(true)}
                  >
                    Use masked texture
                  </button>
                </div>
              )}

              {preview.notes?.length > 0 && (
                <p className="texture-preview-notes">{preview.notes.join(' · ')}</p>
              )}

              <div className="texture-preview-actions">
                <button className="btn-primary texture-apply-btn" onClick={handleApply}>
                  <Check size={14} />
                  Apply as {activeType}
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => { setPreview(null); setPendingRect(null) }}
                >
                  <Crop size={14} /> Redraw
                </button>
              </div>
            </div>
          )}

          {/* Success feedback */}
          {appliedMsg && (
            <div className="texture-applied-msg">
              <Check size={13} /> {appliedMsg}
            </div>
          )}

          {/* Applied samples summary */}
          {TYPES.some((t) => textureSamples[t]) && (
            <div className="texture-thumbs">
              {TYPES.map((t) => {
                const s = textureSamples[t]
                if (!s) return null
                return (
                  <div key={t} className="texture-thumb-item">
                    <img src={s.dataUrl} alt={`${t} sample`} />
                    <span className="texture-thumb-label">{t}</span>
                    <button
                      className="texture-thumb-clear"
                      onClick={() => handleClear(t)}
                      title={`Remove ${t} sample`}
                    >
                      <X size={10} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
