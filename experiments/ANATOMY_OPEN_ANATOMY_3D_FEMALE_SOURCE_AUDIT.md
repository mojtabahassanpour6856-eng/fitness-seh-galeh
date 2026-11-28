# Female and grouped-muscle source audit — Open Anatomy 3D

Date: 2026-11-28
Status: research-only; no product assets imported.

## Candidate inspected
- Repository: `MervinR07/open-anatomy-3d`
- Package: `open-anatomy-3d` 0.1.0 (README's pinned CDN examples)
- Catalog: `packages/open-anatomy-3d/catalog.json`
- Build method: `pipeline/f_build.mjs`
- License: application code MIT; model assets and catalog CC BY 4.0.
- Credit line required by upstream:
  `Anatomy: BodyParts3D © The Database Center for Life Science (CC BY 4.0); female organs: Human Reference Atlas 3D Reference Organs, HuBMAP (CC BY 4.0); female body: MakeHuman (CC0). Modified by open-anatomy-3d, CC BY 4.0.`

## What it provides
- One male and one female GLB model.
- Catalog contains 147 named structures (140 male / 145 female as described by README; joint hotspots are not meshes).
- Catalog contains 41 muscle-group entries. These are broad regions, not 41 individually isolated muscles.
- Examples: chest muscles, deltoid, upper-arm muscles, forearm muscles, back muscles, gluteal muscles, quadriceps, hamstrings, calf, shin, abdominal wall, and trapezius.
- The source's muscle classification rules group many separate BodyParts3D structures into these broader training-region meshes. This can be useful as a coarse comparison taxonomy, but it does not replace our detailed target-specific audit.

## Critical female-model limitation
The upstream `pipeline/f_build.mjs` explicitly states that the HRA female reference has almost no muscles or limb vessels. Its female model is made by:
1. Taking the complete male BodyParts3D anatomy, including its muscle meshes.
2. Fitting/warping that male anatomy into a MakeHuman female body using a thin-plate-spline (TPS) deformation driven by matched landmarks.
3. Swapping selected sex-specific organs for HRA female organs.

The pipeline source describes matched landmarks on vertebrae, pelvis, leg bones, organs, head and body outline. Therefore the female muscle meshes are not independently sourced female muscle geometry. They are deformed male-source structures.

**Decision:** do not use this package's female muscle geometry as verified female anatomy in Fitness Seh Galeh. Do not map those warped muscles to the female four-view selector or present them as anatomically verified. At most, this source can inform coarse grouping vocabulary and UI ideas, not anatomical ground truth.

## Male-model limitations
- Male BodyParts3D data is a valid source candidate under CC BY 4.0 with attribution.
- The package merges many source meshes into broad groups such as `chest_muscles_r`, `upper_arm_muscles_r`, and `quadriceps_r`.
- Such merged groups are not enough to isolate each muscle head or individual muscle. Use the full BodyParts3D manifest/element mapping for detailed targets.
- Its GLB is compressed with `EXT_meshopt_compression`; a compatible decoder is required.
- External CDN availability must not be assumed for Iranian networks. Any later product use requires local hosting or a controlled fallback and explicit performance/network tests.

## Comparison with current Fitness Seh Galeh approach
| Requirement | BodyParts3D 4.0 raw mesh manifest | Open Anatomy 3D package |
|---|---|---|
| Separate source element meshes | Yes, 2,234 | Mostly merged into 135 meshed structures |
| Named anatomical concept hierarchy | 3,432 concepts | 147 catalog structures |
| Detailed muscle heads / subparts | Better source granularity | Mostly grouped |
| Adult male reference | Yes | Yes |
| Independently sourced female skeletal muscles | No | No; male muscles are TPS-warped |
| Suitable for immediate production | No; needs decode, validation, mapping | No; grouping and female provenance limitations |

## Next action
Continue with the raw BodyParts3D manifest route for male candidates:
1. Verify the byte layout using the upstream converter and validate selected chunk offsets.
2. Add a full-body context mesh in the isolated lab only if its source and coordinate frame can be verified.
3. Inspect candidate meshes in situ from front, back and lateral views; validate left/right and boundaries.
4. Keep the female targets in `candidate_geometry` / `not_available` until an independently sourced female skeletal-muscle dataset is found and validated.
5. Do not change `src/`, production MuscleMap, `main`, Supabase or trainee data.

No external anatomy package or model was copied into the production application by this audit.
