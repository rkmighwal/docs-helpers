// The repository's LICENSE file is bundled into the page so it can be read offline.
import licenseText from '../../LICENSE?raw';

export const APP = {
  name: 'Resource Loading Planner',
  version: __APP_VERSION__,
  releaseDate: __RELEASE_DATE__, // YYYY-MM-DD
  licenseId: __LICENSE_ID__,
  licenseText: licenseText.trim(),
};

export function formatReleaseDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/** First "Copyright …" line of the licence, if any. */
export function copyrightLine(): string {
  return APP.licenseText.split('\n').find(l => /^copyright/i.test(l.trim()))?.trim() ?? '';
}
