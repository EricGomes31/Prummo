import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // O frontend chama /api/...; em desenvolvimento isso é repassado para a API local.
    // API_URL permite apontar para outra instância da API.
    proxy: {
      '/api': {
        target: process.env.API_URL ?? 'http://127.0.0.1:3333',
        rewrite: (caminho) => caminho.replace(/^\/api/, ''),
      },
    },
  },
})
