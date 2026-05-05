import { motion } from 'framer-motion'

const STEPS = [
  { id: 'capture', label: 'Capture' },
  { id: 'review', label: 'Review' },
  { id: 'calibrate', label: 'Calibrate' },
  { id: 'estimate', label: 'Estimate' },
  { id: 'preview', label: 'Preview' },
  { id: 'export', label: 'Export' },
]

export default function StepHeader({ step }) {
  const currentIdx = STEPS.findIndex((s) => s.id === step)

  return (
    <header className="step-header">
      <div className="step-header-brand">G2Tree</div>
      <nav className="step-nav">
        {STEPS.map((s, i) => (
          <div
            key={s.id}
            className={`step-dot ${i < currentIdx ? 'done' : ''} ${i === currentIdx ? 'active' : ''}`}
            title={s.label}
          >
            <span className="step-dot-label">{s.label}</span>
          </div>
        ))}
      </nav>
    </header>
  )
}
