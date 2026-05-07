import { useEffect } from 'react'
import { AnimatePresence } from 'framer-motion'
import useTreeSession from './state/useTreeSession'
import { supabase } from './lib/supabaseClient'
import HomePage from './components/HomePage'
import StepHeader from './components/StepHeader'
import CapturePanel from './components/CapturePanel'
import PhotoReview from './components/PhotoReview'
import LandmarkCanvas from './components/LandmarkCanvas'
import PreviewErrorBoundary from './components/PreviewErrorBoundary'
import IdentifyPanel from './components/IdentifyPanel'
import PhotoScaffoldEditor from './components/PhotoScaffoldEditor'
import MaterialsPanel from './components/MaterialsPanel'
import ClonePreview from './components/ClonePreview'
import ExportPanel from './components/ExportPanel'
import ProfilePanel from './components/ProfilePanel'
import FinishedCloneView from './components/FinishedCloneView'
import './styles.css'

// Map step IDs → panel components.
// Old IDs (estimate, preview, scaffold) redirect to new equivalents.
const STEP_MAP = {
  capture:   CapturePanel,
  review:    PhotoReview,
  identify:  IdentifyPanel,
  estimate:  IdentifyPanel,      // legacy alias
  calibrate: LandmarkCanvas,
  scaffold:  PhotoScaffoldEditor,
  materials: MaterialsPanel,
  clone:     ClonePreview,
  preview:   ClonePreview,       // legacy alias
  export:    ExportPanel,
  profile:   ProfilePanel,
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

  const StepComponent = STEP_MAP[step] || CapturePanel

  return (
    <div className="app-root">
      <StepHeader step={step} />
      <main className="app-main">
        <AnimatePresence mode="wait">
          {step === 'clone' || step === 'preview' ? (
            <PreviewErrorBoundary key="clone">
              <ClonePreview />
            </PreviewErrorBoundary>
          ) : (
            <StepComponent key={step} />
          )}
        </AnimatePresence>
      </main>
    </div>
  )
}
