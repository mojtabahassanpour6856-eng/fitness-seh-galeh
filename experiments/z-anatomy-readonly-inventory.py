# Z-Anatomy read-only inventory for Blender 3.5+
# Does NOT modify objects, mesh data, visibility, collections, or save the .blend file.
# Run from Blender's Scripting workspace after opening the Z-Anatomy .blend file.

import bpy, json, csv, os, re
from mathutils import Vector

OUT_DIR = bpy.path.abspath("//")
PREFIX = "z_anatomy_inventory"
TERMS = (
    "pector", "thorac", "sternocostal", "clavicular", "chest",
    "breast", "mammary", "pectoral", "muscul"
)

def clean(v):
    try:
        return str(v)
    except Exception:
        return repr(v)

def world_bounds(obj):
    try:
        pts = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
        mins = [min(p[i] for p in pts) for i in range(3)]
        maxs = [max(p[i] for p in pts) for i in range(3)]
        return {"min": [round(x, 6) for x in mins],
                "max": [round(x, 6) for x in maxs]}
    except Exception:
        return None

def object_record(obj):
    data = obj.data if obj.type == "MESH" else None
    name_blob = " ".join([
        obj.name, clean(obj.data.name) if obj.data else "",
        " ".join(c.name for c in obj.users_collection)
    ]).lower()
    candidate = any(term in name_blob for term in TERMS)
    rec = {
        "object_name": obj.name,
        "data_name": obj.data.name if obj.data else None,
        "type": obj.type,
        "parent": obj.parent.name if obj.parent else None,
        "collections": sorted(c.name for c in obj.users_collection),
        "visible_viewport": bool(obj.visible_get()),
        "hide_viewport": bool(obj.hide_viewport),
        "hide_render": bool(obj.hide_render),
        "dimensions_world": [round(float(x), 6) for x in obj.dimensions],
        "world_bounds": world_bounds(obj),
        "material_names": [m.name if m else None for m in (obj.data.materials if obj.data else [])],
        "modifiers": [{"name": m.name, "type": m.type} for m in obj.modifiers],
        "candidate_by_name": candidate
    }
    if data:
        rec.update({
            "vertices": len(data.vertices),
            "edges": len(data.edges),
            "polygons": len(data.polygons),
            "triangles": sum(max(0, len(p.vertices)-2) for p in data.polygons),
            "mesh_users": int(data.users),
            "vertex_groups": [g.name for g in obj.vertex_groups]
        })
    return rec

objects = sorted(list(bpy.data.objects), key=lambda o: o.name.lower())
records = [object_record(o) for o in objects]
meshes = [r for r in records if r["type"] == "MESH"]
candidates = [r for r in records if r["candidate_by_name"]]

payload = {
    "report_type": "read_only_z_anatomy_object_inventory",
    "blender_version": bpy.app.version_string,
    "blend_file": bpy.data.filepath,
    "scene": bpy.context.scene.name if bpy.context.scene else None,
    "object_count": len(records),
    "mesh_object_count": len(meshes),
    "candidate_count": len(candidates),
    "candidate_terms": list(TERMS),
    "important_warning": "Name-based candidates are search hints only; they do not prove anatomical identity or independent muscle geometry.",
    "objects": records
}
json_path = os.path.join(OUT_DIR, PREFIX + ".json")
candidate_path = os.path.join(OUT_DIR, PREFIX + "_candidates.csv")
with open(json_path, "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, indent=2)

columns = [
    "object_name", "data_name", "type", "parent", "collections",
    "vertices", "edges", "polygons", "triangles", "mesh_users",
    "dimensions_world", "world_bounds", "material_names",
    "visible_viewport", "hide_viewport", "hide_render",
    "candidate_by_name"
]
with open(candidate_path, "w", newline="", encoding="utf-8-sig") as f:
    writer = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    for row in candidates:
        row = dict(row)
        for k in ("collections", "dimensions_world", "world_bounds", "material_names"):
            row[k] = json.dumps(row.get(k), ensure_ascii=False)
        writer.writerow(row)

print("\n=== Z-ANATOMY INVENTORY COMPLETE (READ ONLY) ===")
print("Blender:", bpy.app.version_string)
print("Objects:", len(records), "| Mesh objects:", len(meshes), "| Name candidates:", len(candidates))
print("JSON:", json_path)
print("Candidate CSV:", candidate_path)
print("IMPORTANT: candidates require anatomical verification; names alone are not proof.")
