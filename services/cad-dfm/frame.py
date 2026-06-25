#!/usr/bin/env python3
"""
Parametric plaque frame using build123d.
Creates: base plate + back engraving + border.
B-rep stays in build123d; mesh exported for manifold3d union.
"""
import json
import sys
import os
import tempfile
from pathlib import Path
import trimesh
import numpy as np


def build_plaque_frame(
    plaque_width_mm: float = 100.0,
    plaque_height_mm: float = 80.0,
    base_thickness_mm: float = 3.0,
    border_width_mm: float = 5.0,
    text: str = "HERMAQUETTE",
    text_depth_mm: float = 0.3,      # intentionally thin for DFM fail demo
    engrave_depth_mm: float = 0.5,
    font_path: str = None,
    output_path: str = None,
) -> dict:
    """Build the plaque frame B-rep and export as STL mesh."""

    try:
        import build123d as bd
        return _build_with_build123d(
            plaque_width_mm, plaque_height_mm, base_thickness_mm,
            border_width_mm, text, text_depth_mm, engrave_depth_mm,
            font_path, output_path
        )
    except ImportError:
        print("[frame] build123d not available, using trimesh primitive fallback", file=sys.stderr)
        return _build_fallback(plaque_width_mm, plaque_height_mm, base_thickness_mm, output_path)


def _build_with_build123d(
    width, height, thickness, border_width, text, text_depth, engrave_depth,
    font_path, output_path
):
    import build123d as bd

    font = font_path or os.environ.get("FONT_PATH", "/fonts/LiberationSans-Regular.ttf")

    with bd.BuildPart() as plaque:
        # Main base plate
        bd.Box(width, height, thickness)

        # Border chamfer (cosmetic)
        bd.chamfer(plaque.edges().filter_by(bd.Axis.Z), length=1.0)

        # Back engraving: "HERMAQUETTE" centered at bottom
        with bd.Locations(bd.Location((0, -(height/2 - 8), thickness/2))):
            try:
                text_face = bd.Text(text, font_size=6, font_path=font if Path(font).exists() else None)
                bd.extrude(text_face, amount=-engrave_depth, mode=bd.Mode.SUBTRACT)
            except Exception as e:
                print(f"[frame] Text engraving skipped: {e}", file=sys.stderr)

    # Export to STL
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    bd.export_stl(plaque.part, output_path)

    # Verify export
    mesh = trimesh.load(output_path)

    return {
        "output_path": output_path,
        "is_watertight": bool(mesh.is_watertight),
        "bounds_mm": mesh.bounds.tolist(),
        "params": {
            "width_mm": width,
            "height_mm": height,
            "thickness_mm": thickness,
            "text_depth_mm": text_depth,
            "engrave_depth_mm": engrave_depth,
        }
    }


def _build_fallback(width, height, thickness, output_path):
    """Simple box fallback when build123d is unavailable."""
    box = trimesh.creation.box(extents=[width, height, thickness])
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    box.export(output_path)
    return {
        "output_path": output_path,
        "is_watertight": True,
        "bounds_mm": box.bounds.tolist(),
        "params": {"width_mm": width, "height_mm": height, "thickness_mm": thickness},
        "fallback": True
    }


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--width-mm", type=float, default=100.0)
    parser.add_argument("--height-mm", type=float, default=80.0)
    parser.add_argument("--base-thickness-mm", type=float, default=3.0)
    parser.add_argument("--text", default="HERMAQUETTE")
    parser.add_argument("--text-depth-mm", type=float, default=0.3)
    parser.add_argument("--engrave-depth-mm", type=float, default=0.5)
    parser.add_argument("--font-path")
    args = parser.parse_args()
    result = build_plaque_frame(
        plaque_width_mm=args.width_mm,
        plaque_height_mm=args.height_mm,
        base_thickness_mm=args.base_thickness_mm,
        text_depth_mm=args.text_depth_mm,
        engrave_depth_mm=args.engrave_depth_mm,
        font_path=args.font_path,
        output_path=args.output,
    )
    print(json.dumps(result))
