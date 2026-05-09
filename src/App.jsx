import { useEffect } from 'react'
import { AnimatePresence } from 'framer-motion'
import useTreeSession from './state/useTreeSession'
import { supabase } from './lib/supabaseClient'
import HomePage from './components/HomePage'
import StepHeader from './components/StepHeader'
import BulkCaptureStep from './components/BulkCaptureStep'
import PhotoLabelGallery from './components/PhotoLabelGallery'
import ScaleAnchorStep from './components/ScaleAnchorStep'
import PhotoReview from './components/PhotoReview'
import LandmarkCanvas from './components/LandmarkCanvas'
import PreviewErrorBoundary from './components/PreviewErrorBoundary'
import IdentifyPanel from './components/IdentifyPanel'
import PhotoScaffoldEditor from './components/PhotoScaffoldEditor'
import MaterialsPanel from './components/MaterialsPanel'
import EcologicalScannerView from './components/EcologicalScannerView'
import EcologicalRolePanel from './components/EcologicalRolePanel'
import ExportPanel from './components/ExportPanel'
import SaveRecordPanel from './components/SaveRecordPanel'
import ProfilePanel from './components/ProfilePanel'
import FinishedCloneView from './components/FinishedCloneView'
import MetricsReviewPanel from './components/MetricsReviewPanel'
import './styles.css'

// Map step IDs → panel components.
// Primary path: capture → label → scale → identify → clone
// scaffold is an optional detail view accessed from clone ("Edit detection")
const STEP_MAP = {
  capture:  BulkCaptureStep,
  label:    PhotoLabelGallery,
  scale:    ScaleAnchorStep,
  identify: IdentifyPanel,
  clone:    EcologicalScannerView,
  // scaffold as detail view — rendered separately below
  scaffold: PhotoScaffoldEditor,
  // Aliases
  estimate: IdentifyPanel,
  preview:  EcologicalScannerView,
  // Account / save
  profile:  ProfilePanel,
  record:   SaveRecordPanel,
  export:   ExportPanel,
}

export default function App() {
  const step       = useTreeSession((s) => s.step)
  const view       = useTreeSession((s) => s.view)
  const setSession = useTreeSession((s) => s.setSession)

  useEffect(() => {
    if (!supabase) return

    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [setSession])

  if (view === 'home') {
    return (
      <div className="app-root">
        <AnimatePresence mode="wait">
          <HomePage key="home" />
        </AnimatePresence>
      </div>
    )
  }

  if (view === 'finishedClone') {
    return (
      <div className="app-root">
        <AnimatePresence mode="wait">
          <FinishedCloneView key="finishedClone" />
        </AnimatePresence>
      </div>
    )
  }

  const StepComponent = STEP_MAP[step] ?? BulkCaptureStep

  // Scaffold is a full-screen detail view — no StepHeader chrome
  if (step === 'scaffold') {
    return (
      <div className="app-root">
        <AnimatePresence mode="wait">
          <PhotoScaffoldEditor key="scaffold" />
        </AnimatePresence>
      </div>
    )
  }

  return (
    <div className="app-root">
      <StepHeader step={step} />
      <main className="app-main">
        <AnimatePresence mode="wait">
          {step === 'clone' || step === 'preview' ? (
            <PreviewErrorBoundary key="clone">
              <EcologicalScannerView />
            </PreviewErrorBoundary>
          ) : (
            <StepComponent key={step} />
          )}
        </AnimatePresence>
      </main>
    </div>
  )
}
