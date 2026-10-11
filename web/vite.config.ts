/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves the site from https://<user>.github.io/Bananahacks-/
  base: '/Bananahacks-/',
  plugins: [react()],
  test: {
    // Engine tests are pure TypeScript, so a plain Node environment is enough (and fast).
    environment: 'node',
  },
})
