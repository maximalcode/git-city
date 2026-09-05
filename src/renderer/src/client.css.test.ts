import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./client.css', import.meta.url), 'utf8')

describe('settings control sizing', () => {
  it('keeps the Time of day range constrained independently of the theme picker', () => {
    const rangeRule = css.match(/\.settings-row input\[type=['"]range['"]\]\s*\{([^}]*)\}/)

    expect(rangeRule, 'the Time of day range should have its own sizing rule').not.toBeNull()
    expect(rangeRule?.[1] ?? '').toContain('max-width: 160px')
  })
})
