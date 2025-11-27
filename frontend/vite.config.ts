import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',  // 👈 CHANGED FROM 3000
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path
      },
      '/socket.io': {
        target: 'http://localhost:3001',  // 👈 CHANGED FROM 3000
        ws: true,
        changeOrigin: true
      }
    }
  }
})