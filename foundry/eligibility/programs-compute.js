/**
 * "Programs you may qualify for" for a saved plan, on this device: the interview answers
 * (FoundryPlanStore record 'interview') and the plan's location, matched by FoundryEligibility
 * over the bundled program data, with the nearest offices from FoundryLocalHelp. No request is
 * made. Shared by the Guided Interview (before rebuilding documents) and the programs screen.
 */
(function (root) {
  'use strict';

  /**
   * @param {object} pipeline the saved plan (runInstantPipeline result)
   * @param {object|null} state interview state (may be null: general programs only)
   * @param {{ interest?: string[] }} [opts] programs added to the To-Do list on the programs screen
   */
  /** The plan's own resolved location (county, metro, ZIP centroid), so nothing is looked up again. */
  function localWhere(loc, place) {
    const l = loc || {};
    return { zip: place.zip || undefined, state: place.state || undefined, county: place.county || undefined, cbsa: l.cbsa || undefined, lat: typeof l.lat === 'number' ? l.lat : undefined, lon: typeof l.lon === 'number' ? l.lon : undefined };
  }

  async function compute(pipeline, state, opts = {}) {
    const E = root.FoundryEligibility;
    const data = root.FoundryProgramData;
    if (!E || !data || !pipeline || !pipeline.ok) return null;
    const stage = (pipeline.intake && pipeline.intake.stage) || 'idea';
    const interest = Array.isArray(opts.interest) ? opts.interest : state && Array.isArray(state.programs_interest) ? state.programs_interest : [];
    const answers = E.normalizeAnswers(state || { answers: {} }, { stage, interest });
    const place = E.placeFromLocation(pipeline.location);
    let local = null;
    if (root.FoundryLocalHelp && (place.zip || place.state)) {
      try {
        local = await root.FoundryLocalHelp.getLocalResources(localWhere(pipeline.location, place));
      } catch {
        local = null; // matches still list each program's own locator
      }
    }
    return E.matchPrograms({ answers, place, data, local });
  }

  root.FoundryProgramsCompute = { compute };
})(typeof window !== 'undefined' ? window : globalThis);
