# Z-Anatomy Asset Intake Gate — 2026-11-28

## Scope
This is a source-intake and reproducibility checkpoint for the experimental anatomy rebuild only. No application runtime, main branch, Supabase project, student record, or production exercise bank was changed.

## Exact upstream source inspected
- Repository: https://github.com/Z-Anatomy/Models-of-human-anatomy
- Ref inspected: `master`
- Upstream commit: `8f1435d8e43d231a3a32a61eacbe617ead8f7f51`
- Commit timestamp: 2026-11-27T23:33:46Z
- Root archive: `Z-Anatomy.zip`
- Archive size reported by GitHub Contents API: 86,734,957 bytes
- Git blob SHA-1: `f43cabc6f366b2a6058dd2ed4a2b3c7b9b2492cb`
- Terminology file: `TA2.csv`, 1,510,396 bytes, blob SHA-1 `71bef934c23d207550ad1f318ec6edd8551cdba4`
- License file: `License.txt`, blob SHA-1 `4d48d7e83d2b79ba4510314c7612b2c3c0a90f67`

The root listing contains the Blender application-template archive, terminology CSV, code, license, and a separate biomechanics archive. It does not expose a per-muscle mesh directory as ordinary text files. GitHub's repository fetch interface returns text content and does not provide the binary archive bytes for local Blender inspection.

## What is confirmed
1. The upstream README describes the repository as a Blender template and says the model is derived from BodyParts3D.
2. The upstream license declares CC BY-SA 4.0 for Z-Anatomy code/content and requires attribution plus ShareAlike for derivative works.
3. The README's requested model attribution includes both BodyParts3D and Z-Anatomy.
4. `TA2.csv` is a multilingual anatomical terminology table. Its existence does not prove that a corresponding named, independent, selectable 3D mesh exists.
5. The archive is large enough (about 82.7 MiB) that it should be downloaded and inspected as a controlled, pinned asset—not copied blindly into the app repository.

## What is NOT yet confirmed
- Exact Blender object names for rectus femoris, vastus lateralis, vastus medialis, vastus intermedius, or trapezius parts.
- Whether upper/middle/lower trapezius are independently modeled objects or merely terminology/labels.
- Whether the atlas contains female geometry or only the male model described by the repository.
- Whether paired left/right meshes are separate, correctly oriented, and consistently named.
- Whether any named structure is suitable for surface projection and interactive highlighting.
- Triangle counts, dimensions, mesh integrity, visibility/occlusion, and export compatibility.
- The SHA-256 digest of the downloaded archive. The Git blob SHA above is not a substitute for SHA-256.

## Asset intake procedure required before a geometry claim
1. Download `Z-Anatomy.zip` from the pinned upstream commit, not a floating branch URL.
2. Record the downloaded byte count and SHA-256; compare byte count with the GitHub API metadata.
3. Inspect ZIP contents without extracting into the app repository; identify `Startup.blend` and all embedded license/attribution files.
4. Open the Blender file in a compatible Blender version and export a read-only inventory containing object name, collection, mesh vertex/face counts, bounding box, transforms, and parent hierarchy.
5. Search the inventory for candidate structures using anatomical names and synonyms; preserve exact source object names.
6. For each candidate, render isolated front/back and oblique views, inspect bilateral geometry and depth/occlusion, and compare against trusted anatomical references.
7. Do not generate 2D silhouettes by arbitrary slicing. Derive projection from actual mesh geometry and retain a source-to-projection trace.
8. Create a machine-readable manifest with stable app IDs, exact source object names, source commit, license attribution, view visibility, laterality, evidence references, and review state.
9. Only after technical and anatomical review, create a lightweight experimental web preview. No asset enters production until separate explicit approval.

## Candidate pilot structures
- Rectus femoris
- Vastus lateralis
- Vastus medialis
- Vastus intermedius (deep layer; must not be presented as a superficial skin-facing selection if occluded)
- Trapezius as a whole; subdivisions only if the source actually contains independent geometry and their anatomy is validated

## License caution
The upstream README currently states CC BY-SA 4.0 for Z-Anatomy and explicitly attributes the underlying BodyParts3D model. A separate BodyParts3D archive notice may describe its own current license differently. Do not assume the two datasets or their license terms are interchangeable. For any derivative that incorporates Z-Anatomy model geometry, retain the required attribution and ShareAlike terms, and obtain a clear distribution plan before shipping the model in the app.

## Decision
**Z-Anatomy remains the preferred pilot source, but it has not passed the mesh-inspection gate.** The next real technical step is binary archive acquisition and Blender inventory generation. Until that happens, no muscle-specific geometry mapping should be marked verified.

## Validation status
- Upstream repository metadata: inspected through GitHub API.
- README and license text: inspected.
- Terminology CSV: sampled; not treated as mesh inventory.
- Binary archive: NOT downloaded or opened in this environment.
- Blender object inventory: NOT generated.
- Browser rendering: NOT performed.
- Scientific anatomy review: NOT performed.
- Production changes: none.
