// Pl@ntNet identification now goes through /api/plantnet-identify (Vercel serverless).
// The browser never holds the API key. CORS is resolved server-side.
//
// Local dev: use `vercel dev` to run both the Vite frontend and the API route.
// `npm run dev` serves only the frontend — the API route will not be available.

import { normalizeImageForPlantNet } from './imageNormalize'

export const PLANTNET_ORGANS = ['auto', 'leaf', 'bark', 'flower', 'fruit', 'habit', 'other']

const BACKEND_UNAVAILABLE =
  'Species ID backend is not running. Use `vercel dev` locally or deploy to Vercel.'
const MISSING_API_KEY =
  'Species ID server is running, but PLANTNET_API_KEY is missing in Vercel environment variables.'
const PAYLOAD_TOO_LARGE =
  'The image upload was still too large for the Vercel function. Try one photo, closer crop, or lower image size.'

const MAX_TOTAL_BYTES = 3_800_000

function isHeic(file) {
  return (
    file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    /\.heic$/i.test(file.name) ||
    /\.heif$/i.test(file.name)
  )
}

function preferredCommonName(species) {
  return (
    species?.commonNames?.[0] ??
    species?.scientificNameWithoutAuthor ??
    species?.scientificName ??
    'Unknown tree'
  )
}

// ── Shared normalization + size-trim ─────────────────────────────────────────
// images: Array<{ file: File, organ: string }>
// Returns { kept, finalNotes, normStats, heicCount }
async function _normalizeAndTrim(images) {
  const heicImages  = images.filter(({ file }) => isHeic(file))
  const otherImages = images.filter(({ file }) => !isHeic(file))

  const normResults = await Promise.all(
    otherImages.map(async ({ file, organ }) => ({
      organ,
      ...(await normalizeImageForPlantNet(file)),
    }))
  )

  const allNotes   = normResults.flatMap((r) => r.notes)
  const validNorms = normResults.filter((r) => r.file && !r.error)

  // Trim to keep total payload under MAX_TOTAL_BYTES; max 3 images
  const kept = []
  let runningBytes = 0
  for (const norm of validNorms) {
    if (runningBytes + norm.outputBytes > MAX_TOTAL_BYTES) break
    kept.push(norm)
    runningBytes += norm.outputBytes
    if (kept.length >= 3) break
  }

  const skippedCount = validNorms.length - kept.length
  const finalNotes   = [...allNotes]

  if (heicImages.length > 0) {
    finalNotes.push(
      `${heicImages.length} HEIC image${heicImages.length > 1 ? 's' : ''} skipped (not supported by Pl@ntNet).`
    )
  }
  if (skippedCount > 0) {
    finalNotes.push(
      `${skippedCount} image${skippedCount > 1 ? 's' : ''} skipped to stay under the Vercel 4.5 MB payload limit.`
    )
  }

  const normStats = {
    sentCount:          kept.length,
    skippedCount,
    totalOriginalBytes: kept.reduce((s, r) => s + r.originalBytes, 0),
    totalOutputBytes:   kept.reduce((s, r) => s + r.outputBytes, 0),
  }

  return { kept, finalNotes, normStats, heicCount: heicImages.length }
}

// ── Shared request + result mapping ─────────────────────────────────────────
async function _requestPlantNet({ kept, finalNotes, normStats }) {
  if (kept.length === 0) {
    return {
      provider: 'plantnet', enabled: true,
      common_name: 'Unknown tree', scientific_name: null, family: null, confidence: 0,
      candidates: [],
      notes: [...finalNotes, 'No supported images available for Pl@ntNet.'],
      normStats, raw: null,
    }
  }

  const form = new FormData()
  kept.forEach(({ file, organ }) => {
    form.append('images', file)
    form.append('organs', organ)
  })

  let res
  try {
    res = await fetch('/api/plantnet-identify', { method: 'POST', body: form })
  } catch {
    return {
      provider: 'plantnet', enabled: false,
      common_name: 'Unknown tree', scientific_name: null, family: null, confidence: 0,
      candidates: [], notes: [BACKEND_UNAVAILABLE], normStats, raw: null,
    }
  }

  if (res.status === 404) {
    return {
      provider: 'plantnet', enabled: false,
      common_name: 'Unknown tree', scientific_name: null, family: null, confidence: 0,
      candidates: [], notes: [BACKEND_UNAVAILABLE], normStats, raw: null,
    }
  }

  if (res.status === 413) throw new Error(PAYLOAD_TOO_LARGE)

  const raw = await res.json().catch(() => ({}))

  if (!res.ok) {
    if (res.status === 500 && raw?.error?.includes('Missing PLANTNET_API_KEY')) {
      return {
        provider: 'plantnet', enabled: false,
        common_name: 'Unknown tree', scientific_name: null, family: null, confidence: 0,
        candidates: [], notes: [MISSING_API_KEY], normStats, raw,
      }
    }
    throw new Error(raw?.error ?? `Pl@ntNet proxy error ${res.status}: ${res.statusText}`)
  }

  const results = raw.results ?? []

  if (results.length === 0) {
    return {
      provider: 'plantnet', enabled: true,
      common_name: 'Unknown tree', scientific_name: null, family: null, confidence: 0,
      candidates: [],
      notes: [...finalNotes, 'No species match found. Try a clearer photo or a different organ hint.'],
      normStats, raw,
    }
  }

  const top             = results[0]
  const common_name     = preferredCommonName(top.species)
  const scientific_name = top.species?.scientificNameWithoutAuthor ?? null
  const family          = top.species?.family?.scientificNameWithoutAuthor ?? null
  const genus           = top.species?.genus?.scientificNameWithoutAuthor ?? null
  const confidence      = top.score ?? 0

  const candidates = results.slice(1, 5).map((r) => ({
    common_name:     preferredCommonName(r.species),
    scientific_name: r.species?.scientificNameWithoutAuthor ?? null,
    family:          r.species?.family?.scientificNameWithoutAuthor ?? null,
    genus:           r.species?.genus?.scientificNameWithoutAuthor ?? null,
    score:           r.score ?? 0,
  }))

  return {
    provider: 'plantnet', enabled: true,
    common_name, scientific_name, family, genus, confidence, candidates,
    notes: finalNotes,
    normStats,
    raw,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Original single-organ API — all photos get the same organ hint.
 * Used by IdentifyPanel for backward compatibility.
 *
 * @param {{ photos: Array<{file:File}|File>, organHint?: string }} opts
 */
export async function identifyWithPlantNet({ photos = [], organHint = 'auto' }) {
  const rawFiles = photos.slice(0, 5).map((p) => p.file ?? p)

  // HEIC-only fast path
  if (rawFiles.length > 0 && rawFiles.every(isHeic)) {
    return {
      provider: 'plantnet', enabled: true,
      common_name: 'Unknown tree', scientific_name: null, family: null, confidence: 0,
      candidates: [],
      notes: ['HEIC is not currently supported by Pl@ntNet. Please use browser camera capture or convert to JPG/PNG.'],
      normStats: null, raw: null,
    }
  }

  const images = rawFiles.map((file) => ({ file, organ: organHint }))
  const { kept, finalNotes, normStats } = await _normalizeAndTrim(images)
  return _requestPlantNet({ kept, finalNotes, normStats })
}

/**
 * Multi-organ API — each image carries its own organ label.
 * Used by the CaptureWizard species analysis service.
 *
 * @param {{ images: Array<{ file: File, organ: string }> }} opts
 */
export async function identifyWithPlantNetMulti({ images = [] }) {
  if (images.length === 0) {
    return {
      provider: 'plantnet', enabled: true,
      common_name: 'Unknown tree', scientific_name: null, family: null, confidence: 0,
      candidates: [], notes: ['No images provided.'], normStats: null, raw: null,
    }
  }

  const { kept, finalNotes, normStats, heicCount } = await _normalizeAndTrim(images)

  if (heicCount === images.length) {
    return {
      provider: 'plantnet', enabled: true,
      common_name: 'Unknown tree', scientific_name: null, family: null, confidence: 0,
      candidates: [],
      notes: ['HEIC is not currently supported by Pl@ntNet. Please use browser camera capture or convert to JPG/PNG.'],
      normStats, raw: null,
    }
  }

  return _requestPlantNet({ kept, finalNotes, normStats })
}
