/**
 * Happy-path toggle for demo recording.
 *
 * HAPPY_PATH=on: pins known-good geometry params → reproducible STL hash
 * HAPPY_PATH=off: full generative run (the demo-integrity truth-test)
 *
 * The cold-run truth-test (M7): HAPPY_PATH=off + cleared cache
 * must still reach Concept→Preview→Manufacturable→Quote→Paid.
 */

export const HAPPY_PATH = process.env.HAPPY_PATH === 'on'

// Known-good params from the last verified hero run
export const HERO_PARAMS_HAPPY = {
  text_depth_mm: 0.6,       // post-DFM-lesson value — passes first-try
  engrave_depth_mm: 0.6,
  base_thickness_mm: 3.0,
  relief_depth_mm: 1.5,
  plaque_width_mm: 100.0,
  plaque_height_mm: 80.0,
  sink_mm: 0.3,
}

// Raw params (triggers DFM fail/fix demo beat)
export const HERO_PARAMS_DEMO = {
  text_depth_mm: 0.3,       // intentionally below PA12 minimum → FIXABLE
  engrave_depth_mm: 0.5,
  base_thickness_mm: 3.0,
  relief_depth_mm: 1.5,
  plaque_width_mm: 100.0,
  plaque_height_mm: 80.0,
  sink_mm: 0.3,
}

// Generic object (same thin-text defect class → lesson applies)
export const GENERIC_PARAMS_HAPPY = {
  text_depth_mm: 0.6,       // lesson pre-applied
  engrave_depth_mm: 0.6,
  base_thickness_mm: 2.0,
  relief_depth_mm: 0.8,
  plaque_width_mm: 60.0,
  plaque_height_mm: 30.0,
  sink_mm: 0.2,
}

export function getHeroParams() {
  return HAPPY_PATH ? HERO_PARAMS_HAPPY : HERO_PARAMS_DEMO
}

export function getGenericParams() {
  // In demo mode: generic uses lesson-applied params (same defect class → first-run PASS)
  return GENERIC_PARAMS_HAPPY
}

export function printToggleStatus() {
  console.log(`HAPPY_PATH: ${HAPPY_PATH ? 'ON (pinned params)' : 'OFF (cold generative run)'}`)
  if (HAPPY_PATH) {
    console.log('  → text_depth pre-thickened to 0.6mm (DFM lesson applied)')
    console.log('  → geometry params pinned for reproducible STL hash')
  } else {
    console.log('  → text_depth=0.3mm (triggers DFM fail/fix demo beat)')
    console.log('  → full generative pipeline — demo-integrity truth-test')
  }
}
