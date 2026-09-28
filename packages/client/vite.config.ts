import { defaultClientConditions, defineConfig } from 'vite'

export default defineConfig({
  // Reachable from the other screens on the network, not just this one.
  server: { host: true },
  // Resolve workspace packages to their TypeScript sources so Vite compiles
  // shared logic straight from source during both dev and build. The defaults
  // have to be carried along: `conditions` replaces them rather than adding to
  // them, so listing `development` alone drops `browser` and `module` and
  // dependencies like three resolve through the wrong entry.
  resolve: {
    conditions: ['development', ...defaultClientConditions],
  },
})
