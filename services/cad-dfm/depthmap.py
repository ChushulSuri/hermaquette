#!/usr/bin/env python3
"""
Depth map generation using Depth Anything V2 (primary) or luminance fallback.
Outputs a normalized grayscale depth PNG where white = closest, black = furthest.
"""
import argparse
import json
import sys
import numpy as np
from pathlib import Path
from PIL import Image, ImageFilter


def load_depth_anything_v2(image: Image.Image) -> np.ndarray:
    """Run Depth Anything V2 monocular depth estimation."""
    from transformers import pipeline

    # Use the small model for CPU speed; still gives good coin-relief quality
    pipe = pipeline(
        task="depth-estimation",
        model="depth-anything/Depth-Anything-V2-Small-hf",
    )
    result = pipe(image)
    depth_array = np.array(result["depth"])
    return depth_array


def luminance_fallback(image: Image.Image) -> np.ndarray:
    """Simple luminance-based pseudo-depth (fallback only — less stable than DA-V2)."""
    gray = image.convert("L")
    arr = np.array(gray, dtype=np.float32)
    # Invert: bright areas = raised in relief
    return 255.0 - arr


def generate_depth_map(
    input_path: str,
    output_path: str,
    max_size: int = 384,
) -> dict:
    image = Image.open(input_path).convert("RGB")

    # Resize to cap — Depth Anything V2 handles any size but we cap for speed
    orig_size = image.size
    if max(image.size) > max_size:
        scale = max_size / max(image.size)
        new_size = (int(image.width * scale), int(image.height * scale))
        image = image.resize(new_size, Image.LANCZOS)

    # Try Depth Anything V2 first
    try:
        depth_array = load_depth_anything_v2(image)
        source = "depth_anything_v2"
    except Exception as e:
        print(f"[depthmap] DA-V2 unavailable ({e}), using luminance fallback", file=sys.stderr)
        depth_array = luminance_fallback(image)
        source = "luminance_fallback"

    # Normalize to [0, 255]
    d_min, d_max = depth_array.min(), depth_array.max()
    if d_max - d_min < 1e-6:
        depth_array = np.full_like(depth_array, 128.0)
    else:
        depth_array = (depth_array - d_min) / (d_max - d_min) * 255.0

    # Slight Gaussian blur to remove noise
    depth_img = Image.fromarray(depth_array.astype(np.uint8), mode="L")
    depth_img = depth_img.filter(ImageFilter.GaussianBlur(radius=1))

    # Save
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    depth_img.save(output_path)

    return {
        "output_path": output_path,
        "source": source,
        "original_size": list(orig_size),
        "output_size": list(depth_img.size),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--max-size", type=int, default=384)
    args = parser.parse_args()

    result = generate_depth_map(args.input, args.output, args.max_size)
    print(json.dumps(result))
