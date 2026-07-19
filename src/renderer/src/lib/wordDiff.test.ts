import { describe, it, expect } from 'vitest'
import { wordDiff, pairedWordSpans, toSideBySide } from './wordDiff'
import type { DiffLine } from '../../../shared/types'

const text = (spans: { text: string; changed: boolean }[]): string =>
  spans.map((s) => s.text).join('')
const changed = (spans: { text: string; changed: boolean }[]): string =>
  spans
    .filter((s) => s.changed)
    .map((s) => s.text)
    .join('')

describe('wordDiff', () => {
  it('marks nothing changed for identical lines', () => {
    const { oldSpans, newSpans } = wordDiff('const x = 1', 'const x = 1')
    expect(oldSpans.every((s) => !s.changed)).toBe(true)
    expect(newSpans.every((s) => !s.changed)).toBe(true)
  })

  it('reconstructs both lines from the spans', () => {
    const { oldSpans, newSpans } = wordDiff('let a = foo()', 'let a = bar()')
    expect(text(oldSpans)).toBe('let a = foo()')
    expect(text(newSpans)).toBe('let a = bar()')
  })

  it('isolates the changed token', () => {
    const { oldSpans, newSpans } = wordDiff('let a = foo()', 'let a = bar()')
    expect(changed(oldSpans)).toBe('foo')
    expect(changed(newSpans)).toBe('bar')
  })

  it('handles a pure insertion (empty old)', () => {
    const { oldSpans, newSpans } = wordDiff('', 'hello')
    expect(oldSpans).toEqual([])
    expect(changed(newSpans)).toBe('hello')
  })

  it('handles a pure deletion (empty new)', () => {
    const { oldSpans, newSpans } = wordDiff('gone', '')
    expect(changed(oldSpans)).toBe('gone')
    expect(newSpans).toEqual([])
  })
})

const line = (kind: DiffLine['kind'], text: string): DiffLine => ({ kind, text })

describe('pairedWordSpans', () => {
  it('pairs a del run with the following add run by position', () => {
    const lines = [line('ctx', 'a'), line('del', 'foo()'), line('add', 'bar()'), line('ctx', 'b')]
    const spans = pairedWordSpans(lines)
    expect(spans[0]).toBeNull()
    expect(spans[3]).toBeNull()
    expect(changed(spans[1]!)).toBe('foo')
    expect(changed(spans[2]!)).toBe('bar')
  })

  it('leaves unbalanced extra lines unpaired', () => {
    const lines = [line('del', 'x'), line('del', 'y'), line('add', 'x2')]
    const spans = pairedWordSpans(lines)
    expect(spans[0]).not.toBeNull() // first del pairs with the add
    expect(spans[1]).toBeNull() // second del has no partner
    expect(spans[2]).not.toBeNull()
  })
})

describe('toSideBySide', () => {
  it('puts context on both sides', () => {
    const rows = toSideBySide([line('ctx', 'same')])
    expect(rows).toHaveLength(1)
    expect(rows[0].left).toMatchObject({ text: 'same', kind: 'ctx' })
    expect(rows[0].right).toMatchObject({ text: 'same', kind: 'ctx' })
  })

  it('aligns a del/add pair into one row with word spans', () => {
    const rows = toSideBySide([line('del', 'foo()'), line('add', 'bar()')])
    expect(rows).toHaveLength(1)
    expect(rows[0].left.kind).toBe('del')
    expect(rows[0].right.kind).toBe('add')
    expect(changed(rows[0].left.spans!)).toBe('foo')
    expect(changed(rows[0].right.spans!)).toBe('bar')
  })

  it('fills empty cells for unbalanced runs', () => {
    const rows = toSideBySide([line('del', 'a'), line('del', 'b'), line('add', 'c')])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ left: { kind: 'del' }, right: { kind: 'add' } })
    expect(rows[1].left.kind).toBe('del')
    expect(rows[1].right.kind).toBe('empty')
  })

  it('a pure addition leaves the left cell empty', () => {
    const rows = toSideBySide([line('add', 'new')])
    expect(rows[0].left.kind).toBe('empty')
    expect(rows[0].right.kind).toBe('add')
  })
})
