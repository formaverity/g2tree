import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Copy, Download, Box, Send } from 'lucide-react'
import useTreeSession from '../state/useTreeSession'
import { buildTreeModelParams } from '../lib/treeModelParams'

function buildExportPayload({
  photos, landmarks, estimates, scaleRealWorldDist,
  userHints, treeStructureHints, speciesAIResult,
  structureDetectionResult, previewMode,
}) {
  return {
    schema: 'g2tree/v2',
    exported_at: new Date().toISOString(),
    metadata: {
      photo_count: photos.length,
      gps:      photos[0]?.exif?.gps      ?? null,
      datetime: photos[0]?.exif?.datetime  ?? null,
      camera:   photos[0]?.exif?.camera    ?? null,
      scale_real_world_dist_m: scaleRealWorldDist,
    },
    user_hints: userHints,
    tree_structure_hints: treeStructureHints,
    landmarks,
    estimates,
    species_identification: speciesAIResult ? {
      provider:        speciesAIResult.provider,
      common_name:     speciesAIResult.common_name,
      scientific_name: speciesAIResult.scientific_name,
      confidence:      speciesAIResult.confidence,
      candidates:      speciesAIResult.candidates,
      notes:           speciesAIResult.notes,
    } : null,
    structure_detection:       structureDetectionResult,
    image_normalization_notes: speciesAIResult?.notes?.filter((n) => n.includes('Converted')) ?? [],
    procedural_params:         buildTreeModelParams(estimates, treeStructureHints),
    procedural_complexity_mode: previewMode,
  }
}

export default function ExportPanel() {
  const {
    photos, landmarks, estimates, scaleRealWorldDist,
    userHints, treeStructureHints, speciesAIResult,
    structureDetectionResult, previewMode,
    setStep,
  } = useTreeSession()

  const [copied, setCopied] = useState(false)

  const payload = buildExportPayload({
    photos, landmarks, estimates, scaleRealWorldDist,
    userHints, treeStructureHints, speciesAIResult,
    structureDetectionResult, previewMode,
  })
  const json = JSON.stringify(payload, null, 2)

  function handleCopy() {
    navigator.clipboard.writeText(json).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }

  function handleDownload() {
    const blob = new Blob([json], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `g2tree_${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <motion.div
      className="panel"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
    >
      <div className="panel-body">
        <h2 className="panel-title">Export</h2>
        <p className="panel-desc">Structured tree record ready for export.</p>

        <div className="export-actions">
          <button className="btn-primary" onClick={handleCopy}>
            <Copy size={16} />
            {copied ? 'Copied!' : 'Copy JSON'}
          </button>
          <button className="btn-primary" onClick={handleDownload}>
            <Download size={16} />
            Download JSON
          </button>
        </div>

        <div className="export-placeholders">
          <button className="btn-placeholder" disabled title="Coming soon">
            <Box size={16} /> Export GLB
          </button>
          <button className="btn-placeholder" disabled title="Coming soon">
            <Send size={16} /> Send to BeechLens
          </button>
          <button className="btn-placeholder" disabled title="Coming soon">
            <Send size={16} /> Send to GROVEMATRIX
          </button>
        </div>

        <pre className="export-preview">{json}</pre>

        <div className="panel-footer">
          <button className="btn-back" onClick={() => setStep('preview')}>
            <ArrowLeft size={16} /> Back
          </button>
        </div>
      </div>
    </motion.div>
  )
}
