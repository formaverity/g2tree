import { useEffect } from 'react'
import { Home, Save, Trash2, X } from 'lucide-react'

/**
 * Modal shown when the user tries to navigate away from an unsaved or
 * partially-saved tree session.
 *
 * Props:
 *   isOpen        boolean
 *   hasSavedId    boolean  — true when currentTreeId exists (edits to a saved record)
 *   saving        boolean  — true while an async save is in progress
 *   saveError     string|null
 *   onSave        () => void  — "Save [changes] and return home"
 *   onDiscard     () => void  — "Discard and return home"
 *   onCancel      () => void  — close the modal
 */
export default function ConfirmLeaveModal({
  isOpen,
  hasSavedId,
  saving,
  saveError,
  onSave,
  onDiscard,
  onCancel,
}) {
  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    function handleKey(e) {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen, onCancel])

  if (!isOpen) return null

  const title = hasSavedId
    ? 'Unsaved changes'
    : 'Unsaved tree'

  const message = hasSavedId
    ? 'This tree has been saved but you have unsaved changes. Save them before going home?'
    : 'You have an unsaved tree in progress. Save it before going home?'

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="leave-modal-title"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="modal-card">
        <button
          className="modal-close"
          onClick={onCancel}
          aria-label="Cancel"
          disabled={saving}
        >
          <X size={18} />
        </button>

        <h2 className="modal-title" id="leave-modal-title">{title}</h2>
        <p className="modal-body">{message}</p>

        {saveError && <p className="modal-error">{saveError}</p>}

        <div className="modal-actions">
          <button
            className="btn-primary modal-btn"
            onClick={onSave}
            disabled={saving}
          >
            <Save size={16} />
            {saving ? 'Saving…' : hasSavedId ? 'Save changes and go home' : 'Save and go home'}
          </button>

          <button
            className="btn-secondary modal-btn"
            onClick={onDiscard}
            disabled={saving}
          >
            <Trash2 size={16} />
            Discard and go home
          </button>

          <button
            className="btn-back modal-btn"
            onClick={onCancel}
            disabled={saving}
          >
            <Home size={16} />
            Keep editing
          </button>
        </div>
      </div>
    </div>
  )
}
