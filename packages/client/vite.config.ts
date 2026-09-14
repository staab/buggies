import { defaultClientConditions, defineConfig } from 'vite'

export default defineConfig({
  // Resolve workspace packages to their TypeScript sources so Vite compiles
  // shared logic straight from source during both dev and build. The defaults
  // have to be carried along: `conditions` replaces them rather than adding to
  // them, and dropping `browser` and `module` leaves dependencies like three
  // resolving differently for the dependency scanner than for the server, which
  // re-optimizes mid-load and forces the page to reload.
  resolve: {
    conditions: ['development', ...defaultClientConditions],
  },
})
