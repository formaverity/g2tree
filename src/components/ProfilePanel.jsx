import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Trash2, Download, LogOut, Trees } from 'lucide-react'
import useTreeSession from '../state/useTreeSession'
import { supabase } from '../lib/supabaseClient'
import { listMyTrees, loadTree, deleteTree } from '../lib/treeRecords'

// ── Auth form ─────────────────────────────────────────────────────────────────

function AuthForm() {
  const [mode, setMode] = useState('signin') // signin | signup
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)
    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setMessage('Check your email for a confirmation link.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (err) {
      setError(err.message ?? 'Authentication failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-section">
      <p className="auth-tagline">Sign in to save and revisit your field trees.</p>

      <form className="auth-form" onSubmit={handleSubmit}>
        <label className="auth-field">
          <span className="auth-label">Email</span>
          <input
            type="email"
            className="auth-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </label>

        <label className="auth-field">
          <span className="auth-label">Password</span>
          <input
            type="password"
            className="auth-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            required
            minLength={6}
          />
        </label>

        {error   && <div className="auth-error">{error}</div>}
        {message && <div className="auth-message">{message}</div>}

        <button type="submit" className="btn-primary auth-submit" disabled={loading}>
          {loading ? '…' : mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <button
        className="auth-mode-toggle"
        onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); setMessage(null) }}
      >
        {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
      </button>
    </div>
  )
}

// ── My Trees list ─────────────────────────────────────────────────────────────

function MyTrees() {
  const {
    setStep, returnStep,
    setPhotos, setEstimates, setLandmark, setUserHints,
    setTreeStructureHint, setScaleRealWorldDist,
    setSpeciesAIResult, setStructureDetectionResult, setPreviewMode,
  } = useTreeSession()

  const [trees, setTrees]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [loadingId, setLoadingId] = useState(null)
  const [deleteId, setDeleteId]   = useState(null) // id awaiting confirm

  useEffect(() => {
    listMyTrees()
      .then(setTrees)
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false))
  }, [])

  async function handleLoad(id) {
    setLoadingId(id)
    setLoadError(null)
    try {
      const { tree: t, photos: loadedPhotos } = await loadTree(id)

      // Restore all session state from the saved record
      if (loadedPhotos.length > 0) setPhotos(loadedPhotos)
      if (t.estimates)             setEstimates(t.estimates)
      if (t.landmarks)             Object.entries(t.landmarks).forEach(([k, v]) => setLandmark(k, v))
      if (t.user_hints)            setUserHints(t.user_hints)
      if (t.tree_structure_hints)  Object.entries(t.tree_structure_hints).forEach(([k, v]) => setTreeStructureHint(k, v))
      if (t.scale_real_world_dist != null) setScaleRealWorldDist(t.scale_real_world_dist)
      if (t.species_ai_result)     setSpeciesAIResult(t.species_ai_result)
      if (t.structure_detection_result) setStructureDetectionResult(t.structure_detection_result)
      if (t.preview_mode)          setPreviewMode(t.preview_mode)

      setStep('estimate')
    } catch (err) {
      setLoadError(err.message)
    } finally {
      setLoadingId(null)
    }
  }

  async function handleDelete(id) {
    if (deleteId !== id) {
      // First click — ask for confirmation
      setDeleteId(id)
      return
    }
    // Second click — confirmed
    setDeleteId(null)
    try {
      await deleteTree(id)
      setTrees((prev) => prev.filter((t) => t.id !== id))
    } catch (err) {
      setLoadError(err.message)
    }
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  }

  function confidenceLabel(estimates) {
    if (!estimates) return null
    const pct = Math.round((estimates.confidence_overall ?? 0) * 100)
    const cls = pct >= 60 ? 'conf-high' : pct >= 35 ? 'conf-mid' : 'conf-low'
    return <span className={`conf-pill ${cls}`}>{pct}%</span>
  }

  if (loading) return <div className="trees-loading">Loading saved trees…</div>

  if (trees.length === 0) {
    return (
      <div className="trees-empty">
        <Trees size={32} strokeWidth={1.5} />
        <p>No saved trees yet.</p>
        <p className="trees-empty-hint">Save a tree from the Estimate or Export screens.</p>
      </div>
    )
  }

  return (
    <div className="tree-list">
      {loadError && <div className="auth-error">{loadError}</div>}
      {trees.map((tree) => (
        <div key={tree.id} className="tree-card">
          <div className="tree-card-info">
            <div className="tree-card-name">{tree.name || tree.species || 'Unknown tree'}</div>
            <div className="tree-card-meta">
              <span className="tree-card-date">{formatDate(tree.created_at)}</span>
              {confidenceLabel(tree.estimates)}
            </div>
          </div>
          <div className="tree-card-actions">
            <button
              className="btn-icon tree-card-load"
              onClick={() => handleLoad(tree.id)}
              disabled={loadingId === tree.id}
              title="Restore this tree"
            >
              <Download size={14} />
              {loadingId === tree.id ? 'Loading…' : 'Load'}
            </button>
            <button
              className={`btn-remove tree-card-delete ${deleteId === tree.id ? 'confirming' : ''}`}
              onClick={() => handleDelete(tree.id)}
              title={deleteId === tree.id ? 'Tap again to confirm delete' : 'Delete'}
            >
              <Trash2 size={14} />
              {deleteId === tree.id ? 'Sure?' : ''}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Profile panel ─────────────────────────────────────────────────────────────

export default function ProfilePanel() {
  const session    = useTreeSession((s) => s.session)
  const setStep    = useTreeSession((s) => s.setStep)
  const returnStep = useTreeSession((s) => s.returnStep)

  async function handleSignOut() {
    await supabase.auth.signOut()
    setStep('capture')
  }

  return (
    <motion.div
      className="panel"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
    >
      <div className="panel-body">
        <div className="profile-header">
          <h2 className="panel-title">My Trees</h2>
          {session && (
            <div className="profile-user">
              <span className="profile-email">{session.user.email}</span>
              <button className="btn-icon profile-signout" onClick={handleSignOut} title="Sign out">
                <LogOut size={14} /> Sign out
              </button>
            </div>
          )}
        </div>

        {session ? <MyTrees /> : <AuthForm />}

        <div className="panel-footer">
          <button className="btn-back" onClick={() => setStep(returnStep || 'capture')}>
            <ArrowLeft size={16} /> Back
          </button>
        </div>
      </div>
    </motion.div>
  )
}
