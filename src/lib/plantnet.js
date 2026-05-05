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

/**
 * @param {{ photos: Array<{file:File}|File>, organHint?: string }} opts
 */
export async function identifyWithPlantNet({ photos = [], organHint = 'auto' }) {
  const rawFiles = photos.slice(0, 5).map((p) => p.file ?? p)

  // HEIC cannot be converted client-side — surface a clear message
  const heicFiles  = rawFiles.filter(isHeic)
  const otherFiles = rawFiles.filter((f) => !isHeic(f))

  if (heicFiles.length > 0 && otherFiles.length === 0) {
    return {
      provider: 'plantnet', enabled: true,
      common_name: 'Unknown tree', scientific_name: null, confidence: 0,
      candidates: [],
      notes: ['HEIC is not currently supported by Pl@ntNet. Please use browser camera capture or convert to JPG/PNG.'],
      normStats: null,
      raw: null,
    }
  }

  // Normalize all images: resize to 1280px longest edge + compress to JPEG
  const normResults = await Promise.all(otherFiles.map((f) => normalizeImageForPlantNet(f)))
  const allNotes    = normResults.flatMap((r) => r.notes)
  const validNorms  = normResults.filter((r) => r.file && !r.error)

  if (validNorms.length === 0) {
    return {
      provider: 'plantnet', enabled: true,
      common_name: 'Unknown tree', scientific_name: null, confidence: 0,
      candidates: [],
      notes: [
        ...allNotes,
        'No supported images available. Pl@ntNet accepts JPG and PNG (WEBP is converted automatically).',
      ],
      normStats: null,
      raw: null,
    }
  }

  // Trim to stay under MAX_TOTAL_BYTES — keep first 1–3 images that fit
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
  if (skippedCount > 0) {
    finalNotes.push(
      `${skippedCount} image${skippedCount > 1 ? 's' : ''} skipped to stay under the Vercel 4.5 MB payload limit.`
    )
  }

  const normStats = {
    sentCount:          kept.length,
    skippedCount,
    totalOriginalBytes: kept.reduce((s, r) => s + r.originalBytes, 0),
    totalOutputBytes:   kept.reduce((s, r) => s + r.outputBytes,   0),
  }

  const form = new FormData()
  kept.forEach(({ file }) => {
    form.append('images', file)
    form.append('organs', organHint)
  })

  let res
  try {
    res = await fetch('/api/plantnet-identify', { method: 'POST', body: form })
  } catch {
    return {
      provider: 'plantnet', enabled: false,
      common_name: 'Unknown tree', scientific_name: null, confidence: 0,
      candidates: [], notes: [BACKEND_UNAVAILABLE], normStats, raw: null,
    }
  }

  if (res.status === 404) {
    return {
      provider: 'plantnet', enabled: false,
      common_name: 'Unknown tree', scientific_name: null, confidence: 0,
      candidates: [], notes: [BACKEND_UNAVAILABLE], normStats, raw: null,
    }
  }

  if (res.status === 413) {
    throw new Error(PAYLOAD_TOO_LARGE)
  }

  const raw = await res.json().catch(() => ({}))

  if (!res.ok) {
    if (res.status === 500 && raw?.error?.includes('Missing PLANTNET_API_KEY')) {
      return {
        provider: 'plantnet', enabled: false,
        common_name: 'Unknown tree', scientific_name: null, confidence: 0,
        candidates: [], notes: [MISSING_API_KEY], normStats, raw,
      }
    }
    const msg = raw?.error ?? `Pl@ntNet proxy error ${res.status}: ${res.statusText}`
    throw new Error(msg)
  }

  const results = raw.results ?? []

  if (results.length === 0) {
    return {
      provider: 'plantnet', enabled: true,
      common_name: 'Unknown tree', scientific_name: null, confidence: 0,
      candidates: [],
      notes: [...finalNotes, 'No species match found. Try a clearer photo or a different organ hint.'],
      normStats,
      raw,
    }
  }

  const top             = results[0]
  const common_name     = preferredCommonName(top.species)
  const scientific_name = top.species?.scientificNameWithoutAuthor ?? null
  const confidence      = top.score ?? 0

  const candidates = results.slice(1, 4).map((r) => ({
    common_name:     preferredCommonName(r.species),
    scientific_name: r.species?.scientificNameWithoutAuthor ?? null,
    family:          r.species?.family?.scientificNameWithoutAuthor ?? null,
    genus:           r.species?.genus?.scientificNameWithoutAuthor ?? null,
    score:           r.score ?? 0,
  }))

  return {
    provider: 'plantnet', enabled: true,
    common_name, scientific_name, confidence, candidates,
    notes: finalNotes,
    normStats,
    raw,
  }
}
