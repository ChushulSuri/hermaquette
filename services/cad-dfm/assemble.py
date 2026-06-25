#!/usr/bin/env python3
"""
Full geometry assembly pipeline:
1. Generate depth map (Depth Anything V2)
2. Build relief slab from depth map
3. Build parametric plaque frame (build123d)
4. Union slab + frame in manifold3d
5. Decimate -> export STL (vendor) + GLB (web viewer)
"""
import argparse
import json
import sys
import os
import tempfile
from pathlib import Path

import numpy as np
import trimesh


def assemble(
    order_id: str,
    image_path: str,
    output_dir: str,
    params: dict,
) -> dict:
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    # Resolve params with defaults
    use_cached_depth = params.get("use_cached_depth", False)
    happy_path = params.get("happy_path", False)

    # For happy-path mode, use conservative (pre-thickened) params
    if happy_path:
        params.setdefault("text_depth_mm", 0.6)
        params.setdefault("engrave_depth_mm", 0.6)
    else:
        params.setdefault("text_depth_mm", 0.3)   # intentionally thin -> DFM FAIL demo
        params.setdefault("engrave_depth_mm", 0.5)

    params.setdefault("plaque_width_mm", 100.0)
    params.setdefault("plaque_height_mm", 80.0)
    params.setdefault("base_thickness_mm", 3.0)
    params.setdefault("relief_depth_mm", 1.5)
    params.setdefault("sink_mm", 0.3)

    # Step 1: Depth map
    depth_path = str(out / "depth.png")
    if not use_cached_depth or not Path(depth_path).exists():
        from depthmap import generate_depth_map
        depth_result = generate_depth_map(image_path, depth_path)
        print(f"[assemble] Depth map: {depth_result['source']}", file=sys.stderr)
    else:
        print("[assemble] Using cached depth map", file=sys.stderr)

    # Step 2: Relief slab
    relief_path = str(out / "relief_slab.stl")
    from relief import depth_to_relief_slab
    relief_result = depth_to_relief_slab(
        depth_path, relief_path,
        width_mm=params["plaque_width_mm"] - 10,  # inset from plaque border
        height_mm=params["plaque_height_mm"] - 10,
        max_relief_mm=params["relief_depth_mm"],
        base_mm=params["base_thickness_mm"] * 0.5,
        sink_mm=params["sink_mm"],
    )
    print(f"[assemble] Relief slab: watertight={relief_result['is_watertight']}", file=sys.stderr)

    # Step 3: Frame
    frame_path = str(out / "frame.stl")
    from frame import build_plaque_frame
    frame_result = build_plaque_frame(
        plaque_width_mm=params["plaque_width_mm"],
        plaque_height_mm=params["plaque_height_mm"],
        base_thickness_mm=params["base_thickness_mm"],
        text_depth_mm=params["text_depth_mm"],
        engrave_depth_mm=params["engrave_depth_mm"],
        output_path=frame_path,
    )
    print(f"[assemble] Frame: watertight={frame_result['is_watertight']}", file=sys.stderr)

    # Step 4: Union in manifold3d
    stl_path = str(out / "model.stl")
    glb_path = str(out / "model.glb")

    union_result = union_meshes(relief_path, frame_path, stl_path, glb_path, params)
    print(
        f"[assemble] Union: watertight={union_result['is_watertight']}, "
        f"vertices={union_result['num_vertices']}",
        file=sys.stderr,
    )

    if not union_result["is_watertight"]:
        return {
            "status": "BLOCKED",
            "reason": "Union produced non-manifold mesh — cannot manufacture",
            "order_id": order_id,
        }

    bbox = union_result["bounds_mm"]
    dims = {
        "x": round(bbox[1][0] - bbox[0][0], 2),
        "y": round(bbox[1][1] - bbox[0][1], 2),
        "z": round(bbox[1][2] - bbox[0][2], 2),
    }

    return {
        "status": "ok",
        "order_id": order_id,
        "stl_path": stl_path,
        "glb_path": glb_path,
        "dimensions_mm": dims,
        "is_watertight": union_result["is_watertight"],
        "num_vertices": union_result["num_vertices"],
        "num_faces": union_result["num_faces"],
        "params": params,
    }


def union_meshes(
    relief_path: str, frame_path: str, stl_out: str, glb_out: str, params: dict
) -> dict:
    """Union relief slab and frame using manifold3d, then decimate and export."""

    try:
        import manifold3d as m3d

        # Load meshes
        relief_mesh = trimesh.load(relief_path)
        frame_mesh = trimesh.load(frame_path)

        # Convert to manifold
        def to_manifold(mesh):
            verts = np.array(mesh.vertices, dtype=np.float64)
            tris = np.array(mesh.faces, dtype=np.int32)
            return m3d.Manifold(mesh=m3d.Mesh(vert_properties=verts, tri_verts=tris))

        m_relief = to_manifold(relief_mesh)
        m_frame = to_manifold(frame_mesh)

        # Center relief on frame
        frame_center_x = (frame_mesh.bounds[1][0] + frame_mesh.bounds[0][0]) / 2
        frame_center_y = (frame_mesh.bounds[1][1] + frame_mesh.bounds[0][1]) / 2
        frame_top_z = frame_mesh.bounds[1][2]

        relief_center_x = (relief_mesh.bounds[1][0] + relief_mesh.bounds[0][0]) / 2
        relief_center_y = (relief_mesh.bounds[1][1] + relief_mesh.bounds[0][1]) / 2

        offset_x = frame_center_x - relief_center_x
        offset_y = frame_center_y - relief_center_y
        offset_z = frame_top_z - params.get("sink_mm", 0.3)

        m_relief = m_relief.translate([offset_x, offset_y, offset_z])

        # Boolean union
        result = m_frame + m_relief

        # Convert back to trimesh
        out_mesh_data = result.to_mesh()
        verts = np.array(out_mesh_data.vert_properties)
        faces = np.array(out_mesh_data.tri_verts)
        combined = trimesh.Trimesh(vertices=verts, faces=faces, process=True)

    except Exception as e:
        print(
            f"[assemble] manifold3d union failed ({e}), falling back to trimesh merge",
            file=sys.stderr,
        )
        # Fallback: just merge the meshes (not a true union, but keeps pipeline alive)
        combined = trimesh.util.concatenate([
            trimesh.load(relief_path),
            trimesh.load(frame_path),
        ])

    # Decimate to target ~50k faces for GLB
    target_faces = 50_000
    if len(combined.faces) > target_faces:
        ratio = target_faces / len(combined.faces)
        try:
            combined = combined.simplify_quadric_decimation(
                int(len(combined.faces) * ratio)
            )
        except Exception as e:
            print(f"[assemble] Decimation failed: {e}", file=sys.stderr)

    # Export
    combined.export(stl_out)
    combined.export(glb_out)

    return {
        "is_watertight": bool(combined.is_watertight),
        "num_vertices": len(combined.vertices),
        "num_faces": len(combined.faces),
        "bounds_mm": combined.bounds.tolist(),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--order-id", required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--params", default="{}")
    args = parser.parse_args()

    params = json.loads(args.params)
    result = assemble(args.order_id, args.image, args.output_dir, params)
    print(json.dumps(result))
    if result.get("status") == "BLOCKED":
        sys.exit(1)
