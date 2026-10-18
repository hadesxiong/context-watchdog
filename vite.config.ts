import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './src/manifest.json' with { type: 'json' }

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 双目标构建：
//   npm run build          → dist/（Chrome，manifest 原样输出，零警告）
//   npm run build:firefox  → dist-firefox/（Firefox）
//
// 两个目标共用同一份输入 manifest（CRXJS 必须靠 side_panel / service_worker
// 发现入口，改动输入会导致漏打包），Firefox 专属的键转换统一由
// scripts/postbuild.mjs 在构建后完成。
export default defineConfig(({ mode }) => {
  const isFirefox = mode === 'firefox'

  return {
    plugins: [
      vue(),
      tailwindcss(),
      crx({ manifest })
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        // 打桩 gliner 静态引用的 ort GPU 子路径：剔除 21.3MB jsep.wasm 产物
        // （executionProvider 固定 'wasm'，运行时永远不拉 jsep；详见 shim 头注释）
        'onnxruntime-web/webgpu': resolve(__dirname, 'src/shims/ort-ep-stub.ts'),
        'onnxruntime-web/webgl': resolve(__dirname, 'src/shims/ort-ep-stub.ts')
      }
    },
    build: {
      outDir: isFirefox ? 'dist-firefox' : 'dist',
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
  }
})
