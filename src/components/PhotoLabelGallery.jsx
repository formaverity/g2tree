import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, ArrowRight, AlertCircle } from 'lucide-react'
import useTreeSession from '../state/useTreeSession'
import { identifyWithPlantNetMulti } from '../lib/plantnet'
import { refineWithSpecies } from '../lib/ai/refineWithSpecies'

// UI label → PlantNet organ string
const ORGAN_MAP = {
  Tree:           'habit',
  Crown:          'habit',
  Branches:       'habit',
  Bark:           'bark',
  'Leaves/Fruit': 'leaf',
}

const LABELS = ['Tree', 'Crown', 'Branches', 'Bark', 'Leaves/Fruit']

// Expand a photo's organLabels into unique PlantNet organ entries.
// A photo tagged ['Bark', 'Leaves/Fruit'] → sent twice: once as 'bark', once as 'leaf'.
function photoToPlantNetImages(p) {
  const labels = p.organLabels ?? []
  if (labels.length === 0) return []   // skip untagged photos

  const file    = p.normalizedBlob
    ? new File([p.normalizedBlob], 'photo.jpg', { type: 'image/jpeg' })
    : p.file
  const organs  = [...new Set(labels.map((l) => ORGAN_MAP[l] ?? 'habit'))]
  return organs.map((organ) => ({ file, organ }))
}

export default function PhotoLabelGallery() {
  const photos          = useTreeSession((s) => s.photos)
  const toggleLabel     = useTreeSession((s) => s.togglePhotoLabel)
  const setMainPhoto    = useTreeSession((s) => s.setMainPhoto)
  const setSpeciesAIResult = useTreeSession((s) => s.setSpeciesAIResult)
  const setScanState    = useTreeSession((s) => s.setScanState)
  const setStep         = useTreeSession((s) => s.setStep)

  const [activeIdx, setActiveIdx] = useState(0)

  const activePhoto   = photos[activeIdx]
  const activeLabels  = activePhoto?.organLabels ?? []

  // Validation: at least one photo must have 'Tree' in its labels
  const hasTree = photos.some((p) => p.organLabels?.includes('Tree'))
  const valid   = hasTree

  function handleToggle(label) {
    if (!activePhoto) return
    toggleLabel(activePhoto.id, label)
    // When Tree is toggled on, promote this as the main photo
    if (label === 'Tree' && !activeLabels.includes('Tree')) {
      setMainPhoto(activePhoto.id)
    }
  }

  function handleNext() {
    if (!valid) return

    const images = photos.flatMap(photoToPlantNetImages)
    if (images.length > 0) {
      identifyWithPlantNetMulti({ images })
        .then((result) => {
          setSpeciesAIResult(result)
          setScanState({ speciesResult: result })
          refineWithSpecies(result)
        })
        .catch(() => { /* IdentifyPanel shows manual fallback */ })
    }

    setStep('scale')
  }

  if (photos.length === 0) {
    return (
      <motion.div
        className="panel"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -16 }}
      >
        <div className="panel-body">
          <p className="panel-desc">No photos to label. Go back and add photos first.</p>
          <div className="panel-footer">
            <button className="btn-back" onClick={() => setStep('capture')}>
              <ArrowLeft size={16} /> Back
            </button>
          </div>
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div
      className="panel panel-label-gallery"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
    >
      <div className="panel-body">
        <h2 className="panel-title">Tag photos</h2>
        <p className="panel-desc">
          Select one or more tags per photo. Tag the full-tree shot as <strong>Tree</strong> — it anchors the scale step.
        </p>

        {/* Active photo */}
        <div className="label-gallery-photo-wrap">
          <AnimatePresence mode="wait">
            <motion.div
              key={activePhoto?.id}
              className="label-gallery-photo-frame"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {activePhoto && (
                <>
                  <img
                    src={activePhoto.url}
                    alt="Selected photo"
                    className="label-gallery-photo"
                    draggable={false}
                  />
                  <div className="label-gallery-caption">
                    {activeLabels.length ? activeLabels.join(' · ') : 'Untagged'}
                  </div>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Multi-select label picker */}
        {activePhoto && (
          <div className="label-picker">
            {LABELS.map((label) => (
              <button
                key={label}
                className={`label-picker-btn${activeLabels.includes(label) ? ' active' : ''}`}
                onClick={() => handleToggle(label)}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Thumbnail strip */}
        {photos.length > 1 && (
          <div className="label-thumb-strip">
            {photos.map((photo, i) => {
              const labels = photo.organLabels ?? []
              return (
                <button
                  key={photo.id}
                  className={`label-thumb-btn${i === activeIdx ? ' active' : ''}`}
                  onClick={() => setActiveIdx(i)}
                >
                  <img
                    src={photo.url}
                    alt={`Photo ${i + 1}`}
                    className="label-thumb-img"
                    draggable={false}
                  />
                  <span className="label-thumb-chip">
                    {labels.length ? labels.join(' · ') : 'Untagged'}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {/* Validation */}
        {!hasTree && (
          <div className="label-validation-msg">
            <AlertCircle size={14} />
            Tag the full-tree photo as <strong>Tree</strong> to continue.
          </div>
        )}

        <div className="panel-footer">
          <button className="btn-back" onClick={() => setStep('capture')}>
            <ArrowLeft size={16} /> Back
          </button>
          <button
            className="btn-next"
            onClick={handleNext}
            disabled={!valid}
          >
            Set scale <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </motion.div>
  )
}
