# G2Tree

Photo-informed ecological reconstruction and procedural digital tree cloning.

---

## Overview

G2Tree is a mobile-first tool for capturing, interpreting, and reconstructing trees as editable digital clones. Working from photographs taken in the field, it combines species identification, image interpretation, procedural modeling, and geospatial context to produce a structured ecological record for each tree.

The system is not a photo filter or a mesh scanner. It is a reconstruction pipeline: photographs inform a procedural model that is grounded in ecological evidence and remains editable throughout. The result is a digital clone that can be queried, compared, and archived — not just rendered.

G2Tree brings together several disciplines that rarely share a workflow:

- species identification and ecological classification
- image-based structure inference
- procedural 3D generation
- ecological metrics estimation
- geospatial census recording

It is intended for use in conservation fieldwork, citizen science, landscape observation, ecological storytelling, and environmental analysis. The longer-term goal is integration with BeechLens and GROVEMATRIX — a shared ecological data layer for tree populations at scale.

---

## Core Workflow

**1. Capture**
Photograph the full tree, then optionally bark texture, leaf or fruit detail, and a scale reference. GPS coordinates are extracted from EXIF data or confirmed via browser geolocation.

**2. Review**
Review captured images and select the primary photograph to use as the structural reference for scaffold construction.

**3. Scaffold**
AI-assisted first-pass analysis generates initial annotations: tree outline, crown envelope, trunk axis, and primary branch network. The user can inspect, correct, and extend each annotation layer before proceeding.

**4. Identify**
Species candidates are returned from PlantNet analysis. The user confirms or adjusts the identification. Confirmed species inform ecological parameters downstream.

**5. Clone**
Procedural reconstruction generates a digital tree clone constrained by the annotated photograph. Ecological analytics are derived from the structural and species data:

- estimated carbon storage
- stormwater interception capacity
- canopy coverage and shade contribution
- crown spread and diameter at breast height

**6. Record**
The completed clone, its ecological metrics, and its location are saved to a geospatial census layer — a persistent ecological record, not just a local session.

---

## Design Philosophy

G2Tree is designed to feel like a field instrument rather than a consumer app. The interface is intended to be observational: it presents empirical evidence, invites correction, and records what the user confirms.

Several convictions shape the design:

**Editable AI.** Every AI output — species identification, structure annotation, ecological estimate — is a starting point, not a verdict. The system surfaces its interpretation and expects the user to engage with it.

**Procedural realism over photogrammetric precision.** A procedural clone constrained by photographic evidence is more useful than an opaque mesh reconstruction that cannot be queried or adjusted. The goal is ecological fidelity, not photographic literalism.

**Lightweight over black-box.** Where heuristics and constrained algorithms can do the work, they should. Heavy opaque models are integrated only where they provide clear interpretive value.

**Trees as ecological agents.** The system models trees as participants in an ecosystem — storing carbon, intercepting water, providing canopy — not as isolated decorative objects.

The visual language draws on scientific overlays, spatial calibration tools, and ecological field instrumentation. Annotations are thin and precise. Feedback is direct. The AR-adjacent aesthetic is intentional: the interface should feel calibrated to the world it is measuring.

---

## Technical Stack

**Frontend**
- React + Vite
- Zustand (session state)
- Framer Motion (transitions and overlays)
- Three.js + React Three Fiber + Drei (3D clone rendering)

**Backend / Infrastructure**
- Supabase (auth, database, photo storage)
- PostGIS-ready schema (spatial indexing)
- Vercel (deployment)

**Vision / AI**
- PlantNet API (species identification)
- Heuristic image analysis (structure inference)
- Depth Anything V2 (planned — monocular depth estimation)
- ONNX Runtime Web (planned — browser-local inference)

**Mapping / Spatial**
- Browser Geolocation API
- EXIF GPS extraction
- MapLibre (planned — geospatial census visualization)

---

## Current Development Focus

- AI-assisted scaffold annotation with user correction
- Editable annotation overlays across outline, crown, trunk, and branch layers
- Procedural branch reconstruction from annotated geometry
- Ecological metrics estimation grounded in i-Tree methodology
- Mobile-first field capture UX across the full five-step workflow
- Clone realism balanced against performance constraints

---

## Long-Term Direction

Multi-image reconstruction from overlapping field photographs. LiDAR and ARKit integration for higher-fidelity spatial capture on capable devices. Forest-scale ecological scanning for population-level analysis. Disease progression tracking across longitudinal records. Shared ecological archives for collaborative citizen science. Environmental digital twin integration with BeechLens and GROVEMATRIX.

These ambitions are held lightly. The near-term goal is a tool that works well in the field for a single tree.

---

## Running Locally

```bash
npm install
npm run dev
```

Required environment variables in `.env.local`:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
PLANTNET_API_KEY=
```
