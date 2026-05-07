/**
 * Supabase CRUD for saved tree records and field photos.
 *
 * g2tree_trees columns used (run supabase_migration.sql before deploying new columns):
 *   user_id, display_name, common_name, scientific_name,
 *   species_confidence, health_status, health_confidence,
 *   lat, lng, location_source, observed_at,
 *   dbh_in, height_ft, canopy_width_ft, age_class,     ← legacy imperial
 *   dbh_cm, height_m, crown_spread_m,                  ← SI from scanState
 *   health_score, canopy_density,
 *   ecological_benefits, procedural_params, vision_analysis,
 *   landmark_data, estimate_data, structure_hints, model_params, ai_results,
 *   clone_status, clone_data, texture_samples, source_photo_summary,
 *   finished_at, updated_at, notes
 *
 * Storage bucket: g2tree-photos
 *   users/{userId}/trees/{treeId}/photos/{photoId}.{ext}    ← wizard photo roll
 *   users/{userId}/trees/{treeId}/scan/{role}.{ext}         ← named scan images
 *   users/{userId}/trees/{treeId}/textures/{type}.{ext}     ← texture crops
 */

import { supabase, supabaseConfigError } from './supabaseClient'
import { buildTreeModelParams } from './treeModelParams'
import { photoToProceduralParams } from './photoToProceduralParams'
import { estimateEcologicalBenefits } from './ecologicalBenefits'
import { effectiveValue } from './treeMetrics'
import { normalizeImageForPlantNet } from './imageNormalize'

function requireSupabase() {
  if (!supabase) throw new Error(supabaseConfigError)
}

// Strip non-JSON-serializable values (ImageData, TypedArrays, etc.) from an
// object before storing it as JSONB. Returns null on any failure.
function safeJsonClone(obj) {
  if (obj == null) return null
  try {
    return JSON.parse(JSON.stringify(obj, (_, v) => {
      if (v instanceof ImageData) return undefined
      if (ArrayBuffer.isView(v) && !(v instanceof DataView)) return undefined
      if (v instanceof ArrayBuffer) return undefined
      return v
    }))
  } catch {
    return null
  }
}

// Keep only the summary fields from visionAnalysis — raw pixel arrays are large.
function summarizeVisionAnalysis(va) {
  if (!va) return null
  const {
    // Include structural geometry + classification percentages
    trunkLine, canopyEllipse, canopyBounds,
    pixelClassification, asymmetry, leafDistribution,
    // Exclude: any field whose value is an array of pixel coords
    ...rest
  } = va
  return safeJsonClone({
    trunkLine,
    canopyEllipse,
    canopyBounds,
    asymmetry,
    leafDistribution,
    pixelSummary: pixelClassification ? {
      skyPct:     pixelClassification.skyPct,
      foliagePct: pixelClassification.foliagePct,
      trunkPct:   pixelClassification.trunkPct,
    } : null,
    ...rest,
  })
}

function buildTreeInsertPayload(state, userId) {
  const {
    photos             = [],
    landmarks,
    estimates,
    treeStructureHints,
    speciesAIResult,
    userHints,
    textureSamples,
    scanState          = {},
    cloneStatus        = 'draft',
    cloneData          = {},
    finishedAt         = null,
  } = state

  // ── Species labels ───────────────────────────────────────────────────────────
  const effectiveSpecies = scanState.speciesResult ?? speciesAIResult
  const species          = effectiveSpecies?.common_name
    ?? estimates?.species_guess
    ?? userHints?.known_species
    ?? null
  const displayName      = species
    ? `${species} — ${new Date().toLocaleDateString()}`
    : `Tree — ${new Date().toLocaleDateString()}`

  // ── Legacy model params ──────────────────────────────────────────────────────
  const modelParams = estimates
    ? buildTreeModelParams(estimates, treeStructureHints)
    : null

  // ── Scan-state derived SI metrics ────────────────────────────────────────────
  const metrics         = scanState.estimatedMetrics ?? null
  const dbhCm           = metrics ? effectiveValue(metrics, 'dbhCm')         : null
  const heightM         = metrics ? effectiveValue(metrics, 'heightM')        : null
  const crownM          = metrics ? effectiveValue(metrics, 'crownSpreadM')   : null
  const healthScore     = metrics?.healthScore   ?? null
  const canopyDensity   = metrics?.canopyDensity ?? null

  // ── Location — prefer selectedLocation, fall back to EXIF GPS ───────────────
  const loc             = scanState.selectedLocation
  const lat             = loc?.lat  ?? photos[0]?.exif?.gps?.lat ?? null
  const lng             = loc?.lng  ?? photos[0]?.exif?.gps?.lng ?? null
  const locationSource  = loc?.source ?? null

  // ── Ecological benefits (computed from SI metrics) ───────────────────────────
  const ecoBenefits = (dbhCm != null) ? estimateEcologicalBenefits({
    speciesResult: effectiveSpecies,
    dbhCm,
    heightM:       heightM      ?? 8,
    crownSpreadM:  crownM       ?? 5,
    canopyDensity: canopyDensity ?? 65,
    healthScore:   healthScore   ?? 75,
    confidence:    metrics?.confidence ?? {},
  }) : null

  // ── Procedural params (photo-derived preferred, legacy fallback) ─────────────
  let proceduralParams = null
  if (dbhCm != null) {
    proceduralParams = safeJsonClone(photoToProceduralParams({
      speciesResult:    scanState.speciesResult ?? speciesAIResult,
      estimatedMetrics: metrics,
      visionAnalysis:   scanState.visionAnalysis,
      visionDepth:      scanState.visionDepth,
      textureSamples,
    }))
  } else if (estimates) {
    proceduralParams = safeJsonClone(modelParams)
  }

  // ── Vision analysis summary ──────────────────────────────────────────────────
  const visionAnalysisSummary = summarizeVisionAnalysis(scanState.visionAnalysis)

  // ── Photo roll summary ───────────────────────────────────────────────────────
  const sourcePhotoSummary = (photos ?? []).map((p, i) => ({
    id:          p.id,
    storagePath: p.storagePath ?? null,
    filename:    p.file?.name ?? p.filename ?? null,
    mimeType:    p.file?.type ?? p.mimeType ?? 'image/jpeg',
    width:       p.width  ?? null,
    height:      p.height ?? null,
    exif:        p.exif   ?? null,
    photoRole:   p.photoRole ?? (i === 0 ? 'calibration' : 'source'),
    persisted:   p.persisted ?? false,
  }))

  return {
    user_id:              userId,
    display_name:         displayName,
    common_name:          effectiveSpecies?.common_name      ?? null,
    scientific_name:      effectiveSpecies?.scientific_name  ?? null,
    species_confidence:   effectiveSpecies?.confidence
      ?? estimates?.species_confidence ?? null,
    health_status:        estimates?.health_status  ?? null,
    health_confidence:    estimates?.health_confidence ?? null,
    lat,
    lng,
    location_source:      locationSource,
    observed_at:          photos[0]?.exif?.datetime ?? null,

    // Legacy imperial fields
    dbh_in:               estimates?.dbh_in          ?? null,
    height_ft:            estimates?.height_ft        ?? null,
    canopy_width_ft:      estimates?.canopy_width_ft  ?? null,
    age_class:            estimates?.age_class ?? metrics?.ageClass ?? null,

    // SI scan-state fields
    dbh_cm:               dbhCm,
    height_m:             heightM,
    crown_spread_m:       crownM,
    health_score:         healthScore,
    canopy_density:       canopyDensity,

    // JSONB
    ecological_benefits:  ecoBenefits,
    procedural_params:    proceduralParams,
    vision_analysis:      visionAnalysisSummary,

    // Legacy blobs
    landmark_data:        landmarks,
    estimate_data:        estimates,
    structure_hints:      treeStructureHints,
    model_params:         modelParams,
    ai_results:           effectiveSpecies ?? null,
    clone_status:         cloneStatus,
    clone_data:           cloneData,
    finished_at:          finishedAt,
    source_photo_summary: sourcePhotoSummary,
    notes:                null,
  }
}

// ── Named scan image slots ────────────────────────────────────────────────────

const SCAN_SLOTS = [
  { key: 'primaryImage', role: 'primary' },
  { key: 'barkImage',    role: 'bark'    },
  { key: 'detailImage',  role: 'detail'  },
  { key: 'scaleImage',   role: 'scale'   },
]

/**
 * Save or update the current session as a tree record.
 * Uploads new photos and textures; skips already-persisted ones.
 * Returns the saved tree row.
 */
export async function saveCurrentTree(state) {
  requireSupabase()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) throw new Error('Not signed in')

  const { photos, textureSamples, scanState, currentTreeId } = state
  const payload = buildTreeInsertPayload(state, user.id)

  // ── Upsert tree row ──────────────────────────────────────────────────────────
  let tree
  if (currentTreeId) {
    const { user_id: _, ...updatePayload } = payload
    const { data, error: treeError } = await supabase
      .from('g2tree_trees')
      .update(updatePayload)
      .eq('id', currentTreeId)
      .eq('user_id', user.id)
      .select()
      .single()
    if (treeError) throw treeError
    tree = data
  } else {
    const { data, error: treeError } = await supabase
      .from('g2tree_trees')
      .insert(payload)
      .select()
      .single()
    if (treeError) throw treeError
    tree = data
  }

  const treeId         = tree.id
  const uploadedPhotos = []
  const textureMeta    = {}
  const scanImageMeta  = {}

  // ── Upload wizard photo roll ─────────────────────────────────────────────────
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i]

    if (photo.persisted && photo.storagePath) {
      uploadedPhotos.push({
        id:          photo.id,
        storagePath: photo.storagePath,
        filename:    photo.filename ?? null,
        mimeType:    photo.mimeType ?? 'image/jpeg',
        width:       photo.width    ?? null,
        height:      photo.height   ?? null,
        exif:        photo.exif     ?? null,
        photoRole:   photo.photoRole ?? (i === 0 ? 'calibration' : 'source'),
        persisted:   true,
      })
      continue
    }

    if (!photo.file) continue

    try {
      let uploadBlob = photo.file
      const norm = await normalizeImageForPlantNet(photo.file)
      if (!norm.error && norm.file) uploadBlob = norm.file

      const ext         = uploadBlob.type === 'image/jpeg' ? 'jpg' : 'png'
      const storagePath = `users/${user.id}/trees/${treeId}/photos/${photo.id}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('g2tree-photos')
        .upload(storagePath, uploadBlob, { contentType: uploadBlob.type, upsert: true })

      if (uploadError) {
        console.warn('Photo upload failed:', uploadError.message)
        continue
      }

      await supabase.from('g2tree_tree_photos').insert({
        tree_id:        treeId,
        user_id:        user.id,
        storage_path:   storagePath,
        is_calibration: i === 0,
        exif:           photo.exif ?? null,
      })

      uploadedPhotos.push({
        id:          photo.id,
        storagePath,
        filename:    photo.file.name ?? null,
        mimeType:    uploadBlob.type,
        width:       null,
        height:      null,
        exif:        photo.exif ?? null,
        photoRole:   i === 0 ? 'calibration' : 'source',
        persisted:   true,
      })
    } catch (err) {
      console.warn('Photo processing failed:', err.message)
    }
  }

  // ── Upload named scan images (primary / bark / detail / scale) ───────────────
  for (const { key, role } of SCAN_SLOTS) {
    const img = scanState?.[key]
    if (!img?.file) continue

    try {
      const ext         = img.file.type === 'image/png' ? 'png' : 'jpg'
      const storagePath = `users/${user.id}/trees/${treeId}/scan/${role}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('g2tree-photos')
        .upload(storagePath, img.file, { contentType: img.file.type, upsert: true })

      if (!uploadError) {
        scanImageMeta[role] = { storagePath, mimeType: img.file.type }
      } else {
        console.warn(`Scan image upload (${role}) failed:`, uploadError.message)
      }
    } catch (err) {
      console.warn(`Scan image processing (${role}) failed:`, err.message)
    }
  }

  // ── Upload texture crops ─────────────────────────────────────────────────────
  for (const type of ['bark', 'leaf', 'canopy']) {
    const sample = textureSamples?.[type]
    if (!sample) continue

    if (sample.persisted && sample.storagePath) {
      textureMeta[type] = {
        storagePath:    sample.storagePath,
        url:            sample.url ?? null,
        width:          sample.width          ?? null,
        height:         sample.height         ?? null,
        averageColor:   sample.averageColor   ?? null,
        dominantColors: sample.dominantColors ?? null,
        notes:          sample.notes          ?? null,
        mimeType:       sample.mimeType       ?? 'image/jpeg',
      }
      continue
    }

    if (!sample.blob) continue

    try {
      const ext         = sample.blob.type === 'image/png' ? 'png' : 'jpg'
      const storagePath = `users/${user.id}/trees/${treeId}/textures/${type}.${ext}`

      const { error: texError } = await supabase.storage
        .from('g2tree-photos')
        .upload(storagePath, sample.blob, { contentType: sample.blob.type, upsert: true })

      if (texError) {
        console.warn(`Texture upload (${type}) failed:`, texError.message)
        continue
      }

      textureMeta[type] = {
        storagePath,
        url:            null,
        width:          sample.width          ?? null,
        height:         sample.height         ?? null,
        averageColor:   sample.averageColor   ?? null,
        dominantColors: sample.dominantColors ?? null,
        notes:          sample.notes          ?? null,
        mimeType:       sample.blob.type,
      }
    } catch (err) {
      console.warn(`Texture processing (${type}) failed:`, err.message)
    }
  }

  // ── Write storage metadata back to the tree row ──────────────────────────────
  const storageUpdate = {}
  if (uploadedPhotos.length > 0) storageUpdate.source_photo_summary = uploadedPhotos
  if (Object.keys(textureMeta).length > 0) storageUpdate.texture_samples = textureMeta
  if (Object.keys(scanImageMeta).length > 0) storageUpdate.scan_image_meta = scanImageMeta

  if (Object.keys(storageUpdate).length > 0) {
    await supabase
      .from('g2tree_trees')
      .update(storageUpdate)
      .eq('id', treeId)
      .eq('user_id', user.id)
  }

  return tree
}

/**
 * List saved trees for the current user, newest first.
 */
export async function listMyTrees() {
  requireSupabase()
  const { data, error } = await supabase
    .from('g2tree_trees')
    .select(
      'id, display_name, common_name, scientific_name, created_at, ' +
      'estimate_data, clone_status, dbh_in, height_ft, dbh_cm, height_m, ' +
      'health_score, ecological_benefits, source_photo_summary'
    )
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []).map(({ display_name, estimate_data, clone_status, ...row }) => ({
    ...row,
    name:        display_name,
    estimates:   estimate_data,
    cloneStatus: clone_status ?? 'draft',
  }))
}

/**
 * Load a full tree record, restore signed URLs for photos and textures.
 * Returns { tree, photos }
 */
export async function loadTree(id) {
  requireSupabase()
  const { data: tree, error } = await supabase
    .from('g2tree_trees')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error

  // ── Restore photos ───────────────────────────────────────────────────────────
  const { data: photoRows } = await supabase
    .from('g2tree_tree_photos')
    .select('id, storage_path, is_calibration, exif')
    .eq('tree_id', id)
    .order('created_at', { ascending: true })

  const photos       = []
  const resolvedPaths = new Set()

  for (const row of (photoRows ?? [])) {
    if (!row.storage_path) continue
    const { data: urlData } = await supabase.storage
      .from('g2tree-photos')
      .createSignedUrl(row.storage_path, 3600)

    if (urlData?.signedUrl) {
      resolvedPaths.add(row.storage_path)
      photos.push({
        id:          row.id,
        url:         urlData.signedUrl,
        storagePath: row.storage_path,
        file:        null,
        exif:        row.exif ?? null,
        persisted:   true,
        mimeType:    'image/jpeg',
        photoRole:   row.is_calibration ? 'calibration' : 'source',
      })
    }
  }

  // Resolve photos captured in source_photo_summary but missing from photos table
  for (const summary of (tree.source_photo_summary ?? [])) {
    if (!summary.storagePath || resolvedPaths.has(summary.storagePath)) continue
    const { data: urlData } = await supabase.storage
      .from('g2tree-photos')
      .createSignedUrl(summary.storagePath, 3600)

    if (urlData?.signedUrl) {
      photos.push({
        id:          summary.id,
        url:         urlData.signedUrl,
        storagePath: summary.storagePath,
        file:        null,
        filename:    summary.filename ?? null,
        mimeType:    summary.mimeType ?? 'image/jpeg',
        width:       summary.width  ?? null,
        height:      summary.height ?? null,
        exif:        summary.exif   ?? null,
        photoRole:   summary.photoRole ?? 'source',
        persisted:   true,
      })
    }
  }

  // ── Restore texture samples ──────────────────────────────────────────────────
  const textureSamples = { bark: null, leaf: null, canopy: null }
  const dbTextures     = tree.texture_samples ?? {}

  for (const type of ['bark', 'leaf', 'canopy']) {
    const meta = dbTextures[type]
    if (!meta?.storagePath) continue

    const { data: urlData } = await supabase.storage
      .from('g2tree-photos')
      .createSignedUrl(meta.storagePath, 3600)

    if (urlData?.signedUrl) {
      textureSamples[type] = {
        storagePath:    meta.storagePath,
        url:            urlData.signedUrl,
        dataUrl:        urlData.signedUrl,
        width:          meta.width          ?? null,
        height:         meta.height         ?? null,
        averageColor:   meta.averageColor   ?? null,
        dominantColors: meta.dominantColors ?? null,
        notes:          meta.notes          ?? null,
        mimeType:       meta.mimeType       ?? 'image/jpeg',
        persisted:      true,
      }
    }
  }

  // ── Map DB column names to app-state keys ────────────────────────────────────
  const mappedTree = {
    ...tree,
    name:               tree.display_name,
    landmarks:          tree.landmark_data,
    estimates:          tree.estimate_data,
    treeStructureHints: tree.structure_hints,
    modelParams:        tree.model_params,
    speciesAIResult:    tree.ai_results,
    cloneStatus:        tree.clone_status   ?? 'draft',
    cloneData:          tree.clone_data     ?? {},
    finishedAt:         tree.finished_at    ?? null,
    textureSamples,
  }

  return { tree: mappedTree, photos }
}

/**
 * Delete a tree record and its associated storage objects.
 */
export async function deleteTree(id) {
  requireSupabase()
  const { data: photoRows } = await supabase
    .from('g2tree_tree_photos')
    .select('storage_path')
    .eq('tree_id', id)

  const paths = (photoRows ?? []).map((r) => r.storage_path).filter(Boolean)
  if (paths.length > 0) {
    await supabase.storage.from('g2tree-photos').remove(paths)
  }

  const { error } = await supabase.from('g2tree_trees').delete().eq('id', id)
  if (error) throw error
}
