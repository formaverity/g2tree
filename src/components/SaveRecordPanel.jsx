import { Suspense, useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, Check, Home, MapPin, Leaf, Droplets,
  PlusCircle, LogIn, TreePine, Wind, Sun, AlertCircle,
} from 'lucide-react'
import * as THREE from 'three'
import useTreeSession from '../state/useTreeSession'
import { saveCurrentTree } from '../lib/treeRecords'
import { estimateEcologicalBenefits } from '../lib/ecologicalBenefits'
import { photoToProceduralParams } from '../lib/photoToProceduralParams'
import { buildTreeModelParams } from '../lib/treeModelParams'
import { effectiveValue } from '../lib/treeMetrics'
import { loadTextureSafe } from '../lib/threeTextureUtils'
import { ProceduralTree } from './TreePreview'
import PreviewErrorBoundary from './PreviewErrorBoundary'

// ── Compact 3D clone card ──────────────────────────────────────────────────────

function isUsableUrl(url) {
  return typeof url === 'string' && (url.startsWith('data:image') || url.startsWith('http'))
}

function CloneCard({ params, textureSamples }) {
  const [barkMap,    setBarkMap]    = useState(null)
  const [leafMap,    setLeafMap]    = useState(null)
  const [leafMasked, setLeafMasked] = useState(false)
  const [skip,       setSkip]       = useState(false)

  const barkSample = textureSamples?.bark
  const leafSample = textureSamples?.leaf ?? textureSamples?.canopy
  const barkUrl = (() => { const u = barkSample?.dataUrl ?? barkSample?.url; return isUsableUrl(u) ? u : null })()
  const leafUrl = (() => { const u = leafSample?.dataUrl ?? leafSample?.url; return isUsableUrl(u) ? u : null })()
  const isMaskedPng = typeof leafUrl === 'string' && leafUrl.startsWith('data:image/png')

  useEffect(() => {
    if (skip || !barkUrl) { setBarkMap(null); return }
    let cancelled = false, loaded = null
    loadTextureSafe(barkUrl, { textureType: 'bark', repeat: [3, 2] }).then((tex) => {
      if (cancelled) { tex?.dispose(); return }
      loaded = tex; setBarkMap(tex)
    })
    return () => { cancelled = true; loaded?.dispose(); setBarkMap(null) }
  }, [barkUrl, skip])

  useEffect(() => {
    if (skip || !leafUrl) { setLeafMap(null); setLeafMasked(false); return }
    let cancelled = false, loaded = null
    loadTextureSafe(leafUrl, {
      textureType: 'leaf',
      wrapS: isMaskedPng ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping,
      wrapT: isMaskedPng ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping,
      repeat: isMaskedPng ? undefined : [2, 2],
    }).then((tex) => {
      if (cancelled) { tex?.dispose(); return }
      loaded = tex; setLeafMap(tex); setLeafMasked(isMaskedPng && !!tex)
    })
    return () => { cancelled = true; loaded?.dispose(); setLeafMap(null); setLeafMasked(false) }
  }, [leafUrl, skip, isMaskedPng])

  if (!params) return null

  return (
    <div className="srp-card srp-clone-card">
      <div className="srp-card-label">Digital Clone</div>
      <PreviewErrorBoundary onSkipTextures={() => setSkip(true)}>
        <div className="srp-canvas-wrap">
          <Canvas camera={{ position: [1.6, 1.1, 1.6], fov: 46 }} gl={{ antialias: true, alpha: true }}>
            <ambientLight intensity={0.52} />
            <directionalLight position={[3, 6, 4]} intensity={1.2} />
            <directionalLight position={[-3, 2, -2]} intensity={0.3} />
            <Suspense fallback={null}>
              <ProceduralTree
                params={params}
                mode="structured"
                barkMap={barkMap}
                leafMap={leafMap}
                leafMasked={leafMasked}
              />
            </Suspense>
            <OrbitControls enablePan={false} minDistance={0.8} maxDistance={6} />
          </Canvas>
        </div>
      </PreviewErrorBoundary>
    </div>
  )
}

// ── Location card ──────────────────────────────────────────────────────────────

const SOURCE_LABELS = {
  'photo gps':    'Photo GPS',
  'device gps':   'Device GPS',
  'manual':       'Manual entry',
  'unknown':      'Unknown',
}

function LocationCard({ location, photos }) {
  const lat = location?.lat ?? photos?.[0]?.exif?.gps?.lat ?? null
  const lng = location?.lng ?? photos?.[0]?.exif?.gps?.lng ?? null
  const source = location?.source ?? (lat != null ? 'photo gps' : null)

  if (lat == null || lng == null) {
    return (
      <div className="srp-card srp-location-card srp-location-card--none">
        <div className="srp-card-label">Location</div>
        <div className="srp-location-none">
          <MapPin size={16} className="srp-location-none-icon" />
          <span>No location data captured</span>
        </div>
      </div>
    )
  }

  const osmUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}&zoom=17`
  const latStr = lat.toFixed(5)
  const lngStr = lng.toFixed(5)
  const latDir = lat >= 0 ? 'N' : 'S'
  const lngDir = lng >= 0 ? 'E' : 'W'

  return (
    <div className="srp-card srp-location-card">
      <div className="srp-card-label">Location</div>
      <div className="srp-location-body">
        <MapPin size={15} className="srp-location-icon" />
        <div className="srp-coords">
          <span className="srp-coord">{Math.abs(lat).toFixed(5)}° {latDir}</span>
          <span className="srp-coord-sep">,</span>
          <span className="srp-coord">{Math.abs(lng).toFixed(5)}° {lngDir}</span>
        </div>
        {source && (
          <span className="srp-source-badge">
            {SOURCE_LABELS[source] ?? source}
          </span>
        )}
      </div>
      <a
        className="srp-map-link"
        href={osmUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        View on OpenStreetMap ↗
      </a>
    </div>
  )
}

// ── Ecological summary card ────────────────────────────────────────────────────

function BenefitStat({ icon: Icon, label, value, unit, color }) {
  return (
    <div className="srp-benefit-stat">
      <Icon size={14} className="srp-benefit-icon" style={{ color }} />
      <div className="srp-benefit-text">
        <span className="srp-benefit-value">
          {typeof value === 'number' ? value.toLocaleString() : value}
          {unit && <span className="srp-benefit-unit"> {unit}</span>}
        </span>
        <span className="srp-benefit-label">{label}</span>
      </div>
    </div>
  )
}

function BenefitsCard({ benefits }) {
  if (!benefits) return null
  const b = benefits
  return (
    <div className="srp-card srp-benefits-card">
      <div className="srp-card-label">Ecological Role · i-Tree-inspired estimate</div>
      <div className="srp-benefit-grid">
        <BenefitStat
          icon={Leaf}
          label="Carbon stored"
          value={b.carbon_storage_kg}
          unit="kg C"
          color="var(--green-bright)"
        />
        <BenefitStat
          icon={Wind}
          label="Annual uptake"
          value={b.annual_carbon_sequestration_kg}
          unit="kg/yr"
          color="var(--green-mid)"
        />
        <BenefitStat
          icon={Droplets}
          label="Stormwater"
          value={b.annual_stormwater_intercepted_liters}
          unit="L/yr"
          color="#7ec8e3"
        />
        <BenefitStat
          icon={Sun}
          label="Shade area"
          value={b.shade_area_m2}
          unit="m²"
          color="var(--amber)"
        />
      </div>
    </div>
  )
}

// ── Review phase ───────────────────────────────────────────────────────────────

function MetricPill({ label, value }) {
  if (value == null) return null
  return (
    <span className="srp-metric-pill">
      <span className="srp-metric-label">{label}</span>
      <span className="srp-metric-value">{value}</span>
    </span>
  )
}

function ReviewPhase({ session, metrics, speciesAIResult, scanState, benefits, photos, setStep, onSave, error }) {
  const species    = speciesAIResult?.common_name ?? scanState?.speciesResult?.common_name ?? null
  const sciName    = speciesAIResult?.scientific_name ?? scanState?.speciesResult?.scientific_name ?? null
  const dbhCm      = metrics ? effectiveValue(metrics, 'dbhCm')       : null
  const heightM    = metrics ? effectiveValue(metrics, 'heightM')      : null
  const crownM     = metrics ? effectiveValue(metrics, 'crownSpreadM') : null
  const health     = metrics?.healthScore ?? null
  const location   = scanState?.selectedLocation
  const photoCount = photos.length + (scanState?.primaryImage ? 1 : 0)

  const notSignedIn = !session

  return (
    <motion.div
      key="review"
      className="srp-phase"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.3 }}
    >
      <div className="srp-review-header">
        <TreePine size={16} className="srp-review-icon" />
        <h2 className="panel-title" style={{ margin: 0 }}>Save Tree Record</h2>
      </div>

      <p className="srp-review-desc">
        Save this tree to your profile with all measurements, ecological estimates, and photos.
      </p>

      {/* Summary */}
      <div className="srp-summary-card">
        {species ? (
          <div className="srp-summary-species">
            <span className="srp-summary-common">{species}</span>
            {sciName && <em className="srp-summary-sci">{sciName}</em>}
          </div>
        ) : (
          <span className="srp-summary-common srp-summary-unknown">Unknown species</span>
        )}

        <div className="srp-metric-row">
          {heightM != null && <MetricPill label="H" value={`${heightM.toFixed(1)} m`} />}
          {dbhCm   != null && <MetricPill label="DBH" value={`${dbhCm.toFixed(1)} cm`} />}
          {crownM  != null && <MetricPill label="Crown" value={`${crownM.toFixed(1)} m`} />}
          {health  != null && <MetricPill label="Health" value={`${health}%`} />}
        </div>

        <div className="srp-summary-meta">
          {location?.lat != null ? (
            <span className="srp-meta-item">
              <MapPin size={10} /> {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
              {location.source && ` · ${SOURCE_LABELS[location.source] ?? location.source}`}
            </span>
          ) : (
            <span className="srp-meta-item srp-meta-dim">No location</span>
          )}
          <span className="srp-meta-item">{photoCount} photo{photoCount !== 1 ? 's' : ''}</span>
          {metrics?.ageClass && <span className="srp-meta-item">{metrics.ageClass}</span>}
        </div>

        {benefits && (
          <div className="srp-summary-benefits">
            <span className="srp-summary-benefit-tag">
              ~{benefits.carbon_storage_kg} kg C stored
            </span>
            <span className="srp-summary-benefit-tag">
              ~{benefits.annual_stormwater_intercepted_liters.toLocaleString()} L/yr stormwater
            </span>
          </div>
        )}
      </div>

      {error && (
        <div className="srp-error">
          <AlertCircle size={13} />
          <span>{error}</span>
        </div>
      )}

      {notSignedIn ? (
        <div className="srp-unsigned">
          <span>Sign in to save trees to your profile.</span>
          <button className="btn-primary srp-signin-btn" onClick={() => setStep('profile')}>
            <LogIn size={14} /> Sign in
          </button>
        </div>
      ) : (
        <button className="btn-primary srp-save-btn" onClick={onSave}>
          <Check size={16} /> Save Tree Record
        </button>
      )}

      <div className="panel-footer" style={{ marginTop: 'auto' }}>
        <button className="btn-back" onClick={() => setStep('export')}>
          <ArrowLeft size={16} /> Export
        </button>
      </div>
    </motion.div>
  )
}

// ── Saving phase ───────────────────────────────────────────────────────────────

function SavingPhase({ progress }) {
  return (
    <motion.div
      key="saving"
      className="srp-phase srp-saving"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="srp-saving-ring" />
      <span className="srp-saving-text">{progress || 'Saving…'}</span>
    </motion.div>
  )
}

// ── Saved phase ────────────────────────────────────────────────────────────────

function SavedPhase({ params, textureSamples, benefits, location, photos, speciesAIResult, scanState, setView, startNewTree, setStep }) {
  const species = speciesAIResult?.common_name
    ?? scanState?.speciesResult?.common_name
    ?? null
  const sciName = speciesAIResult?.scientific_name
    ?? scanState?.speciesResult?.scientific_name
    ?? null

  return (
    <motion.div
      key="saved"
      className="srp-phase srp-saved"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
    >
      {/* Success badge */}
      <motion.div
        className="srp-success-badge"
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1,   opacity: 1 }}
        transition={{ delay: 0.1, type: 'spring', stiffness: 300, damping: 22 }}
      >
        <Check size={20} className="srp-success-icon" />
      </motion.div>

      <h2 className="srp-saved-title">Tree Record Saved</h2>

      {species && (
        <div className="srp-saved-species">
          <span>{species}</span>
          {sciName && <em>{sciName}</em>}
        </div>
      )}

      {/* Location */}
      <LocationCard location={location} photos={photos} />

      {/* Clone preview */}
      <CloneCard params={params} textureSamples={textureSamples} />

      {/* Ecological summary */}
      <BenefitsCard benefits={benefits} />

      {/* Actions */}
      <div className="srp-saved-actions">
        <button className="btn-primary" onClick={startNewTree}>
          <PlusCircle size={15} /> New Tree
        </button>
        <button className="btn-back" onClick={() => setView('home')}>
          <Home size={15} /> Home
        </button>
      </div>
    </motion.div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function SaveRecordPanel() {
  const {
    session,
    scanState,
    speciesAIResult,
    textureSamples,
    photos,
    estimates,
    treeStructureHints,
    scaffoldGeometry,
    markSaved,
    setStep,
    setView,
    startNewTree,
  } = useTreeSession()

  const [phase,    setPhase]    = useState('review')
  const [progress, setProgress] = useState('')
  const [error,    setError]    = useState(null)

  const metrics  = scanState?.estimatedMetrics ?? null
  const location = scanState?.selectedLocation ?? null

  // Ecological benefits — computed from session state for display
  const benefits = useMemo(() => {
    if (!metrics?.dbhCm) return null
    return estimateEcologicalBenefits({
      speciesResult: scanState?.speciesResult ?? speciesAIResult,
      dbhCm:         effectiveValue(metrics, 'dbhCm'),
      heightM:       effectiveValue(metrics, 'heightM'),
      crownSpreadM:  effectiveValue(metrics, 'crownSpreadM'),
      canopyDensity: metrics.canopyDensity ?? 65,
      healthScore:   metrics.healthScore   ?? 75,
      confidence:    metrics.confidence    ?? {},
    })
  }, [metrics, scanState?.speciesResult, speciesAIResult])

  // Procedural params for the clone preview
  const params = useMemo(() => {
    if (metrics?.dbhCm != null) {
      return photoToProceduralParams({
        speciesResult:    scanState?.speciesResult ?? speciesAIResult,
        estimatedMetrics: metrics,
        visionAnalysis:   scanState?.visionAnalysis,
        visionDepth:      scanState?.visionDepth,
        textureSamples,
      })
    }
    if (estimates) {
      return buildTreeModelParams(estimates, treeStructureHints, {
        scientificName: speciesAIResult?.scientific_name ?? '',
        commonName:     speciesAIResult?.common_name     ?? '',
      }, textureSamples)
    }
    return null
  }, [metrics, scanState, speciesAIResult, textureSamples, estimates, treeStructureHints])

  async function handleSave() {
    if (!session) { setStep('profile'); return }
    setError(null)
    setPhase('saving')
    setProgress('Preparing record…')

    try {
      // Small pause lets "Preparing" render before the async work starts
      await new Promise((r) => setTimeout(r, 180))
      setProgress('Uploading images…')
      const tree = await saveCurrentTree(useTreeSession.getState())
      markSaved(tree.id)
      setPhase('saved')
    } catch (err) {
      setError(err.message ?? 'Save failed — check your connection and try again.')
      setPhase('review')
    }
  }

  return (
    <motion.div
      className="panel"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
    >
      <div className="panel-body srp-panel-body">
        <AnimatePresence mode="wait">
          {phase === 'review' && (
            <ReviewPhase
              key="review"
              session={session}
              metrics={metrics}
              speciesAIResult={speciesAIResult}
              scanState={scanState}
              benefits={benefits}
              photos={photos}
              setStep={setStep}
              onSave={handleSave}
              error={error}
            />
          )}
          {phase === 'saving' && (
            <SavingPhase key="saving" progress={progress} />
          )}
          {phase === 'saved' && (
            <SavedPhase
              key="saved"
              params={params}
              textureSamples={textureSamples}
              benefits={benefits}
              location={location}
              photos={photos}
              speciesAIResult={speciesAIResult}
              scanState={scanState}
              setView={setView}
              startNewTree={startNewTree}
              setStep={setStep}
            />
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
