---
name: intake-research
description: Use when a new order needs its request parsed — produces a full-3D-figure description, material, color, reference search keywords, and an IP-sensitivity flag; builds deterministic provenance + rights framing in code (the model never invents URLs).
version: 1.0.0
author: Hermaquette
license: MIT
metadata:
  hermes:
    tags: [hermaquette, intake, research, provenance]
---

# Skill: intake-research

**Status**: Superseded — agent-native reasoning replaces this scripted step. The orchestrator agent researches and decides directly using its own model. No script is invoked.

## Description

Research stage for a new order. The orchestrator agent (Hermaquette) handles this natively:
1. Parses the customer's free-text description
2. Determines a rights framing (personal gift, no commercial claim)
3. Produces a clean front-facing description optimised for image generation
4. Recommends the best print material (pa12 / resin / tpu)

No `jobs` row, no handler script. The agent's own reasoning replaces the scripted LLM call.

## Memory / learning hooks

None on this stage. Lessons from dfm-repair are applied upstream at geometry build time.
