import { useRef } from 'react'
import { motion } from 'framer-motion'
import { Camera, Upload, ArrowRight } from 'lucide-react'
import useTreeSession from '../state/useTreeSession'

export default function CapturePanel() {
  const { photos, addPhotos, setStep } = useTreeSession()
  const cameraRef = useRef()
  const uploadRef = useRef()

  function handleFiles(e) {
    const files = Array.from(e.target.files || [])
    if (files.length) addPhotos(files)
    e.target.value = ''
  }

  return (
    <motion.div
      className="panel"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
    >
      <div className="panel-body">
        <h2 className="panel-title">Capture</h2>
        <p className="panel-desc">
          Photograph the tree from multiple angles. At least one front-facing shot is required for
          calibration.
        </p>

        <div className="capture-actions">
          <button className="btn-primary" onClick={() => cameraRef.current?.click()}>
            <Camera size={20} />
            Take Photo
          </button>
          <button className="btn-secondary" onClick={() => uploadRef.current?.click()}>
            <Upload size={20} />
            Upload Photos
          </button>
        </div>

        {/* Hidden inputs */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          style={{ display: 'none' }}
          onChange={handleFiles}
        />
        <input
          ref={uploadRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={handleFiles}
        />

        {photos.length > 0 && (
          <div className="capture-thumbs">
            {photos.map((p) => (
              <img key={p.id} src={p.url} alt="captured" className="capture-thumb" />
            ))}
          </div>
        )}

        <div className="panel-footer">
          <span className="photo-count">{photos.length} photo{photos.length !== 1 ? 's' : ''}</span>
          <button
            className="btn-next"
            disabled={photos.length === 0}
            onClick={() => setStep('review')}
          >
            Next <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </motion.div>
  )
}
