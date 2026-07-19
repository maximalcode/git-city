import { readFile } from 'fs/promises'
import { join } from 'path'
import type { ImageDiff, ImageBlob } from '../../shared/types'
import { imageMime } from '../../shared/imageExt'
import { runGitBuffer } from './exec'

function toBlob(buf: Buffer | null, mime: string): ImageBlob | null {
  if (!buf || buf.length === 0) return null
  return { dataUri: `data:${mime};base64,${buf.toString('base64')}`, bytes: buf.length }
}

/**
 * The before/after image bytes for a changed image file, as data URIs.
 * In timeline mode (rev) it compares that commit to its parent; in working
 * mode it compares HEAD to the working-tree file. Either side is null when the
 * image doesn't exist there (added or deleted). Returns null for non-images.
 */
export async function imageDiff(
  repoPath: string,
  path: string,
  rev?: string
): Promise<ImageDiff | null> {
  const mime = imageMime(path)
  if (!mime) return null

  let oldBuf: Buffer | null
  let newBuf: Buffer | null
  if (rev) {
    oldBuf = await runGitBuffer(repoPath, ['show', `${rev}~1:${path}`])
    newBuf = await runGitBuffer(repoPath, ['show', `${rev}:${path}`])
  } else {
    oldBuf = await runGitBuffer(repoPath, ['show', `HEAD:${path}`])
    newBuf = await readFile(join(repoPath, path)).catch(() => null)
  }

  return { old: toBlob(oldBuf, mime), new: toBlob(newBuf, mime) }
}
