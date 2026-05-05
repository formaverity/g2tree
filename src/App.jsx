import { AnimatePresence } from 'framer-motion'
import useTreeSession from './state/useTreeSession'
import StepHeader from './components/StepHeader'
import CapturePanel from './components/CapturePanel'
import PhotoReview from './components/PhotoReview'
import LandmarkCanvas from './components/LandmarkCanvas'
import EstimatePanel from './components/EstimatePanel'
import TreePreview from './components/TreePreview'
import ExportPanel from './components/ExportPanel'
import './styles.css'

const STEP_MAP = {
  capture: CapturePanel,
  review: PhotoReview,
  calibrate: LandmarkCanvas,
  estimate: EstimatePanel,
  preview: TreePreview,
  export: ExportPanel,
}

export default function App() {
  const step = useTreeSession((s) => s.step)
  const StepComponent = STEP_MAP[step] || CapturePanel

  return (
    <div className="app-root">
      <StepHeader step={step} />
      <main className="app-main">
        <AnimatePresence mode="wait">
          <StepComponent key={step} />
        </AnimatePresence>
      </main>
    </div>
  )
}
