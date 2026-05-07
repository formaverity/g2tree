import { useState, useEffect, useRef } from 'react'
import {
  Leaf, Loader, AlertTriangle, CheckCircle2,
  RefreshCw, Edit3, HelpCircle, Layers, Eye, EyeOff,
} from 'lucide-react'
import useTreeSession from '../state/useTreeSession'
import { analyzeSpecies } from '../lib/speciesAnalysis'
import { loadDepthModel, estimateDepth, isDepthUnavailable } from '../lib/depthEstimation'
import DepthOverlay from './DepthOverlay'

// ── Helpers ────────────────────────────────────────────────────────────────────

function ConfPill({ value }) {
  const pct = Math.round(value * 100)
  const cls = pct >= 60 ? 'conf-high' : pct >= 35 ? 'conf-mid' : 'conf-low'
  return <span className={`conf-pill ${cls}`}>{pct}%</span>
}

function ConfBar({ value }) {
  const pct = Math.round(value * 100)
  const color = pct >= 60 ? 'var(--green-mid)' : pct >= 35 ? 'var(--amber)' : '#c06050'
  return (
    <div className="ir-conf-bar-track">
      <div className="ir-conf-bar-fill" style={{ width: `${pct}%`, background: color }} />
      <span className="ir-conf-pct">{pct}%</span>
    </div>
  )
}

const ORGAN_LABELS = { auto:'auto', leaf:'leaf', flower:'flower', fruit:'fruit', bark:'bark', habit:'habit', other:'other' }

// ── Photo source thumbnails ────────────────────────────────────────────────────
function SourceThumbs({ barkImage, detailImage, primaryImage, detailOrgan }) {
  const slots = [
    detailImage  && { img: detailImage,  organ: ORGAN_LABELS[detailOrgan] ?? detailOrgan },
    barkImage    && { img: barkImage,    organ: 'bark' },
    primaryImage && { img: primaryImage, organ: 'habit' },
  ].filter(Boolean)

  if (!slots.length) return null

  return (
    <div className="ir-source-row">
      <span className="ir-source-heading">Analyzing</span>
      <div className="ir-source-thumbs">
        {slots.map(({ img, organ }, i) => (
          <div key={i} className="ir-source-thumb-wrap">
            <img src={img.url} alt={organ} className="ir-source-thumb" />
            <span className="ir-thumb-organ">{organ}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Depth card ────────────────────────────────────────────────────────────────
// depthStatus: 'idle' | 'loading' | 'ready' | 'unavailable'
function DepthCard({ primaryImage, depthStatus, depthData, showOverlay, onToggleOverlay }) {
  if (!primaryImage || depthStatus === 'idle') return null

  return (
    <div className="ir-depth-card">
      <div className="ir-depth-header">
        <Layers size={13} className="ir-depth-icon" />
        <span className="ir-depth-title">Depth Estimation</span>

        {depthStatus === 'loading' && (
          <span className="ir-depth-status ir-depth-status--loading">
            <Loader size={11} className="spin" />
            estimating…
          </span>
        )}

        {depthStatus === 'unavailable' && (
          <span className="ir-depth-status ir-depth-status--unavailable">
            unavailable — heuristic mode
          </span>
        )}

        {depthStatus === 'ready' && (
          <button
            className={`ir-depth-toggle ${showOverlay ? 'active' : ''}`}
            onClick={onToggleOverlay}
            title={showOverlay ? 'Hide depth map' : 'Show depth map'}
          >
            {showOverlay ? <EyeOff size={12} /> : <Eye size={12} />}
            {showOverlay ? 'Hide' : 'Show'}
          </button>
        )}
      </div>

      {depthStatus === 'ready' && (
        <div className="ir-depth-preview-wrap">
          <img
            src={primaryImage.url}
            alt="primary"
            className="ir-depth-preview-img"
          />
          {showOverlay && depthData && (
            <DepthOverlay depthData={depthData} opacity={0.7} />
          )}
          {depthStatus === 'ready' && !showOverlay && (
            <div className="ir-depth-preview-hint">depth map ready</div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function InterpretationReview() {
  const {
    scanState, setScanState,
    setSpeciesAIResult, setUserHints,
  } = useTreeSession()

  // Species view: 'idle' | 'loading' | 'result' | 'unavailable' | 'confirmed'
  const [view, setView]           = useState('idle')
  const [error, setError]         = useState(null)
  const [detailOrgan, setDetailOrgan] = useState('auto')
  const [manualInput, setManualInput] = useState('')

  // Depth state — runs in parallel with species ID
  const [depthStatus,     setDepthStatus]     = useState('idle')
  const [depthData,       setDepthData]       = useState(null)
  const [showDepthOverlay, setShowDepthOverlay] = useState(false)
  const depthAbortRef = useRef(false)  // guard against stale async updates

  const { barkImage, detailImage, primaryImage } = scanState
  const result    = scanState.speciesResult
  const hasImages = barkImage || detailImage || primaryImage

  // ── On mount: rehydrate species view + kick off depth estimation ───────────
  useEffect(() => {
    // Rehydrate species view
    if (result?.confirmed) { setView('confirmed') }
    else if (result?.enabled)          { setView('result') }
    else if (result && !result.enabled){ setView('unavailable') }
    else if (hasImages)                { runAnalysis() }

    // Start depth estimation (lazy — model only loads now)
    if (primaryImage && !isDepthUnavailable()) {
      depthAbortRef.current = false
      runDepthEstimation()
    }

    return () => { depthAbortRef.current = true }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Depth estimation ───────────────────────────────────────────────────────
  async function runDepthEstimation() {
    if (!primaryImage) return
    setDepthStatus('loading')
    try {
      await loadDepthModel()
      const result = await estimateDepth(primaryImage.url)
      if (depthAbortRef.current) return
      setDepthData(result)
      // Store the low-res grid in scan state for downstream procedural use
      setScanState({
        visionDepth: { grid: result.grid, width: result.width, height: result.height },
      })
      setDepthStatus('ready')
    } catch {
      if (!depthAbortRef.current) setDepthStatus('unavailable')
    }
  }

  // ── Species analysis ───────────────────────────────────────────────────────
  async function runAnalysis() {
    if (!hasImages) { setError('No photos captured yet.'); return }
    setView('loading')
    setError(null)
    try {
      const res = await analyzeSpecies({
        primaryImage, barkImage, detailImage, detailOrgan,
        location: scanState.selectedLocation,
      })
      setScanState({ speciesResult: { ...res, confirmed: false } })
      setView(res.enabled ? 'result' : 'unavailable')
    } catch (e) {
      setError(e.message)
      setView('result')
    }
  }

  // ── Species confirmation ───────────────────────────────────────────────────
  function confirmSpecies(commonName, scientificName, confidence) {
    const payload = {
      ...(result ?? {}),
      common_name: commonName, scientific_name: scientificName,
      confidence: confidence ?? 0,
      provider: result?.provider ?? 'plantnet',
      enabled: true, confirmed: true,
    }
    setScanState({ speciesResult: payload })
    setSpeciesAIResult(payload)
    setUserHints({ known_species: commonName ?? scientificName ?? '' })
    setView('confirmed')
  }

  function applyManual() {
    const name = manualInput.trim()
    if (!name) return
    const payload = {
      provider: 'manual', enabled: true,
      common_name: name, scientific_name: null,
      family: null, genus: null, confidence: 1,
      candidates: [], notes: [], normStats: null, raw: null,
      confirmed: true,
    }
    setScanState({ speciesResult: payload })
    setSpeciesAIResult(payload)
    setUserHints({ known_species: name })
    setView('confirmed')
  }

  function continueUnknown() {
    const payload = {
      provider: 'unknown', enabled: true,
      common_name: null, scientific_name: null,
      confidence: 0, candidates: [], confirmed: true,
    }
    setScanState({ speciesResult: payload })
    setView('confirmed')
  }

  function reset() {
    setScanState({ speciesResult: null })
    setManualInput('')
    setView('idle')
    setError(null)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIRMED VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  if (view === 'confirmed') {
    const r         = scanState.speciesResult
    const isUnknown = r?.provider === 'unknown' || !r?.common_name
    const isManual  = r?.provider === 'manual'

    return (
      <div className="interp-step">
        <div className="ir-confirmed-card">
          <CheckCircle2 size={18} className="ir-confirmed-check" />
          <div className="ir-confirmed-body">
            {isUnknown ? (
              <span className="ir-confirmed-name ir-unknown-label">Unknown species</span>
            ) : (
              <>
                <span className="ir-confirmed-name">{r.common_name}</span>
                {r.scientific_name && <em className="ir-confirmed-sci">{r.scientific_name}</em>}
              </>
            )}
            {isManual && <span className="ir-confirmed-tag">manual entry</span>}
            {!isManual && !isUnknown && r?.imageSources?.length > 0 && (
              <span className="ir-confirmed-tag">{r.imageSources.join(' · ')}</span>
            )}
          </div>
          <button className="ir-change-btn" onClick={reset}>Change</button>
        </div>

        {!isUnknown && !isManual && (
          <div className="ir-confirmed-detail">
            {r.scientific_name && <em className="ir-confirmed-sci-full">{r.scientific_name}</em>}
            {r.family          && <span className="ir-confirmed-family">Family: {r.family}</span>}
            {r.confidence > 0  && <ConfBar value={r.confidence} />}
          </div>
        )}

        {/* Depth card persists after species is confirmed */}
        <DepthCard
          primaryImage={primaryImage}
          depthStatus={depthStatus}
          depthData={depthData}
          showOverlay={showDepthOverlay}
          onToggleOverlay={() => setShowDepthOverlay((v) => !v)}
        />

        <p className="ir-continue-note">
          Species locked — continue to clone preview or use Change above.
        </p>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN VIEW (idle / loading / result / unavailable)
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="interp-step">

      {hasImages && (
        <SourceThumbs
          barkImage={barkImage}
          detailImage={detailImage}
          primaryImage={primaryImage}
          detailOrgan={detailOrgan}
        />
      )}

      {detailImage && view !== 'loading' && (
        <div className="interp-organ-row">
          <span className="interp-organ-label">Detail image type</span>
          <div className="ai-organ-tabs">
            {['auto', 'leaf', 'flower', 'fruit', 'bark'].map((o) => (
              <button key={o}
                className={`ai-organ-tab ${detailOrgan === o ? 'active' : ''}`}
                onClick={() => setDetailOrgan(o)}>
                {o}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Depth estimation card — always visible once triggered */}
      <DepthCard
        primaryImage={primaryImage}
        depthStatus={depthStatus}
        depthData={depthData}
        showOverlay={showDepthOverlay}
        onToggleOverlay={() => setShowDepthOverlay((v) => !v)}
      />

      {view === 'loading' && (
        <div className="interp-loading">
          <Loader size={20} className="spin" />
          <span>Identifying species…</span>
        </div>
      )}

      {error && view !== 'loading' && (
        <div className="ir-error-row">
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      )}

      {view === 'unavailable' && result && !error && (
        <div className="ir-unavailable-card">
          <AlertTriangle size={16} className="ir-unavail-icon" />
          <div>
            <p className="ir-unavail-title">PlantNet unavailable</p>
            <p className="ir-unavail-desc">{result.notes?.[0] ?? 'API not configured.'}</p>
          </div>
        </div>
      )}

      {view === 'result' && result?.enabled && result?.common_name && (
        <div className="ir-top-card">
          <div className="ir-top-card-header">
            <span className="ir-top-label">Top match</span>
            {result.normStats?.sentCount > 0 && (
              <span className="ir-images-used">
                {result.normStats.sentCount} image{result.normStats.sentCount !== 1 ? 's' : ''} analyzed
              </span>
            )}
          </div>

          <div className="ir-top-species">
            <span className="ir-common-name">{result.common_name}</span>
            {result.scientific_name && <em className="ir-sci-name">{result.scientific_name}</em>}
            {result.family && <span className="ir-family-name">{result.family}</span>}
          </div>

          <ConfBar value={result.confidence ?? 0} />

          <button
            className="btn-primary ir-confirm-btn"
            onClick={() => confirmSpecies(result.common_name, result.scientific_name, result.confidence)}
          >
            <CheckCircle2 size={15} />
            Use this species
          </button>
        </div>
      )}

      {view === 'result' && result?.candidates?.length > 0 && (
        <div className="ir-alternates">
          <span className="ir-alt-heading">Alternates</span>
          {result.candidates.map((c, i) => (
            <button key={i} className="ir-alt-row"
              onClick={() => confirmSpecies(c.common_name, c.scientific_name, c.score)}>
              <div className="ir-alt-names">
                <span className="ir-alt-common">{c.common_name ?? c.scientific_name}</span>
                {c.common_name && c.scientific_name && <em className="ir-alt-sci">{c.scientific_name}</em>}
                {c.family && <span className="ir-alt-family">{c.family}</span>}
              </div>
              <ConfPill value={c.score ?? 0} />
            </button>
          ))}
        </div>
      )}

      {view === 'result' && result?.notes?.length > 0 && (
        <p className="ir-notes">{result.notes.join(' · ')}</p>
      )}

      {view !== 'loading' && (
        <div className="ir-action-row">
          {view === 'idle' ? (
            <button className="btn-primary ir-run-btn" onClick={runAnalysis} disabled={!hasImages}>
              <Leaf size={16} />
              Identify Species
            </button>
          ) : (
            <button className="btn-secondary ir-rerun-btn" onClick={runAnalysis}>
              <RefreshCw size={13} />
              Re-identify
            </button>
          )}
        </div>
      )}

      {view !== 'loading' && (
        <div className="ir-manual-section">
          <div className="ir-manual-header">
            <Edit3 size={13} />
            <span>Enter species manually</span>
          </div>
          <div className="ir-manual-row">
            <input
              className="hints-input ir-manual-input"
              type="text"
              placeholder="e.g. White Oak"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyManual()}
            />
            <button
              className="ir-manual-submit"
              onClick={applyManual}
              disabled={!manualInput.trim()}
            >
              Use
            </button>
          </div>
        </div>
      )}

      {view !== 'loading' && (
        <button className="ir-unknown-btn" onClick={continueUnknown}>
          <HelpCircle size={13} />
          Continue as unknown species
        </button>
      )}
    </div>
  )
}
