import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, ArrowLeft, AlertTriangle, Info } from 'lucide-react'
import useTreeSession from '../state/useTreeSession'
import { estimateTree } from '../lib/estimateTree'

function ConfidencePill({ value }) {
  const pct = Math.round(value * 100)
  const cls = pct >= 60 ? 'conf-high' : pct >= 35 ? 'conf-mid' : 'conf-low'
  return <span className={`conf-pill ${cls}`}>{pct}%</span>
}

function StatRow({ label, value, unit, confidence }) {
  return (
    <div className="stat-row">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}<span className="stat-unit"> {unit}</span></span>
      {confidence != null && <ConfidencePill value={confidence} />}
    </div>
  )
}

export default function EstimatePanel() {
  const { landmarks, scaleRealWorldDist, photos, estimates, setEstimates, setStep } = useTreeSession()

  useEffect(() => {
    const result = estimateTree({ landmarks, scaleRealWorldDist, photos })
    setEstimates(result)
  }, [])

  if (!estimates) return null

  return (
    <motion.div
      className="panel"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
    >
      <div className="panel-body">
        <h2 className="panel-title">Estimate</h2>

        <div className="estimate-section">
          <StatRow label="Species" value={estimates.species_guess} unit="" confidence={estimates.species_confidence} />
          <StatRow label="Health" value={estimates.health_status} unit="" confidence={estimates.health_confidence} />
          <StatRow label="Height" value={estimates.height_ft} unit="ft" />
          <StatRow label="Canopy Width" value={estimates.canopy_width_ft} unit="ft" />
          <StatRow label="DBH" value={estimates.dbh_in} unit="in" />
          <StatRow label="Age Class" value={estimates.age_class} unit="" />
        </div>

        <div className="estimate-confidence">
          <span className="conf-label">Overall confidence</span>
          <ConfidencePill value={estimates.confidence_overall} />
        </div>

        {estimates.warnings.length > 0 && (
          <div className="estimate-warnings">
            {estimates.warnings.map((w, i) => (
              <div key={i} className="warning-row">
                <AlertTriangle size={14} />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        <details className="assumptions-details">
          <summary><Info size={13} /> Assumptions</summary>
          <ul className="assumptions-list">
            {estimates.assumptions.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </details>

        <div className="panel-footer">
          <button className="btn-back" onClick={() => setStep('calibrate')}>
            <ArrowLeft size={16} /> Back
          </button>
          <button className="btn-next" onClick={() => setStep('preview')}>
            Preview <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </motion.div>
  )
}
