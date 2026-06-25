"""
Vendor spec object schema — the cross-stage handoff between DFM, quote, payment, tracking.
This file defines the canonical spec structure used throughout the pipeline.
"""
from dataclasses import dataclass, field, asdict
from typing import Optional, List, Dict, Any


@dataclass
class Provenance:
    url: str
    title: str
    notes: str = ""


@dataclass
class DimensionsMM:
    x: float
    y: float
    z: float


@dataclass
class VendorSpec:
    """
    Vendor spec object: persisted in the spec SQLite table.
    Passed between DFM, quote, payment, tracking stages.
    """
    order_id: str

    # File references
    stl_path: Optional[str] = None
    glb_path: Optional[str] = None
    file_format: str = "STL"

    # Physical properties
    dimensions_mm: Optional[DimensionsMM] = None
    material: str = "pa12"
    process: str = "SLS"  # Sculpteo PA12 SLS

    # DFM state
    dfm_status: str = "pending"  # PASS|FAIL|FIXABLE|BLOCKED|NEEDS_REVIEW|pending
    dfm_report: Optional[Dict[str, Any]] = None

    # Vendor state
    vendor: str = "sculpteo"
    quote_status: str = "pending"  # pending|accepted|manual|cached
    ship_to_status: str = "address_pending"

    # Image reference
    approved_image_id: Optional[str] = None

    # Provenance (rights framing)
    provenance: List[Provenance] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @property
    def is_quotable(self) -> bool:
        return self.dfm_status == "PASS" and self.stl_path is not None

    @property
    def is_purchasable(self) -> bool:
        return self.quote_status in ("accepted", "manual") and self.is_quotable


# PA12 SLS manufacturing constants (Sculpteo)
PA12_SLS_CONSTANTS = {
    "flexible_wall_min_mm": 0.8,
    "rigid_wall_min_mm": 2.0,
    "embossed_detail_min_mm": 0.4,
    "engraved_text_min_mm": 0.5,
    "max_build_volume_mm": {"x": 300, "y": 300, "z": 300},
    "min_volume_mm3": 0.1,
    "material_name": "PA12 Plastic (White)",
    "process": "SLS",
    "vendor": "Sculpteo",
}
