import { useState, useEffect } from 'react'
import { Satellite, Navigation, Crosshair, MapPin, Loader,
         CheckCircle2, ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react'
import useTreeSession from '../state/useTreeSession'

// ── Source metadata ────────────────────────────────────────────────────────────
const SOURCE_META = {
  'photo gps':  { Icon: Satellite,  label: 'Photo GPS',  cls: 'src-photo',  desc: 'Position embedded in photo EXIF'     },
  'device gps': { Icon: Navigation, label: 'Device GPS', cls: 'src-device', desc: 'Real-time device location services'  },
  'manual':     { Icon: Crosshair,  label: 'Manual Pin', cls: 'src-manual', desc: 'User-placed position'                },
  'unknown':    { Icon: MapPin,     label: 'Unset',      cls: 'src-unknown', desc: 'No position recorded'               },
}

const NUDGE_STEPS = [0.0001, 0.001, 0.01]

// ── Helpers ────────────────────────────────────────────────────────────────────
function toDMS(val, pos, neg) {
  if (val == null || isNaN(val)) return '—'
  const dir  = val >= 0 ? pos : neg
  const abs  = Math.abs(val)
  const deg  = Math.floor(abs)
  const minF = (abs - deg) * 60
  const min  = Math.floor(minF)
  const sec  = ((minF - min) * 60).toFixed(2)
  return `${deg}° ${String(min).padStart(2, '0')}' ${sec.padStart(5, '0')}" ${dir}`
}

function fmtAccuracy(m) {
  if (m == null) return null
  return m < 1000 ? `±${Math.round(m)} m` : `±${(m / 1000).toFixed(1)} km`
}

function fmtTime(iso) {
  if (!iso) return null
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
  catch { return null }
}

// Scan all photo slots for any embedded GPS
function findExifGps(scanState) {
  for (const k of ['primaryImage', 'barkImage', 'detailImage', 'scaleImage']) {
    const gps = scanState[k]?.exif?.gps
    if (gps?.lat != null && gps?.lng != null) return gps
  }
  return null
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function LocationConfirmStep() {
  const { scanState, setScanState } = useTreeSession()

  // phase: 'probing' | 'confirmed' | 'refining' | 'none'
  const [phase, setPhase]       = useState('probing')
  const [geoNote, setGeoNote]   = useState(null)   // 'denied' | 'timeout' | null

  // Refine panel state
  const [refineLat,  setRefineLat]  = useState('')
  const [refineLng,  setRefineLng]  = useState('')
  const [nudgeStep,  setNudgeStep]  = useState(0.001)

  // ── Commit a resolved location to store ──────────────────────────────────────
  function commit(lat, lng, source, accuracyMeters = null) {
    setScanState({
      selectedLocation: {
        lat,
        lng,
        source,
        accuracyMeters: accuracyMeters != null ? Math.round(accuracyMeters) : null,
        capturedAt:     new Date().toISOString(),
      },
      ...(source === 'photo gps'  && { exifLocation:    { lat, lng } }),
      ...(source === 'device gps' && { browserLocation: { lat, lng, accuracy: accuracyMeters } }),
    })
    setPhase('confirmed')
  }

  // ── Probe on mount ──────────────────────────────────────────────────────────
  useEffect(() => {
    // Already have a location (user returned to this step)
    if (scanState.selectedLocation) { setPhase('confirmed'); return }

    // 1. Prefer EXIF GPS from any captured photo
    const exif = findExifGps(scanState)
    if (exif) { commit(exif.lat, exif.lng, 'photo gps'); return }

    // 2. Fall back to browser geolocation
    if (!navigator.geolocation) { setPhase('none'); return }

    navigator.geolocation.getCurrentPosition(
      (pos) => commit(
        pos.coords.latitude,
        pos.coords.longitude,
        'device gps',
        pos.coords.accuracy,
      ),
      (err) => {
        setGeoNote(err.code === 1 ? 'denied' : 'timeout')
        setPhase('none')
      },
      { timeout: 12000, maximumAge: 120000, enableHighAccuracy: true },
    )
  }, [])

  // ── Open refine panel pre-filled with current coords ─────────────────────────
  function openRefine() {
    const loc = scanState.selectedLocation
    setRefineLat(loc?.lat?.toFixed(7) ?? '')
    setRefineLng(loc?.lng?.toFixed(7) ?? '')
    setPhase('refining')
  }

  // ── Nudge decimal value by step ───────────────────────────────────────────────
  function nudge(setter, direction) {
    setter((prev) => {
      const next = (parseFloat(prev) || 0) + direction * nudgeStep
      return next.toFixed(7)
    })
  }

  // ── Apply refinement ──────────────────────────────────────────────────────────
  function applyRefine() {
    const lat = parseFloat(refineLat)
    const lng = parseFloat(refineLng)
    if (isNaN(lat) || isNaN(lng)) return
    commit(lat, lng, 'manual')
  }

  const loc        = scanState.selectedLocation
  const sourceMeta = SOURCE_META[loc?.source ?? 'unknown']

  // ── Probing ───────────────────────────────────────────────────────────────────
  if (phase === 'probing') {
    return (
      <div className="loc-step">
        <div className="loc-probe-row">
          <Loader size={16} className="spin" />
          <span>Calibrating position…</span>
        </div>
        <SkipNote />
      </div>
    )
  }

  // ── No automatic location found ───────────────────────────────────────────────
  if (phase === 'none') {
    return (
      <div className="loc-step">
        <div className="loc-no-signal">
          <div className="loc-no-signal-icon">
            <Crosshair size={26} />
          </div>
          <div className="loc-no-signal-text">
            <p className="loc-no-signal-title">Position not detected</p>
            <p className="loc-no-signal-desc">
              {geoNote === 'denied'  && 'Location access was declined.'}
              {geoNote === 'timeout' && 'Location request timed out.'}
              {!geoNote             && 'No EXIF GPS or device location available.'}
              {' '}Place the tree position manually below.
            </p>
          </div>
        </div>

        <PlaceForm
          lat={refineLat} setLat={setRefineLat}
          lng={refineLng} setLng={setRefineLng}
          onApply={applyRefine}
        />
        <SkipNote />
      </div>
    )
  }

  // ── Refine mode ───────────────────────────────────────────────────────────────
  if (phase === 'refining') {
    const previewLat = parseFloat(refineLat)
    const previewLng = parseFloat(refineLng)
    const canApply   = !isNaN(previewLat) && !isNaN(previewLng)
    return (
      <div className="loc-step">
        <div className="loc-refine-bar">
          <Crosshair size={14} />
          <span>Refine position</span>
          {loc?.source && (
            <span className="loc-refine-from">correcting {SOURCE_META[loc.source]?.label}</span>
          )}
        </div>

        {/* Lat nudge */}
        <CoordNudge
          label="Latitude"
          value={refineLat}
          onChange={setRefineLat}
          dms={toDMS(previewLat, 'N', 'S')}
          onNorthward={() => nudge(setRefineLat, +1)}
          onSouthward={() => nudge(setRefineLat, -1)}
          northLabel="N ▲"
          southLabel="▼ S"
        />

        {/* Lng nudge */}
        <CoordNudge
          label="Longitude"
          value={refineLng}
          onChange={setRefineLng}
          dms={toDMS(previewLng, 'E', 'W')}
          onNorthward={() => nudge(setRefineLng, +1)}
          onSouthward={() => nudge(setRefineLng, -1)}
          northLabel="E ►"
          southLabel="◄ W"
        />

        {/* Nudge step selector */}
        <div className="loc-nudge-step-row">
          <span className="loc-nudge-step-label">Step</span>
          {NUDGE_STEPS.map((s) => (
            <button key={s}
              className={`loc-nudge-step-btn ${nudgeStep === s ? 'active' : ''}`}
              onClick={() => setNudgeStep(s)}>
              {s}°
            </button>
          ))}
        </div>

        <div className="loc-refine-actions">
          <button className="btn-back" onClick={() => setPhase('confirmed')}>Cancel</button>
          <button className="btn-next" disabled={!canApply} onClick={applyRefine}>
            Apply
          </button>
        </div>
      </div>
    )
  }

  // ── Confirmed ─────────────────────────────────────────────────────────────────
  const { Icon } = sourceMeta
  return (
    <div className="loc-step">
      {/* Source / confidence badge */}
      <div className={`loc-source-badge ${sourceMeta.cls}`}>
        <Icon size={15} />
        <span className="loc-source-name">{sourceMeta.label}</span>
        <span className="loc-source-sep">·</span>
        <span className="loc-source-desc">{sourceMeta.desc}</span>
      </div>

      {/* Main coordinate card */}
      <div className="loc-coord-card">
        <div className="loc-dms-block">
          <div className="loc-dms-row">
            <span className="loc-axis-label">LAT</span>
            <span className="loc-dms-val">{toDMS(loc?.lat, 'N', 'S')}</span>
          </div>
          <div className="loc-dms-row">
            <span className="loc-axis-label">LNG</span>
            <span className="loc-dms-val">{toDMS(loc?.lng, 'E', 'W')}</span>
          </div>
        </div>

        {/* Meta row: accuracy + time + check */}
        <div className="loc-card-meta">
          {loc?.accuracyMeters != null && (
            <span className="loc-accuracy-pill">
              <span className="loc-accuracy-ring" />
              {fmtAccuracy(loc.accuracyMeters)}
            </span>
          )}
          {loc?.capturedAt && (
            <span className="loc-captured-time">recorded {fmtTime(loc.capturedAt)}</span>
          )}
          <CheckCircle2 size={13} className="loc-confirm-check" />
        </div>

        {/* Decimal fallback + refine button */}
        <div className="loc-card-footer">
          <span className="loc-decimal-coords">
            {loc?.lat?.toFixed(6)}, {loc?.lng?.toFixed(6)}
          </span>
          <button className="loc-refine-btn" onClick={openRefine}>
            <Crosshair size={12} />
            Refine
          </button>
        </div>
      </div>

      <SkipNote />
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SkipNote() {
  return (
    <p className="loc-skip-note">
      Location is optional — skip to continue without it.
    </p>
  )
}

function PlaceForm({ lat, setLat, lng, setLng, onApply }) {
  return (
    <div className="loc-place-form">
      <div className="loc-place-form-header">
        <MapPin size={13} />
        <span>Place tree position</span>
      </div>
      <div className="loc-place-fields">
        <label className="loc-place-field">
          <span className="loc-place-field-label">Latitude</span>
          <input className="hints-input" type="number" step="0.0001"
            placeholder="e.g. 48.8566"
            value={lat} onChange={(e) => setLat(e.target.value)} />
        </label>
        <label className="loc-place-field">
          <span className="loc-place-field-label">Longitude</span>
          <input className="hints-input" type="number" step="0.0001"
            placeholder="e.g. -2.3522"
            value={lng} onChange={(e) => setLng(e.target.value)} />
        </label>
      </div>
      <button className="btn-primary loc-place-submit"
        onClick={onApply} disabled={!lat || !lng}>
        Set Position
      </button>
    </div>
  )
}

function CoordNudge({ label, value, onChange, dms, onNorthward, onSouthward, northLabel, southLabel }) {
  return (
    <div className="loc-coord-nudge">
      <span className="loc-nudge-label">{label}</span>
      <div className="loc-nudge-row">
        <button className="loc-nudge-dir-btn" onClick={onSouthward}>{southLabel}</button>
        <input className="hints-input loc-nudge-input" type="number" step="0.0001"
          value={value} onChange={(e) => onChange(e.target.value)} />
        <button className="loc-nudge-dir-btn" onClick={onNorthward}>{northLabel}</button>
      </div>
      {dms !== '—' && <span className="loc-dms-preview">{dms}</span>}
    </div>
  )
}
