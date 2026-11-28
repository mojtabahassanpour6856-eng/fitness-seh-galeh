# BodyParts3D 4.0 — targeted muscle metadata audit

## Purpose
Metadata-only candidate audit using the publicly available Human Atlas manifest. This does not alter the product or assert anatomical correctness.

## Source and provenance
- Repository: `ashemag/human-atlas`
- Manifest: `public/models/atlas.json`
- Pinned manifest blob: `0f81b5621479a0c0548f4683c316f33bd4d6545b`
- Dataset: BodyParts3D 4.0
- License: CC BY 4.0
- Required attribution: **BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International.**
- Source reference model: adult male.

The manifest contains 2,234 mesh records, 3,432 named concepts, 15 binary chunks and 2,288,268 triangles in total. Target-name filtering returned 82 candidate element records and 131 concept records.

## Important interpretation
- A concept can map to multiple element meshes.
- Right and left are distinct element records and must remain distinct in source geometry.
- This is metadata evidence only. We have not yet decoded or visually inspected the binary chunks.
- Do not project this adult-male geometry onto the female figures.
- Presence in the manifest does not establish a valid MuscleMap hit-region, depth layer, or final training target.
- Source system labels are viewer categories, not a complete anatomical validation.

## Early coverage notes
- Pectoralis major is represented in separately named regional elements (abdominal and sternocostal in the records found); clavicular-region presence must be confirmed by inspecting all matching concept records before final grouping.
- Deltoid is split into clavicular, acromial and spinal portions.
- Triceps brachii has long, lateral and medial head records.
- Biceps brachii has long and short head records.
- Gluteus maximus, medius and minimus each have right/left element pairs.
- Quadriceps components rectus femoris, vastus lateralis, vastus medialis and vastus intermedius have right/left element pairs.
- The manifest also exposes a broad set of posterior-chain and calf candidates.

## Next validation gate
1. Obtain only the required binary chunks from the public repository without asking the user to download or upload files.
2. Decode position/normal/index buffers according to each manifest offset and verify byte bounds and triangle indices.
3. Render selected chunks in an isolated experiment page.
4. Visually inspect each target from anterior/posterior/lateral angles and confirm left/right orientation.
5. Only then label candidates as `verified_geometry`; otherwise retain `candidate_geometry` or `not_available`.
6. Keep the four-view MuscleMap and all production files untouched until explicit approval.

Detailed machine-readable inventory: `ANATOMY_BODYPARTS3D_TARGETED_MUSCLE_METADATA_AUDIT.json`.
