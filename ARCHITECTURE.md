# G2Tree Architecture

This document describes the technical architecture of G2Tree — how its systems are organized, how data flows through the pipeline, and why key design decisions were made.

---

## System Overview

G2Tree is structured as a layered ecological reconstruction pipeline:

```
PHOTO CAPTURE
  → IMAGE INTERPRETATION
    → STRUCTURE ANNOTATION
      → SPECIES IDENTIFICATION
        → PROCEDURAL RECONSTRUCTION
          → ECOLOGICAL ESTIMATION
            → GEOSPATIAL RECORD
```

Each stage produces outputs that constrain and inform the next. The pipeline is intentionally non-linear in the user-facing sense: every stage can be revisited, and every AI-generated output can be overridden.

The system deliberately avoids:
- heavyweight photogrammetry (dense point cloud / mesh reconstruction)
- opaque generative mesh systems with no editable intermediate state
- purely decorative AI rendering that produces plausible-looking outputs without grounding

Instead it relies on:
- constrained procedural generation driven by annotated photographic evidence
- interpretable image analysis with visible, editable outputs
- deterministic heuristics where feasible, ML models only where necessary

---

## Frontend Architecture

### Step Orchestration

[App.jsx](src/App.jsx) owns the top-level step routing. The primary workflow is a five-step sequence:

```
capture → review → scaffold → identify → clone
```

Legacy steps (metrics, benefits, calibrate, materials, export, record) remain accessible but are not part of the primary path. The Profile panel is accessible at any point via the StepHeader user icon, outside the main step sequence.

Step transitions are explicit: each panel exposes a Back and Next action that calls into the Zustand session to update `currentStep`. No implicit routing.

### Session State

All workflow state lives in a single Zustand store: [useTreeSession.js](src/state/useTreeSession.js).

Key state groups:

| Group | Contents |
|---|---|
| `scanState` | primaryImage, barkImage, detailImage, scaleImage, scaleHintFt, exifLocation, browserLocation, selectedLocation, speciesResult, visionAnalysis, estimatedMetrics, proceduralParams |
| `annotations` | treeOutline, crownOutline, trunkLine, primaryBranches (all as `[{x,y}]` normalized coordinates) |
| `session` | auth session from Supabase |
| `calibrationPhotoIndex` | which captured image is used as the scaffold reference |
| `speciesAIResult` | normalized PlantNet candidates |
| `userHints` | user-confirmed overrides (known_species, etc.) |

Actions are granular: `setScanState(partial)`, `setAnnotations(partial)`, `resetSession()`. State is restored between steps rather than re-fetched.

### Panel Component Map

| Step | Component | Responsibility |
|---|---|---|
| capture | [CaptureWizard.jsx](src/components/CaptureWizard.jsx) | 7-substep guided scan |
| review | [PhotoReview.jsx](src/components/PhotoReview.jsx) | Photo review + calibration selection |
| scaffold | [PhotoScaffoldEditor.jsx](src/components/PhotoScaffoldEditor.jsx) | Annotation overlays + structure AI |
| identify | [IdentifyPanel.jsx](src/components/IdentifyPanel.jsx) | Species confirmation |
| clone | [EcologicalScannerView.jsx](src/components/EcologicalScannerView.jsx) | Clone rendering + metrics |

Supporting components: [LandmarkCanvas.jsx](src/components/LandmarkCanvas.jsx), [ClonePreview.jsx](src/components/ClonePreview.jsx), [EcologicalRolePanel.jsx](src/components/EcologicalRolePanel.jsx), [InterpretationOverlay.jsx](src/components/InterpretationOverlay.jsx), [DepthOverlay.jsx](src/components/DepthOverlay.jsx), [MetricsReviewPanel.jsx](src/components/MetricsReviewPanel.jsx), [MaterialsPanel.jsx](src/components/MaterialsPanel.jsx), [ExportPanel.jsx](src/components/ExportPanel.jsx).

---

## Capture Pipeline

[CaptureWizard.jsx](src/components/CaptureWizard.jsx) runs a 7-substep guided capture sequence:

1. **Full tree photo** → `scanState.primaryImage` (EXIF GPS extracted here via [exif.js](src/lib/exif.js))
2. **Bark / trunk detail** → `scanState.barkImage`
3. **Leaf, flower, or fruit** → `scanState.detailImage`
4. **Scale reference** → `scanState.scaleImage` (optional; user provides scale hint in feet)
5. **Location confirmation** → `scanState.selectedLocation` (EXIF or browser geolocation)
6. **AI species analysis** → `scanState.speciesResult` (PlantNet via [plantnet.js](src/lib/plantnet.js))
7. **Summary and clone preview**

On completing the wizard, state commits to the Zustand store and the step advances to `review`.

Image upload goes through [imageNormalize.js](src/lib/imageNormalize.js) before storage — normalization ensures consistent orientation and size for downstream analysis.

---

## Image Interpretation Pipeline

Scaffold construction begins in [PhotoScaffoldEditor.jsx](src/components/PhotoScaffoldEditor.jsx) and is driven by [analyzeTreeImage.js](src/lib/analyzeTreeImage.js), which wraps [visionAnalysis.js](src/lib/visionAnalysis.js).

On opening the scaffold step, if no annotations exist, first-pass structure inference runs automatically:

1. The selected calibration image (indexed by `calibrationPhotoIndex`) is passed to `analyzeTreeImage`
2. The analysis attempts to infer: tree outline polygon, crown envelope polygon, trunk axis polyline, primary branch polylines
3. Results populate `annotations` in Zustand as normalized `{x, y}` coordinate arrays
4. A status banner surfaces the result: running / done / failed
5. The user can rerun or clear the analysis at any time

### Annotation Layers

The editor operates in two modes:

**Annotate mode** (default): four independent annotation layers, each with click-to-add and drag-to-adjust handles.

| Layer | Type | Color |
|---|---|---|
| Tree outline | Polygon | Green |
| Crown outline | Polygon | Blue |
| Trunk axis | Polyline | Red |
| Primary branches | Polylines (multiple) | Amber |

**Fine-tune scaffold mode**: direct manipulation of trunk, canopy, and branch scaffold handles from the procedural system, for adjustment after the annotation pass.

### Current Approach and Future ML

The current first-pass analysis is heuristic: it uses [visionAnalysis.js](src/lib/visionAnalysis.js) and [structureAI.js](src/lib/structureAI.js) to derive structural estimates from image properties without a full segmentation model. This is intentional — it keeps the system fast, transparent, and locally runnable.

Planned ML integration (see Planned AI Integrations) will replace or augment this with SAM2 segmentation and semantic branch extraction while preserving the same editable annotation interface.

---

## Procedural Reconstruction System

Clone geometry is generated by [scaffoldGeometry.js](src/lib/scaffoldGeometry.js) and parameterized by [treeModelParams.js](src/lib/treeModelParams.js) and [photoToProceduralParams.js](src/lib/photoToProceduralParams.js).

The bridge from annotations to procedural parameters lives in `PhotoScaffoldEditor.handleGenerate`:

- If `annotations.trunkLine.length >= 2`: the trunk annotation is used as `trunkAxisOverride` for `analyzeTreePhotoScaffold`
- If `annotations.primaryBranches.length > 0`: branch annotations are converted to branch gesture inputs for `buildScaffoldCloneGeometry`
- Otherwise: falls back to manual scaffold handle positions

### What the Procedural System Generates

**Trunk**: A spline generated from the trunk axis annotation, with taper, lean, and curvature parameters derived from the photograph and species data.

**Branch hierarchy**: A recursive branch network seeded from primary branch annotations, with secondary and tertiary branching generated procedurally. Branch angles, lengths, and tapering are modulated by species parameters and estimated health state.

**Canopy**: A crown envelope mesh constrained by the annotated crown outline, with leaf density and distribution driven by species and season parameters.

**Bark materials**: Procedural bark textures parameterized by species, sampled via [textureSampling.js](src/lib/textureSampling.js) and [threeTextureUtils.js](src/lib/threeTextureUtils.js). Bark image capture feeds the texture pipeline when available.

**Health modulation**: Structural asymmetry, branch loss, and canopy gaps are modulated by the estimated health score. A healthy crown is denser and more symmetric; a stressed crown reflects that in the geometry.

The procedural clone is an ecological interpretation constrained by photographic evidence. It is not a literal mesh reconstruction of the photographed tree. The goal is a model that behaves ecologically — that produces credible estimates of canopy coverage, carbon storage, and stormwater interception — not one that is visually identical to the source photograph.

---

## Ecological Metrics Layer

Metrics are estimated in [estimateTree.js](src/lib/estimateTree.js) and [ecologicalBenefits.js](src/lib/ecologicalBenefits.js), with geometry derived from [treeMetrics.js](src/lib/treeMetrics.js).

### Estimated Parameters

- **DBH (diameter at breast height)**: Estimated from trunk width in the annotated photograph, calibrated against scale reference when available
- **Crown spread**: Derived from the crown outline annotation and camera distance estimate
- **Canopy density**: Estimated from crown annotation area and species leaf area index
- **Height**: Estimated from full-tree photograph aspect ratio and trunk annotation
- **Health score**: Composite of canopy completeness, structural symmetry, and user-observed condition

### Ecological Analytics

Downstream benefits estimation follows i-Tree-inspired methodology:

- **Carbon storage**: Function of DBH, species, and health state
- **Stormwater interception**: Function of canopy area and local precipitation assumptions
- **Shade contribution**: Function of crown spread and canopy density
- **Canopy coverage**: Direct from crown spread estimate

All results are displayed as estimates and remain editable. The system is transparent about the uncertainty in its inputs.

---

## Geospatial Architecture

### Storage Schema

Tree records are written to Supabase via [treeRecords.js](src/lib/treeRecords.js). The schema is PostGIS-ready — location fields are structured for spatial indexing. Photos are stored in the `g2tree-photos` bucket; metadata in `g2tree_tree_photos`; tree records in `g2tree_trees`.

Export format is versioned (`g2tree/v1`) for forward compatibility. Clone packages are assembled by [clonePackage.js](src/lib/clonePackage.js).

### Location Capture

Location is captured in priority order:
1. EXIF GPS from the primary photograph ([exif.js](src/lib/exif.js))
2. Browser geolocation API
3. Manual confirmation via LocationConfirmStep

The confirmed location is stored in `scanState.selectedLocation` and written to the tree record.

### Census Layer

Each saved tree becomes a record in a spatial ecological census — a persistent, queryable layer of observed trees. The design anticipates longitudinal use: the same tree can be resurveyed, and records can be compared over time.

Future integration with BeechLens and GROVEMATRIX will expose this census layer to broader ecological data systems. Export stubs for both integrations are present in [ExportPanel.jsx](src/components/ExportPanel.jsx).

---

## Visual / UX Architecture

The interface is designed to feel observational rather than gamified. Several specific decisions shape this:

**Thin annotation language.** Structure overlays — outlines, axes, branch lines — are rendered as thin vectors over the source photograph. They read as measurements, not decorations.

**Direct image feedback.** Annotation handles appear directly on the photograph. The user interacts with the image itself, not with abstracted controls. Corrections feel like drawing, not configuring.

**Minimal visual noise.** The UI suppresses chrome during active annotation. Controls appear contextually. The field of view belongs to the photograph.

**Calm transitions.** Framer Motion drives step transitions. Animations are functional — they signal state changes — not performative.

**Field-instrument feeling.** The aesthetic draws on scientific overlays, spatial calibration tools, and ecological survey instruments. Typefaces, color choices, and layout density are calibrated toward legibility in outdoor lighting conditions.

**Ecological scanner framing.** The clone rendering step ([EcologicalScannerView.jsx](src/components/EcologicalScannerView.jsx)) frames the result as a scan output — an interpreted record — rather than a finished product. This framing keeps the user in an investigative posture.

The interface should feel like it is helping the user understand a tree, not like it is performing for the user.

---

## Planned AI Integrations

Current AI integration is intentionally minimal and interpretable. The roadmap adds depth while preserving editability.

### Depth Anything V2
Monocular depth estimation to improve DBH, height, and crown spread estimates from single photographs. Infrastructure is partially in place via [depthEstimation.js](src/lib/depthEstimation.js) and [DepthOverlay.jsx](src/components/DepthOverlay.jsx).

### ONNX Runtime Web
Browser-local model inference without a server round-trip. The target is structure analysis and depth estimation running entirely on-device, which matters for field use with intermittent connectivity.

### SAM / SAM2 Segmentation
Segment Anything Model for precise tree silhouette and crown boundary extraction. This would replace or augment the current heuristic outline detection.

### Semantic Branch Extraction
Structured branch topology inference from the segmented crown — distinguishing primary, secondary, and tertiary branching structure for more ecologically accurate procedural reconstruction.

### Multi-Image Reconstruction
Fusing multiple photographs of the same tree for better structural estimation. This is a longer-term capability that depends on camera calibration and pose estimation.

### Why Lightweight and Local

The project prefers browser-local inference over server-side AI for three reasons:

1. **Field use.** Network connectivity is unreliable in ecological fieldwork contexts.
2. **Interpretability.** Local models with editable outputs are easier to trust than remote black boxes.
3. **Cost and latency.** For per-image inference at field scale, local inference is more sustainable.

Remote AI (PlantNet, future vision APIs) is used only where local inference is not feasible.

---

## Repository Structure

```
src/
  components/       — Step panels, overlays, UI
  state/            — Zustand session store
  lib/              — Analysis, estimation, geometry, services
  assets/           — Static images
  styles.css        — Global styles
  App.jsx           — Step routing and top-level layout
  main.jsx          — Entry point

public/
  models/           — Static 3D assets (planned)
  textures/         — Static texture assets (planned)
```

### Key Library Files

| File | Role |
|---|---|
| [analyzeTreeImage.js](src/lib/analyzeTreeImage.js) | First-pass structure inference entrypoint |
| [visionAnalysis.js](src/lib/visionAnalysis.js) | Image analysis pipeline |
| [structureAI.js](src/lib/structureAI.js) | Structure inference heuristics |
| [speciesAI.js](src/lib/speciesAI.js) | Species identification pipeline |
| [speciesAnalysis.js](src/lib/speciesAnalysis.js) | Species result normalization |
| [plantnet.js](src/lib/plantnet.js) | PlantNet API integration |
| [photoToProceduralParams.js](src/lib/photoToProceduralParams.js) | Annotation-to-procedural parameter bridge |
| [scaffoldGeometry.js](src/lib/scaffoldGeometry.js) | Clone geometry generation |
| [photoScaffold.js](src/lib/photoScaffold.js) | Photo scaffold analysis |
| [treeModelParams.js](src/lib/treeModelParams.js) | Procedural parameter schema |
| [estimateTree.js](src/lib/estimateTree.js) | DBH, height, crown estimation |
| [treeMetrics.js](src/lib/treeMetrics.js) | Geometry-derived metrics |
| [ecologicalBenefits.js](src/lib/ecologicalBenefits.js) | Carbon, stormwater, canopy analytics |
| [depthEstimation.js](src/lib/depthEstimation.js) | Depth estimation (planned integration) |
| [treeRecords.js](src/lib/treeRecords.js) | Supabase read/write for tree records |
| [clonePackage.js](src/lib/clonePackage.js) | Export package assembly |
| [imageNormalize.js](src/lib/imageNormalize.js) | Upload normalization |
| [exif.js](src/lib/exif.js) | EXIF GPS and metadata extraction |
| [textureSampling.js](src/lib/textureSampling.js) | Bark texture sampling |
| [threeTextureUtils.js](src/lib/threeTextureUtils.js) | Three.js texture utilities |
| [supabaseClient.js](src/lib/supabaseClient.js) | Supabase client singleton |

---

## Guiding Principles

These principles are not aspirational — they are operational constraints that should inform any architectural decision:

**Ecological legibility.** Every output — clone geometry, metric estimate, annotation — should be understandable in ecological terms. If it cannot be explained in field language, it probably should not be in the interface.

**Editable AI interpretation.** No AI output is final. Every inference is a starting point for human judgment. The interface must always provide a path to correction.

**Procedural realism.** The goal is a model that behaves ecologically, not one that looks photorealistic. Ecological fidelity takes precedence over visual literalism.

**Lightweight spatial intelligence.** Prefer algorithms that can run in the browser, produce interpretable intermediate state, and fail gracefully over algorithms that require heavy infrastructure or produce opaque outputs.

**Mobile-first field capture.** The primary user is in the field, on a phone, possibly in bright sunlight with intermittent connectivity. Interface decisions, performance targets, and AI integration choices should reflect this.

**Environmental storytelling.** Trees have histories, relationships, and roles in their ecosystems. The system should make it possible to observe and record those roles, not just produce geometric models.

**Calm observational interfaces.** The interface should be quiet enough to keep the user's attention on the tree, not on the tool.

**Trees as ecological agents.** The tree is the subject. The system is the instrument.
