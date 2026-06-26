#!/usr/bin/env python3
"""
Mesh repair pipeline for AI-generated 3D models.

Deterministic repair macro (applied in order):
  1. fill_holes — fill small holes using trimesh/manifold3d
  2. make_watertight — ensure closed manifold using manifold3d
  3. remove_small_components — keep largest body, drop floaters
  4. rescale_to_target_mm — scale longest dim to target_mm (default 80mm)
  5. decimate_to_ceiling — reduce triangles if > max_triangles

Wall thicken is OFF by default (hero figure is printable-by-construction).

Returns:
  {
    "status": "PASS" | "FIXABLE" | "BLOCKED",
    "reason": str,
    "applied_repairs": [...],
    "mesh_checks": { is_watertight, volume_mm3, dimensions_mm, triangle_count, component_count },
    "repaired_stl_path": str | None,
    "original_stats": {...}
  }
"""
import argparse
import json
import sys
import hashlib
from pathlib import Path

import numpy as np
import trimesh


PA12_BUILD_VOLUME_MM = [300, 300, 300]
DEFAULT_TARGET_MM = 80.0
DEFAULT_MAX_TRIANGLES = 200_000


def _mesh_stats(mesh):
    """Compute stats dict for a mesh."""
    try:
        components = trimesh.graph.connected_components(mesh.face_adjacency)
        component_count = len(components)
    except Exception:
        component_count = 1

    bounds = mesh.bounds
    dims = (bounds[1] - bounds[0]).tolist() if bounds is not None else [0, 0, 0]
    volume = float(mesh.volume) if mesh.is_watertight else 0.0

    return {
        "is_watertight": bool(mesh.is_watertight),
        "volume_mm3": round(abs(volume), 3),
        "dimensions_mm": [round(d, 2) for d in dims],
        "triangle_count": len(mesh.faces),
        "component_count": component_count,
    }


def _load_mesh(stl_path):
    """Load a mesh from STL/GLB/OBJ path."""
    mesh = trimesh.load(str(stl_path), force='mesh')
    if isinstance(mesh, trimesh.Scene):
        mesh = trimesh.util.concatenate(list(mesh.geometry.values()))
    return mesh


def _fill_holes_and_watertight(mesh):
    """Fill holes and make watertight using manifold3d."""
    try:
        import manifold3d as m3d
        # Convert to manifold and back — this auto-repairs topology
        vertices = mesh.vertices.tolist()
        faces = mesh.faces.tolist()
        mani = m3d.Manifold.compose([
            m3d.Manifold(m3d.Mesh(vert_properties=np.array(vertices, dtype=float),
                                   tri_verts=np.array(faces, dtype=int)))
        ])
        result_mesh_data = mani.to_mesh()
        repaired = trimesh.Trimesh(
            vertices=np.array(result_mesh_data.vert_properties),
            faces=np.array(result_mesh_data.tri_verts),
            process=False
        )
        return repaired, "manifold3d_repair"
    except Exception as e:
        # Fall back to trimesh fill_holes
        try:
            mesh.fill_holes()
            trimesh.repair.fill_holes(mesh)
            return mesh, "trimesh_fill_holes"
        except Exception:
            return mesh, "no_repair_available"


def _remove_small_components(mesh):
    """Keep only the largest connected component."""
    try:
        components = trimesh.graph.connected_components(mesh.face_adjacency)
        if len(components) <= 1:
            return mesh, 0
        removed = len(components) - 1
        # Keep largest component
        largest_idx = max(components, key=len)
        mesh = mesh.submesh([largest_idx], append=True)
        return mesh, removed
    except Exception:
        return mesh, 0


def _rescale_to_target(mesh, target_mm):
    """Scale so the longest dimension = target_mm."""
    bounds = mesh.bounds
    dims = bounds[1] - bounds[0]
    longest = float(dims.max())
    if longest <= 0:
        return mesh, 1.0
    scale = target_mm / longest
    mesh.apply_scale(scale)
    return mesh, scale


def _decimate_to_ceiling(mesh, max_triangles):
    """Reduce triangle count if above ceiling."""
    n = len(mesh.faces)
    if n <= max_triangles:
        return mesh, 0
    ratio = max_triangles / n
    try:
        mesh = mesh.simplify_quadric_decimation(max_triangles)
        return mesh, n - len(mesh.faces)
    except Exception:
        return mesh, 0


def repair_mesh(stl_path: str, opts: dict = None) -> dict:
    """
    Verify and repair an AI-generated mesh for 3D printing.

    Returns structured PASS/FIXABLE/BLOCKED result.
    """
    opts = opts or {}
    target_mm = float(opts.get('target_mm', DEFAULT_TARGET_MM))
    max_triangles = int(opts.get('max_triangles', DEFAULT_MAX_TRIANGLES))

    # Load mesh
    try:
        mesh = _load_mesh(stl_path)
    except Exception as e:
        return {
            "status": "BLOCKED",
            "reason": f"Cannot load mesh: {e}",
            "applied_repairs": [],
            "mesh_checks": {},
            "repaired_stl_path": None,
            "original_stats": {},
        }

    # Original stats
    original_stats = _mesh_stats(mesh)
    applied_repairs = []

    # Sanity: reject degenerate meshes early
    if len(mesh.faces) < 10:
        return {
            "status": "BLOCKED",
            "reason": f"Mesh has only {len(mesh.faces)} faces — degenerate/empty",
            "applied_repairs": [],
            "mesh_checks": original_stats,
            "repaired_stl_path": None,
            "original_stats": original_stats,
        }

    # Step 1+2: Fill holes + make watertight
    if not mesh.is_watertight:
        mesh, repair_method = _fill_holes_and_watertight(mesh)
        applied_repairs.append(f"fill_holes+watertight ({repair_method})")

    # Step 3: Remove small components
    mesh, removed_count = _remove_small_components(mesh)
    if removed_count > 0:
        applied_repairs.append(f"remove_small_components (removed {removed_count})")

    # Step 4: Rescale to target
    mesh, scale = _rescale_to_target(mesh, target_mm)
    if abs(scale - 1.0) > 0.01:
        applied_repairs.append(f"rescale_to_{target_mm}mm (factor {scale:.3f})")

    # Step 5: Decimate
    mesh, decimated = _decimate_to_ceiling(mesh, max_triangles)
    if decimated > 0:
        applied_repairs.append(f"decimate (removed {decimated} triangles)")

    # Final checks
    final_stats = _mesh_stats(mesh)

    # BLOCKED conditions
    if not mesh.is_watertight and final_stats["volume_mm3"] == 0:
        return {
            "status": "BLOCKED",
            "reason": "Mesh is non-watertight and has zero volume after repair attempts",
            "applied_repairs": applied_repairs,
            "mesh_checks": final_stats,
            "repaired_stl_path": None,
            "original_stats": original_stats,
        }

    dims = final_stats["dimensions_mm"]
    if any(dims[i] > PA12_BUILD_VOLUME_MM[i] for i in range(3)):
        return {
            "status": "BLOCKED",
            "reason": f"Mesh exceeds build volume {PA12_BUILD_VOLUME_MM}mm after rescale",
            "applied_repairs": applied_repairs,
            "mesh_checks": final_stats,
            "repaired_stl_path": None,
            "original_stats": original_stats,
        }

    # Save repaired mesh
    repaired_path = str(Path(stl_path).with_suffix('')) + '_repaired.stl'
    try:
        mesh.export(repaired_path)
    except Exception as e:
        return {
            "status": "BLOCKED",
            "reason": f"Cannot export repaired mesh: {e}",
            "applied_repairs": applied_repairs,
            "mesh_checks": final_stats,
            "repaired_stl_path": None,
            "original_stats": original_stats,
        }

    status = "PASS" if not applied_repairs else "FIXABLE"
    # After repairs, check if it passes
    if applied_repairs and final_stats["is_watertight"] and final_stats["volume_mm3"] > 0:
        status = "PASS"
    elif not final_stats["is_watertight"]:
        status = "FIXABLE"

    return {
        "status": status,
        "reason": f"Repairs applied: {', '.join(applied_repairs)}" if applied_repairs else "Mesh passes all checks",
        "applied_repairs": applied_repairs,
        "mesh_checks": final_stats,
        "repaired_stl_path": repaired_path,
        "original_stats": original_stats,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--stl", required=True)
    parser.add_argument("--target-mm", type=float, default=DEFAULT_TARGET_MM)
    parser.add_argument("--max-triangles", type=int, default=DEFAULT_MAX_TRIANGLES)
    args = parser.parse_args()

    result = repair_mesh(args.stl, {
        "target_mm": args.target_mm,
        "max_triangles": args.max_triangles,
    })
    print(json.dumps(result))
    sys.exit(0)
