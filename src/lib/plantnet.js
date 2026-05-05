// Pl@ntNet identification now goes through /api/plantnet-identify (Vercel serverless).
// The browser never holds the API key. CORS is resolved server-side.
//
// Local dev: use `vercel dev` to run both the Vite frontend and the API route.
// `npm run dev` serves only the frontend — the API route will not be available.

import { normalizeImageForPlantNet } from './imageNormalize'

export const PLANTNET_ORGANS = ['auto', 'leaf', 'bark', 'flower', 'fruit', 'habit', 'other']

const BACKEND_UNAVAILABLE =
  "Species ID backend is not running. Use `vercel dev` locally or deploy to Vercel."

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
      raw: null,
    }
  }

  // Normalize: WEBP → JPEG; JPEG/PNG pass through unchanged
  const normResults     = await Promise.all(otherFiles.map(normalizeImageForPlantNet))
  const conversionNotes = normResults.flatMap((r) => r.notes)
  const validFiles      = normResults.filter((r) => r.file && !r.error).map((r) => r.file)

  if (validFiles.length === 0) {
    return {
      provider: 'plantnet', enabled: true,
      common_name: 'Unknown tree', scientific_name: null, confidence: 0,
      candidates: [],
      notes: [
        ...conversionNotes,
        'No supported images available. Pl@ntNet accepts JPG and PNG (WEBP is converted automatically).',
      ],
      raw: null,
    }
  }

  const form = new FormData()
  validFiles.forEach((f) => {
    form.append('images', f)
    form.append('organs', organHint)
  })

  let res
  try {
    res = await fetch('/api/plantnet-identify', { method: 'POST', body: form })
  } catch {
    // Network error — likely `npm run dev` without `vercel dev`
    return {
      provider: 'plantnet', enabled: false,
      common_name: 'Unknown tree', scientific_name: null, confidence: 0,
      candidates: [], notes: [BACKEND_UNAVAILABLE], raw: null,
    }
  }

  // 404 = vercel dev not running; 503 = key not configured server-side
  if (res.status === 404 || res.status === 503) {
    return {
      provider: 'plantnet', enabled: false,
      common_name: 'Unknown tree', scientific_name: null, confidence: 0,
      candidates: [], notes: [BACKEND_UNAVAILABLE], raw: null,
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Pl@ntNet proxy ${res.status}: ${text || res.statusText}`)
  }

  const raw     = await res.json()
  const results = raw.results ?? []

  if (results.length === 0) {
    return {
      provider: 'plantnet', enabled: true,
      common_name: 'Unknown tree', scientific_name: null, confidence: 0,
      candidates: [],
      notes: [...conversionNotes, 'No species match found. Try a clearer photo or a different organ hint.'],
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
    notes: conversionNotes,
    raw,
  }
}
