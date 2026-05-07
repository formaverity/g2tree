import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, ArrowLeft, AlertTriangle, Leaf, ChevronDown, ChevronUp, Info } from 'lucide-react'
import useTreeSession from '../state/useTreeSession'
import { estimateTree } from '../lib/estimateTree'
import { identifySpeciesFromPhoto } from '../lib/speciesAI'
import { PLANTNET_ORGANS } from '../lib/plantnet'
import SaveTreeButton from './SaveTreeButton'

const DBH_METHOD_LABEL = {
  user_confirmed:       { text: 'User confirmed',      cls: 'conf-high' },
  landmark_scaled:      { text: 'Landmark + scale',    cls: 'conf-high' },
  known_height_proxy:   { text: 'Known height proxy',  cls: 'conf-mid'  },
  heuristic:            { text: 'Heuristic estimate',  cls: 'conf-low'  },
}

const DISTANCE_OPTIONS = [
  { value: 'unknown',         label: 'Unknown' },
  { value: 'close_trunk',     label: 'Close-up trunk' },
  { value: 'full_tree',       label: 'Full tree' },
  { value: 'base_looking_up', label: 'Base looking up' },
]

function ConfidencePill({ value }) {
  const pct = Math.round(value * 100)
  const cls = pct >= 60 ? 'conf-high' : pct >= 35 ? 'conf-mid' : 'conf-low'
  return <span className={`conf-pill ${cls}`}>{pct}%</span>
}

function StatRow({ label, value, unit, confidence, badge }) {
  return (
    <div className="stat-row">
      <span className="stat-label">{label}</span>
      <span className="stat-value">
        {value}<span className="stat-unit"> {unit}</span>
      </span>
      {badge && <span className={`conf-pill ${badge.cls}`}>{badge.text}</span>}
      {confidence != null && !badge && <ConfidencePill value={confidence} />}
    </div>
  )
}

export default function IdentifyPanel() {
  const {
    landmarks, scaleRealWorldDist, showScaleRef,
    photos, estimates, setEstimates,
    userHints, setUserHints, setUserHint,
    speciesAIResult, setSpeciesAIResult,
    setStep,
  } = useTreeSession()

  const [hintsOpen, setHintsOpen] = useState(false)
  const [organHint, setOrganHint] = useState('auto')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError]     = useState(null)

  useEffect(() => {
    const result = estimateTree({ landmarks, scaleRealWorldDist, showScaleRef, photos, userHints })
    setEstimates(result)
  }, [
    landmarks, scaleRealWorldDist, showScaleRef,
    userHints.known_dbh_in, userHints.known_height_ft,
    userHints.known_species, userHints.site_type,
    userHints.photo_distance_hint,
  ])

  function selectCandidate(c, idx) {
    const newResult = {
      ...result,
      common_name:     c.common_name,
      scientific_name: c.scientific_name,
      confidence:      c.score ?? 0,
      candidates: [
        { common_name: result.common_name, scientific_name: result.scientific_name, score: result.confidence },
        ...result.candidates.filter((_, i) => i !== idx),
      ],
    }
    setSpeciesAIResult(newResult)
    setUserHints({ known_species: c.common_name ?? c.scientific_name ?? '' })
  }

  async function handleIdentifySpecies() {
    if (photos.length === 0) return
    setAiLoading(true)
    setAiError(null)
    try {
      const gps    = photos[0]?.exif?.gps
      const result = await identifySpeciesFromPhoto({
        photos,
        organHint,
        lat: gps?.lat ?? null,
        lng: gps?.lng ?? null,
      })
      setSpeciesAIResult(result)
    } catch (err) {
      setAiError(err.message ?? 'Identification failed. Check your connection.')
    } finally {
      setAiLoading(false)
    }
  }

  if (!estimates) return null

  const dbhBadge = DBH_METHOD_LABEL[estimates.dbh_method]
  const result   = speciesAIResult

  return (
    <motion.div
      className="panel panel-identify"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
    >
      <div className="panel-body">
        <h2 className="panel-title">Identify</h2>
        <p className="panel-desc">Measure the tree and identify its species before scaffolding.</p>

        {photos.length > 0 && (
          <div className="ai-photo-strip">
            {photos.map((p) => (
              <img key={p.id} src={p.url} className="ai-photo-thumb" alt="" />
            ))}
          </div>
        )}

        {/* ── Measurements ─────────────────────────────────────────────── */}
        <div className="estimate-section">
          <StatRow label="Species"      value={estimates.species_guess}     unit=""   confidence={estimates.species_method === 'user_provided' ? null : estimates.species_confidence} badge={estimates.species_method === 'user_provided' ? { text: 'User provided', cls: 'conf-high' } : null} />
          <StatRow label="Health"       value={estimates.health_status}     unit=""   confidence={estimates.health_confidence} />
          <StatRow label="Height"       value={estimates.height_ft}         unit="ft" />
          <StatRow label="Canopy width" value={estimates.canopy_width_ft}   unit="ft" />
          <StatRow label="DBH"          value={estimates.dbh_in}            unit="in" confidence={estimates.dbh_method === 'user_confirmed' ? null : estimates.dbh_confidence} badge={dbhBadge} />
          <StatRow label="Age class"    value={estimates.age_class}         unit=""   />
        </div>

        <div className="estimate-confidence">
          <span className="conf-label">Overall confidence</span>
          <ConfidencePill value={estimates.confidence_overall} />
        </div>

        {/* ── Species AI ───────────────────────────────────────────────── */}
        <div className="species-ai-section">
          <div className="ai-organ-row">
            <span className="ai-organ-label">Organ in photo</span>
            <div className="ai-organ-tabs">
              {PLANTNET_ORGANS.map((o) => (
                <button key={o} className={`ai-organ-tab${organHint === o ? ' active' : ''}`} onClick={() => setOrganHint(o)}>
                  {o}
                </button>
              ))}
            </div>
          </div>

          <button className="btn-secondary" onClick={handleIdentifySpecies} disabled={aiLoading || photos.length === 0} style={{ width: '100%' }}>
            <Leaf size={16} />
            {aiLoading ? 'Identifying…' : 'Identify species from photo'}
          </button>

          <div className="ai-species-warning">
            <AlertTriangle size={12} />
            AI species ID is a field suggestion. Confirm with bark, leaves, site context, season, and local range.
          </div>

          {aiError && <div className="ai-result-error">{aiError}</div>}

          {result && (
            <div className="ai-result-card">
              <div className="ai-result-header">
                <span className="ai-result-provider">{result.provider === 'none' ? 'AI not configured' : result.provider}</span>
                {result.confidence > 0 && <ConfidencePill value={result.confidence} />}
              </div>
              {result.common_name && (
                <div className="ai-result-name">
                  <span className="ai-common">{result.common_name}</span>
                  {result.scientific_name && <em className="ai-scientific">{result.scientific_name}</em>}
                </div>
              )}
              {result.candidates?.length > 0 && (
                <div className="ai-candidates">
                  {result.candidates.map((c, i) => (
                    <button key={i} className="ai-candidate-row" onClick={() => selectCandidate(c, i)}>
                      <div className="ai-candidate-info">
                        <span className="ai-candidate-name">{c.common_name ?? c.scientific_name}</span>
                        {c.scientific_name && c.common_name && (
                          <em className="ai-candidate-sci">{c.scientific_name}</em>
                        )}
                      </div>
                      <ConfidencePill value={c.score ?? 0} />
                    </button>
                  ))}
                </div>
              )}
              {result.notes?.map((n, i) => <div key={i} className="ai-result-note">{n}</div>)}
            </div>
          )}
        </div>

        {/* ── Field Hints ───────────────────────────────────────────────── */}
        <div className="hints-section">
          <button className="hints-toggle" onClick={() => setHintsOpen((o) => !o)}>
            <Info size={14} />
            Field hints
            {hintsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {hintsOpen && (
            <div className="hints-body">
              <p className="hints-desc">Known values override heuristic estimates.</p>
              <div className="hints-grid">
                <label className="hints-field">
                  <span>Known DBH (in)</span>
                  <input type="number" min="0" step="0.1" placeholder="e.g. 14.5" value={userHints.known_dbh_in} onChange={(e) => setUserHints({ known_dbh_in: e.target.value })} className="hints-input" />
                </label>
                <label className="hints-field">
                  <span>Known height (ft)</span>
                  <input type="number" min="0" step="1" placeholder="e.g. 45" value={userHints.known_height_ft} onChange={(e) => setUserHints({ known_height_ft: e.target.value })} className="hints-input" />
                </label>
                <label className="hints-field" style={{ gridColumn: '1 / -1' }}>
                  <span>Known species</span>
                  <input type="text" placeholder="e.g. White Oak" value={userHints.known_species} onChange={(e) => setUserHints({ known_species: e.target.value })} className="hints-input" />
                </label>
                <label className="hints-field">
                  <span>Site type</span>
                  <input type="text" placeholder="e.g. urban park" value={userHints.site_type} onChange={(e) => setUserHints({ site_type: e.target.value })} className="hints-input" />
                </label>
                <label className="hints-field">
                  <span>Photo distance</span>
                  <select value={userHints.photo_distance_hint} onChange={(e) => setUserHints({ photo_distance_hint: e.target.value })} className="hints-input hints-select">
                    {DISTANCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              </div>
            </div>
          )}
        </div>

        {estimates.warnings?.length > 0 && (
          <div className="estimate-warnings">
            {estimates.warnings.map((w, i) => (
              <div key={i} className="warning-row"><AlertTriangle size={14} /><span>{w}</span></div>
            ))}
          </div>
        )}

        <SaveTreeButton />

        <div className="panel-footer">
          <button className="btn-back" onClick={() => setStep('review')}>
            <ArrowLeft size={16} /> Review
          </button>
          <button className="btn-next" onClick={() => setStep('calibrate')}>
            Calibrate <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </motion.div>
  )
}
