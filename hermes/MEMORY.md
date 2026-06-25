# Hermaquette — Hermes Agent Memory

> This file is updated automatically by Hermes after each DFM failure/fix cycle (KTD11 learning loop).
> Lessons here are applied PRE-EMPTIVELY on subsequent geometry builds to avoid known failures.

---

## Initial Lessons

### Lesson 001 — PA12 Minimum Feature Size (Sculpteo SLS)

**Applies to**: any object with engraved text, fine detail, or relief depth
**Rule**: Pre-check `text_depth`, `relief_depth`, and `engrave_depth` against PA12 minimums:

| Feature type       | Sculpteo minimum | Recommended pre-set |
|--------------------|-----------------|---------------------|
| Embossed detail    | ≥ 0.4 mm        | 0.5 mm              |
| Engraved text      | ≥ 0.5 mm        | **0.6 mm**          |
| Engrave depth      | ≥ 0.5 mm        | **0.6 mm**          |
| Flexible wall      | ≥ 0.8 mm        | 1.0 mm              |
| Rigid wall         | ≥ 2.0 mm        | 2.5 mm              |

**Learned from**: Hero run (Nous Girl Hermes Relief Plaque, 2026-06-25)
**Fix applied**: thickened `text_depth` from 0.3 mm → 0.6 mm → DFM PASS
**Effect on HAPPY_PATH**: pre-thickened at 0.6 mm → first-run DFM PASS (zero text failures in demo)
**Effect on demo path**: `text_depth=0.3mm` deliberately triggers FIXABLE → showcases learning loop

---

### Lesson 002 — STL Wall Closure (all materials)

**Applies to**: any STL with boolean union of multiple solids
**Rule**: Always run a manifold check after CAD assembly. Open shells fail Sculpteo upload validation
before they reach DFM.
**Recommended**: use `cadquery` solid export with `compound.clean()` before STL export.
**Mitigation in pipeline**: cad-dfm /geometry endpoint calls `clean()` by default.

---

*New lessons will be appended here automatically by the dfm-gate skill after each FIXABLE cycle.*
