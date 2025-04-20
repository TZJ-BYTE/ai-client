import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  server: {
    port: 5174,
    host: '0.0.0.0',
    proxy: {
      '/chat': {
        target: 'ws://localhost:4388',
        changeOrigin: true,
        ws: true
      }
    }
  }
})
