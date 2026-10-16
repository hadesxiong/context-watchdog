import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './src/manifest.json' with { type: 'json' }

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    crx({ manifest })
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  build: {
    // transformers.js / onnxruntime-web 的实际体积（第三方模型运行时，无法再拆）
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'src/sidepanel/index.html'),
      }
    },
    // rolldown 专用配置（vite 8 底层）：
    // 屏蔽 node_modules 内 onnxruntime 的 DIRECT_EVAL 告警（第三方产物，不可控）
    // 其他位置（含我们自己的代码）出现 eval 告警仍然会正常报出
    rolldownOptions: {
      onwarn(warning: { code?: string; id?: string }, warn: (w: unknown) => void) {
        // rolldown 的直接 eval 告警 code 为 EVAL
        if (
          (warning.code === 'EVAL' || warning.code === 'DIRECT_EVAL') &&
          typeof warning.id === 'string' &&
          warning.id.includes('node_modules')
        ) {
          return
        }
        warn(warning)
      }
    }
  }
})
