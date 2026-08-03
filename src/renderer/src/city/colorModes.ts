import { Color } from 'three'
import type { Snapshot, FileState } from '../../../shared/types'
import { languageOf } from '../lib/languages'

/** The slice of a scene model the colorers need — every mode model satisfies it. */
export interface ColorContext {
  /** per-object language color, indexed like the model's paths */
  langColors: Color[]
}

/** Ways to color the city. Each mode uses a deliberately distinct palette. */
export type ColorMode = 'language' | 'activity' | 'author' | 'recency' | 'size' | 'filetype'

export interface ColorModeInfo {
  id: ColorMode
  name: string
  hint: string
}

export const COLOR_MODES: ColorModeInfo[] = [
  { id: 'language', name: 'Language', hint: 'Programming language / file type color' },
  { id: 'activity', name: 'Activity', hint: 'How often the file changes' },
  { id: 'author', name: 'Author', hint: 'Who last touched the file' },
  { id: 'recency', name: 'Recency', hint: 'How recently the file changed' },
  { id: 'size', name: 'Size', hint: 'Lines of code' },
  { id: 'filetype', name: 'Kind', hint: 'Code / test / config / docs / assets' }
]

export interface LegendItem {
  label: string
  color: string
}
export interface Legend {
  /** gradient → render as a continuous bar; else a list of swatches */
  gradient: boolean
  items: LegendItem[]
}

export interface Colorer {
  /** writes the color for building `i` (file `f`) into `out`, returns it */
  colorFor(f: FileState, i: number, out: Color): Color
  legend: Legend
}

// ---- file categorization (for the "Kind" mode) ----
export type FileKind = 'code' | 'test' | 'config' | 'docs' | 'assets' | 'other'

const KIND_COLORS: Record<FileKind, string> = {
  code: '#3178c6',
  test: '#22c55e',
  config: '#f59e0b',
  docs: '#a855f7',
  assets: '#ec4899',
  other: '#64748b'
}
const KIND_LABEL: Record<FileKind, string> = {
  code: 'Code',
  test: 'Test',
  config: 'Config',
  docs: 'Docs',
  assets: 'Assets',
  other: 'Other'
}

const CODE_EXT = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'c',
  'h',
  'cpp',
  'cc',
  'hpp',
  'cs',
  'php',
  'vue',
  'svelte',
  'scala',
  'clj',
  'ex',
  'exs',
  'erl',
  'hs',
  'lua',
  'dart',
  'r',
  'zig',
  'sh',
  'bash',
  'ps1'
])
const CONFIG_EXT = new Set([
  'json',
  'yml',
  'yaml',
  'toml',
  'ini',
  'env',
  'cfg',
  'conf',
  'lock',
  'xml'
])
const DOCS_EXT = new Set(['md', 'mdx', 'txt', 'rst', 'adoc'])
const ASSET_EXT = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'ico',
  'webp',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'mp3',
  'mp4',
  'wav'
])

export function categorize(path: string): FileKind {
  const lower = path.toLowerCase()
  const base = lower.split('/').pop() ?? lower
  if (/(^|\/)(tests?|__tests__|spec|specs|e2e)(\/|$)/.test(lower) || /\.(test|spec)\./.test(base)) {
    return 'test'
  }
  const dot = base.lastIndexOf('.')
  const ext = dot >= 0 ? base.slice(dot + 1) : ''
  if (base === 'dockerfile' || base.startsWith('.') || CONFIG_EXT.has(ext)) return 'config'
  if (DOCS_EXT.has(ext)) return 'docs'
  if (ASSET_EXT.has(ext)) return 'assets'
  if (CODE_EXT.has(ext)) return 'code'
  return 'other'
}

// ---- deterministic author color (golden-angle hue spread) ----
export function authorColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  const hue = (Math.abs(h) * 137.508) % 360 // golden angle → well-spread hues
  return `hsl(${hue.toFixed(0)}, 62%, 58%)`
}

// ---- gradient ramps ----
function ramp(stops: Color[], t: number, out: Color): Color {
  const x = Math.min(0.999, Math.max(0, t)) * (stops.length - 1)
  const i = Math.floor(x)
  return out.copy(stops[i]).lerp(stops[i + 1], x - i)
}

const ACTIVITY = ['#2e4a7a', '#f5a623', '#ff4757'].map((c) => new Color(c))
const RECENCY = ['#38506e', '#3aa0c0', '#52e07a'].map((c) => new Color(c)) // old → recent
const SIZE = ['#ded1ff', '#8b5cf6', '#5b21b6'].map((c) => new Color(c)) // small → large

function topBy(counts: Map<string, number>, n: number): string[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map((e) => e[0])
}

/** How many swatches a categorical legend shows before folding the rest. */
export const LEGEND_MAX = 8

/** Colour for everything past {@link LEGEND_MAX} in a categorical mode. */
export const OTHERS_COLOR = '#64748b'

/**
 * A categorical legend, with the tail folded into one honest "Others" row.
 *
 * It used to stop after eight swatches with no indication there were more,
 * while the first-run guide told the user "see the legend for what each colour
 * means" — so in any mid-sized repository most of the colours on screen had no
 * entry explaining them (#28).
 */
function categoricalLegend(
  top: string[],
  total: number,
  colorOf: (name: string) => string
): Legend {
  const items = top.map((name) => ({ label: name || 'unknown', color: colorOf(name) }))
  if (total > top.length) {
    items.push({ label: `Others (${total - top.length})`, color: OTHERS_COLOR })
  }
  return { gradient: false, items }
}

/**
 * A ramp needs a range, and on a repository with one commit there isn't one.
 *
 * Every file then carries the same value, and the ramp lands on whichever end
 * stop the arithmetic happens to reach: a freshly initialised repository came
 * out entirely 'Long ago' blue-grey under Recency and entirely 'Often' red
 * under Activity, both while the legend underneath promised a spread. The same
 * thing happens at commit 1 when scrubbing any repository's timeline (#28).
 *
 * `at` is where a single-valued repository should sit on the ramp: the midpoint
 * for Activity and Size, the recent end for Recency — a file committed today
 * is not "long ago" whatever else is true.
 */
function flatColorer(stops: Color[], at: number, label: string): Colorer {
  const flat = ramp(stops, at, new Color())
  const hex = `#${flat.getHexString()}`
  return {
    colorFor: (_f, _i, out) => out.copy(flat),
    legend: { gradient: false, items: [{ label, color: hex }] }
  }
}

/** Build a per-mode colorer + legend for one snapshot. */
export function buildColorer(model: ColorContext, snapshot: Snapshot, mode: ColorMode): Colorer {
  const files = snapshot.files

  if (mode === 'language') {
    const counts = new Map<string, number>()
    for (const f of files) {
      const { name } = languageOf(f.path)
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    const top = topBy(counts, LEGEND_MAX)
    // The scene keeps every language its own colour here — a language's colour
    // is its identity and folding them would be a bigger lie than the legend
    // running out of room. The legend just admits there are more.
    return {
      colorFor: (_f, i, out) => out.copy(model.langColors[i]),
      legend: categoricalLegend(top, counts.size, (name) => colorForLanguageName(name, files))
    }
  }

  if (mode === 'activity') {
    let min = Infinity
    let max = 0
    for (const f of files) {
      if (f.commits < min) min = f.commits
      if (f.commits > max) max = f.commits
    }
    if (files.length > 0 && min === max) {
      const n = max
      return flatColorer(ACTIVITY, 0.5, `All files: ${n} commit${n === 1 ? '' : 's'}`)
    }
    const top = Math.max(1, max)
    return {
      colorFor: (f, _i, out) => ramp(ACTIVITY, Math.sqrt(f.commits / top), out),
      legend: gradientLegend('Rarely', 'Often', ACTIVITY)
    }
  }

  if (mode === 'recency') {
    let min = Infinity
    let max = 0
    for (const f of files) {
      if (f.lastTouched < min) min = f.lastTouched
      if (f.lastTouched > max) max = f.lastTouched
    }
    if (files.length > 0 && min === max) {
      // the recent end, not the midpoint: everything here was touched by the
      // same commit, and that commit is the newest thing in the repository
      return flatColorer(RECENCY, 1, 'All files touched at the same time')
    }
    const span = Math.max(1, max - min)
    return {
      colorFor: (f, _i, out) => ramp(RECENCY, (f.lastTouched - min) / span, out),
      legend: gradientLegend('Long ago', 'Today', RECENCY)
    }
  }

  if (mode === 'size') {
    let min = Infinity
    let max = 0
    for (const f of files) {
      if (f.loc < min) min = f.loc
      if (f.loc > max) max = f.loc
    }
    if (files.length > 0 && min === max) {
      return flatColorer(SIZE, 0.5, `All files: ${max} line${max === 1 ? '' : 's'}`)
    }
    const top = Math.max(1, max)
    const norm = (loc: number): number => Math.sqrt(loc) / Math.sqrt(top)
    return {
      colorFor: (f, _i, out) => ramp(SIZE, norm(f.loc), out),
      legend: gradientLegend('Small', 'Large', SIZE)
    }
  }

  if (mode === 'author') {
    const counts = new Map<string, number>()
    for (const f of files) counts.set(f.lastAuthor, (counts.get(f.lastAuthor) ?? 0) + 1)
    const top = topBy(counts, LEGEND_MAX)
    // Unlike language, the tail is folded in the SCENE too: an author's colour
    // is arbitrary, so a swatch-less one tells the viewer nothing, and "Others"
    // at least means the same thing on the buildings as in the legend (#28).
    const shown = new Set(top)
    const others = new Color(OTHERS_COLOR)
    const cache = new Map<string, Color>()
    const colorOf = (name: string): Color => {
      if (!shown.has(name)) return others
      let c = cache.get(name)
      if (!c) {
        c = new Color(authorColor(name))
        cache.set(name, c)
      }
      return c
    }
    return {
      colorFor: (f, _i, out) => out.copy(colorOf(f.lastAuthor)),
      legend: categoricalLegend(top, counts.size, authorColor)
    }
  }

  // filetype / kind
  const present = new Set<FileKind>()
  for (const f of files) present.add(categorize(f.path))
  const kindColor = new Map<FileKind, Color>()
  ;(Object.keys(KIND_COLORS) as FileKind[]).forEach((k) =>
    kindColor.set(k, new Color(KIND_COLORS[k]))
  )
  const order: FileKind[] = ['code', 'test', 'config', 'docs', 'assets', 'other']
  return {
    colorFor: (f, _i, out) => out.copy(kindColor.get(categorize(f.path))!),
    legend: {
      gradient: false,
      items: order
        .filter((k) => present.has(k))
        .map((k) => ({ label: KIND_LABEL[k], color: KIND_COLORS[k] }))
    }
  }
}

function gradientLegend(from: string, to: string, stops: Color[]): Legend {
  return {
    gradient: true,
    items: [
      { label: from, color: `#${stops[0].getHexString()}` },
      ...stops.slice(1, -1).map((c) => ({ label: '', color: `#${c.getHexString()}` })),
      { label: to, color: `#${stops[stops.length - 1].getHexString()}` }
    ]
  }
}

function colorForLanguageName(name: string, files: FileState[]): string {
  const f = files.find((x) => languageOf(x.path).name === name)
  return f ? languageOf(f.path).color : '#888'
}
