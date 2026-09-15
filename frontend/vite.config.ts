import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// El daemon Go escucha en 127.0.0.1:7411 (ver docs/ARCHITECTURE.md §6). En
// desarrollo Vite hace de proxy para que el frontend hable siempre con `/api`
// y no tenga que conocer el puerto.
const CORE_ORIGIN = process.env.SAVEME_CORE_ORIGIN ?? 'http://127.0.0.1:7411'

export default defineConfig({
  plugins: [
    // El generador de rutas debe ir antes que el plugin de React.
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routesDirectory: './src/routes',
      generatedRouteTree: './src/routeTree.gen.ts',
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    proxy: {
      '/api': {
        target: CORE_ORIGIN,
        changeOrigin: true,
        // El stream SSE no debe pasar por el buffer del proxy.
        ws: false,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
  clearScreen: false,
})
