import { useRef, useState } from 'react'
import { Camera, Upload, RefreshCw, CheckCircle2 } from 'lucide-react'
import { parseExif } from '../lib/exif'
import InterpretationOverlay from './InterpretationOverlay'

export default function ImageDropCapture({ label, hint, value, onCapture, readExif = false, optional = false, analysis = null }) {
  const cameraRef  = useRef()
  const uploadRef  = useRef()
  const [loading, setLoading] = useState(false)

  async function handleFiles(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    setLoading(true)
    const url = URL.createObjectURL(file)
    let exif = null
    if (readExif) exif = await parseExif(file)
    setLoading(false)

    onCapture(file, url, exif)
  }

  const captured = !!value

  return (
    <div className="idc-root">
      {/* Scanner zone */}
      <div className="scanner-zone">
        <div className="scanner-grid" />

        {!captured && !loading && <div className="scanner-line" />}

        {/* Reticle corner brackets */}
        <div className="reticle">
          <div className="reticle-inner" />
        </div>

        {captured ? (
          <>
            <img src={value.url} alt={label} className="scanner-preview" />
            {analysis && <InterpretationOverlay analysis={analysis} />}
          </>
        ) : loading ? (
          <div className="scanner-empty">
            <RefreshCw size={28} className="scanner-icon spin" />
            <span className="scanner-empty-label">Processing…</span>
          </div>
        ) : (
          <div className="scanner-empty">
            <Camera size={32} className="scanner-icon" />
            <span className="scanner-empty-label">{label}</span>
            {optional && <span className="scanner-optional-badge">optional</span>}
          </div>
        )}

        {captured && (
          <div className="scanner-captured-badge">
            <CheckCircle2 size={14} />
            Captured
          </div>
        )}

        {!captured && !loading && (
          <div className="scanner-hint-overlay">{hint || 'Tap to capture'}</div>
        )}
      </div>

      {/* Action buttons */}
      <div className="idc-actions">
        <button className="btn-primary idc-btn" onClick={() => cameraRef.current?.click()} disabled={loading}>
          <Camera size={18} />
          {captured ? 'Retake' : 'Camera'}
        </button>
        <button className="btn-secondary idc-btn" onClick={() => uploadRef.current?.click()} disabled={loading}>
          <Upload size={18} />
          Upload
        </button>
      </div>

      <input ref={cameraRef} type="file" accept="image/*" capture="environment"
        style={{ display: 'none' }} onChange={handleFiles} />
      <input ref={uploadRef} type="file" accept="image/*"
        style={{ display: 'none' }} onChange={handleFiles} />
    </div>
  )
}
