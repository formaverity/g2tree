import { useState } from 'react'
import { User } from 'lucide-react'
import useTreeSession from '../state/useTreeSession'
import { saveCurrentTree } from '../lib/treeRecords'
import ConfirmLeaveModal from './ConfirmLeaveModal'

const STEPS = [
  { id: 'capture',   label: 'Capture',   aliases: []                   },
  { id: 'review',    label: 'Review',    aliases: []                   },
  { id: 'identify',  label: 'Identify',  aliases: ['estimate']         },
  { id: 'calibrate', label: 'Calibrate', aliases: []                   },
  { id: 'scaffold',  label: 'Scaffold',  aliases: []                   },
  { id: 'materials', label: 'Materials', aliases: []                   },
  { id: 'clone',     label: 'Clone',     aliases: ['preview']          },
]

function resolveStepIndex(step) {
  const direct = STEPS.findIndex((s) => s.id === step)
  if (direct !== -1) return direct
  return STEPS.findIndex((s) => s.aliases?.includes(step))
}

export default function StepHeader({ step }) {
  const session          = useTreeSession((s) => s.session)
  const setStep          = useTreeSession((s) => s.setStep)
  const setReturn        = useTreeSession((s) => s.setReturnStep)
  const setView          = useTreeSession((s) => s.setView)
  const hasUnsavedChanges = useTreeSession((s) => s.hasUnsavedChanges)
  const currentTreeId    = useTreeSession((s) => s.currentTreeId)
  const photos           = useTreeSession((s) => s.photos)
  const markSaved        = useTreeSession((s) => s.markSaved)
  const resetSession     = useTreeSession((s) => s.resetSession)

  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving]       = useState(false)
  const [saveError, setSaveError] = useState(null)

  const currentIdx = resolveStepIndex(step)

  function handleProfileClick() {
    if (step === 'profile') return
    setReturn(step)
    setStep('profile')
  }

  function goHome() {
    setView('home')
  }

  function handleBrandClick() {
    // No work in progress — go home immediately
    if (!hasUnsavedChanges || photos.length === 0) {
      goHome()
      return
    }
    setSaveError(null)
    setModalOpen(true)
  }

  async function handleSaveAndLeave() {
    setSaving(true)
    setSaveError(null)
    try {
      const tree = await saveCurrentTree(useTreeSession.getState())
      markSaved(tree.id)
      setModalOpen(false)
      goHome()
    } catch (err) {
      setSaveError(err.message ?? 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  function handleDiscardAndLeave() {
    resetSession()
    setModalOpen(false)
    setView('home')
  }

  function handleModalCancel() {
    if (saving) return
    setModalOpen(false)
    setSaveError(null)
  }

  return (
    <>
      <header className="step-header">
        <button
          className="step-header-brand"
          onClick={handleBrandClick}
          aria-label="G2Tree — return home"
          title="Return home"
        >
          G2Tree
        </button>

        <nav className="step-nav" aria-label="Workflow steps">
          {STEPS.map((s, i) => (
            <div
              key={s.id}
              className={`step-dot ${i < currentIdx ? 'done' : ''} ${i === currentIdx ? 'active' : ''}`}
              title={s.label}
            >
              <span className="step-dot-label">{s.label}</span>
            </div>
          ))}
        </nav>

        <button
          className={`step-header-profile ${step === 'profile' ? 'active' : ''}`}
          onClick={handleProfileClick}
          title={session ? session.user.email : 'Sign in / My Trees'}
          aria-label={session ? `Profile: ${session.user.email}` : 'Sign in'}
        >
          <User size={15} />
        </button>
      </header>

      <ConfirmLeaveModal
        isOpen={modalOpen}
        hasSavedId={!!currentTreeId}
        saving={saving}
        saveError={saveError}
        onSave={handleSaveAndLeave}
        onDiscard={handleDiscardAndLeave}
        onCancel={handleModalCancel}
      />
    </>
  )
}
