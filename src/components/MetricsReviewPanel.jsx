import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, ArrowLeft, RotateCcw, Leaf, Ruler, TreePine } from 'lucide-react'
import useTreeSession from '../state/useTreeSession'
import { estimateTreeMetrics, effectiveValue } from '../lib/treeMetrics'

// ── Confidence dot ─────────────────────────────────────────────────────────────
function ConfDot({ value }) {
  const cls   = value >= 0.60 ? 'hi' : value >= 0.35 ? 'mid' : 'lo'
  const label = value >= 0.60 ? 'high' : value >= 0.35 ? 'med' : 'low'
  return <span className={`mp-conf-dot mp-conf-${cls}`}>{label}</span>
}

// ── Custom range slider ─────────────────────────────────────────────────────────
function MetricSlider({
  label, unit, value, estimated,
  min, max, step, confidence,
  isOverridden, onChange, onReset,
}) {
  const fillPct = Math.round(((value - min) / (max - min)) * 1000) / 10

  return (
    <div className="mp-slider-block">
      <div className="mp-slider-header">
        <span className="mp-slider-label">{label}</span>
        <div className="mp-slider-end">
          <AnimatePresence>
            {isOverridden && (
              <motion.button
                className="mp-reset-btn"
                onClick={onReset}
                title="Reset to estimated value"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.15 }}
              >
                <RotateCcw size={10} />
                reset
              </motion.button>
            )}
          </AnimatePresence>
          <ConfDot value={confidence} />
        </div>
      </div>

      <div className="mp-value-row">
        <span className="mp-value-main">{value.toFixed(1)}</span>
        <span className="mp-value-unit">{unit}</span>
        {isOverridden && estimated != null && (
          <span className="mp-value-est">est. {estimated.toFixed(1)}</span>
        )}
      </div>

      <input
        type="range"
        className="mp-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ '--fill': fillPct }}
      />

      <div className="mp-range-ends">
        <span>{min} {unit}</span>
        <span>{max} {unit}</span>
      </div>
    </div>
  )
}

// ── Health dot-matrix ──────────────────────────────────────────────────────────
function HealthDots({ score }) {
  const filled = Math.round(score / 20)
  const color  = score >= 70 ? 'var(--green-bright)'
    : score >= 45 ? 'var(--amber)'
    : '#e05050'
  return (
    <div className="mp-health-dots" aria-label={`Health ${score}%`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className="mp-health-dot"
          style={{ background: i <= filled ? color : undefined }}
        />
      ))}
    </div>
  )
}

// ── Age chip ───────────────────────────────────────────────────────────────────
const AGE_ORDER = ['seedling', 'sapling', 'young', 'mid-age', 'mature', 'old-growth']

function AgeChip({ ageClass }) {
  const idx   = AGE_ORDER.indexOf(ageClass)
  const fill  = idx / (AGE_ORDER.length - 1)
  const color = fill < 0.4 ? 'var(--green-mid)'
    : fill < 0.75 ? 'var(--green-bright)'
    : 'var(--amber)'
  return <span className="mp-age-chip" style={{ borderColor: color, color }}>{ageClass}</span>
}

// ── Notes list ─────────────────────────────────────────────────────────────────
function NotesList({ notes }) {
  if (!notes?.length) return null
  // Show only diagnostic notes (skip the plain measurement echoes)
  const display = notes.filter((n) =>
    n.toLowerCase().includes('no ') ||
    n.toLowerCase().includes('low conf') ||
    n.toLowerCase().includes('add a') ||
    n.toLowerCase().includes('estimated via') ||
    n.toLowerCase().includes('image analysis') ||
    n.toLowerCase().includes('allometry') ||
    n.toLowerCase().includes('prior')
  )
  if (!display.length) return null
  return (
    <div className="mp-notes">
      {display.map((n, i) => <p key={i} className="mp-note">{n}</p>)}
    </div>
  )
}

// ── Main panel ─────────────────────────────────────────────────────────────────
export default function MetricsReviewPanel() {
  const {
    scanState, setScanState,
    setStep,
  } = useTreeSession()

  const [metrics, setMetrics] = useState(null)

  // ── Compute or rehydrate metrics on mount ─────────────────────────────────
  useEffect(() => {
    const existing = scanState.estimatedMetrics
    if (existing?.dbhCm != null) {
      setMetrics(existing)
      return
    }

    const computed = estimateTreeMetrics({
      speciesResult:   scanState.speciesResult,
      visionAnalysis:  scanState.visionAnalysis,
      visionDepth:     scanState.visionDepth,
      selectedLocation: scanState.selectedLocation,
      scaleHintFt:     scanState.scaleHintFt,
      userHints:       scanState.userHints ?? {},
    })

    setScanState({ estimatedMetrics: computed })
    setMetrics(computed)
  }, [])

  // ── Persist changes to store ───────────────────────────────────────────────
  function update(next) {
    setMetrics(next)
    setScanState({ estimatedMetrics: next })
  }

  // ── Override handlers ──────────────────────────────────────────────────────
  function setOverride(key, rawValue) {
    if (!metrics) return
    const value = parseFloat(rawValue.toFixed(1))
    const next = {
      ...metrics,
      overrides: { ...metrics.overrides, [key]: value },
    }
    update(next)
  }

  function resetOverride(key) {
    if (!metrics) return
    const next = {
      ...metrics,
      overrides: { ...metrics.overrides, [key]: null },
    }
    update(next)
  }

  if (!metrics) {
    return (
      <motion.div className="panel" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <div className="panel-body mp-loading">
          <span>Computing metrics…</span>
        </div>
      </motion.div>
    )
  }

  const heightEff = effectiveValue(metrics, 'heightM')
  const dbhEff    = effectiveValue(metrics, 'dbhCm')
  const crownEff  = effectiveValue(metrics, 'crownSpreadM')

  const speciesName = scanState.speciesResult?.common_name
    ?? scanState.userHints?.known_species
    ?? null

  return (
    <motion.div
      className="panel"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
    >
      <div className="panel-body">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="mp-header">
          <div className="mp-title-row">
            <TreePine size={16} className="mp-title-icon" />
            <h2 className="panel-title" style={{ margin: 0 }}>Tree Metrics</h2>
          </div>
          {speciesName && (
            <div className="mp-species-row">
              <Leaf size={12} className="mp-species-icon" />
              <span className="mp-species-name">{speciesName}</span>
              {scanState.speciesResult?.scientific_name && (
                <em className="mp-species-sci">{scanState.speciesResult.scientific_name}</em>
              )}
            </div>
          )}
        </div>

        {/* ── Overview strip ──────────────────────────────────────────── */}
        <div className="mp-overview">
          <div className="mp-ov-cell">
            <span className="mp-ov-label">Health</span>
            <span
              className="mp-ov-value"
              style={{
                color: metrics.healthScore >= 70 ? 'var(--green-bright)'
                  : metrics.healthScore >= 45 ? 'var(--amber)' : '#e05050',
              }}
            >
              {metrics.healthScore}%
            </span>
            <HealthDots score={metrics.healthScore} />
          </div>

          <div className="mp-ov-divider" />

          <div className="mp-ov-cell">
            <span className="mp-ov-label">Age class</span>
            <AgeChip ageClass={metrics.ageClass} />
          </div>

          <div className="mp-ov-divider" />

          <div className="mp-ov-cell">
            <span className="mp-ov-label">Canopy</span>
            <span className="mp-ov-value">{metrics.canopyDensity}%</span>
            <div className="mp-canopy-bar">
              <div
                className="mp-canopy-fill"
                style={{ width: `${metrics.canopyDensity}%` }}
              />
            </div>
          </div>
        </div>

        {/* ── Sliders ─────────────────────────────────────────────────── */}
        <div className="mp-sliders">
          <MetricSlider
            label="HEIGHT"
            unit="m"
            value={heightEff}
            estimated={metrics.heightM}
            min={2}
            max={70}
            step={0.5}
            confidence={metrics.confidence.height}
            isOverridden={metrics.overrides.heightM != null}
            onChange={(v) => setOverride('heightM', v)}
            onReset={() => resetOverride('heightM')}
          />

          <MetricSlider
            label="DIAMETER AT BREAST HEIGHT"
            unit="cm"
            value={dbhEff}
            estimated={metrics.dbhCm}
            min={2}
            max={250}
            step={1}
            confidence={metrics.confidence.dbh}
            isOverridden={metrics.overrides.dbhCm != null}
            onChange={(v) => setOverride('dbhCm', v)}
            onReset={() => resetOverride('dbhCm')}
          />

          <MetricSlider
            label="CROWN SPREAD"
            unit="m"
            value={crownEff}
            estimated={metrics.crownSpreadM}
            min={1}
            max={35}
            step={0.5}
            confidence={metrics.confidence.crownSpread}
            isOverridden={metrics.overrides.crownSpreadM != null}
            onChange={(v) => setOverride('crownSpreadM', v)}
            onReset={() => resetOverride('crownSpreadM')}
          />
        </div>

        {/* ── Secondary metrics (read-only) ──────────────────────────── */}
        <div className="mp-secondary">
          <div className="mp-sec-row">
            <span className="mp-sec-label">Crown radius</span>
            <span className="mp-sec-value">{(crownEff / 2).toFixed(1)} m</span>
          </div>
          <div className="mp-sec-row">
            <span className="mp-sec-label">DBH (imperial)</span>
            <span className="mp-sec-value">{(dbhEff / 2.54).toFixed(1)} in</span>
          </div>
          <div className="mp-sec-row">
            <span className="mp-sec-label">Height (imperial)</span>
            <span className="mp-sec-value">{(heightEff * 3.2808).toFixed(1)} ft</span>
          </div>
          <div className="mp-sec-row">
            <span className="mp-sec-label">Species confidence</span>
            <span className="mp-sec-value">
              {Math.round(metrics.confidence.species * 100)}%
            </span>
          </div>
        </div>

        {/* ── Estimation notes ────────────────────────────────────────── */}
        <NotesList notes={metrics.notes} />

        {/* ── Ruler decoration ──────────────────────────────────────── */}
        <div className="mp-ruler">
          <Ruler size={11} className="mp-ruler-icon" />
          <span>Adjust sliders to correct field measurements. Overrides are stored alongside estimates.</span>
        </div>

        {/* ── Footer navigation ───────────────────────────────────────── */}
        <div className="panel-footer">
          <button className="btn-back" onClick={() => setStep('capture')}>
            <ArrowLeft size={16} /> Back
          </button>
          <button className="btn-next" onClick={() => setStep('benefits')}>
            Benefits <ArrowRight size={16} />
          </button>
        </div>

      </div>
    </motion.div>
  )
}
