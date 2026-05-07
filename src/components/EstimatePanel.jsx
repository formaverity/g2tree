import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, ArrowLeft, AlertTriangle, Info, Leaf, ChevronDown, ChevronUp, Check, GitBranch } from 'lucide-react'
import useTreeSession from '../state/useTreeSession'
import { estimateTree } from '../lib/estimateTree'
import { identifySpeciesFromPhoto } from '../lib/speciesAI'
import { PLANTNET_ORGANS } from '../lib/plantnet'
import { detectTreeStructureFromPhoto } from '../lib/structureAI'
import SaveTreeButton from './SaveTreeButton'
import TextureSampler from './TextureSampler'

const DBH_METHOD_LABEL = {
  user_confirmed:       { text: 'User confirmed',      cls: 'conf-high' },
  landmark_scaled:      { text: 'Landmark + scale',    cls: 'conf-high' },
  known_height_proxy:   { text: 'Known height proxy',  cls: 'conf-mid'  },
  heuristic:            { text: 'Heuristic estimate',  cls: 'conf-low'  },
}

const DISTANCE_OPTIONS = [
  { value: 'unknown',        label: 'Unknown' },
  { value: 'close_trunk',    label: 'Close-up trunk' },
  { value: 'full_tree',      label: 'Full tree' },
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

export default function EstimatePanel() {
  const {
    landmarks, scaleRealWorldDist, showScaleRef,
    photos, estimates, setEstimates,
    userHints, setUserHints, setUserHint,
    speciesAIResult, setSpeciesAIResult,
    treeStructureHints, setTreeStructureHint,
    structureDetectionResult, setStructureDetectionResult,
    setStep,
  } = useTreeSession()

  const [hintsOpen, setHintsOpen] = useState(false)
  const [structureOpen, setStructureOpen] = useState(false)
  const [organHint, setOrganHint] = useState('auto')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState(null)
  const [structureLoading, setStructureLoading] = useState(false)

  // Re-run estimate whenever landmarks, scale, or hints change
  useEffect(() => {
    const result = estimateTree({ landmarks, scaleRealWorldDist, showScaleRef, photos, userHints })
    setEstimates(result)
  }, [
    landmarks, scaleRealWorldDist, showScaleRef,
    userHints.known_dbh_in, userHints.known_height_ft,
    userHints.known_species, userHints.site_type,
    userHints.photo_distance_hint,
  ])

  async function handleIdentifySpecies() {
    if (photos.length === 0) return
    setAiLoading(true)
    setAiError(null)
    try {
      const gps = photos[0]?.exif?.gps
      const result = await identifySpeciesFromPhoto({
        photos,
        organHint,
        lat: gps?.lat ?? null,
        lng: gps?.lng ?? null,
      })
      setSpeciesAIResult(result)
    } catch (err) {
      setAiError(err.message ?? 'Identification failed. Check your connection and try again.')
    } finally {
      setAiLoading(false)
    }
  }

  function useSpecies(name) {
    setUserHint('known_species', name)
  }

  async function handleDetectStructure() {
    setStructureLoading(true)
    try {
      const result = await detectTreeStructureFromPhoto({ photos, landmarks })
      setStructureDetectionResult(result)
      setTreeStructureHint('trunkForm', result.trunkForm)
      setTreeStructureHint('branchDensity', result.branchDensity)
      setTreeStructureHint('canopyDistribution', result.canopyDistribution)
      setTreeStructureHint('leafDistribution', result.leafDistribution)
    } catch (err) {
      // Structure detection is optional — fail silently
    } finally {
      setStructureLoading(false)
    }
  }

  if (!estimates) return null

  const dbhBadge = DBH_METHOD_LABEL[estimates.dbh_method]
  const result = speciesAIResult

  return (
    <motion.div
      className="panel"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
    >
      <div className="panel-body">
        <h2 className="panel-title">Estimate</h2>

        {/* ── Estimates ───────────────────────────────────────────────── */}
        <div className="estimate-section">
          <StatRow
            label="Species"
            value={estimates.species_guess}
            unit=""
            confidence={estimates.species_method === 'user_provided' ? null : estimates.species_confidence}
            badge={estimates.species_method === 'user_provided' ? { text: 'User provided', cls: 'conf-high' } : null}
          />
          <StatRow label="Health"       value={estimates.health_status}    unit="" confidence={estimates.health_confidence} />
          <StatRow label="Height"       value={estimates.height_ft}         unit="ft" />
          <StatRow label="Canopy Width" value={estimates.canopy_width_ft}   unit="ft" />
          <StatRow
            label="DBH"
            value={estimates.dbh_in}
            unit="in"
            confidence={estimates.dbh_method === 'user_confirmed' ? null : estimates.dbh_confidence}
            badge={dbhBadge}
          />
          <StatRow label="Age Class"    value={estimates.age_class}         unit="" />
        </div>

        <div className="estimate-confidence">
          <span className="conf-label">Overall confidence</span>
          <ConfidencePill value={estimates.confidence_overall} />
        </div>

        {/* ── Species AI ──────────────────────────────────────────────── */}
        <div className="species-ai-section">
          <div className="ai-organ-row">
            <span className="ai-organ-label">Organ in photo</span>
            <div className="ai-organ-tabs">
              {PLANTNET_ORGANS.map((o) => (
                <button
                  key={o}
                  className={`ai-organ-tab${organHint === o ? ' active' : ''}`}
                  onClick={() => setOrganHint(o)}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>

          <button
            className="btn-secondary"
            onClick={handleIdentifySpecies}
            disabled={aiLoading || photos.length === 0}
            style={{ width: '100%' }}
          >
            <Leaf size={16} />
            {aiLoading ? 'Identifying…' : 'Identify species from photo'}
          </button>

          <div className="ai-species-warning">
            <AlertTriangle size={12} />
            AI species ID is a field suggestion. Confirm with bark, leaves, site context, season, and local range.
          </div>

          {aiError && (
            <div className="ai-result-error">{aiError}</div>
          )}

          {result && (
            <div className="ai-result-card">
              <div className="ai-result-header">
                <span className="ai-result-provider">
                  {result.provider === 'none' ? 'AI not configured' : result.provider}
                </span>
                {result.confidence > 0 && (
                  <ConfidencePill value={result.confidence} />
                )}
              </div>

              <div className="ai-result-top">
                <div>
                  <div className="ai-result-name">{result.common_name}</div>
                  {result.scientific_name && (
                    <div className="ai-result-sci">{result.scientific_name}</div>
                  )}
                </div>
                {result.enabled !== false && result.common_name !== 'Unknown tree' && (
                  <button
                    className="ai-use-btn"
                    onClick={() => useSpecies(result.common_name)}
                    title="Copy into Known species field"
                  >
                    <Check size={12} />
                    Use
                  </button>
                )}
              </div>

              {result.candidates?.length > 0 && (
                <div className="ai-result-candidates">
                  <span className="ai-candidates-label">Other candidates</span>
                  {result.candidates.map((c, i) => (
                    <div key={i} className="ai-candidate-row">
                      <div className="ai-candidate-info">
                        <span className="ai-candidate-name">{c.common_name}</span>
                        {c.scientific_name && (
                          <span className="ai-candidate-sci">{c.scientific_name}</span>
                        )}
                      </div>
                      <div className="ai-candidate-actions">
                        <ConfidencePill value={c.score ?? c.confidence ?? 0} />
                        <button
                          className="ai-use-btn ai-use-btn-sm"
                          onClick={() => useSpecies(c.common_name)}
                          title="Use this species"
                        >
                          Use
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {result.normStats && (
                <div className="ai-result-norm-stats">
                  <span>{result.normStats.sentCount} photo{result.normStats.sentCount !== 1 ? 's' : ''} sent</span>
                  <span className="norm-stats-sep">·</span>
                  <span>
                    {(result.normStats.totalOriginalBytes / 1_048_576).toFixed(1)} MB
                    {' → '}
                    {(result.normStats.totalOutputBytes / 1_048_576).toFixed(1)} MB
                  </span>
                  {result.normStats.skippedCount > 0 && (
                    <span className="norm-stats-skipped">
                      · {result.normStats.skippedCount} skipped (payload limit)
                    </span>
                  )}
                </div>
              )}

              {result.notes?.map((n, i) => (
                <div key={i} className="ai-result-note">{n}</div>
              ))}
            </div>
          )}
        </div>

        <TextureSampler />

        {/* ── Tree Structure ───────────────────────────────────────────── */}
        <div className="hints-section">
          <button
            className="hints-toggle"
            onClick={() => setStructureOpen((o) => !o)}
          >
            <GitBranch size={14} />
            Tree structure
            {structureOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {structureOpen && (
            <div className="hints-body">
              <p className="hints-desc">
                Structure detection is approximate. Correct these hints if the preview does not match the tree.
              </p>

              <button
                className="btn-secondary"
                onClick={handleDetectStructure}
                disabled={structureLoading || photos.length === 0}
                style={{ width: '100%' }}
              >
                <GitBranch size={15} />
                {structureLoading ? 'Detecting…' : 'Detect structure from photo'}
              </button>

              {structureDetectionResult && (
                <div className="structure-detection-result">
                  <span className="structure-confidence">
                    Detection confidence: {Math.round(structureDetectionResult.detectedStructureConfidence * 100)}%
                  </span>
                  {structureDetectionResult.notes?.map((n, i) => (
                    <div key={i} className="ai-result-note">{n}</div>
                  ))}
                </div>
              )}

              <div className="hints-grid">
                <label className="hints-field" style={{ gridColumn: '1 / -1' }}>
                  <span>Trunk form</span>
                  <select
                    value={treeStructureHints.trunkForm}
                    onChange={(e) => setTreeStructureHint('trunkForm', e.target.value)}
                    className="hints-input hints-select"
                  >
                    <option value="unknown">Unknown</option>
                    <option value="single">Single trunk</option>
                    <option value="forked">Forked trunk</option>
                    <option value="multi">Multi-trunk</option>
                  </select>
                </label>

                {treeStructureHints.trunkForm === 'multi' && (
                  <label className="hints-field">
                    <span>Trunk count</span>
                    <input
                      type="number"
                      min="2"
                      max="5"
                      value={treeStructureHints.trunkCount}
                      onChange={(e) => setTreeStructureHint('trunkCount', parseInt(e.target.value, 10) || 2)}
                      className="hints-input"
                    />
                  </label>
                )}

                <label className="hints-field">
                  <span>Branch density</span>
                  <select
                    value={treeStructureHints.branchDensity}
                    onChange={(e) => setTreeStructureHint('branchDensity', e.target.value)}
                    className="hints-input hints-select"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>

                <label className="hints-field">
                  <span>Canopy distribution</span>
                  <select
                    value={treeStructureHints.canopyDistribution}
                    onChange={(e) => setTreeStructureHint('canopyDistribution', e.target.value)}
                    className="hints-input hints-select"
                  >
                    <option value="sparse">Sparse</option>
                    <option value="medium">Medium</option>
                    <option value="dense">Dense</option>
                    <option value="asymmetric">Asymmetric</option>
                  </select>
                </label>

                <label className="hints-field">
                  <span>Leaf distribution</span>
                  <select
                    value={treeStructureHints.leafDistribution}
                    onChange={(e) => setTreeStructureHint('leafDistribution', e.target.value)}
                    className="hints-input hints-select"
                  >
                    <option value="outer_shell">Outer shell</option>
                    <option value="clustered">Clustered</option>
                    <option value="even">Even</option>
                    <option value="sparse">Sparse</option>
                  </select>
                </label>
              </div>
            </div>
          )}
        </div>

        {/* ── Field Hints ─────────────────────────────────────────────── */}
        <div className="hints-section">
          <button
            className="hints-toggle"
            onClick={() => setHintsOpen((o) => !o)}
          >
            <Info size={14} />
            Field hints
            {hintsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {hintsOpen && (
            <div className="hints-body">
              <p className="hints-desc">
                Providing known values improves accuracy and overrides heuristics.
              </p>

              <div className="hints-grid">
                <label className="hints-field">
                  <span>Known DBH (in)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="e.g. 14.5"
                    value={userHints.known_dbh_in}
                    onChange={(e) => setUserHints({ known_dbh_in: e.target.value })}
                    className="hints-input"
                  />
                </label>

                <label className="hints-field">
                  <span>Known height (ft)</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    placeholder="e.g. 45"
                    value={userHints.known_height_ft}
                    onChange={(e) => setUserHints({ known_height_ft: e.target.value })}
                    className="hints-input"
                  />
                </label>

                <label className="hints-field" style={{ gridColumn: '1 / -1' }}>
                  <span>Known species</span>
                  <input
                    type="text"
                    placeholder="e.g. White Oak"
                    value={userHints.known_species}
                    onChange={(e) => setUserHints({ known_species: e.target.value })}
                    className="hints-input"
                  />
                </label>

                <label className="hints-field">
                  <span>Site type</span>
                  <input
                    type="text"
                    placeholder="e.g. urban park"
                    value={userHints.site_type}
                    onChange={(e) => setUserHints({ site_type: e.target.value })}
                    className="hints-input"
                  />
                </label>

                <label className="hints-field">
                  <span>Photo distance</span>
                  <select
                    value={userHints.photo_distance_hint}
                    onChange={(e) => setUserHints({ photo_distance_hint: e.target.value })}
                    className="hints-input hints-select"
                  >
                    {DISTANCE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          )}
        </div>

        {/* ── Warnings ────────────────────────────────────────────────── */}
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

        {/* ── Assumptions ─────────────────────────────────────────────── */}
        <details className="assumptions-details">
          <summary><Info size={13} /> Assumptions</summary>
          <ul className="assumptions-list">
            {estimates.assumptions.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </details>

        <SaveTreeButton />

        <div className="panel-footer">
          <button className="btn-back" onClick={() => setStep('calibrate')}>
            <ArrowLeft size={16} /> Back
          </button>
          <button className="btn-secondary" onClick={() => setStep('scaffold')}>
            Scaffold <ArrowRight size={16} />
          </button>
          <button className="btn-next" onClick={() => setStep('preview')}>
            Preview <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </motion.div>
  )
}
