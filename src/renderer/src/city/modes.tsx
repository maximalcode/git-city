import { Vector3, type Color } from 'three'
import type { ReactNode } from 'react'
import type { RepoAnalysis, Snapshot } from '../../../shared/types'
import type { ColorMode } from './colorModes'
import type { IconName } from '../lib/icons'
import { buildCityModel, snapshotTargets, type CityModel } from './cityData'
import { buildForestModel, forestTargets, type ForestModel } from '../layout/forest'
import { buildFarmModel, farmTargets, type FarmModel } from '../layout/farm'
import CityScene from './CityScene'
import ForestScene from './ForestScene'
import FarmScene from './FarmScene'

/**
 * The registry of view modes.
 *
 * Everything that used to be a `viewMode === 'city' ? … : …` ternary spread
 * across SceneView, Minimap, Onboarding and the palette lives here as one entry
 * per mode. Adding a mode is adding an entry plus its scene component.
 *
 * Each entry hands back a {@link PreparedScene} rather than exposing its model,
 * so the shell never learns a mode's shape — that is what removes the casts and
 * non-null assertions the old binary needed.
 */

export type ViewMode = 'city' | 'forest' | 'farm'

export interface MinimapDot {
  x: number
  z: number
  color: Color
}

export interface SceneProps {
  snapshot: Snapshot
  hotspots: string[]
  reviewPaths: string[]
}

/** What the shell needs from a mode once its model and targets are built. */
export interface PreparedScene {
  /** world extent, for the camera rig, fog and minimap scale */
  worldSize: number
  /** satisfies HudModel and ColorContext — both models already do */
  hud: { paths: string[]; langColors: Color[] }
  /** where the camera should fly for a file, or null if absent from this scene */
  focus(path: string): Vector3 | null
  dots(): MinimapDot[]
  render(props: SceneProps): ReactNode
}

export interface ModeDef {
  id: ViewMode
  name: string
  glyph: string
  icon: IconName
  hint: string
  /** heading for the first-run guide: "Reading the city" */
  noun: string
  /**
   * Ambient occlusion suits the city's boxy massing. On foliage it mostly
   * darkens the canopy interiors into mud, so modes opt in.
   */
  ao: boolean
  /** first-run guide rows; the colour row follows the active colour mode */
  rows(colorName: string): { icon: IconName; title: string; body: string }[]
  prepare(analysis: RepoAnalysis, snapshot: Snapshot, colorMode: ColorMode): PreparedScene
}

/** Rows every mode shares — the colour legend and the hotspot beacons. */
function commonRows(colorName: string): { icon: IconName; title: string; body: string }[] {
  return [
    {
      icon: 'color',
      title: `Colour = ${colorName.toLowerCase()}`,
      body: 'See the legend (bottom-right) for what each colour means.'
    },
    {
      icon: 'flame',
      title: 'Glowing beacons are hotspots',
      body: 'The files changing most this week.'
    }
  ]
}

// Per-analysis model caches: switching modes back and forth must not re-run the
// layout algorithms. Kept per mode so each owns its own memoisation.
const cityCache = new WeakMap<RepoAnalysis, CityModel>()
const forestCache = new WeakMap<RepoAnalysis, ForestModel>()
const farmCache = new WeakMap<RepoAnalysis, FarmModel>()

function cityModelFor(analysis: RepoAnalysis): CityModel {
  let m = cityCache.get(analysis)
  if (!m) {
    m = buildCityModel(analysis)
    cityCache.set(analysis, m)
  }
  return m
}

function forestModelFor(analysis: RepoAnalysis): ForestModel {
  let m = forestCache.get(analysis)
  if (!m) {
    m = buildForestModel(analysis)
    forestCache.set(analysis, m)
  }
  return m
}

function farmModelFor(analysis: RepoAnalysis): FarmModel {
  let m = farmCache.get(analysis)
  if (!m) {
    m = buildFarmModel(analysis)
    farmCache.set(analysis, m)
  }
  return m
}

const cityMode: ModeDef = {
  id: 'city',
  name: 'City',
  glyph: '🏙',
  icon: 'city',
  hint: 'Files as buildings in districts',
  noun: 'city',
  ao: true,
  rows: (colorName) => [
    { icon: 'city', title: 'Buildings are files', body: 'Taller = more lines of code.' },
    {
      icon: 'branch',
      title: 'Districts are folders',
      body: 'Nested plots mirror your directory tree.'
    },
    ...commonRows(colorName)
  ],
  prepare(analysis, snapshot, colorMode) {
    const model = cityModelFor(analysis)
    const targets = snapshotTargets(model, snapshot, colorMode)
    return {
      worldSize: model.citySize,
      hud: model,
      focus(path) {
        const i = model.indexOf.get(path)
        if (i === undefined) return null
        const { rect } = model.layout.plots[i]
        return new Vector3(rect.x + rect.w / 2, 5, rect.y + rect.h / 2)
      },
      dots() {
        return model.layout.plots.map((p, i) => ({
          x: p.rect.x + p.rect.w / 2,
          z: p.rect.y + p.rect.h / 2,
          color: model.langColors[i]
        }))
      },
      render: (props) => <CityScene model={model} targets={targets} {...props} />
    }
  }
}

const forestMode: ModeDef = {
  id: 'forest',
  name: 'Forest',
  glyph: '🌲',
  icon: 'forest',
  hint: 'Files as trees in folder groves',
  noun: 'forest',
  ao: false,
  rows: (colorName) => [
    { icon: 'forest', title: 'Trees are files', body: 'Bigger canopy = more lines of code.' },
    {
      icon: 'branch',
      title: 'Groves are folders',
      body: 'Each clearing gathers one directory’s files.'
    },
    ...commonRows(colorName)
  ],
  prepare(analysis, snapshot, colorMode) {
    const model = forestModelFor(analysis)
    const targets = forestTargets(model, snapshot, colorMode)
    return {
      worldSize: model.worldSize,
      hud: model,
      focus(path) {
        const i = model.indexOf.get(path)
        if (i === undefined) return null
        return new Vector3(model.positions[i * 3], 4, model.positions[i * 3 + 2])
      },
      dots() {
        return model.langColors.map((color, i) => ({
          x: model.positions[i * 3],
          z: model.positions[i * 3 + 2],
          color
        }))
      },
      render: (props) => <ForestScene model={model} targets={targets} {...props} />
    }
  }
}

const farmMode: ModeDef = {
  id: 'farm',
  name: 'Farm',
  glyph: '🚜',
  icon: 'farm',
  hint: 'Files as fields on a working farm',
  noun: 'farm',
  // the crop is foliage, not massing: AO just darkens it into mud
  ao: false,
  rows: (colorName) => [
    { icon: 'farm', title: 'Fields are files', body: 'Taller crop = more lines of code.' },
    {
      icon: 'branch',
      title: 'Parcels are folders',
      body: 'Each fenced holding gathers one directory, with its own barn.'
    },
    ...commonRows(colorName)
  ],
  prepare(analysis, snapshot, colorMode) {
    const model = farmModelFor(analysis)
    const targets = farmTargets(model, snapshot, colorMode)
    return {
      worldSize: model.worldSize,
      hud: model,
      focus(path) {
        const i = model.indexOf.get(path)
        if (i === undefined) return null
        return new Vector3(model.centers[i * 2], 3, model.centers[i * 2 + 1])
      },
      dots() {
        return model.langColors.map((color, i) => ({
          x: model.centers[i * 2],
          z: model.centers[i * 2 + 1],
          color
        }))
      },
      render: (props) => <FarmScene model={model} targets={targets} {...props} />
    }
  }
}

/** Every mode, in the order the picker and the `V` key cycle through them. */
export const MODES: ModeDef[] = [cityMode, forestMode, farmMode]

export const DEFAULT_MODE: ViewMode = 'city'

export function getMode(id: string): ModeDef {
  return MODES.find((m) => m.id === id) ?? MODES[0]
}

/** True only for an id the registry actually knows — used to validate storage. */
export function isViewMode(v: unknown): v is ViewMode {
  return typeof v === 'string' && MODES.some((m) => m.id === v)
}

/** The mode after `id`, wrapping — what the `V` key and the palette entry use. */
export function nextMode(id: ViewMode): ModeDef {
  const i = MODES.findIndex((m) => m.id === id)
  return MODES[(i + 1) % MODES.length]
}
