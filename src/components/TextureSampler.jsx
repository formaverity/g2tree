import { useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Scissors, X } from 'lucide-react'
import useTreeSession from '../state/useTreeSession'

const SAMPLE_TYPES = ['bark', 'leaf', 'canopy']

async function cropImageToBlob(imgEl, containerEl, cropRect) {
  const rect = containerEl.getBoundingClientRect()
  const sf = imgEl.naturalWidth / rect.width
  const sx = Math.max(0, cropRect.x * sf)
  const sy = Math.max(0, cropRect.y * sf)
  const sw = Math.min(cropRect.w * sf, imgEl.naturalWidth - sx)
  const sh = Math.min(cropRect.h * sf, imgEl.naturalHeight - sy)
  if (sw < 4 || sh < 4) return null
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  canvas.getContext('2d').drawImage(imgEl, sx, sy, sw, sh, 0, 0, 256, 256)
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? null), 'image/jpeg', 0.88)
  })
}

export default function TextureSampler() {
  const { photos, textureSamples, setTextureSample, clearTextureSample } = useTreeSession()
  const [open, setOpen] = useState(false)
  const [activeType, setActiveType] = useState('bark')
  const [selectedPhotoIdx, setSelectedPhotoIdx] = useState(0)
  const [cropStart, setCropStart] = useState(null)
  const [cropEnd, setCropEnd] = useState(null)
  const [cropping, setCropping] = useState(false)
  const containerRef = useRef(null)
  const imgRef = useRef(null)
  const draggingRef = useRef(false)

  const photo = photos[selectedPhotoIdx] ?? photos[0] ?? null

  function getRelCoords(e) {
    const r = containerRef.current.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    }
  }

  function handlePointerDown(e) {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    draggingRef.current = true
    const c = getRelCoords(e)
    setCropStart(c)
    setCropEnd(c)
  }

  function handlePointerMove(e) {
    if (!draggingRef.current) return
    e.preventDefault()
    setCropEnd(getRelCoords(e))
  }

  async function handlePointerUp(e) {
    if (!draggingRef.current) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    draggingRef.current = false
    const end = getRelCoords(e)
    setCropEnd(end)

    const start = cropStart
    if (!start || !imgRef.current || !containerRef.current) return

    const rx = Math.min(start.x, end.x)
    const ry = Math.min(start.y, end.y)
    const rw = Math.abs(end.x - start.x)
    const rh = Math.abs(end.y - start.y)

    if (rw < 0.02 || rh < 0.02) { setCropStart(null); setCropEnd(null); return }

    setCropping(true)
    try {
      const blob = await cropImageToBlob(imgRef.current, containerRef.current, { x: rx, y: ry, w: rw, h: rh })
      if (blob) {
        const url = URL.createObjectURL(blob)
        setTextureSample(activeType, {
          url,
          blob,
          sourcePhotoId: photo?.id ?? null,
          cropRect: { x: rx, y: ry, w: rw, h: rh },
        })
      }
    } finally {
      setCropping(false)
      setCropStart(null)
      setCropEnd(null)
    }
  }

  const cropRect = (cropStart && cropEnd) ? {
    x: Math.min(cropStart.x, cropEnd.x),
    y: Math.min(cropStart.y, cropEnd.y),
    w: Math.abs(cropEnd.x - cropStart.x),
    h: Math.abs(cropEnd.y - cropStart.y),
  } : null

  // TODO: Future — fetch reference textures from GBIF media API:
  //   https://api.gbif.org/v1/species/{key}/media
  //   Requires GBIF species key from speciesAIResult (lookup by scientificName)

  // TODO: Future — fetch observation photos from iNaturalist for texture references:
  //   https://api.inaturalist.org/v1/observations
  //   Filter by taxon_name and quality_grade=research

  if (photos.length === 0) return null

  return (
    <div className="texture-sampler hints-section">
      <button className="hints-toggle" onClick={() => setOpen((o) => !o)}>
        <Scissors size={14} />
        Texture samples
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div className="hints-body">
          <p className="hints-desc">
            Draw a rectangle on the photo to save a bark, leaf, or canopy texture sample.
          </p>

          <div className="texture-type-tabs">
            {SAMPLE_TYPES.map((t) => (
              <button
                key={t}
                className={`texture-type-btn${activeType === t ? ' active' : ''}`}
                onClick={() => setActiveType(t)}
              >
                {t}
                {textureSamples[t] && <span className="texture-dot" />}
              </button>
            ))}
          </div>

          {photos.length > 1 && (
            <div className="texture-photo-selector">
              <div className="texture-photo-thumbs">
                {photos.map((p, i) => (
                  <button
                    key={p.id}
                    className={`texture-photo-thumb${selectedPhotoIdx === i ? ' active' : ''}`}
                    onClick={() => setSelectedPhotoIdx(i)}
                  >
                    <img src={p.url} alt={`Photo ${i + 1}`} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {photo && (
            <div
              ref={containerRef}
              className="texture-crop-wrap"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            >
              <img
                ref={imgRef}
                src={photo.url}
                alt="Crop source"
                className="texture-crop-img"
                draggable={false}
              />
              {cropRect && cropRect.w > 0.01 && cropRect.h > 0.01 && (
                <div
                  className="texture-crop-rect"
                  style={{
                    left: `${cropRect.x * 100}%`,
                    top: `${cropRect.y * 100}%`,
                    width: `${cropRect.w * 100}%`,
                    height: `${cropRect.h * 100}%`,
                  }}
                />
              )}
              {cropping && <div className="texture-crop-overlay">Cropping…</div>}
            </div>
          )}

          {SAMPLE_TYPES.some((t) => textureSamples[t]) && (
            <div className="texture-thumbs">
              {SAMPLE_TYPES.map((t) => {
                const s = textureSamples[t]
                if (!s) return null
                return (
                  <div key={t} className="texture-thumb-item">
                    <img src={s.url} alt={`${t} sample`} />
                    <span className="texture-thumb-label">{t}</span>
                    <button
                      className="texture-thumb-clear"
                      onClick={() => clearTextureSample(t)}
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
