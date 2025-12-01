import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Use non-default port to avoid conflicts. Override with FLOWRIDER_DEV_PORT env var.
const DEV_PORT = parseInt(process.env.FLOWRIDER_DEV_PORT || '5199', 10)

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
  server: {
    port: DEV_PORT,
    strictPort: true,
    hmr: {
      host: 'localhost',
      protocol: 'ws',
    },
    cors: true,
  },
})
