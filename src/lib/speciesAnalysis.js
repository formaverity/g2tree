/**
 * Species analysis service for the CaptureWizard flow.
 *
 * Builds a prioritised multi-image payload from the scan's captured photo slots,
 * assigns each image the correct Pl@ntNet organ hint, and calls the multi-organ
 * API. The result shape is identical to identifyWithPlantNet so downstream
 * components don't need to branch.
 *
 * Priority order (most diagnostic first):
 *   1. detailImage  — leaf / flower / fruit / bark (user-selected organ)
 *   2. barkImage    — bark (always 'bark')
 *   3. primaryImage — full tree silhouette (always 'habit')
 *
 * The primary image is included only when there are fewer than 3 diagnostic
 * images, so we don't waste a payload slot on a low-signal habit shot when
 * we already have leaf + bark.
 */

import { identifyWithPlantNetMulti } from './plantnet'

/**
 * @param {{
 *   primaryImage: {file:File, url:string}|null,
 *   barkImage:    {file:File, url:string}|null,
 *   detailImage:  {file:File, url:string}|null,
 *   detailOrgan?: string,       // 'auto'|'leaf'|'flower'|'fruit'|'bark' — defaults 'auto'
 *   location?:    {lat,lng}|null,
 * }} opts
 * @returns {Promise<import('./plantnet').PlantNetResult & { imageSources: string[], queriedAt: string }>}
 */
export async function analyzeSpecies({
  primaryImage  = null,
  barkImage     = null,
  detailImage   = null,
  detailOrgan   = 'auto',
}) {
  const images = []

  if (detailImage?.file) {
    images.push({ file: detailImage.file, organ: detailOrgan })
  }
  if (barkImage?.file) {
    images.push({ file: barkImage.file, organ: 'bark' })
  }
  // Include habit shot only if we have room (< 3 diagnostic images)
  if (primaryImage?.file && images.length < 3) {
    images.push({ file: primaryImage.file, organ: 'habit' })
  }

  if (images.length === 0) {
    throw new Error('No images available for species analysis.')
  }

  const result = await identifyWithPlantNetMulti({ images })

  return {
    ...result,
    // Record which organ slots were actually sent so the UI can show them
    imageSources: images.map(({ organ }) => organ),
    queriedAt:    new Date().toISOString(),
  }
}
