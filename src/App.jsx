import { useEffect } from 'react'
import { AnimatePresence } from 'framer-motion'
import useTreeSession from './state/useTreeSession'
import { supabase } from './lib/supabaseClient'
import HomePage from './components/HomePage'
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
