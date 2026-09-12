import { defineConfig } from 'vite'

export default defineConfig({
  // Resolve workspace packages to their TypeScript sources so Vite compiles
  // shared logic straight from source during both dev and build.
  resolve: {
    conditions: ['development'],
  },
})