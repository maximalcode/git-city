import { describe, expect, it } from 'vitest'
import { imageMime, isImagePath } from './imageExt'

describe('imageMime / isImagePath', () => {
  it('maps known image extensions (case-insensitive)', () => {
    expect(imageMime('logo.png')).toBe('image/png')
    expect(imageMime('a/b/Photo.JPG')).toBe('image/jpeg')
    expect(imageMime('icon.svg')).toBe('image/svg+xml')
    expect(imageMime('x.webp')).toBe('image/webp')
  })

  it('returns null for non-images and extensionless paths', () => {
    expect(imageMime('src/index.ts')).toBeNull()
    expect(imageMime('README')).toBeNull()
    expect(imageMime('archive.tar.gz')).toBeNull()
  })

  it('isImagePath mirrors imageMime', () => {
    expect(isImagePath('a.gif')).toBe(true)
    expect(isImagePath('a.txt')).toBe(false)
  })
})
