import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import useTreeSession from '../state/useTreeSession'
import CaptureStep from './CaptureStep'
import ImageDropCapture from './ImageDropCapture'
import LocationConfirmStep from './LocationConfirmStep'
import InterpretationReview from './InterpretationReview'
import ClonePreviewStep from './ClonePreviewStep'
import { analyzeImage } from '../lib/visionAnalysis'
import { estimateTreeMetrics } from '../lib/treeMetrics'

const STEPS = [
  {
    id:       'primary',
    label:    'Full Tree Photo',
    hint:     'Step back and capture the whole tree — trunk, crown, and base if possible. This image drives calibration and clone structure.',
    slot:     'primaryImage',
    readExif: true,
    required: true,
  },
  {
    id:       'bark',
    label:    'Bark / Trunk Detail',
    hint:     'Close-up of trunk bark. Detail images improve species ID, bark texture, and health signals.',
    slot:     'barkImage',
    readExif: false,
    required: false,
  },
  {
    id:       'detail',
    label:    'Leaf, Flower, or Fruit',
    hint:     'Best organ for species ID. A clear leaf or fruit photo significantly improves identification accuracy.',
    slot:     'detailImage',
    readExif: false,
    required: false,
  },
  {
    id:       'scale',
    label:    'Scale Reference',
    hint:     'Optional: person, measuring tape, or known object beside the trunk for size calibration.',
    slot:     'scaleImage',
    readExif: false,
    required: false,
    optional: true,
  },
  { id: 'location',  label: 'Location',    hint: 'Confirm where this tree is standing' },
  { id: 'analysis',  label: 'AI Analysis', hint: 'Species identification from your photos' },
  { id: 'clone',     label: 'Summary',     hint: 'Digital summary — ready for detailed refinement' },
]

const PHOTO_STEPS  = STEPS.slice(0, 4)
const TOTAL        = STEPS.length

export default function CaptureWizard() {
  const {
    scanState, setScanState, resetScanState,
    setPhotos, setSpeciesAIResult, setUserHints,
    setStep,
  } = useTreeSession()

  const [wizardStep, setWizardStep] = useState(0)

  const step = STEPS[wizardStep]

  // ── Photo capture ──────────────────────────────────────────────────────────
  function handleCapture(slot, file, url, exif) {
    const prev = scanState[slot]
    if (prev?.url?.startsWith('blob:')) URL.revokeObjectURL(prev.url)
    setScanState({ [slot]: { file, url, exif } })

    if (slot === 'primaryImage') {
      setScanState({ visionAnalysis: null })
      analyzeImage(url)
        .then((analysis) => setScanState({ visionAnalysis: analysis }))
        .catch(() => {})
    }
  }

  // ── Navigation ─────────────────────────────────────────────────────────────
  function goBack() {
    setWizardStep((w) => Math.max(0, w - 1))
  }

  function goNext() {
    if (wizardStep < TOTAL - 1) {
      const nextStep = wizardStep + 1
      // Compute metrics when the user reaches the clone preview step so it can
      // show a summary, and so commitAndFinish has a result ready to persist.
      if (STEPS[nextStep]?.id === 'clone') {
        const metrics = estimateTreeMetrics({
          speciesResult:    scanState.speciesResult,
          visionAnalysis:   scanState.visionAnalysis,
          visionDepth:      scanState.visionDepth,
          selectedLocation: scanState.selectedLocation,
          scaleHintFt:      scanState.scaleHintFt,
          userHints:        scanState.userHints ?? {},
        })
        setScanState({ estimatedMetrics: metrics })
      }
      setWizardStep(nextStep)
    } else {
      commitAndFinish()
    }
  }

  // ── Commit scan data → existing workflow state ──────────────────────────────
  function commitAndFinish() {
    const slots = ['primaryImage', 'barkImage', 'detailImage', 'scaleImage']
    const committed = slots
      .map((k) => scanState[k])
      .filter(Boolean)
      .map((img) => ({
        id:   crypto.randomUUID(),
        url:  img.url,
        file: img.file,
        exif: img.exif ?? null,
      }))

    if (committed.length) setPhotos(committed)

    if (scanState.speciesResult?.enabled && scanState.speciesResult?.common_name) {
      setSpeciesAIResult(scanState.speciesResult)
      setUserHints({ known_species: scanState.speciesResult.common_name })
    }

    setStep('review')
  }

  // ── Next-button availability ────────────────────────────────────────────────
  function isNextDisabled() {
    if (step.required && !scanState[step.slot]) return true
    return false
  }

  // ── Render step content ─────────────────────────────────────────────────────
  function renderContent() {
    if (step.slot) {
      return (
        <ImageDropCapture
          label={step.label}
          hint={step.hint}
          value={scanState[step.slot]}
          onCapture={(file, url, exif) => handleCapture(step.slot, file, url, exif)}
          readExif={step.readExif}
          optional={step.optional}
          analysis={step.id === 'primary' ? scanState.visionAnalysis : null}
        />
      )
    }
    if (step.id === 'location')  return <LocationConfirmStep />
    if (step.id === 'analysis')  return <InterpretationReview />
    if (step.id === 'clone')     return <ClonePreviewStep />
    return null
  }

  return (
    <motion.div
      className="wizard-root"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
    >
      {/* Progress bar */}
      <div className="wizard-progress" aria-label="Scan progress">
        {STEPS.map((s, i) => (
          <div
            key={s.id}
            className={`wizard-seg ${i < wizardStep ? 'done' : i === wizardStep ? 'active' : ''}`}
          />
        ))}
      </div>

      {/* Step content with slide animation */}
      <AnimatePresence mode="wait" initial={false}>
        <CaptureStep
          key={step.id}
          stepIndex={wizardStep}
          totalSteps={TOTAL}
          title={step.label}
          hint={step.hint}
          onBack={wizardStep > 0 ? goBack : null}
          onNext={goNext}
          nextLabel={wizardStep === TOTAL - 1 ? 'Begin Scan' : 'Next'}
          nextDisabled={isNextDisabled()}
          canSkip={step.optional || step.id === 'location' || step.id === 'analysis'}
          onSkip={goNext}
        >
          {renderContent()}
        </CaptureStep>
      </AnimatePresence>
    </motion.div>
  )
}
