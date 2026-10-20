# ContextWatchdog 落地页（`apps/site`）

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
    ├── env.d.ts              # __EXTENSION_VERSION__ / __SITE_LINKS__ 的类型声明
    ├── data/
    │   ├── links.ts          # 部署身份 → 页面链接（渠道 / 语言镜像 / 备案 / 收款码）
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
3. **未上架的渠道不渲染成链接**。渠道 URL 为空时页面显示「即将上架」，而不是一个点了
   打不开的 URL（也不是 `href=""`——那会刷新当前页）。URL 来自 `apps/site/.env`，
   见 `.env.example`；这些是**部署身份**（域名 / 商店页 / 备案号 / 收款码），不进仓库，
   因为 fork 之后不该静默继承别人的它们。

## 构建与交付

| 项 | 值 |
|---|---|
| 构建命令 | `npm run site:build` |
| 输出目录 | `apps/site/dist`（纯静态，零客户端 JS） |
| 配置来源 | `apps/site/.env`（gitignored）或同名 shell 环境变量 |

仓库的职责到 `dist/` 为止——怎么上传、证书、反向代理都属于托管环境，不在本仓库内。
换机器或 fork 时照 `.env.example` 复制一份 `.env` 即可。

发布构建建议加 `SITE_REQUIRE_URL=1`：缺 `SITE_URL` 时直接失败，而不是静默产出一份
canonical 是相对路径的线上站点。

部署前必须做的事：

1. `apps/site/.env`
   - `SITE_URL` 填真实域名。**留空时 canonical / og:url 会退化成相对路径**——本地预览无妨，
     线上必须先填，否则搜索引擎拿到的是不可解析的 canonical。
   - 渠道上架后在对应键填真实 URL（留空即「即将上架」；填了就必须是 https，否则构建失败）。
   - `GITEE_URL` 只在**镜像的 Release 已上传同样的 zip 之后**再填，否则中文页的下载会 404。
   - `ICP_BEIAN` / `POLICE_BEIAN`：空值不渲染页脚那一行。
2. `npm run site:evidence` —— 刷新页面上的测试/探针数（并提交 evidence.json）。
3. `npm run site:check && npm run site:build && npm run check:versions` —— 全部通过。
   `check-versions` 会逐个页面核对 canonical 是否指向**自己**（多语言站点最常见的错法
   是 canonical 写死首页，后果是所有子页不被收录且毫无报错），并核对产物里的域名
   与当前 `.env` 是否一致（改了 env 忘了重建会在这里被抓住）。
4. 生成 `supporters.json`（0 人时该区块自动隐藏）。录入任何姓名**必须事先取得本人同意**。
5. 补两项待作者产出的资产：演示动图（E8）与打赏收款码（E10，放本地由 `DONATE_QR` 指向，
   构建期内联成 data URI，图片本身不进仓库）。
6. 隐私权政策页（`/privacy/`、`/en/privacy/`）的内容与 README 的「数据流与隐私声明」一节同源：
   **改一处要一起改**，口径不一致在商店审核时会被追问。CWS 的表单里必填这个 URL。
