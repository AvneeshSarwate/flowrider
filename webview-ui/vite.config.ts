import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '', // important – no leading slash
  build: {
    outDir: '../media',
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      output: {
        // Inline dynamic imports to avoid CSP issues with mermaid
        inlineDynamicImports: true,
      },
    },
  },
  optimizeDeps: {
    include: ['mermaid'],
  },
})
