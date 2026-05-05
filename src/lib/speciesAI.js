/**
 * Species identification interface — pluggable AI layer.
 *
 * Current provider: Pl@ntNet via /api/plantnet-identify (Vercel serverless proxy).
 * The API key lives server-side only (PLANTNET_API_KEY in .env.local / Vercel env).
 *
 * ----- Adding future providers -----
 *
 * Gemini image understanding:
 *   - Create api/gemini-identify.js following the same proxy pattern.
 *   - General-purpose vision model, good for full-tree silhouettes.
 *
 * iNaturalist:
 *   - Useful for taxonomy lookup and observation reference, not direct CV.
 *   - iNat's vision model is not available as a public REST endpoint.
 *
 * ----- Security note -----
 *   All provider keys must stay server-side. Never use VITE_* prefixes for
 *   keys that should not appear in the browser bundle.
 */

import { identifyWithPlantNet } from './plantnet'

/**
 * @param {{ photos: Array<{file:File}>, organHint?: string, lat?: number|null, lng?: number|null }} opts
 * lat/lng are reserved for future regional filtering — not forwarded yet.
 */
export async function identifySpeciesFromPhoto({ photos, organHint = 'auto', lat, lng }) {
  return identifyWithPlantNet({ photos, organHint })
}
