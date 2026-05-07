import { motion } from 'framer-motion'
import { ArrowRight, ArrowLeft } from 'lucide-react'
import useTreeSession from '../state/useTreeSession'
import TextureSampler from './TextureSampler'
import SaveTreeButton from './SaveTreeButton'

export default function MaterialsPanel() {
  const { setStep } = useTreeSession()

  return (
    <motion.div
      className="panel panel-materials"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
    >
      <div className="panel-body">
        <h2 className="panel-title">Sample Materials</h2>
        <p className="panel-desc">
          Crop bark, leaf, and canopy textures from your photo. These paint the clone's surface.
        </p>

        <TextureSampler />

        <SaveTreeButton />

        <div className="panel-footer">
          <button className="btn-back" onClick={() => setStep('scaffold')}>
            <ArrowLeft size={16} /> Scaffold
          </button>
          <button className="btn-next" onClick={() => setStep('clone')}>
            Generate Clone <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </motion.div>
  )
}
