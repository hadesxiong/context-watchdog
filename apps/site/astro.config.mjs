// Astro 配置（落地页）
//
// 三条约束决定了这里几乎没什么可配的：
//   1. output: 'static' —— 全站零客户端 JS（唯一的例外是「复制」按钮）
//   2. 设计 token 走 @tokens 别名指向 packages/design-tokens/tokens.css，
//      与扩展同一个源 → 视觉结构上不可能漂移
//   3. 不引 Tailwind / 图标库 / 动效库 / web font：站点样式直接用 token 变量写普通 CSS，
//      图标用内联 SVG，字体用系统栈（顺带避开国内 web font 加载问题）
//
// 部署身份（域名 / 商店链接 / 备案号）全部来自环境变量，见 .env.example。
// 它们不进仓库，是因为源码公开：fork 之后不该静默继承作者的域名或商店页。
// 解析与校验在 scripts/lib/site-links.mjs（纯函数，有单测）。
//
// 注意：Astro 的 defineConfig 是恒等函数，**不支持回调式配置**（那是 Vite 的能力）。
// 所以 env 在模块顶层解析，mode 从命令行推断。
import { defineConfig } from 'astro/config'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
import { channelStates, resolveSiteLinks } from '../../scripts/lib/site-links.mjs'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
/** apps/site/ —— 也是 .env 的查找目录 */
const siteRoot = here('.')
const src = (p) => here(p)

// `astro build` / `astro dev` / `astro preview`：只影响读 .env.[mode]，不影响产物形态
const MODE = process.argv.includes('build') ? 'production' : 'development'

const env = loadEnv(MODE, siteRoot, '')

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

const packageJson = JSON.parse(readFileSync(src('../../package.json'), 'utf8'))
const links = resolveSiteLinks(env, { repository: packageJson.repository })

// 缺 SITE_URL 时：普通构建只警告（别人 clone / fork 也能构建出相对链接的产物），
// 但要发布时用 SITE_REQUIRE_URL=1 把自己钉死 —— 否则会静默产出一份没有 canonical
// 的线上站点，而 canonical 缺失不会让任何东西报错。
if (!links.siteUrl) {
  if (env.SITE_REQUIRE_URL === '1') {
    throw new Error(
      '[site] SITE_REQUIRE_URL=1 但 SITE_URL 为空：发布会产出没有 canonical 的站点。' +
        '请在 apps/site/.env 里配置 SITE_URL（见 .env.example）'
    )
  }
  console.warn(
    '[site] 未配置 SITE_URL：canonical / hreflang 将输出相对路径（仅适合本地预览与 fork）'
  )
}

// 未配置的渠道 = 页面上显示「即将上架」（不渲染 <a>，不是空 href）
const pendingChannels = channelStates(links)
  .filter((state) => !state.configured)
  .map((state) => state.key)
if (pendingChannels.length > 0) {
  console.warn(`[site] 未配置的渠道将显示「即将上架」：${pendingChannels.join(', ')}`)
}

export default defineConfig({
  output: 'static',
  // 目录式输出：/en/ 而不是 /en.html（静态托管时路径更干净）
  build: { format: 'directory' },
  devToolbar: { enabled: false },
  // 子路径部署：SITE_URL 形如 https://aa.bb.com/context-watchdog 时，pathname 派生出
  // base（根部署为 '' → '/'）。Astro **不会**从 site 的 pathname 推导 base，必须显式配；
  // 站内 href 的前缀来自 import.meta.env.BASE_URL（i18n.siteBase），与这里同源。
  base: links.basePath || '/',
  // canonical / og:url / hreflang 统一由它派生；为空时保持相对路径
  site: links.siteUrl || undefined,
  vite: {
    define: {
      __EXTENSION_VERSION__: JSON.stringify(extensionVersion),
      __SITE_LINKS__: JSON.stringify(links)
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
