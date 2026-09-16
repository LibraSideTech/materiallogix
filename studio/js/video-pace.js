// How long a video render takes on this computer, measured rather than guessed.
//
// Running out of cloud credit used to end the job: the customer was handed the
// string `insufficient_cloud_balance` in a toast, with no route onward, even
// though the same edit can be rendered on their own machine. Offering that
// choice is only fair if it comes with an honest wait, and a wait is only
// honest if it was measured here.
//
// The image path already works this way (recordCpuPace / estimateCpuSeconds),
// but its unit is steps by pixels, which says nothing about video. This one
// measures wall-clock seconds per second of finished video, and refuses to
// invent a figure before it has seen one. There is no defensible prior for a
// render whose cost depends on the codec, the filters and the machine, so
// before the first local render this reports that it does not know.

const KEY = 'cros:video-local-pace';

/** Remember what a finished local render actually cost. */
export function recordVideoPace(elapsedSeconds, outputSeconds, storage = globalThis.localStorage) {
  if (!(elapsedSeconds > 0) || !(outputSeconds > 0)) return;
  try { storage?.setItem(KEY, String(elapsedSeconds / outputSeconds)); } catch { /* private mode */ }
}

/**
 * What the next local render should cost. `measured` is false when this
 * machine has never finished one, and callers must not print a number then.
 */
export function estimateVideoSeconds(outputSeconds, storage = globalThis.localStorage) {
  let rate = 0;
  try { rate = Number(storage?.getItem(KEY)) || 0; } catch { /* private mode */ }
  if (!(rate > 0) || !(outputSeconds > 0)) return { seconds: 0, measured: false };
  return { seconds: Math.max(1, Math.round(rate * outputSeconds)), measured: true };
}

/**
 * What to say when the cloud has run out mid-project. The wait is included
 * only when it was measured on this computer.
 */
export function localFallbackMessage(outputSeconds, storage = globalThis.localStorage) {
  const estimate = estimateVideoSeconds(outputSeconds, storage);
  return estimate.measured
    ? { ...estimate, detail: `Rendering here takes about ${plainWait(estimate.seconds)}, measured from your last local render.` }
    : { ...estimate, detail: 'This computer has not finished a video render yet, so the wait is unknown until it does.' };
}

/** Plain wording for a wait, never a bare count of seconds. */
export function plainWait(seconds) {
  const total = Math.max(1, Math.round(seconds));
  if (total < 90) return `${total} seconds`;
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} hour${hours === 1 ? '' : 's'}`;
}
