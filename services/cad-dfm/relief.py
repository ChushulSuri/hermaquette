#!/usr/bin/env python3
"""
Converts a depth map image into a closed, watertight relief mesh slab.
The slab has side walls and a bottom face — essential for manifold3d union.
Relief depth is clamped to max_relief_mm.
"""
import numpy as np
from PIL import Image, ImageFilter
import trimesh
import json
import sys
from pathlib import Path


def depth_to_relief_slab(
    depth_path: str,
    output_path: str,
    width_mm: float = 90.0,
    height_mm: float = 70.0,
    max_relief_mm: float = 1.5,
    base_mm: float = 0.5,          # bottom thickness below zero plane
    sink_mm: float = 0.3,           # how much slab sinks into the plaque (creates overlap for clean union)
    grid_size: int = 256,
    min_island_area_px: int = 50,   # strip tiny noisy islands from depth
) -> dict:
    """Generate a closed relief mesh slab from a depth map."""

    # Load and preprocess depth map
    depth_img = Image.open(depth_path).convert("L")
    depth_img = depth_img.resize((grid_size, grid_size), Image.LANCZOS)

    # Additional blur to soften depth transitions
    depth_img = depth_img.filter(ImageFilter.GaussianBlur(radius=0.8))
    depth_arr = np.array(depth_img, dtype=np.float32) / 255.0

    # Clamp: avoid deep pits at dark areas
    depth_arr = np.clip(depth_arr, 0.05, 1.0)

    # Scale to relief depth in mm
    relief_arr = depth_arr * max_relief_mm

    nx, ny = grid_size, grid_size
    dx = width_mm / (nx - 1)
    dy = height_mm / (ny - 1)

    # Build vertex grid: top face (relief surface) + bottom face (flat)
    # Vertices laid out as: [top_grid, bottom_grid, side_verts]
    # Top face Z = relief_arr[y, x] (raised geometry)
    # Bottom face Z = -base_mm (constant flat bottom)

    # Top grid vertices
    top_verts = []
    for y in range(ny):
        for x in range(nx):
            top_verts.append([x * dx, y * dy, relief_arr[y, x]])
    top_verts = np.array(top_verts, dtype=np.float64)

    # Bottom grid vertices (same XY, Z = -base_mm)
    bot_verts = top_verts.copy()
    bot_verts[:, 2] = -base_mm

    all_verts = np.vstack([top_verts, bot_verts])
    N = nx * ny

    # Helper: grid index
    def idx(x, y): return y * nx + x

    faces = []

    # Top face quads -> triangles
    for y in range(ny - 1):
        for x in range(nx - 1):
            tl, tr = idx(x, y), idx(x+1, y)
            bl, br = idx(x, y+1), idx(x+1, y+1)
            faces.append([tl, tr, br])
            faces.append([tl, br, bl])

    # Bottom face (flipped winding for outward normal)
    for y in range(ny - 1):
        for x in range(nx - 1):
            tl, tr = N + idx(x, y), N + idx(x+1, y)
            bl, br = N + idx(x, y+1), N + idx(x+1, y+1)
            faces.append([tl, br, tr])
            faces.append([tl, bl, br])

    # Side walls
    # Left (x=0)
    for y in range(ny - 1):
        t0, t1 = idx(0, y), idx(0, y+1)
        b0, b1 = N + idx(0, y), N + idx(0, y+1)
        faces.append([t0, b0, b1])
        faces.append([t0, b1, t1])
    # Right (x=nx-1)
    for y in range(ny - 1):
        t0, t1 = idx(nx-1, y), idx(nx-1, y+1)
        b0, b1 = N + idx(nx-1, y), N + idx(nx-1, y+1)
        faces.append([t0, b1, b0])
        faces.append([t0, t1, b1])
    # Front (y=0)
    for x in range(nx - 1):
        t0, t1 = idx(x, 0), idx(x+1, 0)
        b0, b1 = N + idx(x, 0), N + idx(x+1, 0)
        faces.append([t0, b1, b0])
        faces.append([t0, t1, b1])
    # Back (y=ny-1)
    for x in range(nx - 1):
        t0, t1 = idx(x, ny-1), idx(x+1, ny-1)
        b0, b1 = N + idx(x, ny-1), N + idx(x+1, ny-1)
        faces.append([t0, b0, b1])
        faces.append([t0, b1, t1])

    faces = np.array(faces, dtype=np.int64)

    mesh = trimesh.Trimesh(vertices=all_verts, faces=faces, process=True)

    # Shift Z down by sink_mm so top of relief is flush with plaque surface
    mesh.apply_translation([0, 0, -sink_mm])

    if not mesh.is_watertight:
        mesh = trimesh.repair.fill_holes(mesh)

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    mesh.export(output_path)

    return {
        "output_path": output_path,
        "is_watertight": bool(mesh.is_watertight),
        "num_vertices": len(mesh.vertices),
        "num_faces": len(mesh.faces),
        "bounds_mm": mesh.bounds.tolist(),
    }


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--depth", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--width-mm", type=float, default=90.0)
    parser.add_argument("--height-mm", type=float, default=70.0)
    parser.add_argument("--max-relief-mm", type=float, default=1.5)
    parser.add_argument("--grid-size", type=int, default=256)
    args = parser.parse_args()
    result = depth_to_relief_slab(
        args.depth, args.output, args.width_mm, args.height_mm,
        args.max_relief_mm, grid_size=args.grid_size,
    )
    print(json.dumps(result))
