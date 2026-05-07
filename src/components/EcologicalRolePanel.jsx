import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, ArrowLeft, Leaf, Droplets, Sun, Wind, TreePine, Info } from 'lucide-react'
import useTreeSession from '../state/useTreeSession'
import { estimateEcologicalBenefits } from '../lib/ecologicalBenefits'
import { effectiveValue } from '../lib/treeMetrics'

// ── Confidence pill ────────────────────────────────────────────────────────────
function ConfPill({ value }) {
  const tier  = value >= 0.60 ? 'hi' : value >= 0.35 ? 'mid' : 'lo'
  const label = value >= 0.60 ? 'high confidence' : value >= 0.35 ? 'moderate' : 'low confidence'
  return <span className={`erp-conf erp-conf-${tier}`}>{label}</span>
}

// ── Score arc (simple SVG ring) ────────────────────────────────────────────────
function ScoreArc({ score, color }) {
  const r   = 22
  const c   = 2 * Math.PI * r
  const fill = c * (1 - score / 100)
  return (
    <svg className="erp-arc" width={52} height={52} viewBox="0 0 52 52">
      <circle cx={26} cy={26} r={r} className="erp-arc-track" />
      <circle
        cx={26} cy={26} r={r}
        className="erp-arc-fill"
        stroke={color}
        strokeDasharray={c}
        strokeDashoffset={fill}
        transform="rotate(-90 26 26)"
      />
      <text x={26} y={30} className="erp-arc-label" textAnchor="middle">{score}</text>
    </svg>
  )
}

// ── Benefit card ───────────────────────────────────────────────────────────────
function BenefitCard({ icon: Icon, title, value, unit, subtext, confidence, color, delay = 0 }) {
  return (
    <motion.div
      className="erp-card"
      style={{ '--card-accent': color }}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
    >
      <div className="erp-card-icon-wrap" style={{ color }}>
        <Icon size={18} />
      </div>
      <div className="erp-card-body">
        <div className="erp-card-title">{title}</div>
        <div className="erp-card-value">
          {typeof value === 'number'
            ? value.toLocaleString()
            : value}
          {unit && <span className="erp-card-unit"> {unit}</span>}
        </div>
        {subtext && <div className="erp-card-sub">{subtext}</div>}
      </div>
      {confidence != null && (
        <div className="erp-card-conf">
          <ConfPill value={confidence} />
        </div>
      )}
    </motion.div>
  )
}

// ── Score card ─────────────────────────────────────────────────────────────────
function ScoreCard({ icon: Icon, title, score, description, color, delay = 0 }) {
  return (
    <motion.div
      className="erp-card erp-score-card"
      style={{ '--card-accent': color }}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
    >
      <ScoreArc score={score} color={color} />
      <div className="erp-card-body">
        <div className="erp-card-title">{title}</div>
        <div className="erp-card-sub">{description}</div>
      </div>
    </motion.div>
  )
}

// ── Main panel ─────────────────────────────────────────────────────────────────
export default function EcologicalRolePanel() {
  const { scanState, setStep } = useTreeSession()

  const metrics = scanState?.estimatedMetrics
  const species = scanState?.speciesResult

  const benefits = useMemo(() => {
    if (!metrics) return null
    return estimateEcologicalBenefits({
      speciesResult:  species,
      dbhCm:          effectiveValue(metrics, 'dbhCm'),
      heightM:        effectiveValue(metrics, 'heightM'),
      crownSpreadM:   effectiveValue(metrics, 'crownSpreadM'),
      canopyDensity:  metrics.canopyDensity ?? 65,
      healthScore:    metrics.healthScore   ?? 75,
      confidence:     metrics.confidence    ?? {},
    })
  }, [metrics, species])

  const speciesLabel = species?.common_name ?? metrics?.species_guess ?? null
  const sciLabel     = species?.scientific_name ?? null

  if (!benefits) {
    return (
      <motion.div className="panel" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <div className="panel-body erp-loading">
          <Leaf size={22} className="erp-loading-icon" />
          <span>Estimating ecological role…</span>
        </div>
      </motion.div>
    )
  }

  const b = benefits

  return (
    <motion.div
      className="panel"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
    >
      <div className="panel-body">

        {/* ── Header ────────────────────────────────────────────────── */}
        <div className="erp-header">
          <div className="erp-title-row">
            <TreePine size={16} className="erp-title-icon" />
            <h2 className="panel-title" style={{ margin: 0 }}>Ecological Role</h2>
          </div>
          {speciesLabel && (
            <div className="erp-species-row">
              <span className="erp-species-name">{speciesLabel}</span>
              {sciLabel && <em className="erp-species-sci">{sciLabel}</em>}
            </div>
          )}
          <p className="erp-subtitle">
            Estimated ecological benefits · {b.meta.method}
          </p>
        </div>

        {/* ── Carbon section ──────────────────────────────────────────── */}
        <div className="erp-section-label">Carbon</div>
        <div className="erp-cards">
          <BenefitCard
            icon={Leaf}
            title="Carbon stored"
            value={b.carbon_storage_kg}
            unit="kg C"
            subtext="Above-ground biomass (Nowak allometric)"
            confidence={b.confidence.carbon}
            color="var(--green-bright)"
            delay={0.05}
          />
          <BenefitCard
            icon={Wind}
            title="Annual uptake"
            value={b.annual_carbon_sequestration_kg}
            unit="kg C / yr"
            subtext="Growth-rate adjusted for tree maturity"
            confidence={b.confidence.sequestration}
            color="var(--green-mid)"
            delay={0.10}
          />
        </div>

        {/* ── Water section ───────────────────────────────────────────── */}
        <div className="erp-section-label">Water</div>
        <div className="erp-cards">
          <BenefitCard
            icon={Droplets}
            title="Stormwater intercepted"
            value={b.annual_stormwater_intercepted_liters}
            unit="L / yr"
            subtext="Canopy LAI × crown area × local precip"
            confidence={b.confidence.stormwater}
            color="#7ec8e3"
            delay={0.15}
          />
          <BenefitCard
            icon={Droplets}
            title="Shade footprint"
            value={b.shade_area_m2}
            unit="m²"
            subtext="Direct canopy projection area"
            confidence={b.confidence.shade}
            color="var(--amber)"
            delay={0.20}
          />
        </div>

        {/* ── Scores section ──────────────────────────────────────────── */}
        <div className="erp-section-label">Benefit scores</div>
        <div className="erp-score-grid">
          <ScoreCard
            icon={Sun}
            title="Cooling"
            score={b.cooling_score}
            description="Shade + transpiration"
            color="var(--amber)"
            delay={0.25}
          />
          <ScoreCard
            icon={Leaf}
            title="Habitat"
            score={b.habitat_score}
            description="Crown volume × health"
            color="var(--green-bright)"
            delay={0.30}
          />
          <ScoreCard
            icon={Droplets}
            title="Runoff"
            score={b.avoided_runoff_score}
            description="Avoided urban runoff"
            color="#7ec8e3"
            delay={0.35}
          />
        </div>

        {/* ── Disclaimer ──────────────────────────────────────────────── */}
        <div className="erp-disclaimer">
          <Info size={11} className="erp-disclaimer-icon" />
          <span>{b.meta.disclaimer}</span>
        </div>

        {/* ── Footer navigation ───────────────────────────────────────── */}
        <div className="panel-footer">
          <button className="btn-back" onClick={() => setStep('metrics')}>
            <ArrowLeft size={16} /> Metrics
          </button>
          <button className="btn-next" onClick={() => setStep('identify')}>
            Identify <ArrowRight size={16} />
          </button>
        </div>

      </div>
    </motion.div>
  )
}
