import { create } from 'zustand'

const isMobile = typeof window !== 'undefined' && window.innerWidth < 768

const DEFAULT_SCAN_STATE = {
  primaryImage:     null,   // { file, url, exif }
  barkImage:        null,   // { file, url }
  detailImage:      null,   // { file, url }
  scaleImage:       null,   // { file, url }
  scaleHintFt:      null,   // number — manual DBH/scale entry
  exifLocation:     null,   // { lat, lng }
  browserLocation:  null,   // { lat, lng, accuracy }
  selectedLocation: null,   // { lat, lng, source: 'photo gps'|'device gps'|'manual'|'unknown', accuracyMeters, capturedAt }
  speciesResult:    null,   // PlantNet result object
  visionAnalysis:   null,   // canvas-based heuristic analysis (InterpretationOverlay)
  visionDepth:      null,   // { grid, width, height } — low-res depth grid from ONNX model
  estimatedMetrics: null,   // { heightFt, dbhIn, canopyFt, species, … }
  proceduralParams: null,   // derived 3-D model params
}

function revokeScanUrls(scanState) {
  const slots = ['primaryImage', 'barkImage', 'detailImage', 'scaleImage']
  slots.forEach((k) => {
    const url = scanState?.[k]?.url
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
  })
}

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

const DEFAULT_USER_HINTS = {
  known_dbh_in:        '',
  known_height_ft:     '',
  known_species:       '',
  site_type:           '',
  photo_distance_hint: 'unknown',
}

const DEFAULT_STRUCTURE_HINTS = {
  trunkForm:                  'unknown',
  trunkCount:                 1,
  branchDensity:              'medium',
  canopyDistribution:         'medium',
  leafDistribution:           'clustered',
  detectedStructureConfidence: 0,
}

const DEFAULT_SCAFFOLD_EDITOR = {
  branchGestures:    [],
  canopyProfiles:    null,
  canopyDensityHint: 'medium',
  trunkCharacter:    'straight',
}

const useTreeSession = create((set, get) => ({
  // Auth session (populated by supabase.auth.onAuthStateChange in App)
  session: null,
  setSession: (session) => set({ session }),

  // View routing: 'home' | 'workflow' | 'finishedClone'
  view: 'home',
  setView: (view) => set({ view }),

  // Step management
  step: 'capture',
  returnStep: 'capture',
  setStep: (step) => set({ step }),
  setReturnStep: (step) => set({ returnStep: step }),

  // Save lifecycle
  currentTreeId:    null,
  isSaved:          false,
  hasUnsavedChanges: false,
  lastSavedAt:      null,

  markSaved: (id) => set({
    currentTreeId:     id,
    isSaved:           true,
    hasUnsavedChanges: false,
    lastSavedAt:       new Date().toISOString(),
  }),

  // Clone lifecycle
  cloneStatus: 'draft',   // 'draft' | 'previewed' | 'finished'
  cloneData:   {},
  finishedAt:  null,

  setCloneStatus: (status) => set({ cloneStatus: status, hasUnsavedChanges: true, isSaved: false }),

  finishClone: (cloneData) => set({
    cloneData,
    cloneStatus:       'finished',
    finishedAt:        new Date().toISOString(),
    hasUnsavedChanges: true,
    isSaved:           false,
  }),

  // Clear all tree data and return to blank capture state.
  resetSession: () => {
    const { photos, textureSamples, scanState } = get()
    photos.forEach((p) => { if (p.url?.startsWith('blob:')) URL.revokeObjectURL(p.url) })
    Object.values(textureSamples).forEach((s) => {
      if (s?.url?.startsWith('blob:')) URL.revokeObjectURL(s.url)
    })
    revokeScanUrls(scanState)
    set({
      photos:              [],
      scanState:           { ...DEFAULT_SCAN_STATE },
      landmarks:           { ...DEFAULT_LANDMARKS },
      showScaleRef:        false,
      scaleRealWorldDist:  1.0,
      userHints:           { ...DEFAULT_USER_HINTS },
      estimates:           null,
      speciesAIResult:     null,
      treeStructureHints:  { ...DEFAULT_STRUCTURE_HINTS },
      structureDetectionResult: null,
      previewMode:         isMobile ? 'simple' : 'structured',
      textureSamples:      { bark: null, leaf: null, canopy: null },
      currentTreeId:       null,
      isSaved:             false,
      hasUnsavedChanges:   false,
      lastSavedAt:         null,
      cloneStatus:         'draft',
      cloneData:           {},
      finishedAt:          null,
      photoScaffold:       null,
      scaffoldGeometry:    null,
      trunkAxisOverride:   null,
      branchGestures:      [],
      canopyProfiles:      null,
      canopyDensityHint:   'medium',
      trunkCharacter:      'straight',
      calibrationPhotoIndex: 0,
      annotations: { treeOutline: [], crownOutline: [], trunkLine: [], primaryBranches: [] },
      step:                'capture',
    })
  },

  // Reset session then navigate to the workflow capture step.
  startNewTree: () => {
    get().resetSession()
    set({ view: 'workflow' })
  },

  // Restore all session state from a loaded tree record in one atomic update.
  restoreSession: ({
    photos               = [],
    estimates            = null,
    landmarks,
    userHints,
    treeStructureHints,
    speciesAIResult      = null,
    structureDetectionResult = null,
    previewMode,
    textureSamples,
    cloneStatus          = 'draft',
    cloneData            = {},
    finishedAt           = null,
    photoScaffold        = null,
    scaffoldGeometry     = null,
    branchGestures       = [],
    canopyProfiles       = null,
    canopyDensityHint    = 'medium',
    trunkCharacter       = 'straight',
    calibrationPhotoIndex = 0,
    annotations,
    id,
  }) => {
    set({
      photos,
      estimates,
      landmarks:            landmarks         ?? { ...DEFAULT_LANDMARKS },
      userHints:            userHints         ?? { ...DEFAULT_USER_HINTS },
      treeStructureHints:   treeStructureHints ?? { ...DEFAULT_STRUCTURE_HINTS },
      speciesAIResult,
      structureDetectionResult,
      previewMode:          previewMode ?? 'photo_scaffold',
      textureSamples:       textureSamples ?? { bark: null, leaf: null, canopy: null },
      cloneStatus,
      cloneData,
      finishedAt,
      photoScaffold,
      scaffoldGeometry,
      trunkAxisOverride:    null,
      branchGestures,
      canopyProfiles,
      canopyDensityHint,
      trunkCharacter,
      calibrationPhotoIndex,
      annotations:          annotations ?? { treeOutline: [], crownOutline: [], trunkLine: [], primaryBranches: [] },
      currentTreeId:        id,
      isSaved:              true,
      hasUnsavedChanges:    false,
      lastSavedAt:          new Date().toISOString(),
      step:                 'identify',
      view:                 'workflow',
    })
  },

  // Scan state — populated by CaptureWizard; committed to photos/speciesAIResult at wizard completion
  scanState: { ...DEFAULT_SCAN_STATE },
  setScanState: (partial) =>
    set((s) => ({ scanState: { ...s.scanState, ...partial }, hasUnsavedChanges: true, isSaved: false })),
  resetScanState: () => {
    revokeScanUrls(get().scanState)
    set({ scanState: { ...DEFAULT_SCAN_STATE } })
  },

  // Photos
  photos: [],
  addPhotos: (files) => {
    const newPhotos = files.map((file) => ({
      id:   crypto.randomUUID(),
      url:  URL.createObjectURL(file),
      file,
      exif: null,
    }))
    set((s) => ({ photos: [...s.photos, ...newPhotos], hasUnsavedChanges: true, isSaved: false }))
  },
  setPhotos: (photos) => set({ photos }),
  removePhoto: (id) => {
    const photo = get().photos.find((p) => p.id === id)
    if (photo?.url?.startsWith('blob:')) URL.revokeObjectURL(photo.url)
    set((s) => ({ photos: s.photos.filter((p) => p.id !== id), hasUnsavedChanges: true, isSaved: false }))
  },
  setPhotoExif: (id, exif) =>
    set((s) => ({ photos: s.photos.map((p) => (p.id === id ? { ...p, exif } : p)) })),

  // Landmarks (normalized 0-1 coords relative to first image)
  landmarks: { ...DEFAULT_LANDMARKS },
  setLandmark: (key, pos) =>
    set((s) => ({ landmarks: { ...s.landmarks, [key]: pos }, hasUnsavedChanges: true, isSaved: false })),
  resetLandmarks: () => set({ landmarks: { ...DEFAULT_LANDMARKS } }),

  // Scale reference
  showScaleRef: false,
  toggleScaleRef: () => set((s) => ({ showScaleRef: !s.showScaleRef })),
  scaleRealWorldDist: 1.0,
  setScaleRealWorldDist: (v) => set({ scaleRealWorldDist: v, hasUnsavedChanges: true, isSaved: false }),

  // Optional field hints that improve estimation accuracy
  userHints: { ...DEFAULT_USER_HINTS },
  setUserHints: (partial) =>
    set((s) => ({ userHints: { ...s.userHints, ...partial }, hasUnsavedChanges: true, isSaved: false })),
  setUserHint: (key, value) =>
    set((s) => ({ userHints: { ...s.userHints, [key]: value }, hasUnsavedChanges: true, isSaved: false })),

  // Estimates
  estimates: null,
  setEstimates: (estimates) => set({ estimates, hasUnsavedChanges: true, isSaved: false }),

  // Species AI result (persisted across panel re-renders)
  speciesAIResult: null,
  setSpeciesAIResult: (result) => set({ speciesAIResult: result, hasUnsavedChanges: true, isSaved: false }),

  // Tree structure hints for procedural model
  treeStructureHints: { ...DEFAULT_STRUCTURE_HINTS },
  setTreeStructureHint: (key, value) =>
    set((s) => ({ treeStructureHints: { ...s.treeStructureHints, [key]: value }, hasUnsavedChanges: true, isSaved: false })),

  // Structure detection result
  structureDetectionResult: null,
  setStructureDetectionResult: (r) => set({ structureDetectionResult: r, hasUnsavedChanges: true, isSaved: false }),

  // Preview mode — structured on desktop, simple on mobile
  previewMode: isMobile ? 'simple' : 'structured',
  setPreviewMode: (mode) => set({ previewMode: mode }),

  // Texture samples cropped from field photos
  textureSamples: { bark: null, leaf: null, canopy: null },
  setTextureSample: (type, sample) =>
    set((s) => ({ textureSamples: { ...s.textureSamples, [type]: sample }, hasUnsavedChanges: true, isSaved: false })),
  clearTextureSample: (type) => {
    const cur = get().textureSamples[type]
    if (cur?.url?.startsWith('blob:')) URL.revokeObjectURL(cur.url)
    set((s) => ({ textureSamples: { ...s.textureSamples, [type]: null } }))
  },

  // Photo scaffold analysis and geometry
  photoScaffold:     null,
  scaffoldGeometry:  null,
  trunkAxisOverride: null,   // user-adjusted trunk axis points (5 handles)

  setPhotoScaffold:    (scaffold)  => set({ photoScaffold: scaffold, hasUnsavedChanges: true, isSaved: false }),
  setScaffoldGeometry: (geometry) => set({ scaffoldGeometry: geometry }),
  setTrunkAxisOverride: (pts)     => set({ trunkAxisOverride: pts }),
  clearScaffold: () => set({ photoScaffold: null, scaffoldGeometry: null, trunkAxisOverride: null }),

  // Calibration photo selection
  calibrationPhotoIndex: 0,
  setCalibrationPhotoIndex: (i) => set({ calibrationPhotoIndex: i }),

  // Annotation layers populated by first-pass analysis and user editing
  annotations: {
    treeOutline:     [],
    crownOutline:    [],
    trunkLine:       [],
    primaryBranches: [],
  },
  setAnnotations: (partial) =>
    set((s) => ({ annotations: { ...s.annotations, ...partial }, hasUnsavedChanges: true, isSaved: false })),

  // Scaffold editor gesture state
  branchGestures:    [],
  canopyProfiles:    null,
  canopyDensityHint: 'medium',
  trunkCharacter:    'straight',

  setBranchGestures:    (gs)  => set({ branchGestures: gs, hasUnsavedChanges: true, isSaved: false }),
  setCanopyProfiles:    (p)   => set({ canopyProfiles: p, hasUnsavedChanges: true, isSaved: false }),
  setCanopyDensityHint: (h)   => set({ canopyDensityHint: h }),
  setTrunkCharacter:    (c)   => set({ trunkCharacter: c }),
}))

export default useTreeSession
