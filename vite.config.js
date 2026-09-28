import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  base: './',
  build: { 
    outDir: 'dist',
    rollupOptions: {
      external: ['better-sqlite3']
    }
  },
  server: {
    port: 5173,
    proxy: {
      // xfwd: pass the page's own host on, so the server's same-origin check
      // (API_KEY, cookie-authorised writes) recognises requests from :5173.
      '/api': { target: 'http://localhost:3421', changeOrigin: true, xfwd: true }
    }
  }
})
