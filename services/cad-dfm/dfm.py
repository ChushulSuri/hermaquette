#!/usr/bin/env python3
"""
Local DFM gate for Hermaquette.
Validates build123d config parameters against Sculpteo PA12 SLS tolerances.
Also runs mesh-level checks: watertight, volume, bbox, component count.

DFM constants (Sculpteo PA12 SLS):
  flexible_wall_min: 0.8 mm
  rigid_wall_min: 2.0 mm
  embossed_detail_min: 0.4 mm
  engraved_text_min: 0.5 mm  <- hero fail point (text_depth=0.3mm)
  max_build_volume: 300 x 300 x 300 mm

Outputs one of: PASS | FIXABLE | NEEDS_REVIEW | BLOCKED
"""
import argparse
import json
import sys
from pathlib import Path
from typing import Optional
import trimesh
import numpy as np


# Sculpteo PA12 SLS DFM constants
PA12_CONSTANTS = {
    "flexible_wall_min_mm": 0.8,
    "rigid_wall_min_mm": 2.0,
    "embossed_detail_min_mm": 0.4,
    "engraved_text_min_mm": 0.5,   # HERO FAIL: text_depth=0.3 < 0.5
    "max_build_volume_mm": [300, 300, 300],
    "min_volume_mm3": 0.1,
}

# Resin constants (for material-specific recommendation)
RESIN_CONSTANTS = {
    "embossed_detail_min_mm": 0.2,
    "engraved_text_min_mm": 0.3,
    "wall_min_mm": 1.0,
    "max_build_volume_mm": [145, 145, 185],
}


def run_dfm(stl_path: str, params: dict) -> dict:
    """Run DFM checks and return a structured result."""

    failures = []
    warnings = []
    auto_fixes = {}

    # -- Parameter-level checks (owned parameters) --------------------------
    # These are the deterministic checks on build123d config values

    text_depth = params.get("text_depth_mm", 0.5)
    engrave_depth = params.get("engrave_depth_mm", 0.5)
    base_thickness = params.get("base_thickness_mm", 3.0)
    relief_depth = params.get("relief_depth_mm", 1.5)

    # SCRIPTED HERO FAILURE: text_depth < engraved_text_min
    if text_depth < PA12_CONSTANTS["engraved_text_min_mm"]:
        failures.append({
            "type": "text_too_thin",
            "param": "text_depth_mm",
            "value": text_depth,
            "minimum": PA12_CONSTANTS["engraved_text_min_mm"],
            "material": "PA12",
            "description": (
                f"Engraved text depth {text_depth}mm is below PA12 minimum "
                f"{PA12_CONSTANTS['engraved_text_min_mm']}mm"
            ),
            "fixable": True,
            "fix": {"text_depth_mm": 0.6},
        })
        auto_fixes["text_depth_mm"] = 0.6

    if engrave_depth < PA12_CONSTANTS["engraved_text_min_mm"]:
        failures.append({
            "type": "engrave_too_shallow",
            "param": "engrave_depth_mm",
            "value": engrave_depth,
            "minimum": PA12_CONSTANTS["engraved_text_min_mm"],
            "fixable": True,
            "fix": {"engrave_depth_mm": 0.6},
        })
        auto_fixes["engrave_depth_mm"] = 0.6

    if base_thickness < PA12_CONSTANTS["rigid_wall_min_mm"]:
        failures.append({
            "type": "base_too_thin",
            "param": "base_thickness_mm",
            "value": base_thickness,
            "minimum": PA12_CONSTANTS["rigid_wall_min_mm"],
            "fixable": True,
            "fix": {"base_thickness_mm": 2.0},
        })
        auto_fixes["base_thickness_mm"] = 2.0

    # -- Mesh-level checks ---------------------------------------------------
    mesh_checks = {}
    if Path(stl_path).exists():
        try:
            mesh = trimesh.load(stl_path)

            # Watertight check
            mesh_checks["is_watertight"] = bool(mesh.is_watertight)
            if not mesh.is_watertight:
                warnings.append({
                    "type": "non_watertight",
                    "description": "Mesh is not watertight — will attempt repair",
                    "fixable": True,
                })

            # Volume check — negative volume = inside-out normals (fixable), not truly zero
            raw_volume = float(mesh.volume) if mesh.is_watertight else 0
            volume = abs(raw_volume)
            mesh_checks["volume_mm3"] = round(volume, 2)
            if raw_volume < 0 and mesh.is_watertight:
                warnings.append({
                    "type": "inverted_normals",
                    "description": "Mesh normals appear inverted (negative volume) — fixable with face flip",
                    "fixable": True,
                })
            elif volume < PA12_CONSTANTS["min_volume_mm3"] and mesh.is_watertight:
                failures.append({
                    "type": "zero_volume",
                    "description": "Mesh has effectively zero volume",
                    "fixable": False,
                })

            # Bounding box / build volume check
            bounds = mesh.bounds
            dims = bounds[1] - bounds[0]
            mesh_checks["dimensions_mm"] = dims.tolist()
            max_vol = PA12_CONSTANTS["max_build_volume_mm"]
            if any(dims[i] > max_vol[i] for i in range(3)):
                failures.append({
                    "type": "exceeds_build_volume",
                    "description": f"Mesh {dims.tolist()} mm exceeds build volume {max_vol} mm",
                    "fixable": False,
                })

            # Component count
            components = trimesh.graph.connected_components(mesh.face_adjacency)
            mesh_checks["component_count"] = len(components)
            if len(components) > 1:
                warnings.append({
                    "type": "multi_component",
                    "description": f"Mesh has {len(components)} disconnected components",
                    "fixable": True,
                })

        except Exception as e:
            warnings.append({"type": "mesh_load_error", "description": str(e)})

    # -- Material recommendation ---------------------------------------------
    material = params.get("material", "pa12")
    if relief_depth < 0.3 or text_depth < 0.3:
        recommended_material = "resin"
        material_reason = "Fine detail features benefit from resin's higher resolution"
    elif base_thickness >= 2.0 and relief_depth <= 2.0:
        recommended_material = "pa12"
        material_reason = "PA12 SLS recommended for structural rigidity and detail quality"
    else:
        recommended_material = material
        material_reason = "Current material settings are appropriate"

    # -- Determine overall status --------------------------------------------
    hard_failures = [f for f in failures if not f.get("fixable", False)]
    fixable_failures = [f for f in failures if f.get("fixable", True)]

    # Build params with applied fixes (for next geometry run)
    fixed_params = {**params, **auto_fixes}

    if hard_failures:
        primary_failure = hard_failures[0]
        return {
            "status": "BLOCKED",
            "reason": primary_failure["description"],
            "failures": failures,
            "warnings": warnings,
            "mesh_checks": mesh_checks,
            "material_recommendation": recommended_material,
            "material_reason": material_reason,
            "failure_class": primary_failure["type"],
        }

    if fixable_failures:
        primary = fixable_failures[0]
        return {
            "status": "FIXABLE",
            "reason": primary["description"],
            "failure_class": primary["type"],
            "failures": fixable_failures,
            "warnings": warnings,
            "mesh_checks": mesh_checks,
            "fix_description": (
                f"Thicken {primary['param']} from {primary['value']}mm "
                f"to {primary['fix'][primary['param']]}mm"
            ),
            "fixed_params": fixed_params,
            "auto_fixes": auto_fixes,
            "material_recommendation": recommended_material,
            "material_reason": material_reason,
            "lesson": (
                f"Pre-thicken {primary['param']} to "
                f">={primary['fix'][primary['param']]}mm on {material.upper()} "
                f"to pass DFM first-try"
            ),
        }

    if warnings:
        return {
            "status": "NEEDS_REVIEW",
            "reason": warnings[0]["description"],
            "warnings": warnings,
            "mesh_checks": mesh_checks,
            "material_recommendation": recommended_material,
            "material_reason": material_reason,
        }

    return {
        "status": "PASS",
        "checks_passed": True,
        "failures": [],
        "warnings": warnings,
        "mesh_checks": mesh_checks,
        "material_recommendation": recommended_material,
        "material_reason": material_reason,
        "params_checked": {
            "text_depth_mm": text_depth,
            "engrave_depth_mm": engrave_depth,
            "base_thickness_mm": base_thickness,
            "relief_depth_mm": relief_depth,
        }
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--stl", required=True)
    parser.add_argument("--params", default="{}")
    args = parser.parse_args()

    params = json.loads(args.params)
    result = run_dfm(args.stl, params)
    print(json.dumps(result))

    # Exit code signals overall status to the caller
    sys.exit(0 if result["status"] in ("PASS", "FIXABLE") else 1)
