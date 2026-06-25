"""Generate a simple sample.stl for Day-0 vendor quote testing."""
import struct
from pathlib import Path


def write_minimal_stl(output_path: str, width=10.0, height=10.0, depth=3.0):
    """Write a binary STL box (6 faces, 12 triangles)."""

    # 6 faces of a box, each as 2 triangles
    w, h, d = width/2, height/2, depth

    triangles = [
        # Bottom (z=0)
        (( 0,  0, -1), (-w, -h, 0), ( w, -h, 0), ( w,  h, 0)),
        (( 0,  0, -1), (-w, -h, 0), ( w,  h, 0), (-w,  h, 0)),
        # Top (z=d)
        (( 0,  0,  1), (-w, -h, d), ( w,  h, d), ( w, -h, d)),
        (( 0,  0,  1), (-w, -h, d), (-w,  h, d), ( w,  h, d)),
        # Front (y=-h)
        (( 0, -1,  0), (-w, -h, 0), ( w, -h, d), ( w, -h, 0)),
        (( 0, -1,  0), (-w, -h, 0), (-w, -h, d), ( w, -h, d)),
        # Back (y=+h)
        (( 0,  1,  0), (-w,  h, 0), ( w,  h, 0), ( w,  h, d)),
        (( 0,  1,  0), (-w,  h, 0), ( w,  h, d), (-w,  h, d)),
        # Left (x=-w)
        ((-1,  0,  0), (-w, -h, 0), (-w,  h, 0), (-w,  h, d)),
        ((-1,  0,  0), (-w, -h, 0), (-w,  h, d), (-w, -h, d)),
        # Right (x=+w)
        (( 1,  0,  0), ( w, -h, 0), ( w,  h, d), ( w,  h, 0)),
        (( 1,  0,  0), ( w, -h, 0), ( w, -h, d), ( w,  h, d)),
    ]

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'wb') as f:
        f.write(b'\x00' * 80)  # header
        f.write(struct.pack('<I', len(triangles)))
        for normal, v1, v2, v3 in triangles:
            f.write(struct.pack('<3f', *normal))
            f.write(struct.pack('<3f', *v1))
            f.write(struct.pack('<3f', *v2))
            f.write(struct.pack('<3f', *v3))
            f.write(struct.pack('<H', 0))  # attribute byte count

    print(f"Written {len(triangles)} triangles to {output_path}")


if __name__ == "__main__":
    write_minimal_stl("sample.stl")
