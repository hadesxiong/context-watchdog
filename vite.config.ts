import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './packages/extension/src/manifest.json' with { type: 'json' }

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const REPO_ROOT = __dirname
// 扩展包根：vite root 指向它，manifest 入口路径保持包内相对形式，产物布局与重构前一致。
// 两目标（Chrome dist/ / Firefox dist-firefox/）共用同一份输入 manifest（CRXJS 靠 side_panel /
// service_worker 发现打包入口，分叉输入会漏打包）；Firefox 键转换见 postbuild.mjs，背景见 docs/spec.md §11。
const EXT_ROOT = resolve(REPO_ROOT, 'packages/extension')

export default defineConfig(({ mode }) => {
  const isFirefox = mode === 'firefox'

  return {
    root: EXT_ROOT,
    // public/ 与产物目录都留在仓库根（public 是仓库级共享资源，产物是发布物）
    publicDir: resolve(REPO_ROOT, 'public'),
    plugins: [
      vue(),
      tailwindcss(),
      crx({ manifest })
    ],
    resolve: {
      alias: {
        '@': resolve(EXT_ROOT, 'src'),
        // 检测引擎（纯逻辑，宿主无关）。硬约束见 docs/spec.md §15
        '@engine': resolve(REPO_ROOT, 'packages/engine/src'),
        // 设计 token 唯一来源（扩展与落地页共用）
        '@tokens': resolve(REPO_ROOT, 'packages/design-tokens'),
        // 打桩 gliner 静态引用的 ort GPU 子路径，剔除 21.3MB jsep.wasm（executionProvider
        // 固定 'wasm'，运行时不会拉 jsep；详见 shim 头注释）
        'onnxruntime-web/webgpu': resolve(EXT_ROOT, 'src/shims/ort-ep-stub.ts'),
        'onnxruntime-web/webgl': resolve(EXT_ROOT, 'src/shims/ort-ep-stub.ts')
      }
    },
    build: {
      outDir: resolve(REPO_ROOT, isFirefox ? 'dist-firefox' : 'dist'),
      emptyOutDir: true,
      // transformers.js / onnxruntime-web 的实际体积（第三方模型运行时，无法再拆）
      chunkSizeWarningLimit: 2500,
      // rolldown 专用（vite 8 底层）：额外的 HTML 入口要写在 rolldownOptions.input，
      // 写在 rollupOptions.input 里会被静默丢弃
      rolldownOptions: {
        input: {
          // offscreen 模型宿主不由 manifest 声明（Chrome 运行时 createDocument），CRXJS 发现
          // 不了它，必须显式加进 input；Firefox 没有 chrome.offscreen，不产出该入口。
          ...(isFirefox ? {} : { offscreen: resolve(EXT_ROOT, 'src/offscreen/index.html') })
        },
        onwarn(warning: { code?: string; id?: string }, warn: (w: unknown) => void) {
          // 屏蔽 node_modules 内 onnxruntime 的 DIRECT_EVAL/EVAL 告警（第三方产物不可控），
          // 自家代码里的 eval 仍会正常报出
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
