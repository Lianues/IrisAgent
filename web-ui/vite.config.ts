import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    // 开发时代理 API 请求到后端
    proxy: {
      '/api': 'http://localhost:8192',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
