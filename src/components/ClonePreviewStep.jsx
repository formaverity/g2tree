import { Leaf, Ruler, TreePine, MapPin, CheckCircle2 } from 'lucide-react'
import useTreeSession from '../state/useTreeSession'

function MetricRow({ label, value, unit }) {
  if (value == null) return null
  return (
    <div className="cps-metric-row">
      <span className="cps-metric-label">{label}</span>
      <span className="cps-metric-value">
        {typeof value === 'number' ? value.toFixed(1) : value}
        {unit && <span className="cps-metric-unit"> {unit}</span>}
      </span>
    </div>
  )
}

// Minimal SVG tree silhouette — no Three.js required, no calibration needed
function TreeSilhouette({ species }) {
  const isConifer = /pine|fir|spruce|cedar|hemlock|cypress/i.test(species ?? '')
  return (
    <svg viewBox="0 0 120 160" className="cps-tree-svg" aria-hidden="true">
      <defs>
        <radialGradient id="glow" cx="50%" cy="60%" r="50%">
          <stop offset="0%" stopColor="#6aab74" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#6aab74" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="60" cy="90" rx="55" ry="70" fill="url(#glow)" />
      {isConifer ? (
        <>
          <polygon points="60,20 35,85 85,85" fill="#3a6a42" opacity="0.85" />
          <polygon points="60,40 30,100 90,100" fill="#4a7a52" opacity="0.85" />
          <polygon points="60,60 28,115 92,115" fill="#3d7046" opacity="0.85" />
          <rect x="55" y="115" width="10" height="22" rx="2" fill="#5a3a20" />
        </>
      ) : (
        <>
          <rect x="55" y="110" width="10" height="28" rx="3" fill="#5a3a20" />
          <ellipse cx="60" cy="78" rx="34" ry="38" fill="#3a6a42" opacity="0.55" />
          <ellipse cx="45" cy="88" rx="24" ry="28" fill="#4a7a52" opacity="0.65" />
          <ellipse cx="75" cy="85" rx="26" ry="30" fill="#4a7a52" opacity="0.65" />
          <ellipse cx="60" cy="68" rx="30" ry="32" fill="#6aab74" opacity="0.5" />
        </>
      )}
    </svg>
  )
}

export default function ClonePreviewStep() {
  const { scanState } = useTreeSession()

  const result  = scanState.speciesResult
  const metrics = scanState.estimatedMetrics
  const loc     = scanState.selectedLocation

  const hasSpecies = result?.enabled && result?.common_name
  const photoCount = [
    scanState.primaryImage,
    scanState.barkImage,
    scanState.detailImage,
    scanState.scaleImage,
  ].filter(Boolean).length

  return (
    <div className="cps-root">
      {/* Tree silhouette */}
      <div className="cps-silhouette-wrap">
        <TreeSilhouette species={result?.common_name} />
        <div className="cps-silhouette-glow" />
      </div>

      {/* Species */}
      <div className="cps-species-card">
        <div className="cps-species-header">
          <Leaf size={16} className="cps-leaf-icon" />
          <span className="cps-section-label">Species</span>
        </div>
        {hasSpecies ? (
          <div className="cps-species-names">
            <span className="cps-common-name">{result.common_name}</span>
            <span className="cps-sci-name">{result.scientific_name}</span>
          </div>
        ) : (
          <span className="cps-unknown">Unknown — continue for detailed ID</span>
        )}
      </div>

      {/* Metrics */}
      {metrics && (
        <div className="cps-metrics-card">
          <div className="cps-metrics-header">
            <Ruler size={16} className="cps-ruler-icon" />
            <span className="cps-section-label">Estimated Metrics</span>
          </div>
          <MetricRow label="Height"      value={metrics.overrides?.heightM      ?? metrics.heightM}      unit="m"  />
          <MetricRow label="DBH"         value={metrics.overrides?.dbhCm        ?? metrics.dbhCm}        unit="cm" />
          <MetricRow label="Crown span"  value={metrics.overrides?.crownSpreadM ?? metrics.crownSpreadM} unit="m"  />
          <MetricRow label="Age class"   value={metrics.ageClass} />
          {metrics.healthScore != null && (
            <MetricRow label="Health" value={`${metrics.healthScore}%`} />
          )}
        </div>
      )}

      {/* Location */}
      {loc && (
        <div className="cps-loc-row">
          <MapPin size={13} />
          <span>{loc.lat?.toFixed(5)}, {loc.lng?.toFixed(5)}</span>
          <span className="cps-loc-source">({loc.source})</span>
        </div>
      )}

      {/* Scan summary */}
      <div className="cps-summary-row">
        <CheckCircle2 size={14} className="cps-check" />
        <span>{photoCount} photo{photoCount !== 1 ? 's' : ''} captured — ready for detailed refinement</span>
      </div>

      <p className="cps-continue-hint">
        Continue to the full scan workflow to calibrate landmarks, trace scaffold, and apply textures for a precise digital clone.
      </p>
    </div>
  )
}
