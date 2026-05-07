import { buildTreeModelParams } from './treeModelParams'

/**
 * Build a self-contained clone package from the current session state.
 * This is stored in g2tree_trees.clone_data when a clone is finished.
 */
export function buildClonePackage(session) {
  const {
    estimates,
    treeStructureHints,
    speciesAIResult,
    userHints,
    textureSamples,
    previewMode,
    photos,
    landmarks,
    scaleRealWorldDist,
    photoScaffold,
    scaffoldGeometry,
  } = session

  const modelParams = buildTreeModelParams(
    estimates,
    treeStructureHints,
    {
      scientificName: speciesAIResult?.scientific_name ?? '',
      commonName:     speciesAIResult?.common_name ?? userHints?.known_species ?? '',
    },
    textureSamples,
  )

  const sourcePhotoSummary = (photos ?? []).map((p) => ({
    id:          p.id,
    storagePath: p.storagePath ?? null,
    filename:    p.file?.name ?? p.filename ?? null,
    mimeType:    p.file?.type ?? p.mimeType ?? 'image/jpeg',
    width:       p.width ?? null,
    height:      p.height ?? null,
    exif:        p.exif ?? null,
    photoRole:   p.photoRole ?? 'source',
    persisted:   p.persisted ?? false,
  }))

  const textureSummary = {}
  for (const type of ['bark', 'leaf', 'canopy']) {
    const s = textureSamples?.[type]
    if (!s) continue
    textureSummary[type] = {
      storagePath:    s.storagePath ?? null,
      url:            s.url ?? null,
      width:          s.width ?? null,
      height:         s.height ?? null,
      averageColor:   s.averageColor ?? null,
      dominantColors: s.dominantColors ?? null,
      notes:          s.notes ?? null,
      mimeType:       s.mimeType ?? 'image/jpeg',
    }
  }

  return {
    version:    1,
    createdAt:  new Date().toISOString(),
    species: {
      provider:        speciesAIResult?.provider ?? null,
      common_name:     speciesAIResult?.common_name ?? userHints?.known_species ?? null,
      scientific_name: speciesAIResult?.scientific_name ?? null,
      confidence:      speciesAIResult?.confidence ?? estimates?.species_confidence ?? null,
      candidates:      speciesAIResult?.candidates ?? [],
    },
    estimates:         estimates ?? {},
    structureHints:    treeStructureHints ?? {},
    modelParams:       modelParams ?? {},
    textureSamples:    textureSummary,
    sourcePhotoSummary,
    renderMode:        previewMode ?? 'structured',
    treeType:          modelParams?.treeType,
    crownHabit:        modelParams?.crownHabit,
    proportions: {
      trunkHeight:     modelParams?.trunkHeight,
      canopyRadius:    modelParams?.canopyRadius,
      trunkRadiusBase: modelParams?.trunkRadiusBase,
    },
    materialInputs: {
      barkColor:   modelParams?.barkColor,
      canopyColor: modelParams?.canopyColor,
    },
    photoScaffold:   photoScaffold   ?? null,
    scaffoldGeometry: scaffoldGeometry ?? null,
  }
}
