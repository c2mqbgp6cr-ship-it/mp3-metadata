import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Electron loads the built index.html via the file:// protocol, where
  // Vite's default root-absolute asset paths (/assets/...) resolve to the
  // filesystem root instead of next to index.html and fail to load. A
  // relative base fixes that for the packaged app without affecting dev
  // mode or the Express-served build.
  base: './',
  plugins: [react()],
})
