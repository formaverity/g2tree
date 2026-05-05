import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { Trash2, ArrowRight, ArrowLeft, MapPin, Clock, Camera } from 'lucide-react'
import useTreeSession from '../state/useTreeSession'
import { parseExif } from '../lib/exif'

export default function PhotoReview() {
  const { photos, removePhoto, setPhotoExif, setStep } = useTreeSession()

  useEffect(() => {
    photos.forEach((p) => {
      if (!p.exif) {
        parseExif(p.file).then((exif) => setPhotoExif(p.id, exif || {}))
      }
    })
  }, [photos.length])

  return (
    <motion.div
      className="panel"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
    >
      <div className="panel-body">
        <h2 className="panel-title">Review</h2>
        <p className="panel-desc">Verify photos and confirm metadata.</p>

        <div className="review-list">
          {photos.map((p, i) => (
            <div key={p.id} className="review-card">
              <div className="review-card-img-wrap">
                <img src={p.url} alt={`photo ${i + 1}`} className="review-img" />
                {i === 0 && <span className="badge-primary">Calibration</span>}
              </div>
              <div className="review-meta">
                {p.exif?.gps?.lat != null && (
                  <div className="meta-row">
                    <MapPin size={13} />
                    <span>{p.exif.gps.lat.toFixed(5)}, {p.exif.gps.lng.toFixed(5)}</span>
                  </div>
                )}
                {p.exif?.datetime && (
                  <div className="meta-row">
                    <Clock size={13} />
                    <span>{p.exif.datetime}</span>
                  </div>
                )}
                {p.exif?.camera?.make && (
                  <div className="meta-row">
                    <Camera size={13} />
                    <span>{p.exif.camera.make} {p.exif.camera.model}</span>
                  </div>
                )}
                {p.exif && !p.exif.gps && !p.exif.datetime && !p.exif.camera?.make && (
                  <div className="meta-row meta-dim">No metadata found</div>
                )}
                {!p.exif && <div className="meta-row meta-dim">Parsing…</div>}
              </div>
              <button className="btn-remove" onClick={() => removePhoto(p.id)} title="Remove">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>

        <div className="panel-footer">
          <button className="btn-back" onClick={() => setStep('capture')}>
            <ArrowLeft size={16} /> Back
          </button>
          <button
            className="btn-next"
            disabled={photos.length === 0}
            onClick={() => setStep('calibrate')}
          >
            Calibrate <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </motion.div>
  )
}
