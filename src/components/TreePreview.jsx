import { Suspense, useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { motion } from 'framer-motion'
import { ArrowRight, ArrowLeft } from 'lucide-react'
import * as THREE from 'three'
import useTreeSession from '../state/useTreeSession'
import { buildTreeModelParams } from '../lib/treeModelParams'
import { loadTextureSafe } from '../lib/threeTextureUtils'
import PreviewErrorBoundary from './PreviewErrorBoundary'

const SHOW_DEBUG = import.meta.env.DEV || import.meta.env.VITE_DEBUG_PREVIEW === 'true'

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
// All sub-builders are closures over shared flat arrays.
// Fully deterministic — no Math.random() calls.

function buildGeometry(params, mode) {
  const {
    trunkHeight, trunkRadiusBase, trunkRadiusTop,
    canopyRadius, canopyYOffset, canopyDensity,
    trunkForm, trunkCount,
    primaryBranchCount, secondaryBranchCount, leafClustersPerTip,
    leafClusterRadius, branchLength,
    leafDistribution, canopyDistribution,
    treeType, crownHabit, branchTierCount, patchiness,
    branchDensity,
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

  // ── Shared helpers ──────────────────────────────────────────────────────────

  function addTrunk(from, to, r0, r1) {
    const s = cylSeg(from, to, r0, r1)
    if (s && trunks.length < MAX_SEGS) trunks.push(s)
  }

  function addBranch(from, to, r0, r1) {
    const s = cylSeg(from, to, r0, r1)
    if (s && branches.length < MAX_SEGS) branches.push(s)
  }

  function addLeaf(pos, radius, baseOpacity, isConiferNeedle = false) {
    if (leafClusters.length >= MAX_LEAVES) return
    let opacity = baseOpacity
    if (patchiness > 0) {
      const gapEvery = Math.max(2, Math.round(1 / patchiness))
      if (leafClusters.length % gapEvery === 0) opacity *= 0.07
    }
    leafClusters.push({ pos, radius, opacity, isConiferNeedle })
    if (isDetailed) {
      const n = Math.min(7, MAX_SPECKLE - speckleXYZ.length / 3)
      for (let k = 0; k < n; k++) {
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

  // ── Conifer form ────────────────────────────────────────────────────────────

  function buildConiferForm() {
    const isColumnar = crownHabit === 'columnar'

    addTrunk([0, 0, 0], [0, trunkHeight, 0], trunkRadiusBase, trunkRadiusTop * 0.30)

    if (isSimple) {
      addLeaf([0, trunkHeight * 0.52, 0], canopyRadius * 0.72, 0.90, true)
      return
    }

    const tierCount = branchTierCount
    const tierStart = isColumnar ? 0.08 : 0.14
    const tierEnd   = 0.91
    const downSlope = isColumnar ? 0.06 : 0.24

    for (let tier = 0; tier < tierCount; tier++) {
      const t      = tierStart + (tier / Math.max(tierCount - 1, 1)) * (tierEnd - tierStart)
      const tierY  = trunkHeight * t
      const taperF = isColumnar ? 0.82 : Math.max(0.14, 1.0 - t * 0.82)

      const tierLen        = canopyRadius * taperF * 1.15
      const branchesInWhorl = 5
      const tierRot        = tier * (Math.PI * 2 / branchesInWhorl) * 0.40

      const brR0 = trunkRadiusTop * 0.52 * Math.max(taperF, 0.28)
      const brR1 = brR0 * 0.30

      for (let b = 0; b < branchesInWhorl; b++) {
        const angle  = (b / branchesInWhorl) * Math.PI * 2 + tierRot
        const bX     = Math.sin(angle)
        const bZ     = Math.cos(angle)
        const dropY  = downSlope * tierLen

        const midPt  = [bX * tierLen * 0.50, tierY - dropY * 0.38, bZ * tierLen * 0.50]
        const tipPt  = [bX * tierLen,         tierY - dropY,        bZ * tierLen        ]

        addBranch([0, tierY, 0], midPt, brR0, brR1 * 1.20)
        addBranch(midPt, tipPt, brR1 * 1.10, brR1 * 0.45)

        const nR = leafClusterRadius * (0.65 + taperF * 0.35)
        addLeaf(midPt, nR * 0.82, 0.72 + tier * 0.012, true)
        addLeaf(tipPt, nR,         0.76 + tier * 0.012, true)
      }

      if (isDetailed && t < 0.62) {
        for (let b = 0; b < 3; b++) {
          const angle  = (b / 3) * Math.PI * 2 + tierRot + Math.PI / 5
          const subLen = tierLen * 0.38
          const subPt  = [
            Math.sin(angle) * subLen,
            tierY - downSlope * subLen * 1.30,
            Math.cos(angle) * subLen,
          ]
          addBranch([0, tierY, 0], subPt, brR0 * 0.44, brR1 * 0.42)
          addLeaf(subPt, leafClusterRadius * 0.52 * taperF, 0.64, true)
        }
      }
    }

    addTrunk([0, trunkHeight * 0.88, 0], [0, trunkHeight * 1.07, 0],
             trunkRadiusTop * 0.28, 0.004)
  }

  // ── Palm form ───────────────────────────────────────────────────────────────

  function buildPalmForm() {
    const lean = 0.055
    const midH = [lean * 0.5, trunkHeight * 0.54, 0]
    const top  = [lean, trunkHeight, 0]

    addTrunk([0, 0, 0], midH, trunkRadiusBase, trunkRadiusBase * 0.72)
    addTrunk(midH, top, trunkRadiusBase * 0.72, trunkRadiusTop)

    if (isSimple) {
      addLeaf([lean, trunkHeight * 1.04, 0], canopyRadius * 0.58, 0.90)
      return
    }

    const frondCount = branchDensity === 'high' ? 11 : branchDensity === 'low' ? 7 : 9
    const frondLen   = canopyRadius * 1.35

    for (let i = 0; i < frondCount; i++) {
      const angle    = (i / frondCount) * Math.PI * 2
      const elevUp   = 0.52
      const bX       = Math.sin(angle)
      const bZ       = Math.cos(angle)

      const midFrond = [
        top[0] + bX * frondLen * 0.44,
        top[1] + elevUp * frondLen * 0.44,
        top[2] + bZ * frondLen * 0.44,
      ]
      const tipFrond = [
        top[0] + bX * frondLen,
        top[1] + elevUp * frondLen * 0.44 - frondLen * 0.38,
        top[2] + bZ * frondLen,
      ]

      const frR0 = trunkRadiusTop * 0.68
      addBranch(top,      midFrond, frR0,        frR0 * 0.52)
      addBranch(midFrond, tipFrond, frR0 * 0.52, frR0 * 0.14)

      addLeaf(tipFrond, leafClusterRadius * 0.92, 0.82)
      if (leafClustersPerTip > 1) {
        addLeaf(midFrond, leafClusterRadius * 0.62, 0.70)
      }
    }
  }

  // ── Deciduous / unknown form ────────────────────────────────────────────────

  function buildDeciduousForm() {
    const HABITS = {
      rounded:         { startT: 0.50, upness: 0.44, spread: 0.85, lenVar: 0.08, gapRate: 0    },
      oval:            { startT: 0.56, upness: 0.53, spread: 0.72, lenVar: 0.05, gapRate: 0    },
      broad_irregular: { startT: 0.36, upness: 0.30, spread: 0.95, lenVar: 0.20, gapRate: 0    },
      open_airy:       { startT: 0.46, upness: 0.48, spread: 0.68, lenVar: 0.13, gapRate: 0.28 },
    }
    const h = HABITS[crownHabit] || HABITS.rounded

    function growBranches(attachPt, trunkDirArr, pCount, lengthScale) {
      if (isSimple || pCount === 0) return
      const td = new THREE.Vector3(...trunkDirArr)
      const q  = new THREE.Quaternion().setFromUnitVectors(Y_UP, td)

      for (let i = 0; i < pCount; i++) {
        if (h.gapRate > 0 && i % Math.max(2, Math.round(1 / h.gapRate)) === 0) continue

        const angle = (i / pCount) * Math.PI * 2
        const dir   = new THREE.Vector3(
          Math.sin(angle) * h.spread + (i === 0 ? asymX * 0.4 : 0),
          h.upness,
          Math.cos(angle) * h.spread,
        ).normalize().applyQuaternion(q)

        const bLen = branchLength * lengthScale * (0.95 + (i % 3) * h.lenVar)
        const bEnd = [
          attachPt[0] + dir.x * bLen,
          attachPt[1] + dir.y * bLen,
          attachPt[2] + dir.z * bLen,
        ]
        addBranch(attachPt, bEnd, trunkRadiusTop * 0.55, trunkRadiusTop * 0.27)

        for (let j = 0; j < secondaryBranchCount; j++) {
          const secA = angle + (j - secondaryBranchCount / 2 + 0.5) * 1.15
          const sDir = new THREE.Vector3(Math.sin(secA) * 0.82, h.upness + j * 0.10, Math.cos(secA) * 0.82).normalize()
          const sLen = bLen * 0.50
          const sEnd = [
            bEnd[0] + sDir.x * sLen,
            bEnd[1] + sDir.y * sLen,
            bEnd[2] + sDir.z * sLen,
          ]
          addBranch(bEnd, sEnd, trunkRadiusTop * 0.20, trunkRadiusTop * 0.10)

          for (let k = 0; k < leafClustersPerTip; k++) {
            addLeaf(
              [sEnd[0] + (k % 2 === 0 ? 0.06 : -0.06) * (j + 1),
               sEnd[1] + 0.04 * k,
               sEnd[2] + 0.06 * (j + 0.5)],
              leafClusterRadius * (0.85 + (j + k) % 3 * 0.10),
              0.68 + (i % 5) * 0.06,
            )
          }
        }
      }
    }

    if (trunkForm === 'multi') {
      const stems = Math.min(Math.max(trunkCount, 2), 5)
      for (let i = 0; i < stems; i++) {
        const angle   = (i / stems) * Math.PI * 2
        const baseOff = [Math.sin(angle) * 0.07, 0, Math.cos(angle) * 0.07]
        const tip     = [
          baseOff[0] + Math.sin(angle) * 0.10 * trunkHeight,
          trunkHeight * 0.90,
          baseOff[2] + Math.cos(angle) * 0.10 * trunkHeight,
        ]
        addTrunk(baseOff, tip, trunkRadiusBase * 0.62, trunkRadiusTop * 0.7)
        const td = new THREE.Vector3(tip[0]-baseOff[0], tip[1]-baseOff[1], tip[2]-baseOff[2]).normalize()
        growBranches(tip, [td.x, td.y, td.z], Math.ceil(primaryBranchCount / stems), 0.75)
      }

    } else if (trunkForm === 'forked') {
      const splitH  = trunkHeight * 0.46
      const splitPt = [0, splitH, 0]
      addTrunk([0, 0, 0], splitPt, trunkRadiusBase, trunkRadiusBase * 0.68)
      for (let i = 0; i < 2; i++) {
        const angle = (i / 2) * Math.PI * 2 + Math.PI * 0.22
        const lH    = trunkHeight - splitH
        const lEnd  = [
          splitPt[0] + Math.sin(angle) * 0.22 * lH,
          trunkHeight,
          splitPt[2] + Math.cos(angle) * 0.22 * lH,
        ]
        addTrunk(splitPt, lEnd, trunkRadiusBase * 0.52, trunkRadiusTop)
        const ld = new THREE.Vector3(lEnd[0]-splitPt[0], lEnd[1]-splitPt[1], lEnd[2]-splitPt[2]).normalize()
        growBranches(lEnd, [ld.x, ld.y, ld.z], Math.ceil(primaryBranchCount / 2), 0.88)
      }

    } else {
      addTrunk([0, 0, 0], [0, trunkHeight, 0], trunkRadiusBase, trunkRadiusTop)

      if (!isSimple) {
        for (let i = 0; i < primaryBranchCount; i++) {
          if (h.gapRate > 0 && i % Math.max(2, Math.round(1 / h.gapRate)) === 0) continue

          const t       = h.startT + (i / primaryBranchCount) * 0.40
          const attachY = trunkHeight * t
          const aX      = asymX * (1 - t)
          const angle   = (i / primaryBranchCount) * Math.PI * 2 + i * 0.28
          const upness  = h.upness + t * 0.22
          const dir     = new THREE.Vector3(Math.sin(angle) * h.spread, upness, Math.cos(angle) * h.spread).normalize()
          const bLen    = branchLength * (1.05 + h.lenVar * (i % 3) - t * 0.28)
          const bEnd    = [aX + dir.x * bLen, attachY + dir.y * bLen, dir.z * bLen]

          addBranch([aX, attachY, 0], bEnd, trunkRadiusTop * 0.58, trunkRadiusTop * 0.28)

          for (let j = 0; j < secondaryBranchCount; j++) {
            const secA = angle + (j - secondaryBranchCount / 2 + 0.5) * 1.10
            const sDir = new THREE.Vector3(Math.sin(secA) * 0.80, 0.58, Math.cos(secA) * 0.80).normalize()
            const sLen = bLen * 0.50
            const sEnd = [bEnd[0] + sDir.x * sLen, bEnd[1] + sDir.y * sLen, bEnd[2] + sDir.z * sLen]

            addBranch(bEnd, sEnd, trunkRadiusTop * 0.19, trunkRadiusTop * 0.09)

            for (let k = 0; k < leafClustersPerTip; k++) {
              addLeaf(
                [sEnd[0] + (k % 2 === 0 ? 0.05 : -0.05) * (j + 1),
                 sEnd[1] + 0.04 * k,
                 sEnd[2] + 0.05 * (j + 0.5)],
                leafClusterRadius * (0.85 + j % 3 * 0.10),
                0.66 + i % 5 * 0.07,
              )
            }
          }
        }
      }
    }

    if (isSimple) {
      addLeaf([asymX, canopyYOffset, 0], canopyRadius, 0.88)
    } else {
      const fillerN = leafDistribution === 'even' ? 6 : leafDistribution === 'outer_shell' ? 4 : 3
      for (let i = 0; i < fillerN; i++) {
        const angle = (i / fillerN) * Math.PI * 2
        const r     = canopyRadius * 0.42
        addLeaf(
          [asymX + Math.sin(angle) * r,
           canopyYOffset + (i % 2 === 0 ? 0.08 : -0.06) * canopyRadius,
           Math.cos(angle) * r],
          leafClusterRadius * 1.35,
          canopyDensity * 0.62,
        )
      }
    }
  }

  // ── Dispatch ────────────────────────────────────────────────────────────────

  if (treeType === 'conifer') {
    buildConiferForm()
  } else if (treeType === 'palm_like') {
    buildPalmForm()
  } else {
    buildDeciduousForm()
  }

  const speckles = speckleXYZ.length > 0 ? new Float32Array(speckleXYZ) : null
  return { trunks, branches, leafClusters, speckles }
}

// ── Segment renderer ──────────────────────────────────────────────────────────

function SegMesh({ seg, color, map }) {
  return (
    <mesh position={seg.pos} quaternion={seg.q}>
      <cylinderGeometry args={[seg.r0, seg.r1, seg.len, 7, 1]} />
      <meshStandardMaterial color={map ? '#ffffff' : color} roughness={0.93} map={map || null} />
    </mesh>
  )
}

// ── ProceduralTree ────────────────────────────────────────────────────────────

export function ProceduralTree({ params, mode, barkMap, leafMap, leafMasked }) {
  const geo = useMemo(() => buildGeometry(params, mode), [params, mode])

  const speckleAttr = useMemo(() => {
    if (!geo.speckles) return null
    return new THREE.BufferAttribute(geo.speckles, 3)
  }, [geo.speckles])

  return (
    <group position={[0, -params.trunkHeight / 2, 0]}>
      {geo.trunks.map((s, i)   => <SegMesh key={`t${i}`} seg={s} color={params.trunkColor} map={barkMap} />)}
      {geo.branches.map((s, i) => <SegMesh key={`b${i}`} seg={s} color={params.trunkColor} map={barkMap} />)}

      {geo.leafClusters.map((lc, i) => (
        <mesh key={`l${i}`} position={lc.pos}>
          <sphereGeometry args={[lc.radius, lc.isConiferNeedle ? 6 : 7, lc.isConiferNeedle ? 4 : 6]} />
          <meshStandardMaterial
            color={leafMap ? '#ffffff' : params.canopyColor}
            roughness={lc.isConiferNeedle ? 0.92 : 0.82}
            transparent
            opacity={lc.opacity * Math.min(params.canopyDensity, 1)}
            map={leafMap || null}
            alphaTest={leafMasked ? 0.35 : 0}
            depthWrite={!leafMasked}
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

// ── ScaffoldTree — photo_scaffold render mode ─────────────────────────────────

export function ScaffoldTree({ scaffoldGeometry, params, barkMap, leafMap, leafMasked }) {
  const geo = useMemo(() => {
    if (!scaffoldGeometry || !params) return null
    const { trunkCurve, branchAttractors, leafCloudPoints } = scaffoldGeometry

    const trunks   = []
    const branches = []

    // Curved trunk segments
    if (trunkCurve?.length > 1) {
      for (let i = 0; i < trunkCurve.length - 1; i++) {
        const a  = trunkCurve[i]
        const b  = trunkCurve[i + 1]
        const tA = i / (trunkCurve.length - 1)
        const tB = (i + 1) / (trunkCurve.length - 1)
        const r0 = a.r ?? params.trunkRadiusBase
        const r1 = b.r ?? params.trunkRadiusTop
        const seg = cylSeg([a.x, a.y, a.z], [b.x, b.y, b.z], r0, r1)
        if (seg) trunks.push(seg)
      }
    } else {
      // Fallback: straight trunk
      const seg = cylSeg([0, 0, 0], [0, params.trunkHeight, 0], params.trunkRadiusBase, params.trunkRadiusTop)
      if (seg) trunks.push(seg)
    }

    // Branch attractors
    for (const att of (branchAttractors ?? [])) {
      const seg = cylSeg(att.start, att.end, att.r0 ?? 0.025, att.r1 ?? 0.012)
      if (seg) branches.push(seg)
    }

    return { trunks, branches, leafCloudPoints: leafCloudPoints ?? [] }
  }, [scaffoldGeometry, params])

  if (!geo) return null

  return (
    <group position={[0, -params.trunkHeight / 2, 0]}>
      {geo.trunks.map((s, i)   => <SegMesh key={`st${i}`} seg={s} color={params.trunkColor} map={barkMap} />)}
      {geo.branches.map((s, i) => <SegMesh key={`sb${i}`} seg={s} color={params.trunkColor} map={barkMap} />)}

      {geo.leafCloudPoints.map((lc, i) => (
        <mesh key={`sl${i}`} position={lc.pos}>
          <sphereGeometry args={[lc.radius, 7, 6]} />
          <meshStandardMaterial
            color={leafMap ? '#ffffff' : params.canopyColor}
            roughness={0.82}
            transparent
            opacity={lc.opacity * Math.min(params.canopyDensity, 1)}
            map={leafMap || null}
            alphaTest={leafMasked ? 0.35 : 0}
            depthWrite={!leafMasked}
          />
        </mesh>
      ))}

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
        <circleGeometry args={[params.canopyRadius * 0.52, 28]} />
        <meshStandardMaterial color="#1b2e1d" transparent opacity={0.32} />
      </mesh>
    </group>
  )
}

// ── TreePreview panel ─────────────────────────────────────────────────────────

const MODES = ['simple', 'structured', 'detailed', 'photo_scaffold']

const TYPE_LABEL = {
  deciduous_broadleaf: 'deciduous',
  conifer:             'conifer',
  palm_like:           'palm',
}

function isUsableUrl(url) {
  return typeof url === 'string' && (url.startsWith('data:image') || url.startsWith('http'))
}

export default function TreePreview() {
  const {
    estimates, treeStructureHints,
    speciesAIResult, userHints,
    textureSamples, scaffoldGeometry,
    previewMode, setPreviewMode, setStep,
  } = useTreeSession()

  const [barkMap, setBarkMap]     = useState(null)
  const [leafMap, setLeafMap]     = useState(null)
  const [leafMasked, setLeafMasked] = useState(false)
  const [skipTextures, setSkipTextures] = useState(false)
  const [texErrors, setTexErrors] = useState(0)

  // Validate sample before reading URLs — accept both data: and https: (persisted)
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

  // Detect if the leaf texture is a masked PNG (transparent alpha)
  const isMaskedPng = typeof leafUrl === 'string' && leafUrl.startsWith('data:image/png')

  useEffect(() => {
    if (skipTextures || !barkUrl) { setBarkMap(null); return }
    let cancelled = false
    let loaded = null
    loadTextureSafe(barkUrl, { textureType: 'bark', repeat: [3, 2] }).then((tex) => {
      if (cancelled) { tex?.dispose(); return }
      loaded = tex
      if (!tex) setTexErrors((n) => n + 1)
      setBarkMap(tex)
    })
    return () => {
      cancelled = true
      loaded?.dispose()
      setBarkMap(null)
    }
  }, [barkUrl, skipTextures])

  useEffect(() => {
    if (skipTextures || !leafUrl) { setLeafMap(null); setLeafMasked(false); return }
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
      if (!tex) setTexErrors((n) => n + 1)
      setLeafMap(tex)
      setLeafMasked(isMaskedPng && !!tex)
    })
    return () => {
      cancelled = true
      loaded?.dispose()
      setLeafMap(null)
      setLeafMasked(false)
    }
  }, [leafUrl, skipTextures, isMaskedPng])

  const params = useMemo(
    () => buildTreeModelParams(
      estimates,
      treeStructureHints,
      {
        scientificName: speciesAIResult?.scientific_name ?? '',
        commonName:     speciesAIResult?.common_name ?? userHints?.known_species ?? '',
      },
      textureSamples,
    ),
    [estimates, treeStructureHints, speciesAIResult, userHints, textureSamples],
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

        <PreviewErrorBoundary onSkipTextures={() => setSkipTextures(true)}>
          <div className="canvas-wrap">
            <Canvas camera={{ position: [1.8, 1.2, 1.8], fov: 45 }} gl={{ antialias: true, alpha: true }}>
              <ambientLight intensity={0.5} />
              <directionalLight position={[3, 6, 4]} intensity={1.2} />
              <directionalLight position={[-3, 2, -2]} intensity={0.3} />
              <Suspense fallback={null}>
                {previewMode === 'photo_scaffold' && scaffoldGeometry ? (
                  <ScaffoldTree
                    scaffoldGeometry={scaffoldGeometry}
                    params={params}
                    barkMap={barkMap}
                    leafMap={leafMap}
                    leafMasked={leafMasked}
                  />
                ) : (
                  <ProceduralTree
                    params={params}
                    mode={previewMode === 'photo_scaffold' ? 'structured' : previewMode}
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

        {SHOW_DEBUG && (
          <div className="preview-diagnostics">
            <span>bark: {barkUrl ? (barkMap ? 'loaded' : 'loading…') : '—'}</span>
            <span>leaf: {leafUrl ? (leafMap ? (leafMasked ? 'masked' : 'loaded') : 'loading…') : '—'}</span>
            <span>canopy: {textureSamples?.canopy ? 'applied' : '—'}</span>
            {texErrors > 0 && <span className="diag-error">{texErrors} error(s)</span>}
            {skipTextures && <span className="diag-error">textures skipped</span>}
          </div>
        )}

        <div className="material-inputs">
          {(['bark', 'leaf', 'canopy']).map((t) => (
            <span key={t} className={`material-input-tag${textureSamples?.[t] ? ' applied' : ''}`}>
              {t}: {textureSamples?.[t] ? 'applied' : 'not sampled'}
            </span>
          ))}
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
              {TYPE_LABEL[params.treeType] && (
                <>
                  <span>·</span>
                  <span>{TYPE_LABEL[params.treeType]}</span>
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
