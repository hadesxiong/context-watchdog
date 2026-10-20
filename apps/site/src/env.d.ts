/// <reference types="astro/client" />

/** 由 astro.config.mjs 经 vite.define 注入：扩展 manifest 里的版本号 */
declare const __EXTENSION_VERSION__: string

/**
 * 由 astro.config.mjs 经 vite.define 注入的部署身份（见 .env.example）。
 *
 * 为什么是构建期常量而不是运行时读取：静态站没有运行时；而且这些值必须在
 * prerender 阶段就固化成 HTML（canonical、商店链接），不能等客户端。
 */
interface SiteLinksChannels {
  cws: string
  edge: string
  amo: string
  win: string
  mac: string
}

interface SiteLinksConfig {
  /** 站点根地址，如 https://example.com；未配置时为 ''（canonical 退化为相对路径） */
  siteUrl: string
  /** 由 package.json 的 repository 派生，不是环境变量 */
  github: string
  /** 中文页的镜像仓库（如 Gitee）；为空则回退 GitHub */
  gitee: string
  /** 渠道 URL：为空表示未上架，页面渲染「即将上架」而非死链 */
  channels: SiteLinksChannels
  /** 备案号（为空则不渲染页脚那一行） */
  icp: string
  /** 公安网备（可选） */
  police: string
  /** 收款码的 data URI（构建期内联；为空则保留占位文案） */
  donateQr: string
}

declare const __SITE_LINKS__: SiteLinksConfig
