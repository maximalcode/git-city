// Browser-only preview of the renderer (no Electron) — used for quick visual
// checks of the 3D city with mocked data. The real app runs via `npm run dev`.
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src')
    }
  },
  plugins: [react()],
  server: {
    port: 5199
  }
})
