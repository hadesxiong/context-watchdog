import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './packages/extension/src/manifest.json' with { type: 'json' }

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 仓库根（本配置文件所在目录）
const REPO_ROOT = __dirname
// 扩展包根：vite root 指向它，这样 manifest 里的入口路径保持
// `src/sidepanel/index.html` 这种"包内相对路径"，产物布局也就与重构前完全一致
// （dist/src/sidepanel/index.html），避免把 packages/extension/... 写进运行时 URL。
const EXT_ROOT = resolve(REPO_ROOT, 'packages/extension')

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
    root: EXT_ROOT,
    // public/ 与产物目录都留在仓库根：public 是仓库级共享资源（含 _locales），
    // 产物则是发布物（与 packages/ 同级更符合直觉）
    publicDir: resolve(REPO_ROOT, 'public'),
    plugins: [
      vue(),
      tailwindcss(),
      crx({ manifest })
    ],
    resolve: {
      alias: {
        // 扩展自身（宿主层）
        '@': resolve(EXT_ROOT, 'src'),
        // 检测引擎（纯逻辑，宿主无关）。硬约束见 packages/engine/README.md
        '@engine': resolve(REPO_ROOT, 'packages/engine/src'),
        // 设计 token 唯一来源（扩展与落地页共用）
        '@tokens': resolve(REPO_ROOT, 'packages/design-tokens'),
        // 打桩 gliner 静态引用的 ort GPU 子路径：剔除 21.3MB jsep.wasm 产物
        // （executionProvider 固定 'wasm'，运行时永远不拉 jsep；详见 shim 头注释）
        'onnxruntime-web/webgpu': resolve(EXT_ROOT, 'src/shims/ort-ep-stub.ts'),
        'onnxruntime-web/webgl': resolve(EXT_ROOT, 'src/shims/ort-ep-stub.ts')
      }
    },
    build: {
      outDir: resolve(REPO_ROOT, isFirefox ? 'dist-firefox' : 'dist'),
      emptyOutDir: true,
      // transformers.js / onnxruntime-web 的实际体积（第三方模型运行时，无法再拆）
      chunkSizeWarningLimit: 2500,
      rollupOptions: {
        input: {
          sidepanel: resolve(EXT_ROOT, 'src/sidepanel/index.html')
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
