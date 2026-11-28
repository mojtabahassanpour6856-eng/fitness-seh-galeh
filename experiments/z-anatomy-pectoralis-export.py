# Z-Anatomy pectoralis focused inspection + isolated GLB export
# Blender 3.5+; read-only with respect to the source .blend.
# Exports only exact source objects listed below, one object per GLB.
# Does not join, cut, decimate, rename, or save the source blend file.

import bpy, os, json, re, hashlib
from datetime import datetime, timezone

OUT_DIR = os.path.join(bpy.path.abspath("//"), "z_anatomy_pectoralis_export")
os.makedirs(OUT_DIR, exist_ok=True)

# Names independently corroborated in a published Z-Anatomy-derived manifest.
TARGETS = [
    ("pectoralis_major_clavicular_left", "(Abdominal part of pectoralis major muscle).l", "Clavicular head of pectoralis major muscle.l"),
    ("pectoralis_major_sternocostal_left", "(Abdominal part of pectoralis major muscle).l", "Sternocostal head of pectoralis major muscle.l"),
    ("pectoralis_major_abdominal_left", "(Abdominal part of pectoralis major muscle).l",),
    ("pectoralis_major_clavicular_right", "(Abdominal part of pectoralis major muscle).r", "Clavicular head of pectoralis major muscle.r"),
    ("pectoralis_major_sternocostal_right", "(Abdominal part of pectoralis major muscle).r", "Sternocostal head of pectoralis major muscle.r"),
    ("pectoralis_major_abdominal_right", "(Abdominal part of pectoralis major muscle).r",),
    ("pectoralis_minor_left", "Pectoralis minor muscle.l"),
    ("pectoralis_minor_right", "Pectoralis minor muscle.r"),
]

def object_info(obj):
    data = obj.data if obj.type == "MESH" else None
    return {
        "object_name": obj.name,
        "data_name": obj.data.name if obj.data else None,
        "type": obj.type,
        "parent": obj.parent.name if obj.parent else None,
        "collections": sorted(c.name for c in obj.users_collection),
        "visible": bool(obj.visible_get()),
        "hide_viewport": bool(obj.hide_viewport),
        "hide_render": bool(obj.hide_render),
        "vertices": len(data.vertices) if data else None,
        "edges": len(data.edges) if data else None,
        "polygons": len(data.polygons) if data else None,
        "triangles": sum(max(0, len(p.vertices)-2) for p in data.polygons) if data else None,
        "materials": [m.name if m else None for m in obj.data.materials] if obj.data else [],
        "modifiers": [{"name": m.name, "type": m.type} for m in obj.modifiers],
        "dimensions": [round(float(x), 6) for x in obj.dimensions],
        "location": [round(float(x), 6) for x in obj.location],
    }

report = {
    "report_type": "z_anatomy_pectoralis_exact_object_export",
    "created_utc": datetime.now(timezone.utc).isoformat(),
    "blender_version": bpy.app.version_string,
    "blend_file": bpy.data.filepath,
    "source_sha256": "e029688545627bd0214b269e1063143abb580aad72b2c2445d6d8a9a0d9da736",
    "source_commit": "8f1435d8e43d231a3a32a61eacbe617ead8f7f51",
    "source_license": "CC BY-SA 4.0; derived exports must retain required attribution and ShareAlike terms.",
    "source_attribution": [
        "Z-Anatomy - The libre 3D atlas of anatomy - CC-BY-SA 4.0",
        "BodyParts3D - The Database Center for Life Science - CC-BY-SA 2.1 Japan"
    ],
    "warning": "Exact object names are source-data candidates, not independent clinical/anatomical validation. No new anatomical segmentation was created by this script.",
    "objects": [],
    "exports": []
}

# Avoid changing user's current selection/context permanently.
old_active = bpy.context.view_layer.objects.active
old_selected = list(bpy.context.selected_objects)

for logical_id, *candidate_names in TARGETS:
    found = []
    for name in candidate_names:
        obj = bpy.data.objects.get(name)
        if obj and obj not in found:
            found.append(obj)
    # Some source names may be represented with alternate punctuation/case.
    if not found:
        wanted = [n.lower().replace(" ", "") for n in candidate_names]
        for obj in bpy.data.objects:
            normalized = obj.name.lower().replace(" ", "")
            if any(w in normalized for w in wanted):
                found.append(obj)
    entry = {"logical_id": logical_id, "candidate_names": list(candidate_names),
             "matched_objects": [object_info(o) for o in found], "exported_files": []}
    report["objects"].append(entry)

    for index, obj in enumerate(found):
        if obj.type not in {"MESH", "CURVE"}:
            continue
        # Select only this exact object. Do not apply modifiers or alter mesh data.
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        suffix = "" if len(found) == 1 else "_match_" + str(index + 1)
        filename = logical_id + suffix + ".glb"
        filepath = os.path.join(OUT_DIR, filename)
        result = bpy.ops.export_scene.gltf(
            filepath=filepath,
            export_format="GLB",
            use_selection=True,
            export_apply=False,
            export_yup=True,
            export_cameras=False,
            export_lights=False,
            export_animations=False,
            export_skins=False,
            export_morph=False,
            export_materials="EXPORT",
            export_extras=True
        )
        ok = "FINISHED" in result and os.path.exists(filepath)
        entry["exported_files"].append({
            "file": filename if ok else None,
            "result": sorted(list(result)),
            "bytes": os.path.getsize(filepath) if ok else None
        })
        if ok:
            report["exports"].append({"logical_id": logical_id, "object_name": obj.name,
                                      "file": filename, "bytes": os.path.getsize(filepath)})

# Restore original selection/active object.
bpy.ops.object.select_all(action="DESELECT")
for obj in old_selected:
    if bpy.data.objects.get(obj.name):
        obj.select_set(True)
if old_active and bpy.data.objects.get(old_active.name):
    bpy.context.view_layer.objects.active = old_active

json_path = os.path.join(OUT_DIR, "pectoralis-export-manifest.json")
with open(json_path, "w", encoding="utf-8") as f:
    json.dump(report, f, ensure_ascii=False, indent=2)

print("\n=== PECTORALIS SOURCE OBJECT REPORT ===")
for row in report["objects"]:
    print(row["logical_id"], "=>", [x["object_name"] for x in row["matched_objects"]])
print("GLB exports:", len(report["exports"]))
print("Output folder:", OUT_DIR)
print("Manifest:", json_path)
print("NOTE: inspect every GLB visually; successful export is not anatomical approval.")
