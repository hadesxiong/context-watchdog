// 下载与站点链接
//
// 数据来源是**构建期注入**的部署身份（astro.config.mjs 的 __SITE_LINKS__，
// 值来自 .env，见 .env.example）。这里只做「怎么用」，不做「值从哪来」：
// 解析与校验在 scripts/lib/site-links.mjs，那里是纯函数、有单测。
//
// 为什么拆开：这些值描述的是**这一份部署**，不是产品事实。源码公开，
// fork 之后不该静默继承作者的域名、商店页、备案号或收款码。
//
// 三条规则：
//   1. 渠道 URL 为空 ⇒ available=false ⇒ 页面渲染 aria-disabled 行 +「即将上架」。
//      不渲染 <a>，也就没有 href=""（会刷新当前页）这种假空链接。
//   2. 中文页的「源码 / 下载」指向镜像（Gitee），其余语言与全部深度链接指 GitHub。
//      深度链接（LICENSE / NOTICE / docs）固定 GitHub —— 镜像的默认分支名不一定
//      是 main，写死路径会 404。
//   3. Issues 不随语言切换：只有一个上游问题区，分裂成两个就没人在看。
import type { SiteLocale } from '@site/i18n'

const config = __SITE_LINKS__

/** 站点根地址；为空时 canonical 输出相对路径（仅本地预览 / fork） */
export const siteUrl = config.siteUrl
export const hasCanonicalOrigin = /^https:\/\//.test(siteUrl)

/** 上游仓库（GitHub）：深度链接与 Issues 永远用它 */
export const githubUrl = config.github

const repoBase = (locale: SiteLocale): string =>
  locale === 'zh' && config.gitee ? config.gitee : config.github

/** 「阅读源码」：中文页优先镜像 */
export const repoUrlFor = (locale: SiteLocale): string => repoBase(locale)

/** 「下载 / Release」：中文页优先镜像（镜像的 Release 也要上传同样的 zip） */
export const releasesUrlFor = (locale: SiteLocale): string => `${repoBase(locale)}/releases`

/** 问题反馈：固定上游 */
export const issuesUrlFor = (): string => `${githubUrl}/issues`

/** 深度链接固定上游（镜像的默认分支名不保证是 main） */
export const blobUrl = (path: string): string => `${githubUrl}/blob/main/${path}`
export const treeUrl = (path: string): string => `${githubUrl}/tree/main/${path}`

export interface ChannelLink {
  url: string
  available: boolean
}

export type StoreChannelKey = 'cws' | 'edge' | 'amo'
export type AppChannelKey = 'win' | 'mac'

const channel = <K extends StoreChannelKey | AppChannelKey>(key: K): ChannelLink & { key: K } => {
  const url = config.channels[key]
  return { key, url, available: url !== '' }
}

/** 浏览器插件渠道：顺序即下拉面板里的行序（Chrome / Edge / Firefox） */
export const storeChannels = [
  channel('cws'),
  channel('edge'),
  channel('amo')
]

/** 桌面应用渠道（与插件并列为第二个下载按钮组；未上架同样只显示「即将上架」） */
export const appChannels = [channel('win'), channel('mac')]

/** 手动安装入口：始终可用（兜底路径，不依赖任何商店） */
export const manualChannel = (locale: SiteLocale): ChannelLink & { key: 'manual' } => ({
  key: 'manual',
  url: releasesUrlFor(locale),
  available: true
})

/** 页脚备案（为空则不渲染该行） */
export const icp = config.icp
export const police = config.police

/** 收款码 data URI（支付宝 / 微信各一张；对应位为空则保留占位文案） */
export const donateQrAlipay = config.donateQrAlipay
export const donateQrWechat = config.donateQrWechat
