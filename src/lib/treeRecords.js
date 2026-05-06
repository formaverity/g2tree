/**
 * Supabase CRUD for saved tree records and field photos.
 *
 * Required Supabase setup — run this SQL in your project's SQL editor:
 *
 *   CREATE TABLE g2tree_trees (
 *     id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     user_id                  uuid REFERENCES auth.users NOT NULL,
 *     created_at               timestamptz DEFAULT now(),
 *     updated_at               timestamptz DEFAULT now(),
 *     name                     text,
 *     species                  text,
 *     estimates                jsonb,
 *     landmarks                jsonb,
 *     user_hints               jsonb,
 *     tree_structure_hints     jsonb,
 *     scale_real_world_dist    numeric,
 *     species_ai_result        jsonb,
 *     structure_detection_result jsonb,
 *     procedural_params        jsonb,
 *     preview_mode             text
 *   );
 *   ALTER TABLE g2tree_trees ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "own trees" ON g2tree_trees
 *     USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
 *
 *   CREATE TABLE g2tree_tree_photos (
 *     id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     tree_id          uuid REFERENCES g2tree_trees ON DELETE CASCADE NOT NULL,
 *     user_id          uuid REFERENCES auth.users NOT NULL,
 *     created_at       timestamptz DEFAULT now(),
 *     storage_path     text,
 *     is_calibration   boolean DEFAULT false,
 *     exif             jsonb
 *   );
 *   ALTER TABLE g2tree_tree_photos ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "own photos" ON g2tree_tree_photos
 *     USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
 *
 *   -- Storage bucket (create in Dashboard → Storage → New Bucket)
 *   -- Name: g2tree-photos   Access: Private
 *   -- Add RLS policy on objects: auth.uid()::text = (storage.foldername(name))[1]
 */

import { supabase, supabaseConfigError } from './supabaseClient'

function requireSupabase() {
  if (!supabase) throw new Error(supabaseConfigError)
}
import { buildTreeModelParams } from './treeModelParams'
import { normalizeImageForPlantNet } from './imageNormalize'

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

  const {
    photos,
    landmarks,
    estimates,
    scaleRealWorldDist,
    userHints,
    treeStructureHints,
    speciesAIResult,
    structureDetectionResult,
    previewMode,
    textureSamples,
  } = state

  const species = estimates?.species_guess ?? userHints?.known_species ?? null
  const name = species
    ? `${species} — ${new Date().toLocaleDateString()}`
    : `Tree — ${new Date().toLocaleDateString()}`

  const modelParams = estimates
    ? buildTreeModelParams(estimates, treeStructureHints)
    : null

  const { data: tree, error: treeError } = await supabase
    .from('g2tree_trees')
    .insert({
      user_id: user.id,
      name,
      species,
      // Scalar fields
      common_name: speciesAIResult?.common_name ?? null,
      scientific_name: speciesAIResult?.scientific_name ?? null,
      species_confidence: estimates?.species_confidence ?? null,
      health_status: estimates?.health_status ?? null,
      health_confidence: estimates?.health_confidence ?? null,
      dbh_in: estimates?.dbh_in ?? null,
      height_ft: estimates?.height_ft ?? null,
      canopy_width_ft: estimates?.canopy_width_ft ?? null,
      age_class: estimates?.age_class ?? null,
      lat: photos[0]?.exif?.gps?.lat ?? null,
      lng: photos[0]?.exif?.gps?.lng ?? null,
      observed_at: photos[0]?.exif?.datetime ?? null,
      notes: null,
      // JSONB columns (app key -> db column)
      estimate_data: estimates,
      landmark_data: landmarks,
      user_hints: userHints,
      structure_hints: treeStructureHints,
      scale_real_world_dist: scaleRealWorldDist,
      ai_results: speciesAIResult,
      structure_detection_result: structureDetectionResult,
      model_params: modelParams,
      preview_mode: previewMode,
    })
    .select()
    .single()

  if (treeError) throw treeError

  // Upload each photo (best-effort — failures are logged, not thrown)
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i]
    if (!photo.file) continue

    try {
      // Compress to JPEG for storage efficiency
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
 * Returns an array of lightweight rows (no full jsonb payloads).
 */
export async function listMyTrees() {
  requireSupabase()
  const { data, error } = await supabase
    .from('g2tree_trees')
    .select('id, name, species, created_at, estimate_data')
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []).map(({ estimate_data, ...row }) => ({ ...row, estimates: estimate_data }))
}

/**
 * Load a full tree record plus signed photo URLs.
 * Returns { tree, photos: [{ id, url, file: null, exif }] }
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

  // Remap db column names back to app state keys
  const mappedTree = {
    ...tree,
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
