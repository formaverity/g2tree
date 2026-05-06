import { User } from 'lucide-react'
import useTreeSession from '../state/useTreeSession'

const STEPS = [
  { id: 'capture',   label: 'Capture'   },
  { id: 'review',    label: 'Review'    },
  { id: 'calibrate', label: 'Calibrate' },
  { id: 'estimate',  label: 'Estimate'  },
  { id: 'preview',   label: 'Preview'   },
  { id: 'export',    label: 'Export'    },
]

export default function StepHeader({ step }) {
  const session    = useTreeSession((s) => s.session)
  const setStep    = useTreeSession((s) => s.setStep)
  const setReturn  = useTreeSession((s) => s.setReturnStep)

  const currentIdx = STEPS.findIndex((s) => s.id === step)

  function handleProfileClick() {
    if (step === 'profile') return
    setReturn(step)
    setStep('profile')
  }

  return (
    <header className="step-header">
      <div className="step-header-brand">G2Tree</div>
      <nav className="step-nav">
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
  )
}
