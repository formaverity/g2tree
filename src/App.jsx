import { useEffect } from 'react'
import { AnimatePresence } from 'framer-motion'
import useTreeSession from './state/useTreeSession'
import { supabase } from './lib/supabaseClient'
import StepHeader from './components/StepHeader'
import CapturePanel from './components/CapturePanel'
import PhotoReview from './components/PhotoReview'
import LandmarkCanvas from './components/LandmarkCanvas'
import EstimatePanel from './components/EstimatePanel'
import TreePreview from './components/TreePreview'
import ExportPanel from './components/ExportPanel'
import ProfilePanel from './components/ProfilePanel'
import './styles.css'

const STEP_MAP = {
  capture:   CapturePanel,
  review:    PhotoReview,
  calibrate: LandmarkCanvas,
  estimate:  EstimatePanel,
  preview:   TreePreview,
  export:    ExportPanel,
  profile:   ProfilePanel,
}

export default function App() {
  const step = useTreeSession((s) => s.step)
  const setSession = useTreeSession((s) => s.setSession)
  const StepComponent = STEP_MAP[step] || CapturePanel

  useEffect(() => {
    // Restore any existing session on mount
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [setSession])

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
