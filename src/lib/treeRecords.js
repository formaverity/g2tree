/**
 * Supabase CRUD for saved tree records and field photos.
 *
 * Actual g2tree_trees schema (columns accepted by insert/update):
 *   user_id, display_name, common_name, scientific_name,
 *   species_confidence, health_status, health_confidence,
 *   lat, lng, observed_at,
 *   dbh_in, height_ft, canopy_width_ft, age_class,
 *   landmark_data, estimate_data, structure_hints, model_params, ai_results,
 *   notes
 */

import { supabase, supabaseConfigError } from './supabaseClient'
import { buildTreeModelParams } from './treeModelParams'
import { normalizeImageForPlantNet } from './imageNormalize'

function requireSupabase() {
  if (!supabase) throw new Error(supabaseConfigError)
}

/**
 * Construct the insert payload for g2tree_trees using only allowed DB columns.
 * Keeps app-side keys (estimates, landmarks, …) out of the wire payload.
 */
function buildTreeInsertPayload(state, userId) {
  const {
    photos,
    landmarks,
    estimates,
    treeStructureHints,
    speciesAIResult,
    userHints,
  } = state

  const species = estimates?.species_guess ?? userHints?.known_species ?? null
  const displayName = species
    ? `${species} — ${new Date().toLocaleDateString()}`
    : `Tree — ${new Date().toLocaleDateString()}`

  const modelParams = estimates
    ? buildTreeModelParams(estimates, treeStructureHints)
    : null

  const payload = {
    user_id: userId,
    display_name: displayName,
    common_name: speciesAIResult?.common_name ?? null,
    scientific_name: speciesAIResult?.scientific_name ?? null,
    species_confidence: estimates?.species_confidence ?? null,
    health_status: estimates?.health_status ?? null,
    health_confidence: estimates?.health_confidence ?? null,
    lat: photos[0]?.exif?.gps?.lat ?? null,
    lng: photos[0]?.exif?.gps?.lng ?? null,
    observed_at: photos[0]?.exif?.datetime ?? null,
    dbh_in: estimates?.dbh_in ?? null,
    height_ft: estimates?.height_ft ?? null,
    canopy_width_ft: estimates?.canopy_width_ft ?? null,
    age_class: estimates?.age_class ?? null,
    landmark_data: landmarks,
    estimate_data: estimates,
    structure_hints: treeStructureHints,
    model_params: modelParams,
    ai_results: speciesAIResult,
    notes: null,
  }

  console.log('tree insert payload', payload)
  return payload
}

/**
 * Save the current session state as a new tree record, uploading photos to
 * Supabase Storage. Returns the inserted tree row.
 *
 * @param {object} state  Snapshot of the Zustand store (useTreeSession.getState())
 */
export async function saveCurrentTree(state) {
  requireSupabase()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) throw new Error('Not signed in')

  const { photos, textureSamples } = state

  const payload = buildTreeInsertPayload(state, user.id)

  const { data: tree, error: treeError } = await supabase
    .from('g2tree_trees')
    .insert(payload)
    .select()
    .single()

  if (treeError) throw treeError

  // Upload each photo (best-effort — failures are logged, not thrown)
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i]
    if (!photo.file) continue

    try {
      let uploadBlob = photo.file
      const norm = await normalizeImageForPlantNet(photo.file)
      if (!norm.error && norm.file) uploadBlob = norm.file

      const ext = uploadBlob.type === 'image/jpeg' ? 'jpg' : 'png'
      const storagePath = `${user.id}/${tree.id}/${photo.id}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('g2tree-photos')
        .upload(storagePath, uploadBlob, { contentType: uploadBlob.type, upsert: false })

      if (uploadError) {
        console.warn('Photo upload failed:', uploadError.message)
        continue
      }

      await supabase.from('g2tree_tree_photos').insert({
        tree_id: tree.id,
        user_id: user.id,
        storage_path: storagePath,
        is_calibration: i === 0,
        exif: photo.exif ?? null,
      })
    } catch (err) {
      console.warn('Photo processing failed:', err.message)
    }
  }

  // Upload texture samples (best-effort)
  const TEXTURE_TYPES = ['bark', 'leaf', 'canopy']
  for (const type of TEXTURE_TYPES) {
    const sample = textureSamples?.[type]
    if (!sample?.blob) continue
    try {
      const storagePath = `${user.id}/${tree.id}/textures/${type}.jpg`
      const { error: texError } = await supabase.storage
        .from('g2tree-photos')
        .upload(storagePath, sample.blob, { contentType: 'image/jpeg', upsert: true })
      if (texError) console.warn(`Texture upload (${type}) failed:`, texError.message)
    } catch (err) {
      console.warn(`Texture processing (${type}) failed:`, err.message)
    }
  }

  return tree
}

/**
 * List saved trees for the current user, newest first.
 * Returns lightweight rows with app-state key names (name, estimates).
 */
export async function listMyTrees() {
  requireSupabase()
  const { data, error } = await supabase
    .from('g2tree_trees')
    .select('id, display_name, common_name, scientific_name, created_at, estimate_data')
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []).map(({ display_name, estimate_data, ...row }) => ({
    ...row,
    name: display_name,
    estimates: estimate_data,
  }))
}

/**
 * Load a full tree record plus signed photo URLs.
 * Returns { tree, photos: [{ id, url, file: null, exif }] }
 * tree has app-state keys overlaid (name, landmarks, estimates, …).
 */
export async function loadTree(id) {
  requireSupabase()
  const { data: tree, error } = await supabase
    .from('g2tree_trees')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error

  const { data: photoRows } = await supabase
    .from('g2tree_tree_photos')
    .select('id, storage_path, is_calibration, exif')
    .eq('tree_id', id)
    .order('created_at', { ascending: true })

  const photos = []
  for (const row of (photoRows ?? [])) {
    if (!row.storage_path) continue
    const { data: urlData } = await supabase.storage
      .from('g2tree-photos')
      .createSignedUrl(row.storage_path, 3600)

    if (urlData?.signedUrl) {
      photos.push({
        id: row.id,
        url: urlData.signedUrl,
        file: null,
        exif: row.exif ?? null,
      })
    }
  }

  // Remap DB column names to app state keys
  const mappedTree = {
    ...tree,
    name: tree.display_name,
    landmarks: tree.landmark_data,
    estimates: tree.estimate_data,
    treeStructureHints: tree.structure_hints,
    modelParams: tree.model_params,
    speciesAIResult: tree.ai_results,
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
