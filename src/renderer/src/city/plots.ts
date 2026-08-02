import type { CityLayout } from '../layout/treemap'

/**
 * What a marker layer needs in order to find a file in a world.
 *
 * The city and the farm lay their files out with the *same* squarified treemap
 * and both keep the result on `layout` — the farm's `rects` are literally
 * `layout.plots.map((p) => p.rect)`. So the layers that draw a box around a
 * file (Highlight, StatusOverlay) can work against either world by asking for
 * this much and nothing more, instead of one being written against CityModel
 * and the farm going without.
 *
 * A third world gets those layers for free by satisfying these two.
 */
export interface PlotSource {
  indexOf: Map<string, number>
  layout: CityLayout
}

/** Whatever stands on each plot: building height in the city, crop on the farm. */
export interface HeightSource {
  heights: Float32Array
}
