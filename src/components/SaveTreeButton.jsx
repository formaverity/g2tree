import { useState } from 'react'
import { Save, LogIn, Check, RefreshCw, Home, PlusCircle, Leaf } from 'lucide-react'
import useTreeSession from '../state/useTreeSession'
import { saveCurrentTree } from '../lib/treeRecords'
import { buildClonePackage } from '../lib/clonePackage'

export default function SaveTreeButton() {
  const session           = useTreeSession((s) => s.session)
  const setStep           = useTreeSession((s) => s.setStep)
  const setReturn         = useTreeSession((s) => s.setReturnStep)
  const setView           = useTreeSession((s) => s.setView)
  const step              = useTreeSession((s) => s.step)
  const currentTreeId     = useTreeSession((s) => s.currentTreeId)
  const isSaved           = useTreeSession((s) => s.isSaved)
  const hasUnsavedChanges = useTreeSession((s) => s.hasUnsavedChanges)
  const lastSavedAt       = useTreeSession((s) => s.lastSavedAt)
  const markSaved         = useTreeSession((s) => s.markSaved)
  const startNewTree      = useTreeSession((s) => s.startNewTree)
  const finishClone       = useTreeSession((s) => s.finishClone)
  const cloneStatus       = useTreeSession((s) => s.cloneStatus)
  const estimates         = useTreeSession((s) => s.estimates)

  const [saving, setSaving]           = useState(false)
  const [finishing, setFinishing]     = useState(false)
  const [error, setError]             = useState(null)

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

  // Already saved, no pending changes — show saved confirmation
  if (isSaved && !hasUnsavedChanges) {
    const savedTime = lastSavedAt
      ? new Date(lastSavedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      : null

    const isFinished = cloneStatus === 'finished'

    return (
      <div className="save-tree-section save-tree-section--saved">
        <div className="save-tree-feedback">
          <span className="save-tree-success">
            <Check size={14} />
            {isFinished ? 'Finished clone saved' : 'Saved draft to your profile'}
          </span>
          {savedTime && <span className="save-tree-hint">Saved at {savedTime}</span>}
        </div>
        <div className="save-tree-actions">
          {!isFinished && estimates && (step === 'clone' || step === 'preview' || step === 'export') && (
            <button
              className="btn-icon finish-clone-btn"
              onClick={handleFinishClone}
              disabled={finishing}
            >
              <Leaf size={14} />
              {finishing ? 'Finishing…' : 'Finish Clone'}
            </button>
          )}
          {isFinished && (
            <button className="btn-icon" onClick={() => setView('finishedClone')}>
              <Leaf size={14} /> View Clone
            </button>
          )}
          <button className="btn-icon" onClick={startNewTree}>
            <PlusCircle size={14} /> New tree
          </button>
          <button className="btn-back" onClick={() => setView('home')}>
            <Home size={14} /> Home
          </button>
        </div>
        {error && <span className="save-tree-error">{error}</span>}
      </div>
    )
  }

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

  async function handleFinishClone() {
    setFinishing(true)
    setError(null)
    try {
      const state = useTreeSession.getState()
      const cloneData = buildClonePackage(state)
      finishClone(cloneData)
      const tree = await saveCurrentTree(useTreeSession.getState())
      markSaved(tree.id)
      setView('finishedClone')
    } catch (err) {
      setError(err.message ?? 'Finish failed.')
    } finally {
      setFinishing(false)
    }
  }

  const canFinish = estimates && (step === 'clone' || step === 'preview' || step === 'export') && cloneStatus !== 'finished'

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
      <div className="save-tree-actions">
        <button className="btn-icon" onClick={handleSave} disabled={saving || finishing}>
          {isUpdate ? <RefreshCw size={14} /> : <Save size={14} />}
          {saving ? 'Saving…' : isUpdate ? 'Save changes' : 'Save tree'}
        </button>
        {canFinish && (
          <button
            className="btn-icon finish-clone-btn"
            onClick={handleFinishClone}
            disabled={saving || finishing}
          >
            <Leaf size={14} />
            {finishing ? 'Finishing…' : 'Finish Clone'}
          </button>
        )}
      </div>
    </div>
  )
}
