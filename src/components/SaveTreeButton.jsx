import { useState } from 'react'
import { Save, LogIn, Check } from 'lucide-react'
import useTreeSession from '../state/useTreeSession'
import { saveCurrentTree } from '../lib/treeRecords'

export default function SaveTreeButton() {
  const session = useTreeSession((s) => s.session)
  const setStep = useTreeSession((s) => s.setStep)
  const setReturn = useTreeSession((s) => s.setReturnStep)
  const step = useTreeSession((s) => s.step)

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  if (!session) {
    return (
      <div className="save-tree-section">
        <span className="save-tree-hint">Sign in to save trees.</span>
        <button
          className="btn-icon"
          onClick={() => { setReturn(step); setStep('profile') }}
        >
          <LogIn size={14} /> Sign in
        </button>
      </div>
    )
  }

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      await saveCurrentTree(useTreeSession.getState())
      setSaved(true)
      setTimeout(() => setSaved(false), 4000)
    } catch (err) {
      setError(err.message ?? 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="save-tree-section">
      <div className="save-tree-feedback">
        {saved  && <span className="save-tree-success"><Check size={13} /> Saved to My Trees!</span>}
        {error  && <span className="save-tree-error">{error}</span>}
        {!saved && !error && <span className="save-tree-hint">Save this tree to your profile.</span>}
      </div>
      <button className="btn-icon" onClick={handleSave} disabled={saving}>
        <Save size={14} /> {saving ? 'Saving…' : 'Save Tree'}
      </button>
    </div>
  )
}
