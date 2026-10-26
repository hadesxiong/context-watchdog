/// <reference types="astro/client" />

/** 由 astro.config.mjs 经 vite.define 注入：扩展 manifest 里的版本号 */
declare const __EXTENSION_VERSION__: string

/**
 * 由 astro.config.mjs 经 vite.define 注入的部署身份（见 .env.example）。
 * 只能是构建期常量：静态站没有运行时，且 canonical / 商店链接必须在 prerender 阶段固化成 HTML。
 */
interface SiteLinksChannels {
  cws: string
  edge: string
  amo: string
  win: string
  mac: string
}

interface SiteLinksConfig {
  /** 站点部署地址（可带子路径）；'' = canonical 退化为相对路径 */
  siteUrl: string
  /** 由 siteUrl 的 pathname 派生的部署子路径：根部署为 ''，否则 '/sub'（无尾斜杠） */
  basePath: string
  github: string
  /** 中文页的镜像仓库（如 Gitee），空则回退 GitHub（github 由 package.json 的 repository 派生） */
  gitee: string
  /** 渠道 URL：空 = 未上架，渲染「即将上架」而非死链 */
  channels: SiteLinksChannels
  /** 备案号 / 公安网备（空则不渲染页脚那一行） */
  icp: string
  police: string
}

declare const __SITE_LINKS__: SiteLinksConfig

/**
 * 由 astro.config.mjs 经 vite.define 注入的访问统计参数（UMAMI_* env，见 .env.example）。
 * enabled=false 时 Base.astro 不渲染 <script is:inline>；warnings 只在配置阶段打印。
 */
interface UmamiConfig {
  /** 启用对（WEBSITE_ID + SCRIPT_URL）齐全且处于构建模式时为 true */
  enabled: boolean
  /** → data-website-id */
  websiteId: string
  /** → script src；也是 check:versions 外链白名单的比对值 */
  scriptUrl: string
  /** → data-host-url；空串 = 不输出该属性 */
  hostUrl: string
  /** → data-do-not-track="true"；false = 不输出该属性 */
  dnt: boolean
  warnings: string[]
}

declare const __UMAMI__: UmamiConfig
