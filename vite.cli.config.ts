import { resolve } from 'path'
import { defineConfig } from 'vite'

/** Bundles the headless `labsim` CLI for Node (npm run labsim -- run <project>). */
export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  build: {
    ssr: resolve(__dirname, 'src/cli/labsim.ts'),
    outDir: 'out/cli',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    rollupOptions: { output: { format: 'cjs', entryFileNames: 'labsim.cjs' } }
  }
})
