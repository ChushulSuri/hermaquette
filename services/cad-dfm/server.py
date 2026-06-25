"""
FastAPI server for the hermaquette cad-dfm execution environment.
The hermes-worker calls these endpoints to run the geometry/DFM pipeline.
"""
import subprocess
import json
import os
import sys
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel

app = FastAPI(title="hermaquette-cad-dfm", version="1.0.0")

ARTIFACTS_DIR = Path(os.environ.get("ARTIFACTS_DIR", "/artifacts"))
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)


class GeometryRequest(BaseModel):
    order_id: str
    image_path: str
    params: dict = {}


class DFMRequest(BaseModel):
    order_id: str
    stl_path: str
    params: dict = {}


class DepthRequest(BaseModel):
    order_id: str
    image_path: str


def run_script(script: str, args: list[str], timeout: int = 300) -> dict:
    """Run a Python script and return parsed JSON stdout."""
    cmd = [sys.executable, script] + args
    result = subprocess.run(
        cmd, capture_output=True, text=True, timeout=timeout,
        cwd=Path(__file__).parent
    )
    if result.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail={"error": result.stderr[-2000:], "stdout": result.stdout[-500:]}
        )
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return {"output": result.stdout, "raw": True}


@app.get("/health")
async def health():
    return {"status": "ok", "service": "cad-dfm"}


@app.post("/depth")
async def generate_depth(req: DepthRequest):
    """Generate depth map from image using Depth Anything V2."""
    output_path = str(ARTIFACTS_DIR / req.order_id / "depth.png")
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    return run_script("depthmap.py", [
        "--input", req.image_path,
        "--output", output_path,
    ], timeout=180)


@app.post("/geometry")
async def run_geometry(req: GeometryRequest):
    """Full geometry pipeline: depth -> relief slab -> frame -> union -> STL+GLB."""
    output_dir = str(ARTIFACTS_DIR / req.order_id)
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    return run_script("assemble.py", [
        "--order-id", req.order_id,
        "--image", req.image_path,
        "--output-dir", output_dir,
        "--params", json.dumps(req.params),
    ], timeout=600)


@app.post("/dfm")
async def run_dfm(req: DFMRequest):
    """Run DFM checks on an STL file. Returns PASS/FIXABLE/BLOCKED/NEEDS_REVIEW."""
    return run_script("dfm.py", [
        "--stl", req.stl_path,
        "--params", json.dumps(req.params),
    ], timeout=120)
