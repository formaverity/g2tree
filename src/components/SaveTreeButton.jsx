import { useState } from 'react'
import { Save, LogIn, Check, RefreshCw, Home, PlusCircle } from 'lucide-react'
import useTreeSession from '../state/useTreeSession'
import { saveCurrentTree } from '../lib/treeRecords'

export default function SaveTreeButton() {
  const session           = useTreeSession((s) => s.session)
  const setStep           = useTreeSession((s) => s.setStep)
  const setReturn         = useTreeSession((s) => s.setReturnStep)
  const step              = useTreeSession((s) => s.step)
  const currentTreeId     = useTreeSession((s) => s.currentTreeId)
  const isSaved           = useTreeSession((s) => s.isSaved)
  const hasUnsavedChanges = useTreeSession((s) => s.hasUnsavedChanges)
  const lastSavedAt       = useTreeSession((s) => s.lastSavedAt)
  const markSaved         = useTreeSession((s) => s.markSaved)
  const startNewTree      = useTreeSession((s) => s.startNewTree)
  const setView           = useTreeSession((s) => s.setView)

  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  // Not signed in
  if (!session) {
    return (
      <div className="save-tree-section">
        <span className="save-tree-hint">Sign in to save trees to your profile.</span>
        <button
          className="btn-icon"
          onClick={() => { setReturn(step); setStep('profile') }}
        >
          <LogIn size={14} /> Sign in
        </button>
      </div>
    )
  }

  // Already saved with no pending changes
  if (isSaved && !hasUnsavedChanges) {
    const savedTime = lastSavedAt
      ? new Date(lastSavedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      : null

    return (
      <div className="save-tree-section save-tree-section--saved">
        <div className="save-tree-feedback">
          <span className="save-tree-success">
            <Check size={14} /> Saved to your profile
          </span>
          {savedTime && <span className="save-tree-hint">Saved at {savedTime}</span>}
        </div>
        <div className="save-tree-actions">
          <button className="btn-icon" onClick={startNewTree}>
            <PlusCircle size={14} /> New tree
          </button>
          <button className="btn-back" onClick={() => setView('home')}>
            <Home size={14} /> Home
          </button>
        </div>
      </div>
    )
  }

  // Has a saved record but unsaved changes, or a brand-new unsaved tree
  const isUpdate = !!currentTreeId

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const tree = await saveCurrentTree(useTreeSession.getState())
      markSaved(tree.id)
    } catch (err) {
      setError(err.message ?? 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="save-tree-section">
      <div className="save-tree-feedback">
        {error
          ? <span className="save-tree-error">{error}</span>
          : <span className="save-tree-hint">
              {isUpdate ? 'You have unsaved changes.' : 'Save this tree to your profile.'}
            </span>
        }
      </div>
      <button className="btn-icon" onClick={handleSave} disabled={saving}>
        {isUpdate ? <RefreshCw size={14} /> : <Save size={14} />}
        {saving ? 'Saving…' : isUpdate ? 'Save changes' : 'Save tree'}
      </button>
    </div>
  )
}
