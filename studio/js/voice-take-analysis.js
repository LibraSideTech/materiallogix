// The four measurements behind the take report, in one place and with no DOM.
//
// Delivery loudness is a property of what gets published, so it reads the
// finished take. The physical defects, the long-form drift and the joins are
// properties of what was recorded, and finishing destroys the evidence for
// them, so those read the source. voice.html carries the full reasoning.
//
// This lives apart from the page because the arithmetic is real: a six-minute
// take is over ten seconds of it, and ten seconds of a frozen window is not
// something a customer should be asked to sit through. voice-take-analysis-worker.js
// runs exactly this off the main thread; the page falls back to calling it
// directly when a worker cannot start.
import { measureLoudness } from './loudness.js';
import { analyseTakeDefects } from './take-defects.js';
import { analyseLongForm } from './long-form.js';
import { analyseSeams } from './seam-check.js';

/**
 * @param {{finished: Float32Array[], finishedRate: number, heard: Float32Array,
 *          heardRate: number, plannedPausesMs: number[]|null}} take
 */
export function analyseTake({ finished, finishedRate, heard, heardRate, plannedPausesMs }) {
  return {
    measured: measureLoudness(finished, finishedRate),
    defects: analyseTakeDefects(heard, heardRate),
    longForm: analyseLongForm(heard, heardRate),
    seams: analyseSeams(heard, heardRate, { plannedPausesMs })
  };
}
