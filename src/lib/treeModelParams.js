/**
 * Convert tree estimates + structure hints into procedural 3D model parameters.
 * All geometry is normalized — trunk height = 1.0 unit.
 */

// ── Species taxonomy lookup tables ───────────────────────────────────────────

const DECIDUOUS_GENERA = new Set([
  'Acer','Quercus','Fagus','Betula','Platanus','Ulmus','Tilia',
  'Fraxinus','Populus','Prunus','Liquidambar','Liriodendron',
  'Nyssa','Carpinus','Corylus','Alnus','Juglans','Castanea',
  'Gleditsia','Robinia','Celtis','Magnolia','Cercis','Morus',
])

const CONIFER_GENERA = new Set([
  'Pinus','Picea','Abies','Thuja','Juniperus','Tsuga','Cedrus',
  'Larix','Sequoia','Sequoiadendron','Pseudotsuga','Chamaecyparis',
  'Cupressus','Taxus','Cryptomeria','Calocedrus','Metasequoia',
])

const PALM_GENERA = new Set([
  'Phoenix','Washingtonia','Sabal','Chamaerops','Trachycarpus',
  'Syagrus','Roystonea','Livistona','Cocos','Butia','Brahea',
])

const COLUMNAR_CONIFER_GENERA = new Set([
  'Juniperus','Thuja','Chamaecyparis','Cupressus','Calocedrus',
])

const RE_CONIFER   = /\b(pine|spruce|fir|cedar|juniper|hemlock|larch|cypress|redwood|yew|arborvitae|douglas.fir)\b/i
const RE_PALM      = /\b(palm|palmetto)\b/i
const RE_DECIDUOUS = /\b(oak|maple|beech|birch|elm|ash|poplar|cherry|sycamore|linden|basswood|sweetgum|tupelo|walnut|chestnut|hornbeam|hazel|alder|locust|redbud|magnolia)\b/i

// ── Typical height ranges by genus (ft) ─────────────────────────────────────
// Used for morphological re-ranking of PlantNet candidates.
const GENUS_HEIGHT_RANGES = {
  // Deciduous
  Acer:         { min: 15,  max: 80  },
  Quercus:      { min: 40,  max: 100 },
  Fagus:        { min: 50,  max: 100 },
  Betula:       { min: 40,  max: 80  },
  Platanus:     { min: 70,  max: 100 },
  Ulmus:        { min: 60,  max: 100 },
  Tilia:        { min: 60,  max: 80  },
  Fraxinus:     { min: 50,  max: 80  },
  Populus:      { min: 50,  max: 100 },
  Prunus:       { min: 15,  max: 50  },
  Liquidambar:  { min: 60,  max: 80  },
  Liriodendron: { min: 60,  max: 120 },
  Nyssa:        { min: 30,  max: 60  },
  Carpinus:     { min: 20,  max: 40  },
  Corylus:      { min: 10,  max: 30  },
  Alnus:        { min: 40,  max: 70  },
  Juglans:      { min: 50,  max: 75  },
  Castanea:     { min: 50,  max: 100 },
  Gleditsia:    { min: 30,  max: 70  },
  Robinia:      { min: 40,  max: 80  },
  Celtis:       { min: 40,  max: 60  },
  Magnolia:     { min: 20,  max: 80  },
  Cercis:       { min: 20,  max: 30  },
  Morus:        { min: 30,  max: 60  },
  // Conifers
  Pinus:        { min: 40,  max: 200 },
  Picea:        { min: 40,  max: 150 },
  Abies:        { min: 60,  max: 200 },
  Thuja:        { min: 10,  max: 60  },
  Juniperus:    { min: 10,  max: 50  },
  Tsuga:        { min: 60,  max: 150 },
  Cedrus:       { min: 40,  max: 100 },
  Larix:        { min: 40,  max: 100 },
  Sequoia:      { min: 200, max: 380 },
  Sequoiadendron:{ min: 160, max: 310 },
  Pseudotsuga:  { min: 130, max: 250 },
  Chamaecyparis:{ min: 20,  max: 70  },
  Cupressus:    { min: 40,  max: 80  },
  Taxus:        { min: 10,  max: 60  },
  Cryptomeria:  { min: 70,  max: 130 },
  Calocedrus:   { min: 60,  max: 130 },
  Metasequoia:  { min: 70,  max: 130 },
  // Palms
  Phoenix:      { min: 20,  max: 80  },
  Washingtonia: { min: 50,  max: 100 },
  Sabal:        { min: 40,  max: 65  },
  Chamaerops:   { min: 6,   max: 15  },
  Trachycarpus: { min: 10,  max: 40  },
  Syagrus:      { min: 20,  max: 50  },
  Roystonea:    { min: 50,  max: 100 },
  Livistona:    { min: 40,  max: 100 },
  Cocos:        { min: 60,  max: 100 },
}

/**
 * Score how well a measured tree height fits a species' typical range.
 * Returns 0–1 (1 = within range, <1 = outside, 0 = implausible).
 *
 * @param {string} sciName  — PlantNet scientific name (with or without author)
 * @param {number} heightFt — measured height from scale anchor step
 */
export function morphologicalScore(sciName, heightFt) {
  if (!sciName || !heightFt) return 0.5  // neutral if no data
  const genus = sciName.trim().split(/\s+/)[0]
  const range = GENUS_HEIGHT_RANGES[genus]
  if (!range) return 0.5  // unknown genus — neutral

  if (heightFt >= range.min && heightFt <= range.max) return 1.0

  // Penalty for being outside the range — distance in range units
  const tolerance = (range.max - range.min) * 0.5
  const distance  = heightFt < range.min
    ? (range.min - heightFt)
    : (heightFt - range.max)
  return Math.max(0, 1 - distance / Math.max(tolerance, 10))
}

// ── Public helpers ────────────────────────────────────────────────────────────

/**
 * Infer broad tree type from species names.
 * Returns 'deciduous_broadleaf' | 'conifer' | 'palm_like' | 'unknown'
 */
export function inferTreeType(scientificName, commonName) {
  const sci = (scientificName || '').trim()
  if (sci) {
    const genus = sci.split(/\s+/)[0]
    if (DECIDUOUS_GENERA.has(genus)) return 'deciduous_broadleaf'
    if (CONIFER_GENERA.has(genus))   return 'conifer'
    if (PALM_GENERA.has(genus))      return 'palm_like'
  }
  const com = commonName || ''
  if (RE_CONIFER.test(com))   return 'conifer'
  if (RE_PALM.test(com))      return 'palm_like'
  if (RE_DECIDUOUS.test(com)) return 'deciduous_broadleaf'
  return 'unknown'
}

function inferCrownHabit(genus, treeType, canopyDistribution) {
  if (treeType === 'conifer') {
    return COLUMNAR_CONIFER_GENERA.has(genus) ? 'columnar' : 'conical'
  }
  if (treeType === 'palm_like') return 'palm_crown'
  if (treeType === 'deciduous_broadleaf') {
    if (genus === 'Quercus')  return 'broad_irregular'
    if (genus === 'Fagus')    return 'oval'
    if (genus === 'Betula')   return 'open_airy'
    if (canopyDistribution === 'asymmetric') return 'broad_irregular'
  }
  return 'rounded'
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * @param {object} estimates
 * @param {object} [treeStructureHints]
 * @param {object} [speciesInfo]  { scientificName?, commonName? }
 * @param {object} [textureSamples]  { bark?, leaf?, canopy? } — from TextureSampler
 */
export function buildTreeModelParams(estimates, treeStructureHints = {}, speciesInfo = {}, textureSamples = {}) {
  const {
    height_ft       = 30,
    canopy_width_ft = 20,
    dbh_in          = 8,
    age_class       = 'mid-age',
    health_status   = 'unknown',
  } = estimates || {}

  const {
    trunkForm: rawTrunkForm = 'unknown',
    trunkCount              = 1,
    branchDensity           = 'medium',
    canopyDistribution      = 'medium',
    leafDistribution        = 'clustered',
  } = treeStructureHints || {}

  const { scientificName = '', commonName = '' } = speciesInfo

  // ── Species / type inference ──────────────────────────────────────────────
  const treeType   = inferTreeType(scientificName, commonName)
  const genus      = (scientificName || '').trim().split(/\s+/)[0] || ''
  const crownHabit = inferCrownHabit(genus, treeType, canopyDistribution)

  // 'unknown' trunk form renders as single — safe default
  const trunkForm = rawTrunkForm === 'unknown' ? 'single' : rawTrunkForm

  // ── Normalized trunk geometry ─────────────────────────────────────────────
  const canopyRatio      = canopy_width_ft / Math.max(height_ft, 1)
  const trunkRadiusRatio = (dbh_in / 12) / Math.max(height_ft, 1)

  const trunkHeight     = 1.0
  const trunkRadiusBase = Math.max(0.025, trunkRadiusRatio)
  // Conifers have a much more tapered apex
  const trunkRadiusTop  = trunkRadiusBase * (treeType === 'conifer' ? 0.26 : 0.42)

  // Conifers have a narrower effective canopy radius (conical shape)
  const canopyRadiusRaw = Math.max(0.3, canopyRatio * 0.5)
  const canopyRadius    = treeType === 'conifer'
    ? canopyRadiusRaw * 0.72
    : canopyRadiusRaw
  // Conifers: canopy centre sits lower since mass is spread along trunk
  const canopyYOffset   = trunkHeight * (treeType === 'conifer' ? 0.54 : 0.72)

  // ── Branch counts ─────────────────────────────────────────────────────────
  const ageBonus = age_class === 'young' ? 0 : age_class === 'mid-age' ? 1 : 2

  const primaryBranchCount = (
    branchDensity === 'low'  ? 4 :
    branchDensity === 'high' ? 9 : 6
  ) + ageBonus

  const secondaryBranchCount =
    branchDensity === 'low'  ? 1 :
    branchDensity === 'high' ? 3 : 2

  const leafClustersPerTip =
    leafDistribution === 'sparse'      ? 1 :
    leafDistribution === 'outer_shell' ? 1 : 2

  // Conifers have smaller, denser needle clusters
  const leafClusterRadius = canopyRadius * (treeType === 'conifer' ? 0.15 : 0.22)
  const branchLength      = trunkHeight * 0.28 * canopyRatio

  // ── Conifer-specific: whorled branch tier count ───────────────────────────
  const branchTierCount = treeType === 'conifer'
    ? Math.min(12, Math.max(5, 5 + ageBonus + (branchDensity === 'high' ? 2 : branchDensity === 'low' ? -1 : 0)))
    : 0

  // ── Leaf cluster total (informational for export schema) ──────────────────
  const leafClusterCount = treeType === 'conifer'
    ? branchTierCount * 5 * 2
    : primaryBranchCount * secondaryBranchCount * leafClustersPerTip

  // ── Canopy density by health ──────────────────────────────────────────────
  const healthDensity =
    health_status === 'good' ? 1.0 :
    health_status === 'fair' ? 0.65 :
    health_status === 'poor' ? 0.35 : 0.8

  const distributionMod =
    canopyDistribution === 'sparse' ? 0.55 :
    canopyDistribution === 'dense'  ? 1.3  : 1.0

  const canopyDensity = healthDensity * distributionMod

  // Patchiness: fraction of leaf clusters shown as dead gaps
  const patchiness =
    health_status === 'poor' ? 0.36 :
    health_status === 'fair' ? 0.12 : 0

  const barkSample = textureSamples?.bark
  const leafSample = textureSamples?.leaf ?? textureSamples?.canopy

  const trunkColor = barkSample?.averageColor ??
    (treeType === 'conifer'   ? '#4a3a2a' :
     treeType === 'palm_like' ? '#8a7a5a' : '#5a4a3a')

  // ── Canopy colour by type × health (overridden by texture sample if present) ─
  const canopyColorBase = (() => {
    if (treeType === 'conifer') {
      return health_status === 'good' ? '#2a5c38' :
             health_status === 'fair' ? '#4a6830' :
             health_status === 'poor' ? '#786038' : '#325a3c'
    }
    if (treeType === 'palm_like') {
      return health_status === 'good' ? '#4a8c3c' :
             health_status === 'fair' ? '#6a8c34' :
             health_status === 'poor' ? '#8a7a34' : '#508040'
    }
    return health_status === 'good' ? '#3d7a4a' :
           health_status === 'fair' ? '#6b8c3e' :
           health_status === 'poor' ? '#8c7a3e' : '#4a7a52'
  })()
  const canopyColor = leafSample?.averageColor ?? canopyColorBase

  // ── Architecture descriptors (output for schema + rendering) ─────────────
  const trunkArchitecture =
    trunkForm === 'multi'     ? 'multi' :
    trunkForm === 'forked'    ? 'forked' :
    treeType  === 'palm_like' ? 'palm' :
    treeType  === 'conifer'   ? 'single_leader' : 'branching_leader'

  const branchArchitecture =
    treeType === 'conifer'   ? 'whorled' :
    treeType === 'palm_like' ? 'fronds' : 'alternate'

  const foliageType =
    treeType === 'conifer'   ? 'needle_masses' :
    treeType === 'palm_like' ? 'frond_arches'  : 'broadleaf_clusters'

  // Legacy fields retained for external consumers
  const branchLevels = age_class === 'young' ? 1 : age_class === 'mid-age' ? 2 : 3
  const branchCount  = primaryBranchCount

  return {
    trunkHeight,
    trunkRadiusBase,
    trunkRadiusTop,
    canopyRadius,
    canopyYOffset,
    branchLength,
    branchLevels,
    branchCount,
    primaryBranchCount,
    secondaryBranchCount,
    leafClustersPerTip,
    leafClusterRadius,
    canopyDensity,
    canopyColor,
    trunkColor,
    trunkForm,
    trunkCount: Math.max(1, Math.min(5, trunkCount || 1)),
    leafDistribution,
    canopyDistribution,
    branchDensity,
    // ── New fields ──
    treeType,
    crownHabit,
    trunkArchitecture,
    branchArchitecture,
    foliageType,
    leafClusterCount,
    branchTierCount,
    patchiness,
    genus,
  }
}
