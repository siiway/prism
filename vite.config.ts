import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxy API calls to wrangler dev (port 8787) during development
      '/api': 'http://localhost:8787',
    },
  },
})
