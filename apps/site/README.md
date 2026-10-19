# PasteGuard 落地页（`apps/site`）

Astro 静态站点，`output: 'static'`。产物是纯 HTML + 一个 CSS 文件，**零客户端 JS**
（`dist` 下不会出现 `.js`）。

## 本地

```bash
npm run site:dev        # 开发服务器
npm run site:build      # 构建 → apps/site/dist/
npm run site:preview    # 预览构建产物
npm run site:check      # astro check（Astro / TS 诊断）
```

> **不要**在 `apps/site` 里单独 `npm install`：仓库未启用 npm workspaces（留到本地代理阶段），
> Astro 装在仓库根 `devDependencies`，上述脚本用 `astro --root apps/site` 调用。

## 结构

```
apps/site/
├── astro.config.mjs          # output:static、@tokens / @site 别名、版本号注入
├── public/                   # favicon.svg、robots.txt
└── src/
    ├── env.d.ts              # __EXTENSION_VERSION__ 的类型声明
    ├── data/
    │   ├── links.json        # 渠道上架状态与链接（**唯一需要手改的数据**）
    │   ├── links.ts          # 构建期校验：available 与 url 必须自洽
    │   ├── evidence.json     # 测试/探针数（由 scripts/site-evidence.mjs 写入，勿手改）
    │   ├── evidence.ts
    │   ├── supporters.json   # 感谢墙名单（按时间升序）
    │   ├── supporters.ts     # 分档规则（纯函数，有单测）
    │   └── version.ts        # 版本号（构建期从扩展 manifest 注入）
    ├── i18n/{zh,en}.json     # 站点文案（两语言键集合一致由单测强制）
    ├── i18n/index.ts         # 类型层面的翻译完整性检查 + 插值 / 粗体解析
    ├── layouts/Base.astro    # <head>（hreflang / canonical / og）+ 页头 + 页脚
    ├── components/           # Mark / Rich / Download / Thanks / PrivacyBody / Landing
    └── pages/
        ├── index.astro       # 中文首页（默认语言，根路径 /）
        ├── en/index.astro    # 英文首页（/en/）
        ├── privacy.astro     # 中文隐私权政策（/privacy/）
        └── en/privacy.astro  # 英文隐私权政策（/en/privacy/）
```

## 三条不改的原则

1. **视觉来自 `packages/design-tokens/tokens.css`**（经 `@tokens` 别名 `@import`），
   与扩展同一个源——两边配色/圆角结构上不可能漂移。站点不引 Tailwind。
2. **版本号与测试数不手写**。版本号构建期从 `packages/extension/src/manifest.json` 注入
   （`vite.define` → `__EXTENSION_VERSION__`）；测试数与探针数由
   `npm run site:evidence` 跑一遍真实套件后写入 `evidence.json`。
3. **未上架的渠道不渲染成链接**。`links.json` 里 `available: false` 时页面显示「即将上架」，
   而不是一个点了打不开的 URL。状态与链接不一致会让构建直接失败。

## 部署（Cloudflare Pages）

| 项 | 值 |
|---|---|
| 构建命令 | `npm run site:build` |
| 输出目录 | `apps/site/dist` |
| 根目录 | 仓库根 |
| Node 版本 | 20 或以上（本仓库开发环境为 24） |

部署前必须做的事（对照 `docs/design/roadmap.md` 的 E 段）：

1. `apps/site/src/data/links.json`
   - 把 `siteUrl` 填成真实域名。**留空时 canonical / og:url 会退化成相对路径**——本地构建无妨，
     线上必须先填，否则搜索引擎拿到的是不可解析的 canonical。
   - 渠道上架后同步 `available: true` 并填 `url`（两者必须同时改，否则构建失败）。
2. `npm run site:evidence` —— 刷新页面上的测试/探针数（并提交 evidence.json）。
3. `npm run site:check && npm run site:build && npm run check:versions` —— 全部通过。
   `check-versions` 会逐个页面核对 canonical 是否指向**自己**（多语言站点最常见的错法
   是 canonical 写死首页，后果是所有子页不被收录且毫无报错）。
4. 生成 `supporters.json`（0 人时该区块自动隐藏）。录入任何姓名**必须事先取得本人同意**。
5. 补两项待作者产出的资产：演示动图（E8）与打赏收款码（E10）。当前页面对两者都是明确的占位文案，
   不会显示成坏图。
6. 隐私权政策页（`/privacy/`、`/en/privacy/`）的内容与 README 的「数据流与隐私声明」一节同源：
   **改一处要一起改**，口径不一致在商店审核时会被追问。CWS 的表单里必填这个 URL。

> 部署完把 `siteUrl` 的域名写进仓库的 `README`/Release 说明，并做一次互链检查（F7）。
