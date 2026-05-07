import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, ChevronRight, SkipForward } from 'lucide-react'

export default function CaptureStep({
  stepIndex,
  totalSteps,
  title,
  hint,
  onBack,
  onNext,
  nextLabel   = 'Next',
  nextDisabled = false,
  canSkip      = false,
  onSkip,
  children,
}) {
  return (
    <motion.div
      className="capture-step"
      key={stepIndex}
      initial={{ opacity: 0, x: 32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -32 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
    >
      {/* Step context header */}
      <div className="cs-header">
        <div className="cs-step-tag">
          <span className="cs-step-num">{stepIndex + 1}</span>
          <span className="cs-step-of">/ {totalSteps}</span>
        </div>
        <div className="cs-titles">
          <h3 className="cs-title">{title}</h3>
          <p className="cs-hint">{hint}</p>
        </div>
      </div>

      {/* Main content slot */}
      <div className="cs-content">{children}</div>

      {/* Footer navigation */}
      <div className="cs-footer">
        {onBack ? (
          <button className="btn-back cs-back" onClick={onBack}>
            <ChevronLeft size={16} />
            Back
          </button>
        ) : <div />}

        <div className="cs-footer-right">
          {canSkip && onSkip && (
            <button className="cs-skip-btn" onClick={onSkip}>
              <SkipForward size={14} />
              Skip
            </button>
          )}
          <button className="btn-next" disabled={nextDisabled} onClick={onNext}>
            {nextLabel}
            {nextLabel === 'Next' && <ChevronRight size={16} />}
          </button>
        </div>
      </div>
    </motion.div>
  )
}
