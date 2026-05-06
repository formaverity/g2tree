import { create } from 'zustand'

const isMobile = typeof window !== 'undefined' && window.innerWidth < 768

const DEFAULT_LANDMARKS = {
  trunk_base:   { x: 0.5,  y: 0.85 },
  trunk_top:    { x: 0.5,  y: 0.35 },
  canopy_left:  { x: 0.2,  y: 0.2  },
  canopy_right: { x: 0.8,  y: 0.2  },
  dbh_left:     { x: 0.47, y: 0.70 },
  dbh_right:    { x: 0.53, y: 0.70 },
  scale_a:      { x: 0.1,  y: 0.9  },
  scale_b:      { x: 0.3,  y: 0.9  },
}

const useTreeSession = create((set, get) => ({
  // Auth session (populated by supabase.auth.onAuthStateChange in App)
  session: null,
  setSession: (session) => set({ session }),

  // Step management
  // profile is outside the main workflow — handled by StepHeader profile button
  step: 'capture', // capture | review | calibrate | estimate | preview | export | profile
  returnStep: 'capture', // step to return to when leaving profile
  setStep: (step) => set({ step }),
  setReturnStep: (step) => set({ returnStep: step }),

  // Photos
  photos: [], // [{ id, url, file, exif }]
  addPhotos: (files) => {
    const newPhotos = files.map((file) => ({
      id: crypto.randomUUID(),
      url: URL.createObjectURL(file),
      file,
      exif: null,
    }))
    set((s) => ({ photos: [...s.photos, ...newPhotos] }))
  },
  // Used when restoring saved trees (photos arrive as { id, url, file: null, exif })
  setPhotos: (photos) => set({ photos }),
  removePhoto: (id) => {
    const photo = get().photos.find((p) => p.id === id)
    if (photo) URL.revokeObjectURL(photo.url)
    set((s) => ({ photos: s.photos.filter((p) => p.id !== id) }))
  },
  setPhotoExif: (id, exif) =>
    set((s) => ({
      photos: s.photos.map((p) => (p.id === id ? { ...p, exif } : p)),
    })),

  // Landmarks (normalized 0-1 coords relative to first image)
  landmarks: { ...DEFAULT_LANDMARKS },
  setLandmark: (key, pos) =>
    set((s) => ({ landmarks: { ...s.landmarks, [key]: pos } })),
  resetLandmarks: () => set({ landmarks: { ...DEFAULT_LANDMARKS } }),

  // Scale reference
  showScaleRef: false,
  toggleScaleRef: () => set((s) => ({ showScaleRef: !s.showScaleRef })),
  scaleRealWorldDist: 1.0, // meters
  setScaleRealWorldDist: (v) => set({ scaleRealWorldDist: v }),

  // Optional field hints that improve estimation accuracy
  userHints: {
    known_dbh_in: '',
    known_height_ft: '',
    known_species: '',
    site_type: '',
    photo_distance_hint: 'unknown', // close_trunk | full_tree | base_looking_up | unknown
  },
  setUserHints: (partial) =>
    set((s) => ({ userHints: { ...s.userHints, ...partial } })),
  setUserHint: (key, value) =>
    set((s) => ({ userHints: { ...s.userHints, [key]: value } })),

  // Estimates
  estimates: null,
  setEstimates: (estimates) => set({ estimates }),

  // Species AI result (persisted across panel re-renders)
  speciesAIResult: null,
  setSpeciesAIResult: (result) => set({ speciesAIResult: result }),

  // Tree structure hints for procedural model
  treeStructureHints: {
    trunkForm: 'unknown',            // single | forked | multi | unknown
    trunkCount: 1,
    branchDensity: 'medium',         // low | medium | high
    canopyDistribution: 'medium',    // sparse | medium | dense | asymmetric
    leafDistribution: 'clustered',   // outer_shell | clustered | even | sparse
    detectedStructureConfidence: 0,
  },
  setTreeStructureHint: (key, value) =>
    set((s) => ({ treeStructureHints: { ...s.treeStructureHints, [key]: value } })),

  // Structure detection result
  structureDetectionResult: null,
  setStructureDetectionResult: (r) => set({ structureDetectionResult: r }),

  // Preview mode — structured on desktop, simple on mobile
  previewMode: isMobile ? 'simple' : 'structured', // simple | structured | detailed
  setPreviewMode: (mode) => set({ previewMode: mode }),

  // Texture samples cropped from field photos
  textureSamples: { bark: null, leaf: null, canopy: null },
  setTextureSample: (type, sample) =>
    set((s) => ({ textureSamples: { ...s.textureSamples, [type]: sample } })),
  clearTextureSample: (type) => {
    const url = get().textureSamples[type]?.url
    if (url) URL.revokeObjectURL(url)
    set((s) => ({ textureSamples: { ...s.textureSamples, [type]: null } }))
  },
}))

export default useTreeSession
