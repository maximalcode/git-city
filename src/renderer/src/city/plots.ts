import type { CityLayout } from '../layout/treemap'

/** File-to-plot lookup used by selection, status and construction overlays. */
export interface PlotSource {
  indexOf: Map<string, number>
  layout: CityLayout
}

/** Building heights used by overlay markers. */
export interface HeightSource {
  heights: Float32Array
}
