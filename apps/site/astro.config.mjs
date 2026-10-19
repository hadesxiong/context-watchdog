// Astro 配置（落地页）
//
// 三条约束决定了这里几乎没什么可配的：
//   1. output: 'static' —— 全站零客户端 JS（唯一的例外是「复制」按钮）
//   2. 设计 token 走 @tokens 别名指向 packages/design-tokens/tokens.css，
//      与扩展同一个源 → 视觉结构上不可能漂移
//   3. 不引 Tailwind / 图标库 / 动效库 / web font：站点样式直接用 token 变量写普通 CSS，
//      图标用内联 SVG，字体用系统栈（顺带避开国内 web font 加载问题）
import { defineConfig } from 'astro/config'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = (p) => fileURLToPath(new URL(p, import.meta.url))

// 版本号在这里（配置阶段）从扩展 manifest 读出来，再经 vite.define 注入产物。
// 不能放到页面/数据模块里读：那些模块会被打包，运行时 import.meta.url 指向 dist 里的
// chunk，相对路径会整体偏移。配置文件的 import.meta.url 才指向真实位置。
const manifestPath = src('../../packages/extension/src/manifest.json')
let extensionVersion
try {
  extensionVersion = JSON.parse(readFileSync(manifestPath, 'utf8')).version
} catch (error) {
  throw new Error(
    `[site] 读不到扩展 manifest（${manifestPath}）：${error instanceof Error ? error.message : String(error)}`
  )
}
if (typeof extensionVersion !== 'string' || !/^\d+\.\d+\.\d+/.test(extensionVersion)) {
  throw new Error(`[site] 扩展 manifest 的 version 不合法：${JSON.stringify(extensionVersion)}`)
}

export default defineConfig({
  output: 'static',
  // 目录式输出：/en/ 而不是 /en.html（部署到 Cloudflare Pages 时路径更干净）
  build: { format: 'directory' },
  devToolbar: { enabled: false },
  vite: {
    define: {
      __EXTENSION_VERSION__: JSON.stringify(extensionVersion)
    },
    resolve: {
      alias: {
        // 与 packages/extension 的写法保持一致：@tokens/tokens.css
        '@tokens': src('../../packages/design-tokens'),
        '@site': src('./src')
      }
    }
  }
})
