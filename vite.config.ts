import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import { legacyApiPlugin } from './server/legacyApiPlugin'
import { comfyApiPlugin } from './server/apiPlugin'

export default defineConfig({
  plugins: [
    vue(),
    legacyApiPlugin(),
    comfyApiPlugin()
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    // 端口被占就直接报错，不要悄悄换到 5174：否则容易连到旧实例（接口缺失、表现诡异）
    strictPort: true,
    proxy: {
      '/comfyui-proxy': {
        target: 'http://127.0.0.1:8188',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/comfyui-proxy/, ''),
        ws: true
      }
    }
  }
})
