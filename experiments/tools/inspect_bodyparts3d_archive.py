#!/usr/bin/env python3
"""Audit official BodyParts3D 4.0 OBJ files against the project's candidate registry.

This is an experiment-only, read-only archive inspector. It does not modify source
assets, production code, trainee records, or the archive. Matching is deliberately
strict: a candidate is matched only when its FMA or BP identifier occurs in the
OBJ member path or header. ELEMENT FileID mappings that are not explicit remain
unmatched for manual/catalog reconciliation; filenames are never guessed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import zipfile
from collections import Counter
from pathlib import Path

ID_RE = re.compile(r"\b(?:FMA\d+|BP\d+)\b", re.IGNORECASE)


def sha256_stream(stream):
    h = hashlib.sha256()
    for block in iter(lambda: stream.read(1024 * 1024), b""):
        h.update(block)
    return h.hexdigest()


def inspect_obj(zf: zipfile.ZipFile, member: str):
    vertices = []
    face_count = 0
    triangle_count = 0
    max_vertex_ref = 0
    min_vertex_ref = None
    groups, objects, header = set(), set(), []
    invalid_numbers = 0
    with zf.open(member) as raw:
        digest = sha256_stream(raw)
    with zf.open(member) as raw:
        for raw_line in raw:
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            if line.startswith("#"):
                if len(header) < 120:
                    header.append(line[:500])
                continue
            if line.startswith("v "):
                parts = line.split()
                if len(parts) >= 4:
                    try:
                        xyz = tuple(float(v) for v in parts[1:4])
                        if all(math.isfinite(v) for v in xyz):
                            vertices.append(xyz)
                        else:
                            invalid_numbers += 1
                    except ValueError:
                        invalid_numbers += 1
            elif line.startswith("f "):
                refs = line.split()[1:]
                if len(refs) >= 3:
                    face_count += 1
                    triangle_count += len(refs) - 2
                    for ref in refs:
                        try:
                            idx = int(ref.split("/")[0])
                            if idx < 0:
                                idx = len(vertices) + idx + 1
                            max_vertex_ref = max(max_vertex_ref, idx)
                            min_vertex_ref = idx if min_vertex_ref is None else min(min_vertex_ref, idx)
                        except (ValueError, IndexError):
                            invalid_numbers += 1
            elif line.startswith("g "):
                groups.add(line[2:].strip())
            elif line.startswith("o "):
                objects.add(line[2:].strip())

    if vertices:
        mins = [min(v[i] for v in vertices) for i in range(3)]
        maxs = [max(v[i] for v in vertices) for i in range(3)]
        bounds = {"min": mins, "max": maxs, "size": [maxs[i] - mins[i] for i in range(3)]}
    else:
        bounds = None
    return {
        "member": member,
        "sha256": digest,
        "vertex_count": len(vertices),
        "face_count": face_count,
        "triangulated_face_count": triangle_count,
        "bounds": bounds,
        "object_names": sorted(objects),
        "group_names": sorted(groups),
        "header": header,
        "invalid_numeric_or_face_refs": invalid_numbers,
        "max_vertex_reference": max_vertex_ref,
        "min_vertex_reference": min_vertex_ref,
        "basic_geometry_valid": bool(vertices and face_count and not invalid_numbers
                                     and max_vertex_ref <= len(vertices)
                                     and (min_vertex_ref is None or min_vertex_ref >= 1)),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("archive", type=Path, help="Official isa_BP3D_4.0_obj_99.zip")
    ap.add_argument("--registry", type=Path,
                    default=Path("experiments/ANATOMY_BODYPARTS3D_4_CANDIDATES.json"))
    ap.add_argument("--out", type=Path, default=Path("bodyparts3d-audit-output"))
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    registry = json.loads(args.registry.read_text(encoding="utf-8"))
    candidates = registry["candidates"]
    with args.archive.open("rb") as f:
        archive_sha = sha256_stream(f)

    rows = []
    with zipfile.ZipFile(args.archive) as zf:
        obj_members = [n for n in zf.namelist() if n.lower().endswith(".obj")]
        for member in obj_members:
            # Read identifiers from path and the first 120 comment lines only.
            with zf.open(member) as raw:
                header_lines = []
                for raw_line in raw:
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if line.startswith("#"):
                        header_lines.append(line[:500])
                    elif line:
                        break
                    if len(header_lines) >= 120:
                        break
            id_tokens = {x.upper() for x in ID_RE.findall(member + " " + " ".join(header_lines))}
            mesh = inspect_obj(zf, member)
            mesh["identifier_tokens"] = sorted(id_tokens)
            matches = []
            for c in candidates:
                wanted = {c["fma"].upper(), c["representation"].upper()}
                if c.get("paired_fma"):
                    wanted.add(c["paired_fma"].upper())
                if c.get("paired_representation"):
                    wanted.add(c["paired_representation"].upper())
                hit = sorted(id_tokens & wanted)
                if hit:
                    matches.append({"candidate": c["name"], "matched_ids": hit})
            mesh["candidate_matches"] = matches
            rows.append(mesh)

    matched = Counter()
    for row in rows:
        for item in row["candidate_matches"]:
            matched[item["candidate"]] += 1

    candidate_status = []
    for c in candidates:
        n = matched[c["name"]]
        candidate_status.append({
            "name": c["name"], "display": c["display"], "fma": c["fma"],
            "representation": c["representation"], "paired_fma": c.get("paired_fma"),
            "paired_representation": c.get("paired_representation"),
            "matching_obj_count": n,
            "status": "candidate_obj_found_needs_visual_review" if n else "not_mapped_by_explicit_ids"
        })

    report = {
        "schema": "bodyparts3d-obj-audit-v1",
        "source_archive": args.archive.name,
        "archive_size_bytes": args.archive.stat().st_size,
        "archive_sha256": archive_sha,
        "mesh_package_expected": "official LSDB BodyParts3D 4.0 IS-A, 99% reduction",
        "obj_member_count": len(rows),
        "basic_geometry_valid_count": sum(r["basic_geometry_valid"] for r in rows),
        "candidate_count": len(candidates),
        "candidate_obj_found_count": sum(x["matching_obj_count"] > 0 for x in candidate_status),
        "warning": "Identifier matches are not anatomical verification. No left/right, depth, isolation, or clinical correctness is inferred.",
        "candidates": candidate_status,
        "meshes": rows
    }
    (args.out / "bodyparts3d-audit.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "archive_sha256": archive_sha,
        "obj_member_count": len(rows),
        "basic_geometry_valid_count": report["basic_geometry_valid_count"],
        "candidate_obj_found_count": report["candidate_obj_found_count"],
        "output": str(args.out / "bodyparts3d-audit.json")
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
