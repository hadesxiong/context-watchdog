// 下载与站点链接
//
// 为什么单独成文件：上架状态是**会变的事实**，而不是文案。渠道还没上架时，
// 页面上必须明确显示「即将上架」，而不是给一个能点但打不开的链接——
// 一个死链比一句「还没有」更伤信任。
//
// links.json 是唯一需要手改的地方（F 阶段填入真实 URL）；这里做构建期校验：
// 声明 available: true 却没有 https URL，直接让构建失败。
import raw from './links.json'

export interface ChannelLink {
  url: string
  available: boolean
}

export interface SiteLinks {
  siteUrl: string
  repo: string
  releases: string
  edge: ChannelLink
  cws: ChannelLink
  amo: ChannelLink
  win: ChannelLink
  mac: ChannelLink
}

const links = raw as SiteLinks

const fail = (message: string): never => {
  throw new Error(`[site] links.json ${message}`)
}

const assertChannel = (key: 'edge' | 'cws' | 'amo' | 'win' | 'mac', label: string): void => {
  const channel = links[key]
  if (typeof channel !== 'object' || channel === null) fail(`缺少渠道 ${key}`)
  if (channel.available && !/^https:\/\/\S+$/.test(channel.url)) {
    fail(`渠道 ${key}（${label}）声明 available 但 url 不是 https 地址：${JSON.stringify(channel.url)}`)
  }
  if (!channel.available && channel.url !== '') {
    // 未上架却已填 URL，说明状态与链接不一致——通常是忘了改 available
    fail(`渠道 ${key}（${label}）未标记 available，却已填写 url；请同步 available: true`)
  }
}

assertChannel('edge', 'Edge Add-ons')
assertChannel('cws', 'Chrome Web Store')
assertChannel('amo', 'Firefox AMO')
assertChannel('win', 'Windows desktop app')
assertChannel('mac', 'macOS desktop app')

if (!/^https:\/\//.test(links.repo)) fail('repo 必须是 https 地址')
if (!/^https:\/\//.test(links.releases)) fail('releases 必须是 https 地址')

/** 站点自身的域名：F 阶段部署后填入；为空时页面渲染相对链接（不做假的 canonical） */
export const siteUrl = links.siteUrl
export const hasCanonicalOrigin = /^https:\/\//.test(siteUrl)

export const repoUrl = links.repo
export const releasesUrl = links.releases

/** 浏览器插件渠道：顺序即下拉面板里的行序（Chrome / Edge / Firefox）。
 *  available=false 时页面显示「即将上架」而不是死链 */
export const channels = [
  { key: 'cws' as const, ...links.cws },
  { key: 'edge' as const, ...links.edge },
  { key: 'amo' as const, ...links.amo }
]

/** 桌面应用渠道（与插件并列为第二个下载按钮组；未上架同样只显示「即将上架」） */
export const appChannels = [
  { key: 'win' as const, ...links.win },
  { key: 'mac' as const, ...links.mac }
]

/** 手动安装入口：始终可用（兜底路径，不依赖任何商店） */
export const manualZip = {
  url: links.releases,
  available: true
}
