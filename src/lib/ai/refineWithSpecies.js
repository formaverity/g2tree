/**
 * refineWithSpecies.js
 *
 * Nudges scaffold geometry and procedural-model params when a PlantNet
 * species result becomes available (fire-and-forget from PhotoLabelGallery).
 *
 * Refinements are subtle — the goal is plausibility, not precision:
 *   - Canopy density hint updated from species typical form
 *   - Trunk character adjusted (conifers → straight, palms → curved)
 *   - Primary branch density hint adjusted
 *
 * Call this after speciesAIResult is stored in session.
 */

import { inferTreeType } from '../treeModelParams'
import useTreeSession from '../../state/useTreeSession'

/**
 * @param {{ results: Array<{ species: { scientificNameWithoutAuthor: string, commonNames: string[] }, score: number }> }} plantNetResult
 */
export function refineWithSpecies(plantNetResult) {
  const top = plantNetResult?.results?.[0]
  if (!top) return

  const sciName    = top.species?.scientificNameWithoutAuthor ?? ''
  const commonName = top.species?.commonNames?.[0] ?? ''
  const treeType   = inferTreeType(sciName, commonName)

  const store = useTreeSession.getState()

  switch (treeType) {
    case 'conifer':
      store.setCanopyDensityHint('dense')
      store.setTrunkCharacter('straight')
      break
    case 'palm':
      store.setCanopyDensityHint('sparse')
      store.setTrunkCharacter('curved')
      break
    case 'deciduous':
      // leave as-is — defaults suit deciduous
      break
    default:
      break
  }
}
