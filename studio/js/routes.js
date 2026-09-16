// Public destinations that leave the app.
//
// These are absolute on purpose. The studio is served at /studio/ on the site
// but also ships as a Windows download, so a root-relative "/#pricing" would
// resolve against the install directory there and fail silently. Deriving them
// from the one canonical origin keeps a second copy of the domain from drifting
// out of step with it.

import { CANONICAL_APP_ORIGIN } from './api-root.js';

/** Where someone goes to buy, or to compare what a plan includes. */
export const PRICING_URL = `${CANONICAL_APP_ORIGIN}/#pricing`;

/** The desktop Studio, which is what local rendering and encoding need. */
export const STUDIO_DOWNLOAD_URL =
  'https://github.com/LibraSideTech/materiallogix/releases/latest/download/MaterialLogix-Studio-Windows.zip';
