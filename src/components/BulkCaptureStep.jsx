import { useRef, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Camera, X, ArrowRight, Image } from 'lucide-react'
import useTreeSession from '../state/useTreeSession'
import { normalizeImageForCapture } from '../lib/imageNormalize'
import { parseExif } from '../lib/exif'
import { warmup } from '../lib/ai/runtime'

export default function BulkCaptureStep() {
  const addPhotos = useTreeSession((s) => s.addPhotos)
  const setStep   = useTreeSession((s) => s.setStep)
  const photos    = useTreeSession((s) => s.photos)
  const removePhoto = useTreeSession((s) => s.removePhoto)

  const fileInputRef = useRef(null)
  const [processing, setProcessing] = useState(false)
  const [error, setError]           = useState(null)

  const handleFiles = useCallback(async (files) => {
    if (!files?.length) return
    setProcessing(true)
    setError(null)

    const results = []
    for (const file of Array.from(files).slice(0, 4)) {
      try {
        const { blob, url, width, height } = await normalizeImageForCapture(file)
        const exifData = await parseExif(file).catch(() => null)
        const exifGps  = exifData?.gps ?? null

        results.push({
          id:             crypto.randomUUID(),
          url,
          file,
          exif:           exifData,
          organLabels:    [],   // user tags on the next screen
          exifGps,
          thumbUrl:       null,
          normalizedBlob: blob,
          width,
          height,
        })
      } catch (err) {
        console.warn('Normalization failed for', file.name, err)
      }
    }

    if (results.length > 0) {
      addPhotos(results)
      // Kick off AI model warm-up in the background on first photo batch
      if (photos.length === 0) warmup()
    }
    setProcessing(false)
  }, [photos, addPhotos])

  function openPicker() {
    fileInputRef.current?.click()
  }

  function handleInputChange(e) {
    handleFiles(e.target.files)
    e.target.value = ''
  }

  const canProceed = photos.length > 0 && !processing

  return (
    <motion.div
      className="panel panel-bulk-capture"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
    >
      <div className="panel-body">
        <h2 className="panel-title">Add photos</h2>
        <p className="panel-desc">
          Capture or upload 1–4 photos of the tree. Include the full tree, then bark, leaves, or
          fruit for better species identification.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          multiple
          capture="environment"
          style={{ display: 'none' }}
          onChange={handleInputChange}
        />

        <button
          className="bulk-capture-cta"
          onClick={openPicker}
          disabled={processing || photos.length >= 4}
        >
          {processing ? (
            <span className="bulk-capture-cta-inner">Processing…</span>
          ) : (
            <span className="bulk-capture-cta-inner">
              <Camera size={20} />
              {photos.length === 0 ? 'Add photos' : 'Add more'}
            </span>
          )}
        </button>

        {photos.length === 0 && !processing && (
          <div className="bulk-capture-empty">
            <Image size={36} strokeWidth={1.2} />
            <p>No photos yet.</p>
          </div>
        )}

        {/* Thumbnail strip */}
        {photos.length > 0 && (
          <div className="bulk-thumb-strip">
            {photos.map((photo) => (
              <div key={photo.id} className="bulk-thumb-item">
                <img
                  src={photo.url}
                  alt="Captured photo"
                  className="bulk-thumb-img"
                  draggable={false}
                />
                <div className="bulk-thumb-label">
                  {photo.organLabels?.length ? photo.organLabels.join(' · ') : 'Untagged'}
                </div>
                <button
                  className="bulk-thumb-remove"
                  onClick={() => removePhoto(photo.id)}
                  aria-label="Remove photo"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {error && <p className="bulk-capture-error">{error}</p>}

        {photos.length >= 4 && (
          <p className="bulk-capture-hint">Maximum 4 photos. Remove one to add another.</p>
        )}

        <div className="panel-footer">
          <button
            className="btn-next"
            onClick={() => setStep('label')}
            disabled={!canProceed}
          >
            Tag photos <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </motion.div>
  )
}
