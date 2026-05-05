import { Suspense, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment } from '@react-three/drei'
import { motion } from 'framer-motion'
import { ArrowRight, ArrowLeft } from 'lucide-react'
import useTreeSession from '../state/useTreeSession'
import { buildTreeModelParams } from '../lib/treeModelParams'
import * as THREE from 'three'

// --- Procedural geometry helpers ---

function Branch({ origin, direction, length, radius, levels, params }) {
  if (levels <= 0 || length < 0.04) return null

  const end = [
    origin[0] + direction[0] * length,
    origin[1] + direction[1] * length,
    origin[2] + direction[2] * length,
  ]

  const mid = [(origin[0] + end[0]) / 2, (origin[1] + end[1]) / 2, (origin[2] + end[2]) / 2]
  const len3 = Math.sqrt(direction[0] ** 2 + direction[1] ** 2 + direction[2] ** 2)
  const normDir = direction.map((d) => d / len3)

  // Quaternion rotation from Y-axis to direction
  const up = new THREE.Vector3(0, 1, 0)
  const dir = new THREE.Vector3(...normDir)
  const quat = new THREE.Quaternion().setFromUnitVectors(up, dir)

  const subBranches = []
  const count = Math.min(params.branchCount, 5)
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2
    const spread = 0.55
    const subDir = new THREE.Vector3(
      Math.sin(angle) * spread,
      0.7,
      Math.cos(angle) * spread
    ).normalize()
    subDir.applyQuaternion(quat)
    subBranches.push(
      <Branch
        key={i}
        origin={end}
        direction={[subDir.x, subDir.y, subDir.z]}
        length={length * 0.65}
        radius={radius * 0.6}
        levels={levels - 1}
        params={params}
      />
    )
  }

  return (
    <group>
      <mesh position={mid} quaternion={quat}>
        <cylinderGeometry args={[radius * 0.6, radius, length, 6]} />
        <meshStandardMaterial color={params.trunkColor} roughness={0.9} />
      </mesh>
      {subBranches}
    </group>
  )
}

function ProceduralTree({ params, mode }) {
  const { trunkHeight, trunkRadiusBase, trunkRadiusTop, canopyRadius, canopyYOffset,
          branchLevels, branchCount, branchLength, canopyDensity, canopyColor, trunkColor } = params

  const primaryBranches = useMemo(() => {
    if (mode === 'simple') return []
    const branches = []
    const count = Math.min(branchCount, 8)
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2
      const spread = 0.7
      branches.push({
        origin: [0, trunkHeight * 0.55, 0],
        direction: [Math.sin(angle) * spread, 0.6, Math.cos(angle) * spread],
        length: branchLength,
        radius: trunkRadiusTop * 0.8,
        levels: branchLevels - 1,
      })
    }
    return branches
  }, [mode, branchCount, trunkHeight, branchLength, trunkRadiusTop, branchLevels])

  // Canopy spheres for density illusion
  const canopySpheres = useMemo(() => {
    if (mode === 'simple') {
      return [{ pos: [0, canopyYOffset, 0], r: canopyRadius, opacity: 0.9 }]
    }
    if (mode === 'canopy_mass') {
      const spheres = []
      const base = Math.round(6 * canopyDensity)
      for (let i = 0; i < base; i++) {
        const angle = (i / base) * Math.PI * 2
        const r = canopyRadius * (0.55 + Math.random() * 0.45)
        const yo = canopyYOffset + (Math.random() - 0.4) * canopyRadius * 0.6
        spheres.push({
          pos: [Math.sin(angle) * canopyRadius * 0.5, yo, Math.cos(angle) * canopyRadius * 0.5],
          r: r * 0.65,
          opacity: 0.7 + Math.random() * 0.25,
        })
      }
      spheres.push({ pos: [0, canopyYOffset + canopyRadius * 0.15, 0], r: canopyRadius * 0.7, opacity: 0.85 })
      return spheres
    }
    // branched — smaller accent spheres
    return [{ pos: [0, canopyYOffset + canopyRadius * 0.1, 0], r: canopyRadius * 0.8, opacity: 0.6 }]
  }, [mode, canopyYOffset, canopyRadius, canopyDensity])

  return (
    <group position={[0, -trunkHeight / 2, 0]}>
      {/* Trunk */}
      <mesh position={[0, trunkHeight / 2, 0]}>
        <cylinderGeometry args={[trunkRadiusTop, trunkRadiusBase, trunkHeight, 10]} />
        <meshStandardMaterial color={trunkColor} roughness={0.95} />
      </mesh>

      {/* Branches */}
      {primaryBranches.map((b, i) => (
        <Branch key={i} {...b} params={params} />
      ))}

      {/* Canopy */}
      {canopySpheres.map((s, i) => (
        <mesh key={i} position={s.pos}>
          <sphereGeometry args={[s.r, 12, 10]} />
          <meshStandardMaterial
            color={canopyColor}
            roughness={0.8}
            transparent
            opacity={s.opacity * canopyDensity}
          />
        </mesh>
      ))}

      {/* Ground disk */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
        <circleGeometry args={[canopyRadius * 0.6, 32]} />
        <meshStandardMaterial color="#2a3a2a" transparent opacity={0.4} />
      </mesh>
    </group>
  )
}

const MODES = ['simple', 'branched', 'canopy_mass']

export default function TreePreview() {
  const { estimates, previewMode, setPreviewMode, setStep } = useTreeSession()
  const params = useMemo(() => buildTreeModelParams(estimates), [estimates])

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
              className={`mode-tab ${previewMode === m ? 'active' : ''}`}
              onClick={() => setPreviewMode(m)}
            >
              {m.replace('_', ' ')}
            </button>
          ))}
        </div>

        <div className="canvas-wrap">
          <Canvas
            camera={{ position: [1.8, 1.2, 1.8], fov: 45 }}
            gl={{ antialias: true, alpha: true }}
          >
            <ambientLight intensity={0.5} />
            <directionalLight position={[3, 6, 4]} intensity={1.2} castShadow />
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
