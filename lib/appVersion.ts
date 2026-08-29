/**
 * Product version. The line is v3.
 *
 * Bump when shipping user-facing work:
 * - patch: fix / polish
 * - minor: feature
 * - major: product reset only
 *
 * Keep `package.json` `version` and `public/sw.js` CACHE_VERSION in sync.
 */
export const APP_VERSION = {
  major: 3,
  minor: 5,
  patch: 1,
} as const;

export const APP_VERSION_NUMBER = `${APP_VERSION.major}.${APP_VERSION.minor}.${APP_VERSION.patch}`;
export const APP_VERSION_LABEL = `v${APP_VERSION_NUMBER}`;
