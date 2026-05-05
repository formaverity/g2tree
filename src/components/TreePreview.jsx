import { Suspense, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { motion } from 'framer-motion'
import { ArrowRight, ArrowLeft } from 'lucide-react'
import * as THREE from 'three'
import useTreeSession from '../state/useTreeSession'
import { buildTreeModelParams } from '../lib/treeModelParams'

// ── Geometry helpers ──────────────────────────────────────────────────────────

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

// ── Tree geometry generator ───────────────────────────────────────────────────
// Builds flat arrays of trunk segments, branch segments, leaf clusters,
// and optional speckle positions. Deterministic — no Math.random() calls.

function buildGeometry(params, mode) {
  const {
    trunkHeight, trunkRadiusBase, trunkRadiusTop,
    canopyRadius, canopyYOffset, canopyDensity,
    trunkForm, trunkCount,
    primaryBranchCount, secondaryBranchCount, leafClustersPerTip,
    leafClusterRadius, branchLength,
    leafDistribution, canopyDistribution,
  } = params

  const MAX_SEGS    = 140
  const MAX_LEAVES  = 220
  const MAX_SPECKLE = 600

  const trunks       = []
  const branches     = []
  const leafClusters = []
  const speckleXYZ   = []

  const isSimple   = mode === 'simple'
  const isDetailed = mode === 'detailed'
  const asymX      = canopyDistribution === 'asymmetric' ? canopyRadius * 0.28 : 0

  function addTrunk(from, to, r0, r1) {
    const s = cylSeg(from, to, r0, r1)
    if (s && trunks.length < MAX_SEGS) trunks.push(s)
  }

  function addBranch(from, to, r0, r1) {
    const s = cylSeg(from, to, r0, r1)
    if (s && branches.length < MAX_SEGS) branches.push(s)
  }

  function addLeaf(pos, radius, opacity) {
    if (leafClusters.length >= MAX_LEAVES) return
    leafClusters.push({ pos, radius, opacity })
    if (isDetailed) {
      const n = Math.min(7, MAX_SPECKLE - speckleXYZ.length / 3)
      for (let k = 0; k < n; k++) {
        // Fibonacci sphere distribution — deterministic
        const phi   = Math.acos(1 - 2 * (k + 0.5) / n)
        const theta = Math.PI * (1 + Math.sqrt(5)) * k
        const r     = radius * 0.88
        speckleXYZ.push(
          pos[0] + r * Math.sin(phi) * Math.cos(theta),
          pos[1] + r * Math.sin(phi) * Math.sin(theta),
          pos[2] + r * Math.cos(phi),
        )
      }
    }
  }

  function growBranches(attachPt, trunkDirArr, pCount, lengthScale) {
    if (isSimple || pCount === 0) return
    const trunkDir = new THREE.Vector3(...trunkDirArr)
    const q = new THREE.Quaternion().setFromUnitVectors(Y_UP, trunkDir)

    for (let i = 0; i < pCount; i++) {
      const angle = (i / pCount) * Math.PI * 2
      const dir = new THREE.Vector3(
        Math.sin(angle) * 0.78 + (i === 0 ? asymX * 0.4 : 0),
        0.52,
        Math.cos(angle) * 0.78
      ).normalize().applyQuaternion(q)

      const bLen = branchLength * lengthScale * (0.95 + (i % 3) * 0.08)
      const bEnd = [
        attachPt[0] + dir.x * bLen,
        attachPt[1] + dir.y * bLen,
        attachPt[2] + dir.z * bLen,
      ]
      addBranch(attachPt, bEnd, trunkRadiusTop * 0.55, trunkRadiusTop * 0.27)

      for (let j = 0; j < secondaryBranchCount; j++) {
        const secAngle = angle + (j - secondaryBranchCount / 2 + 0.5) * 1.15
        const secDir = new THREE.Vector3(
          Math.sin(secAngle) * 0.82, 0.55 + j * 0.1, Math.cos(secAngle) * 0.82
        ).normalize()
        const secLen = bLen * 0.50
        const secEnd = [
          bEnd[0] + secDir.x * secLen,
          bEnd[1] + secDir.y * secLen,
          bEnd[2] + secDir.z * secLen,
        ]
        addBranch(bEnd, secEnd, trunkRadiusTop * 0.20, trunkRadiusTop * 0.10)

        for (let k = 0; k < leafClustersPerTip; k++) {
          const lPos = [
            secEnd[0] + (k % 2 === 0 ? 0.06 : -0.06) * (j + 1),
            secEnd[1] + 0.04 * k,
            secEnd[2] + 0.06 * (j + 0.5),
          ]
          addLeaf(lPos, leafClusterRadius * (0.85 + (j + k) % 3 * 0.1), 0.68 + (i % 5) * 0.06)
        }
      }
    }
  }

  // ── Trunk forms ───────────────────────────────────────────────────────────

  if (trunkForm === 'multi') {
    const stems = Math.min(Math.max(trunkCount, 2), 5)
    for (let i = 0; i < stems; i++) {
      const angle   = (i / stems) * Math.PI * 2
      const lean    = 0.10
      const baseOff = [Math.sin(angle) * 0.07, 0, Math.cos(angle) * 0.07]
      const tip     = [
        baseOff[0] + Math.sin(angle) * lean * trunkHeight,
        trunkHeight * 0.90,
        baseOff[2] + Math.cos(angle) * lean * trunkHeight,
      ]
      addTrunk(baseOff, tip, trunkRadiusBase * 0.62, trunkRadiusTop * 0.7)
      const tipDir = new THREE.Vector3(
        tip[0] - baseOff[0], tip[1] - baseOff[1], tip[2] - baseOff[2]
      ).normalize()
      growBranches(tip, [tipDir.x, tipDir.y, tipDir.z], Math.ceil(primaryBranchCount / stems), 0.75)
    }

  } else if (trunkForm === 'forked') {
    const splitH  = trunkHeight * 0.46
    const splitPt = [0, splitH, 0]
    addTrunk([0, 0, 0], splitPt, trunkRadiusBase, trunkRadiusBase * 0.68)
    for (let i = 0; i < 2; i++) {
      const angle     = (i / 2) * Math.PI * 2 + Math.PI * 0.22
      const lean      = 0.22
      const leaderH   = trunkHeight - splitH
      const leaderEnd = [
        splitPt[0] + Math.sin(angle) * lean * leaderH,
        trunkHeight,
        splitPt[2] + Math.cos(angle) * lean * leaderH,
      ]
      addTrunk(splitPt, leaderEnd, trunkRadiusBase * 0.52, trunkRadiusTop)
      const lDir = new THREE.Vector3(
        leaderEnd[0] - splitPt[0], leaderEnd[1] - splitPt[1], leaderEnd[2] - splitPt[2]
      ).normalize()
      growBranches(leaderEnd, [lDir.x, lDir.y, lDir.z], Math.ceil(primaryBranchCount / 2), 0.88)
    }

  } else {
    // Single trunk with branches along upper shaft
    addTrunk([0, 0, 0], [0, trunkHeight, 0], trunkRadiusBase, trunkRadiusTop)

    if (!isSimple) {
      for (let i = 0; i < primaryBranchCount; i++) {
        const t       = 0.50 + (i / primaryBranchCount) * 0.40
        const attachY = trunkHeight * t
        const aX      = asymX * (1 - t)
        const attachPt= [aX, attachY, 0]
        const angle   = (i / primaryBranchCount) * Math.PI * 2 + i * 0.28
        const upness  = 0.44 + t * 0.22
        const dir     = new THREE.Vector3(Math.sin(angle) * 0.85, upness, Math.cos(angle) * 0.85).normalize()
        const bLen    = branchLength * (1.05 - t * 0.28)
        const bEnd    = [
          attachPt[0] + dir.x * bLen,
          attachPt[1] + dir.y * bLen,
          attachPt[2] + dir.z * bLen,
        ]
        addBranch(attachPt, bEnd, trunkRadiusTop * 0.58, trunkRadiusTop * 0.28)

        for (let j = 0; j < secondaryBranchCount; j++) {
          const secAngle = angle + (j - secondaryBranchCount / 2 + 0.5) * 1.1
          const secDir   = new THREE.Vector3(Math.sin(secAngle) * 0.80, 0.58, Math.cos(secAngle) * 0.80).normalize()
          const secLen   = bLen * 0.50
          const secEnd   = [
            bEnd[0] + secDir.x * secLen,
            bEnd[1] + secDir.y * secLen,
            bEnd[2] + secDir.z * secLen,
          ]
          addBranch(bEnd, secEnd, trunkRadiusTop * 0.19, trunkRadiusTop * 0.09)

          for (let k = 0; k < leafClustersPerTip; k++) {
            const lPos = [
              secEnd[0] + (k % 2 === 0 ? 0.05 : -0.05) * (j + 1),
              secEnd[1] + 0.04 * k,
              secEnd[2] + 0.05 * (j + 0.5),
            ]
            addLeaf(lPos, leafClusterRadius * (0.85 + j % 3 * 0.1), 0.66 + i % 5 * 0.07)
          }
        }
      }
    }
  }

  // ── Canopy filler blobs ───────────────────────────────────────────────────
  if (isSimple) {
    addLeaf([asymX, canopyYOffset, 0], canopyRadius, 0.88)
  } else {
    const fillerN = leafDistribution === 'even' ? 6 : leafDistribution === 'outer_shell' ? 4 : 3
    for (let i = 0; i < fillerN; i++) {
      const angle = (i / fillerN) * Math.PI * 2
      const r     = canopyRadius * 0.42
      addLeaf(
        [asymX + Math.sin(angle) * r, canopyYOffset + (i % 2 === 0 ? 0.08 : -0.06) * canopyRadius, Math.cos(angle) * r],
        leafClusterRadius * 1.35,
        canopyDensity * 0.62
      )
    }
  }

  const speckles = speckleXYZ.length > 0 ? new Float32Array(speckleXYZ) : null
  return { trunks, branches, leafClusters, speckles }
}

// ── Segment renderer ──────────────────────────────────────────────────────────

function SegMesh({ seg, color }) {
  return (
    <mesh position={seg.pos} quaternion={seg.q}>
      <cylinderGeometry args={[seg.r0, seg.r1, seg.len, 7, 1]} />
      <meshStandardMaterial color={color} roughness={0.93} />
    </mesh>
  )
}

// ── ProceduralTree ────────────────────────────────────────────────────────────

function ProceduralTree({ params, mode }) {
  const geo = useMemo(() => buildGeometry(params, mode), [params, mode])

  const speckleAttr = useMemo(() => {
    if (!geo.speckles) return null
    return new THREE.BufferAttribute(geo.speckles, 3)
  }, [geo.speckles])

  return (
    <group position={[0, -params.trunkHeight / 2, 0]}>
      {geo.trunks.map((s, i)  => <SegMesh key={`t${i}`} seg={s} color={params.trunkColor} />)}
      {geo.branches.map((s, i) => <SegMesh key={`b${i}`} seg={s} color={params.trunkColor} />)}

      {geo.leafClusters.map((lc, i) => (
        <mesh key={`l${i}`} position={lc.pos}>
          <sphereGeometry args={[lc.radius, 7, 6]} />
          <meshStandardMaterial
            color={params.canopyColor}
            roughness={0.82}
            transparent
            opacity={lc.opacity * Math.min(params.canopyDensity, 1)}
          />
        </mesh>
      ))}

      {speckleAttr && (
        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" {...speckleAttr} />
          </bufferGeometry>
          <pointsMaterial color={params.canopyColor} size={0.018} sizeAttenuation transparent opacity={0.52} />
        </points>
      )}

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
        <circleGeometry args={[params.canopyRadius * 0.52, 28]} />
        <meshStandardMaterial color="#1b2e1d" transparent opacity={0.32} />
      </mesh>
    </group>
  )
}

// ── TreePreview panel ─────────────────────────────────────────────────────────

const MODES = ['simple', 'structured', 'detailed']

export default function TreePreview() {
  const { estimates, treeStructureHints, previewMode, setPreviewMode, setStep } = useTreeSession()
  const params = useMemo(
    () => buildTreeModelParams(estimates, treeStructureHints),
    [estimates, treeStructureHints]
  )

  return (
    <motion.div
      className="panel panel-preview"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
    >
      <div className="panel-body">
        <h2 className="panel-title">Preview</h2>

        <div className="mode-tabs">
          {MODES.map((m) => (
            <button
              key={m}
              className={`mode-tab${previewMode === m ? ' active' : ''}`}
              onClick={() => setPreviewMode(m)}
            >
              {m}
            </button>
          ))}
        </div>

        <div className="canvas-wrap">
          <Canvas camera={{ position: [1.8, 1.2, 1.8], fov: 45 }} gl={{ antialias: true, alpha: true }}>
            <ambientLight intensity={0.5} />
            <directionalLight position={[3, 6, 4]} intensity={1.2} />
            <directionalLight position={[-3, 2, -2]} intensity={0.3} />
            <Suspense fallback={null}>
              <ProceduralTree params={params} mode={previewMode} />
            </Suspense>
            <OrbitControls enablePan={false} minDistance={0.8} maxDistance={6} />
          </Canvas>
        </div>

        <div className="tree-stats-mini">
          {estimates && (
            <>
              <span>{estimates.height_ft} ft</span>
              <span>·</span>
              <span>{estimates.canopy_width_ft} ft canopy</span>
              <span>·</span>
              <span>{estimates.age_class}</span>
              {treeStructureHints?.trunkForm && treeStructureHints.trunkForm !== 'unknown' && (
                <>
                  <span>·</span>
                  <span>{treeStructureHints.trunkForm} trunk</span>
                </>
              )}
            </>
          )}
        </div>

        <div className="panel-footer">
          <button className="btn-back" onClick={() => setStep('estimate')}>
            <ArrowLeft size={16} /> Back
          </button>
          <button className="btn-next" onClick={() => setStep('export')}>
            Export <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </motion.div>
  )
}
