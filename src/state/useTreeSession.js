import { create } from 'zustand'

const useTreeSession = create((set, get) => ({
  // Step management
  step: 'capture', // capture | review | calibrate | estimate | preview | export
  setStep: (step) => set({ step }),

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
  landmarks: {
    trunk_base: { x: 0.5, y: 0.85 },
    trunk_top: { x: 0.5, y: 0.35 },
    canopy_left: { x: 0.2, y: 0.2 },
    canopy_right: { x: 0.8, y: 0.2 },
    scale_a: { x: 0.1, y: 0.9 },
    scale_b: { x: 0.3, y: 0.9 },
  },
  setLandmark: (key, pos) =>
    set((s) => ({ landmarks: { ...s.landmarks, [key]: pos } })),

  // Scale reference
  showScaleRef: false,
  toggleScaleRef: () => set((s) => ({ showScaleRef: !s.showScaleRef })),
  scaleRealWorldDist: 1.0, // meters
  setScaleRealWorldDist: (v) => set({ scaleRealWorldDist: v }),

  // Estimates
  estimates: null,
  setEstimates: (estimates) => set({ estimates }),

  // Preview mode
  previewMode: 'branched', // simple | branched | canopy_mass
  setPreviewMode: (mode) => set({ previewMode: mode }),
}))

export default useTreeSession
