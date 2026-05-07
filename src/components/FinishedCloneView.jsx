import { Suspense, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { motion } from 'framer-motion'
import { ArrowLeft, Edit2, Copy, Download, Home, PlusCircle } from 'lucide-react'
import * as THREE from 'three'
import useTreeSession from '../state/useTreeSession'
import { loadTextureSafe } from '../lib/threeTextureUtils'
import { ProceduralTree } from './TreePreview'
import PreviewErrorBoundary from './PreviewErrorBoundary'

function isUsableUrl(url) {
  return typeof url === 'string' && (url.startsWith('data:image') || url.startsWith('http'))
}

// ── Embedded orbitable 3D viewer ─────────────────────────────────────────────

function CloneViewer({ modelParams, renderMode, textureSamples }) {
  const [barkMap, setBarkMap]       = useState(null)
  const [leafMap, setLeafMap]       = useState(null)
  const [leafMasked, setLeafMasked] = useState(false)
  const [skip, setSkip]             = useState(false)

  const barkSample = textureSamples?.bark
  const leafSample = textureSamples?.leaf ?? textureSamples?.canopy

  const barkUrl = (() => {
    if (!barkSample) return null
    const u = barkSample.dataUrl ?? barkSample.url
    return isUsableUrl(u) ? u : null
  })()

  const leafUrl = (() => {
    if (!leafSample) return null
    const u = leafSample.dataUrl ?? leafSample.url
    return isUsableUrl(u) ? u : null
  })()

  const isMaskedPng = typeof leafUrl === 'string' && leafUrl.startsWith('data:image/png')

  useEffect(() => {
    if (skip || !barkUrl) { setBarkMap(null); return }
    let cancelled = false
    let loaded = null
    loadTextureSafe(barkUrl, { textureType: 'bark', repeat: [3, 2] }).then((tex) => {
      if (cancelled) { tex?.dispose(); return }
      loaded = tex
      setBarkMap(tex)
    })
    return () => { cancelled = true; loaded?.dispose(); setBarkMap(null) }
  }, [barkUrl, skip])

  useEffect(() => {
    if (skip || !leafUrl) { setLeafMap(null); setLeafMasked(false); return }
    let cancelled = false
    let loaded = null
    loadTextureSafe(leafUrl, {
      textureType: 'leaf',
      wrapS: isMaskedPng ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping,
      wrapT: isMaskedPng ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping,
      repeat: isMaskedPng ? undefined : [2, 2],
    }).then((tex) => {
      if (cancelled) { tex?.dispose(); return }
      loaded = tex
      setLeafMap(tex)
      setLeafMasked(isMaskedPng && !!tex)
    })
    return () => { cancelled = true; loaded?.dispose(); setLeafMap(null); setLeafMasked(false) }
  }, [leafUrl, skip, isMaskedPng])

  if (!modelParams) return null

  return (
    <PreviewErrorBoundary onSkipTextures={() => setSkip(true)}>
      <div className="canvas-wrap">
        <Canvas camera={{ position: [1.8, 1.2, 1.8], fov: 45 }} gl={{ antialias: true, alpha: true }}>
          <ambientLight intensity={0.5} />
          <directionalLight position={[3, 6, 4]} intensity={1.2} />
          <directionalLight position={[-3, 2, -2]} intensity={0.3} />
          <Suspense fallback={null}>
            <ProceduralTree
              params={modelParams}
              mode={renderMode ?? 'structured'}
              barkMap={barkMap}
              leafMap={leafMap}
              leafMasked={leafMasked}
            />
          </Suspense>
          <OrbitControls enablePan={false} minDistance={0.8} maxDistance={6} />
        </Canvas>
      </div>
    </PreviewErrorBoundary>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatRow({ label, value, unit }) {
  if (!value) return null
  return (
    <div className="fcv-stat-row">
      <span className="fcv-stat-label">{label}</span>
      <span className="fcv-stat-value">{value}{unit ? <span className="fcv-stat-unit"> {unit}</span> : null}</span>
    </div>
  )
}

function ColorSwatch({ color }) {
  if (!color) return null
  return <span className="fcv-color-swatch" style={{ background: color }} title={color} />
}

function TextureCard({ label, sample }) {
  if (!sample) return <div className="fcv-texture-card fcv-texture-empty">{label}<span>—</span></div>
  const thumbUrl = sample.url ?? sample.dataUrl ?? null
  return (
    <div className="fcv-texture-card">
      {thumbUrl
        ? <img className="fcv-texture-thumb" src={thumbUrl} alt={label} crossOrigin="anonymous" />
        : <div className="fcv-texture-placeholder" />
      }
      <span className="fcv-texture-label">{label}</span>
      {sample.averageColor && <ColorSwatch color={sample.averageColor} />}
    </div>
  )
}

// ── FinishedCloneView ─────────────────────────────────────────────────────────

export default function FinishedCloneView() {
  const {
    currentTreeId,
    cloneData,
    finishedAt,
    speciesAIResult,
    estimates,
    textureSamples,
    photos,
    setView,
    startNewTree,
  } = useTreeSession()

  const modelParams  = cloneData?.modelParams ?? null
  const renderMode   = cloneData?.renderMode  ?? 'structured'
  const species      = cloneData?.species     ?? speciesAIResult
  const cloneEstimates = cloneData?.estimates ?? estimates

  const finishedDate = finishedAt
    ? new Date(finishedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : null

  function handleEditTree() {
    useTreeSession.setState({ step: 'estimate', view: 'workflow' })
  }

  function handleDuplicate() {
    // Start fresh but pre-fill species hint from finished clone
    startNewTree()
  }

  function handleExportJson() {
    const payload = {
      schema:      'g2tree/v1-clone',
      exported_at: new Date().toISOString(),
      clone_data:  cloneData,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `g2tree_clone_${currentTreeId ?? Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleReturnHome() {
    setView('home')
  }

  const displayPhotos = photos.filter((p) => p.url)

  return (
    <motion.div
      className="finished-clone-view"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Header */}
      <div className="fcv-header">
        <button className="btn-back fcv-back" onClick={handleReturnHome}>
          <ArrowLeft size={16} /> Home
        </button>
        <div className="fcv-status-badge">finished clone</div>
      </div>

      <div className="fcv-body">
        {/* Species block */}
        <div className="fcv-species-block">
          <h1 className="fcv-common-name">{species?.common_name ?? 'Unknown species'}</h1>
          {species?.scientific_name && (
            <p className="fcv-sci-name">{species.scientific_name}</p>
          )}
          {finishedDate && <p className="fcv-date">Finished {finishedDate}</p>}
        </div>

        {/* 3D viewer */}
        {modelParams
          ? <CloneViewer modelParams={modelParams} renderMode={renderMode} textureSamples={textureSamples} />
          : <div className="fcv-no-clone">No clone data available.</div>
        }

        {/* Measurements */}
        {cloneEstimates && (
          <div className="fcv-section">
            <h3 className="fcv-section-title">Measurements</h3>
            <div className="fcv-stats">
              <StatRow label="DBH"          value={cloneEstimates.dbh_in}         unit="in" />
              <StatRow label="Height"       value={cloneEstimates.height_ft}      unit="ft" />
              <StatRow label="Canopy width" value={cloneEstimates.canopy_width_ft} unit="ft" />
              <StatRow label="Age class"    value={cloneEstimates.age_class} />
              <StatRow label="Health"       value={cloneEstimates.health_status} />
            </div>
          </div>
        )}

        {/* Species confidence */}
        {species?.confidence != null && (
          <div className="fcv-section">
            <h3 className="fcv-section-title">Species ID</h3>
            <div className="fcv-stats">
              <StatRow label="Provider"    value={species.provider} />
              <StatRow label="Confidence"  value={`${Math.round(species.confidence * 100)}%`} />
            </div>
          </div>
        )}

        {/* Textures / materials */}
        <div className="fcv-section">
          <h3 className="fcv-section-title">Materials</h3>
          <div className="fcv-texture-row">
            <TextureCard label="Bark"   sample={textureSamples?.bark} />
            <TextureCard label="Leaf"   sample={textureSamples?.leaf} />
            <TextureCard label="Canopy" sample={textureSamples?.canopy} />
          </div>
        </div>

        {/* Source photos */}
        {displayPhotos.length > 0 && (
          <div className="fcv-section">
            <h3 className="fcv-section-title">Source Photos</h3>
            <div className="fcv-photo-row">
              {displayPhotos.map((p) => (
                <img
                  key={p.id}
                  className="fcv-photo-thumb"
                  src={p.url}
                  alt="source"
                  crossOrigin="anonymous"
                />
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="fcv-actions">
          <button className="btn-primary" onClick={handleEditTree}>
            <Edit2 size={15} /> Edit Tree
          </button>
          <button className="btn-icon" onClick={handleDuplicate}>
            <PlusCircle size={15} /> Duplicate as New
          </button>
          <button className="btn-icon" onClick={handleExportJson}>
            <Download size={15} /> Export JSON
          </button>
          <button className="btn-back" onClick={handleReturnHome}>
            <Home size={15} /> Return Home
          </button>
        </div>
      </div>
    </motion.div>
  )
}
