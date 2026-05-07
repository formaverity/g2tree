import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { TreePine, Download, Trash2, LogIn, LogOut } from 'lucide-react'
import useTreeSession from '../state/useTreeSession'
import { supabase, supabaseConfigured } from '../lib/supabaseClient'
import { listMyTrees, loadTree, deleteTree } from '../lib/treeRecords'

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

function CloneStatusPill({ status }) {
  const label = status === 'finished' ? 'finished' : status === 'previewed' ? 'previewed' : 'draft'
  return <span className={`clone-status-pill clone-status-${label}`}>{label}</span>
}

function SavedTreeList({ onLoad }) {
  const [trees, setTrees]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [loadingId, setLoadingId] = useState(null)
  const [deleteId, setDeleteId]   = useState(null)

  useEffect(() => {
    listMyTrees()
      .then(setTrees)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  async function handleDelete(id) {
    if (deleteId !== id) { setDeleteId(id); return }
    setDeleteId(null)
    try {
      await deleteTree(id)
      setTrees((prev) => prev.filter((t) => t.id !== id))
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return <p className="home-trees-loading">Loading saved trees…</p>
  if (error)   return <p className="home-trees-error">{error}</p>

  if (trees.length === 0) {
    return (
      <div className="home-trees-empty">
        <TreePine size={28} strokeWidth={1.5} />
        <p>No saved trees yet.</p>
        <p className="home-trees-empty-hint">After saving a tree you will find it here.</p>
      </div>
    )
  }

  return (
    <div className="tree-list">
      {trees.map((tree) => (
        <div key={tree.id} className="tree-card">
          <div className="tree-card-info">
            <div className="tree-card-name">{tree.name || 'Unknown tree'}</div>
            <div className="tree-card-meta">
              <span className="tree-card-date">{formatDate(tree.created_at)}</span>
              <CloneStatusPill status={tree.cloneStatus} />
            </div>
            {(tree.dbh_in || tree.height_ft) && (
              <div className="tree-card-dims">
                {tree.dbh_in    && <span>DBH {tree.dbh_in}&Prime;</span>}
                {tree.height_ft && <span>H {tree.height_ft}′</span>}
              </div>
            )}
            {(tree.common_name || tree.scientific_name) && (
              <div className="tree-card-species">
                {tree.common_name && <span>{tree.common_name}</span>}
                {tree.scientific_name && <span className="tree-card-sci">{tree.scientific_name}</span>}
              </div>
            )}
          </div>
          <div className="tree-card-actions">
            <button
              className="btn-icon tree-card-load"
              onClick={() => onLoad(tree.id, tree.cloneStatus)}
              disabled={loadingId === tree.id}
            >
              <Download size={14} />
              {loadingId === tree.id ? 'Loading…' : tree.cloneStatus === 'finished' ? 'Open' : 'Load'}
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

export default function HomePage() {
  const session        = useTreeSession((s) => s.session)
  const startNewTree   = useTreeSession((s) => s.startNewTree)
  const restoreSession = useTreeSession((s) => s.restoreSession)
  const setView        = useTreeSession((s) => s.setView)
  const setStep        = useTreeSession((s) => s.setStep)
  const setReturn      = useTreeSession((s) => s.setReturnStep)

  const [loadError, setLoadError] = useState(null)
  const [loadingId, setLoadingId] = useState(null)

  async function handleLoad(id, cloneStatus) {
    setLoadingId(id)
    setLoadError(null)
    try {
      const { tree: t, photos: loadedPhotos } = await loadTree(id)
      restoreSession({
        id,
        photos:                  loadedPhotos,
        estimates:               t.estimates,
        landmarks:               t.landmarks,
        userHints:               t.user_hints,
        treeStructureHints:      t.treeStructureHints,
        speciesAIResult:         t.speciesAIResult,
        structureDetectionResult: t.structureDetectionResult ?? null,
        textureSamples:          t.textureSamples,
        cloneStatus:             t.cloneStatus,
        cloneData:               t.cloneData,
        finishedAt:              t.finishedAt,
      })
      if (cloneStatus === 'finished') {
        setView('finishedClone')
      }
    } catch (err) {
      setLoadError(err.message)
    } finally {
      setLoadingId(null)
    }
  }

  function handleSignIn() {
    setReturn('capture')
    setStep('profile')
    useTreeSession.getState().setView('workflow')
  }

  async function handleSignOut() {
    if (supabase) await supabase.auth.signOut()
  }

  return (
    <motion.div
      className="home-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="home-hero">
        <img src="/g2treelogo.svg" alt="G2Tree" className="home-logo" />
        <p className="home-subtitle">photo-informed procedural tree modeling</p>
      </div>

      <div className="home-actions">
        <button className="btn-primary home-start-btn" onClick={startNewTree}>
          <TreePine size={18} /> Start New Tree
        </button>
      </div>

      <section className="home-trees-section">
        <div className="home-trees-header">
          <h2 className="home-trees-title">My Saved Trees</h2>
          {session && (
            <button className="btn-icon home-signout-btn" onClick={handleSignOut} title="Sign out">
              <LogOut size={14} /> Sign out
            </button>
          )}
        </div>

        {loadError && <p className="home-trees-error">{loadError}</p>}

        {session ? (
          <SavedTreeList onLoad={handleLoad} loadingId={loadingId} />
        ) : (
          <div className="home-signin-prompt">
            <p>Sign in to save and revisit your field trees.</p>
            <button className="btn-icon" onClick={handleSignIn}>
              <LogIn size={14} /> Sign in
            </button>
          </div>
        )}
      </section>
    </motion.div>
  )
}
