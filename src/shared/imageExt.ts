/**
 * Image-extension helpers shared by the main process (to read blobs) and the
 * renderer (to decide whether to render an image diff). Pure string logic, no
 * node/browser APIs, so it lives in `shared`.
 */
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  avif: 'image/avif'
}

/** The image mime for a path, or null when the extension isn't an image. */
export function imageMime(path: string): string | null {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return null
  return IMAGE_MIME[path.slice(dot + 1).toLowerCase()] ?? null
}

/** Is this path a diff-able image by extension? */
export function isImagePath(path: string): boolean {
  return imageMime(path) !== null
}
