# Z-Anatomy: exact-name pectoralis inspection and isolated GLB export
# Blender 3.5+. Opens an existing Startup.blend; never saves/modifies it.
import bpy, os, json
from datetime import datetime, timezone

OUT_DIR = os.path.join(bpy.path.abspath("//"), "z_anatomy_pectoralis_export_v2")
os.makedirs(OUT_DIR, exist_ok=True)

# Exact object names reported in a Z-Anatomy-derived sourceObjects manifest.
# Each logical ID maps to ONE exact source object; no fallback or fuzzy matching.
TARGETS = [
    ("pectoralis_major_clavicular_left", "Clavicular head of pectoralis major muscle.l"),
    ("pectoralis_major_sternocostal_left", "Sternocostal head of pectoralis major muscle.l"),
    ("pectoralis_major_abdominal_left", "(Abdominal part of pectoralis major muscle).l"),
    ("pectoralis_major_clavicular_right", "Clavicular head of pectoralis major muscle.r"),
    ("pectoralis_major_sternocostal_right", "Sternocostal head of pectoralis major muscle.r"),
    ("pectoralis_major_abdominal_right", "(Abdominal part of pectoralis major muscle).r"),
    ("pectoralis_minor_left", "Pectoralis minor muscle.l"),
    ("pectoralis_minor_right", "Pectoralis minor muscle.r"),
]

def inspect(obj):
    mesh = obj.data if obj.type == "MESH" else None
    return {
        "object_name": obj.name,
        "data_name": obj.data.name if obj.data else None,
        "type": obj.type,
        "parent": obj.parent.name if obj.parent else None,
        "collections": sorted(c.name for c in obj.users_collection),
        "visible": bool(obj.visible_get()),
        "hide_viewport": bool(obj.hide_viewport),
        "hide_render": bool(obj.hide_render),
        "vertices": len(mesh.vertices) if mesh else None,
        "edges": len(mesh.edges) if mesh else None,
        "polygons": len(mesh.polygons) if mesh else None,
        "triangles": sum(max(0, len(p.vertices)-2) for p in mesh.polygons) if mesh else None,
        "materials": [m.name if m else None for m in obj.data.materials] if obj.data else [],
        "modifiers": [{"name": m.name, "type": m.type} for m in obj.modifiers],
        "dimensions": [round(float(v), 6) for v in obj.dimensions],
        "location": [round(float(v), 6) for v in obj.location],
    }

report = {
    "report_type": "exact_name_pectoralis_export_v2",
    "created_utc": datetime.now(timezone.utc).isoformat(),
    "blender_version": bpy.app.version_string,
    "blend_file": bpy.data.filepath,
    "source_zip_sha256_expected": "e029688545627bd0214b269e1063143abb580aad72b2c2445d6d8a9a0d9da736",
    "source_commit_expected": "8f1435d8e43d231a3a32a61eacbe617ead8f7f51",
    "attribution": [
        "Z-Anatomy - The libre 3D atlas of anatomy - CC-BY-SA 4.0",
        "BodyParts3D - The Database Center for Life Science - CC-BY-SA 2.1 Japan"
    ],
    "license": "CC BY-SA 4.0; derived model assets must retain attribution and ShareAlike.",
    "warning": "Names are source-object evidence only. Export success does not validate anatomical boundaries, layer depth, or clinical accuracy.",
    "results": []
}

old_active = bpy.context.view_layer.objects.active
old_selected = list(bpy.context.selected_objects)

for logical_id, exact_name in TARGETS:
    obj = bpy.data.objects.get(exact_name)
    row = {"logical_id": logical_id, "expected_object_name": exact_name,
           "found": obj is not None, "object": inspect(obj) if obj else None,
           "export": None}
    report["results"].append(row)
    if not obj:
        continue
    if obj.type != "MESH":
        row["export"] = {"status": "skipped_non_mesh"}
        continue

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    path = os.path.join(OUT_DIR, logical_id + ".glb")
    try:
        result = bpy.ops.export_scene.gltf(
            filepath=path, export_format="GLB", use_selection=True,
            export_apply=False, export_yup=True,
            export_cameras=False, export_lights=False,
            export_animations=False, export_skins=False,
            export_morph=False, export_materials="EXPORT",
            export_extras=True
        )
        ok = "FINISHED" in result and os.path.isfile(path)
        row["export"] = {
            "status": "exported" if ok else "operator_not_finished",
            "operator_result": sorted(list(result)),
            "file": os.path.basename(path) if ok else None,
            "bytes": os.path.getsize(path) if ok else None
        }
    except Exception as exc:
        row["export"] = {"status": "error", "error": repr(exc)}

# Restore selection and active object.
bpy.ops.object.select_all(action="DESELECT")
for item in old_selected:
    if bpy.data.objects.get(item.name):
        item.select_set(True)
if old_active and bpy.data.objects.get(old_active.name):
    bpy.context.view_layer.objects.active = old_active

manifest_path = os.path.join(OUT_DIR, "pectoralis-export-manifest-v2.json")
with open(manifest_path, "w", encoding="utf-8") as f:
    json.dump(report, f, ensure_ascii=False, indent=2)

print("\n=== PECTORALIS EXACT-NAME RESULTS ===")
for row in report["results"]:
    print(row["logical_id"], "FOUND" if row["found"] else "NOT FOUND",
          row["export"]["status"] if row["export"] else "")
print("Manifest:", manifest_path)
print("Output:", OUT_DIR)
