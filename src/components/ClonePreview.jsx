import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { motion } from 'framer-motion'
import { ArrowRight, ArrowLeft, Layers, TreePine } from 'lucide-react'
import * as THREE from 'three'
import useTreeSession from '../state/useTreeSession'
import { buildTreeModelParams } from '../lib/treeModelParams'
import { loadTextureSafe } from '../lib/threeTextureUtils'
import { ProceduralTree } from './TreePreview'
import PreviewErrorBoundary from './PreviewErrorBoundary'
import SaveTreeButton from './SaveTreeButton'

const SHOW_DEBUG = import.meta.env.DEV || import.meta.env.VITE_DEBUG_PREVIEW === 'true'

const Y_UP = new THREE.Vector3(0, 1, 0)

function cylSeg(from, to, r0, r1) {
  const a = new THREE.Vector3(...from)
  const b = new THREE.Vector3(...to)
  const dir = b.clone().sub(a)
  const len = dir.length()
  if (len < 0.003) return null
  const mid = a.clone().lerp(b, 0.5)
  const q   = new THREE.Quaternion().setFromUnitVectors(Y_UP, dir.normalize())
  return { pos: [mid.x, mid.y, mid.z], q, len, r0, r1 }
}

// ── Segment mesh ──────────────────────────────────────────────────────────────

function SegMesh({ seg, color, map }) {
  return (
    <mesh position={seg.pos} quaternion={seg.q}>
      <cylinderGeometry args={[seg.r0, seg.r1, seg.len, 7, 1]} />
      <meshStandardMaterial color={map ? '#ffffff' : color} roughness={0.93} map={map || null} />
    </mesh>
  )
}

// ── Leaf cloud (InstancedMesh of flat planes) ─────────────────────────────────

function LeafCloud({ leaves, leafMap, leafMasked, color, opacity }) {
  const meshRef = useRef()
  const dummy   = useMemo(() => new THREE.Object3D(), [])

  useEffect(() => {
    if (!meshRef.current || !leaves.length) return
    leaves.forEach((leaf, i) => {
      dummy.position.set(...leaf.pos)
      dummy.rotation.set(leaf.rx, leaf.ry, leaf.rz)
      dummy.scale.setScalar(leaf.scale)
      dummy.updateMatrix()
      meshRef.current.setMatrixAt(i, dummy.matrix)
    })
    meshRef.current.instanceMatrix.needsUpdate = true
  }, [leaves, dummy])

  if (!leaves.length) return null

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, leaves.length]}>
      <planeGeometry args={[1, 1]} />
      <meshStandardMaterial
        color={leafMap ? '#ffffff' : color}
        map={leafMap || null}
        side={THREE.DoubleSide}
        alphaTest={leafMasked ? 0.32 : 0}
        transparent={!leafMasked}
        opacity={leafMasked ? 1 : (opacity ?? 0.82)}
        depthWrite={leafMasked}
        roughness={0.86}
      />
    </instancedMesh>
  )
}

// ── Scaffold-driven tree ───────────────────────────────────────────────────────

function ScaffoldClone({ scaffoldGeometry, params, barkMap, leafMap, leafMasked }) {
  const geo = useMemo(() => {
    if (!scaffoldGeometry || !params) return null
    const { trunkCurve, branchSegments } = scaffoldGeometry

    const trunks   = []
    const branches = []

    if (trunkCurve?.length > 1) {
      for (let i = 0; i < trunkCurve.length - 1; i++) {
        const a = trunkCurve[i], b = trunkCurve[i + 1]
        const seg = cylSeg([a.x, a.y, a.z], [b.x, b.y, b.z], a.r ?? params.trunkRadiusBase, b.r ?? params.trunkRadiusTop)
        if (seg) trunks.push(seg)
      }
    } else {
      const seg = cylSeg([0,0,0],[0,params.trunkHeight,0], params.trunkRadiusBase, params.trunkRadiusTop)
      if (seg) trunks.push(seg)
    }

    for (const att of (branchSegments ?? [])) {
      const seg = cylSeg(att.start, att.end, att.r0 ?? 0.025, att.r1 ?? 0.012)
      if (seg) branches.push(seg)
    }

    return { trunks, branches }
  }, [scaffoldGeometry, params])

  if (!geo) return null

  const leaves = scaffoldGeometry?.leafInstances ?? []

  return (
    <group position={[0, -params.trunkHeight / 2, 0]}>
      {geo.trunks.map((s, i)   => <SegMesh key={`t${i}`}  seg={s} color={params.trunkColor}  map={barkMap} />)}
      {geo.branches.map((s, i) => <SegMesh key={`b${i}`}  seg={s} color={params.trunkColor}  map={barkMap} />)}

      <LeafCloud
        leaves={leaves}
        leafMap={leafMap}
        leafMasked={leafMasked}
        color={params.canopyColor}
        opacity={params.canopyDensity * 0.88}
      />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
        <circleGeometry args={[params.canopyRadius * 0.52, 28]} />
        <meshStandardMaterial color="#1b2e1d" transparent opacity={0.3} />
      </mesh>
    </group>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onGoScaffold }) {
  return (
    <div className="clone-empty-state">
      <TreePine size={40} className="clone-empty-icon" />
      <h3>No scaffold yet</h3>
      <p>Trace the tree's gesture in the Scaffold step to generate your clone.</p>
      <button className="btn-primary" onClick={onGoScaffold}>
        <Layers size={14} /> Go to Scaffold Tree
      </button>
    </div>
  )
}

// ── Clone Preview panel ───────────────────────────────────────────────────────

const FALLBACK_MODES = ['simple', 'structured', 'detailed']

function isUsableUrl(url) {
  return typeof url === 'string' && (url.startsWith('data:image') || url.startsWith('http'))
}

export default function ClonePreview() {
  const {
    estimates, treeStructureHints,
    speciesAIResult, userHints,
    textureSamples,
    scaffoldGeometry,
    previewMode, setPreviewMode,
    setStep,
  } = useTreeSession()

  const [barkMap,    setBarkMap]    = useState(null)
  const [leafMap,    setLeafMap]    = useState(null)
  const [leafMasked, setLeafMasked] = useState(false)
  const [skipTextures, setSkipTextures] = useState(false)
  const [showFallback, setShowFallback] = useState(false)

  const barkSample = textureSamples?.bark
  const leafSample = textureSamples?.leaf ?? textureSamples?.canopy

  const barkUrl = (() => { const u = barkSample?.dataUrl ?? barkSample?.url; return isUsableUrl(u) ? u : null })()
  const leafUrl = (() => { const u = leafSample?.dataUrl ?? leafSample?.url; return isUsableUrl(u) ? u : null })()
  const isMaskedPng = typeof leafUrl === 'string' && leafUrl.startsWith('data:image/png')

  useEffect(() => {
    if (skipTextures || !barkUrl) { setBarkMap(null); return }
    let cancelled = false, loaded = null
    loadTextureSafe(barkUrl, { textureType: 'bark', repeat: [3, 2] }).then((tex) => {
      if (cancelled) { tex?.dispose(); return }
      loaded = tex; setBarkMap(tex)
    })
    return () => { cancelled = true; loaded?.dispose(); setBarkMap(null) }
  }, [barkUrl, skipTextures])

  useEffect(() => {
    if (skipTextures || !leafUrl) { setLeafMap(null); setLeafMasked(false); return }
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
  }, [leafUrl, skipTextures, isMaskedPng])

  const params = useMemo(
    () => buildTreeModelParams(
      estimates, treeStructureHints,
      { scientificName: speciesAIResult?.scientific_name ?? '', commonName: speciesAIResult?.common_name ?? userHints?.known_species ?? '' },
      textureSamples,
    ),
    [estimates, treeStructureHints, speciesAIResult, userHints, textureSamples],
  )

  const hasScaffold   = !!scaffoldGeometry
  const useScaffold   = hasScaffold && !showFallback
  const fallbackMode  = FALLBACK_MODES.includes(previewMode) ? previewMode : 'structured'

  const speciesLabel = speciesAIResult?.common_name ?? estimates?.species_guess ?? '—'
  const sciLabel     = speciesAIResult?.scientific_name ?? ''

  return (
    <motion.div
      className="panel panel-clone"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
    >
      <div className="panel-body">
        <h2 className="panel-title">Your Clone</h2>

        {speciesLabel !== '—' && (
          <div className="clone-species-badge">
            <span className="clone-species-common">{speciesLabel}</span>
            {sciLabel && <span className="clone-species-sci">{sciLabel}</span>}
          </div>
        )}

        {!hasScaffold && !showFallback ? (
          <EmptyState onGoScaffold={() => setStep('scaffold')} />
        ) : (
          <PreviewErrorBoundary onSkipTextures={() => setSkipTextures(true)}>
            <div className="canvas-wrap">
              <Canvas camera={{ position: [1.8, 1.2, 1.8], fov: 45 }} gl={{ antialias: true, alpha: true }}>
                <ambientLight intensity={0.52} />
                <directionalLight position={[3, 6, 4]} intensity={1.2} />
                <directionalLight position={[-3, 2, -2]} intensity={0.3} />
                <Suspense fallback={null}>
                  {useScaffold ? (
                    <ScaffoldClone
                      scaffoldGeometry={scaffoldGeometry}
                      params={params}
                      barkMap={barkMap}
                      leafMap={leafMap}
                      leafMasked={leafMasked}
                    />
                  ) : (
                    <ProceduralTree
                      params={params}
                      mode={fallbackMode}
                      barkMap={barkMap}
                      leafMap={leafMap}
                      leafMasked={leafMasked}
                    />
                  )}
                </Suspense>
                <OrbitControls enablePan={false} minDistance={0.8} maxDistance={6} />
              </Canvas>
            </div>
          </PreviewErrorBoundary>
        )}

        {/* ── Measurements ─────────────────────────────────────────────── */}
        {estimates && (
          <div className="clone-stats">
            <span>{estimates.height_ft} ft</span>
            <span>·</span>
            <span>{estimates.canopy_width_ft} ft canopy</span>
            <span>·</span>
            <span>DBH {estimates.dbh_in} in</span>
            <span>·</span>
            <span>{estimates.age_class}</span>
            {scaffoldGeometry && (
              <>
                <span>·</span>
                <span className="clone-scaffold-badge">scaffold-driven</span>
              </>
            )}
          </div>
        )}

        {/* ── Material status ───────────────────────────────────────────── */}
        <div className="material-inputs">
          {(['bark', 'leaf', 'canopy']).map((t) => (
            <span key={t} className={`material-input-tag${textureSamples?.[t] ? ' applied' : ''}`}>
              {t}: {textureSamples?.[t] ? 'applied' : 'not sampled'}
            </span>
          ))}
        </div>

        {/* ── Advanced / fallback modes ─────────────────────────────────── */}
        <details className="clone-advanced" onToggle={(e) => { if (!e.target.open) setShowFallback(false) }}>
          <summary>Advanced render modes</summary>
          <div className="clone-advanced-body">
            <label>
              <input type="checkbox" checked={showFallback} onChange={(e) => setShowFallback(e.target.checked)} />
              {' '}Use generic procedural tree
            </label>
            {showFallback && (
              <div className="mode-tabs" style={{ marginTop: 10 }}>
                {FALLBACK_MODES.map((m) => (
                  <button
                    key={m}
                    className={`mode-tab${fallbackMode === m ? ' active' : ''}`}
                    onClick={() => setPreviewMode(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
            {SHOW_DEBUG && (
              <div className="preview-diagnostics" style={{ marginTop: 8 }}>
                <span>scaffold: {hasScaffold ? `${scaffoldGeometry.branchSegments?.length ?? 0} branches, ${scaffoldGeometry.leafInstances?.length ?? 0} leaves, ${scaffoldGeometry.crownLevels?.length ?? 0} levels` : 'none'}</span>
                {hasScaffold && scaffoldGeometry.scaleInfo && (() => {
                  const si = scaffoldGeometry.scaleInfo
                  return (
                    <span>scale: {si.height_ft ?? '?'}ft h · {si.canopy_width_ft ?? '?'}ft canopy · {si.dbh_in ?? '?'}in dbh → r={si.canopyRadius?.toFixed(3)} wpf={si.worldPerFrac?.toFixed(3)}</span>
                  )
                })()}
                <span>bark: {barkUrl ? (barkMap ? 'loaded' : 'loading') : '—'}</span>
                <span>leaf: {leafUrl ? (leafMap ? (leafMasked ? 'masked' : 'loaded') : 'loading') : '—'}</span>
              </div>
            )}
          </div>
        </details>

        <SaveTreeButton />

        <div className="panel-footer">
          <button className="btn-back" onClick={() => setStep('materials')}>
            <ArrowLeft size={16} /> Materials
          </button>
          <button className="btn-next" onClick={() => setStep('export')}>
            Save / Export <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </motion.div>
  )
}
