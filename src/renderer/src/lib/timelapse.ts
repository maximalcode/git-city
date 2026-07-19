/**
 * Time-lapse export helpers. The heavy lifting (MediaRecorder on the WebGL
 * canvas's captureStream) lives in the exporter component; these are the small,
 * pure, testable pieces: picking a supported container/codec and naming the
 * output file. Recording to WebM via the browser's own MediaRecorder needs no
 * new runtime dependency.
 */

/** Candidate mime types, best (smallest/most modern) first. */
export const TIMELAPSE_MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm'
] as const

/**
 * The first candidate the running MediaRecorder supports, or null when video
 * recording isn't available at all. `isSupported` is injected so this stays a
 * pure function (MediaRecorder is absent in the test/node environment).
 */
export function pickTimelapseMime(
  isSupported: (mime: string) => boolean = (m) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)
): string | null {
  for (const mime of TIMELAPSE_MIME_CANDIDATES) {
    try {
      if (isSupported(mime)) return mime
    } catch {
      /* isTypeSupported can throw on some engines — treat as unsupported */
    }
  }
  return null
}

/** A filesystem-safe, dated name for the exported clip. */
export function timelapseFileName(repoName: string, date = new Date()): string {
  const slug =
    repoName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'repo'
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('')
  return `git-city-${slug}-timelapse-${stamp}.webm`
}
