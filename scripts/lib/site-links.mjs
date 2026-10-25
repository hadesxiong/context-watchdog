// 落地页「部署身份」的解析与校验（astro.config.mjs 与单测共用）
//
// 为什么这些值不进仓库：源码是公开的，而它们描述的是**这份部署**——
// 域名、商店上架状态、备案号。别人 fork 之后不应该静默继承它们：
//   · 域名被人继承 → canonical / hreflang 指向作者的站；
//   · 商店链接被继承 → fork 的用户被导流到作者的插件页；
//   · 备案号被继承 → 属于冒用备案（法律问题）。
//
// 与之相对，**产品事实**（有哪些渠道、什么顺序、什么文案）留在仓库里，
// 因为护栏要能校验它，而且 fork 也应该看到它。
//
// 校验集中在这里而不是散落在模板里：一个拼错的 https 地址应该在建站时
// 就炸掉，而不是等用户点出一个 404。

/** 渠道键 → 环境变量名。顺序与页面行序无关（那是 links.ts 的事）。 */
export const CHANNEL_ENV = {
  cws: 'CWS_URL',
  edge: 'EDGE_URL',
  amo: 'AMO_URL',
  win: 'WIN_URL',
  mac: 'MAC_URL'
}

export const CHANNEL_KEYS = Object.keys(CHANNEL_ENV)

const read = (env, key) => {
  const value = env?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

/** 去掉末尾斜杠（保留协议与主机；子路径的归一化见下方校验与 basePathFrom） */
const stripTrailingSlash = (value) => value.replace(/\/+$/, '')

/**
 * 解析一个 https 基础地址；空值返回 ''（= 未配置，页面据此降级）。
 * @param {string} raw
 * @param {string} label 用于报错文案（环境变量名或「package.json 的 repository」）
 * @param {{ allowPath?: boolean, allowSitePath?: boolean }} [options]
 *   - allowPath：渠道 / 镜像地址本身是具体页面，允许任意路径
 *   - allowSitePath：站点地址允许部署在子路径（由 pathname 派生 Astro 的 base）
 */
export function parseHttpsBase(raw, label, options = {}) {
  const value = stripTrailingSlash(typeof raw === 'string' ? raw.trim() : '')
  if (!value) return ''

  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${label} 不是合法 URL：${JSON.stringify(raw)}`)
  }
  if (url.protocol !== 'https:') {
    throw new Error(`${label} 必须是 https 地址（当前 ${url.protocol}）：${raw}`)
  }
  if (url.search || url.hash) {
    throw new Error(`${label} 不应带查询串或锚点：${raw}`)
  }
  if (url.pathname !== '/' && !options.allowPath) {
    if (!options.allowSitePath) {
      // 根地址（格式为 directory 的静态产物）是默认形态。不显式允许子路径就报错，
      // 免得 canonical / base 各自猜一个路径出来（见 basePathFrom）。
      throw new Error(`${label} 必须是站点根地址、不能带路径：${raw}`)
    }
    // 空段「//」会让派生出的子路径以 // 开头，站内链接随即变成**协议相对地址**
    // （//foo/... 会被浏览器理解成 host=foo），是最难查的一类坏链接，直接挡在建站前。
    if (url.pathname.includes('//')) {
      throw new Error(`${label} 的子路径不能包含空段「//」：${raw}`)
    }
  }
  return stripTrailingSlash(url.href)
}

/**
 * 从**已归一化**的站点地址派生部署子路径：根地址 → ''，带路径 → '/sub'（无尾斜杠）。
 * astro.config.mjs 的 base 就来自它——SITE_URL 是 base 与 canonical 的唯一来源，
 * 两者不可能不同步。未配置（''）时同样返回 ''，产物与根路径部署完全一致。
 * @param {string} siteUrl parseHttpsBase 的返回值
 */
export function basePathFrom(siteUrl) {
  if (!siteUrl) return ''
  const pathname = new URL(siteUrl).pathname
  return pathname === '/' ? '' : pathname.replace(/\/+$/, '')
}

/**
 * 把 package.json 的 repository 归一成 https 地址。
 * 支持 `git+https://host/o/r.git`、`https://host/o/r`、`git@host:o/r.git`。
 * @param {unknown} repository package.json 的 repository 字段（对象或字符串）
 */
export function normalizeRepository(repository) {
  const raw =
    typeof repository === 'string'
      ? repository
      : repository && typeof repository === 'object' && typeof repository.url === 'string'
        ? repository.url
        : ''
  if (!raw.trim()) {
    throw new Error('package.json 缺少 repository：落地页的源码 / Release 链接由它派生（fork 请改这一处）')
  }

  let value = raw.trim().replace(/^git\+/, '')
  // git@github.com:owner/repo.git → https://github.com/owner/repo
  const scp = /^git@([^:]+):(.+)$/.exec(value)
  if (scp) value = `https://${scp[1]}/${scp[2]}`
  value = value.replace(/\.git$/, '').replace(/\/+$/, '')

  const url = new URL(value)
  if (url.protocol !== 'https:' || url.search || url.hash) {
    throw new Error(`package.json 的 repository 不是可用的 https 地址：${JSON.stringify(raw)}`)
  }
  return stripTrailingSlash(url.href)
}

/**
 * 解析全部部署身份。空值一律折叠成 ''（调用方据此降级），非法值直接抛错。
 * @param {Record<string, string | undefined>} env
 * @param {{ repository?: unknown }} pkg
 */
export function resolveSiteLinks(env, pkg = {}) {
  // 站点地址允许带子路径（如 https://aa.bb.com/context-watchdog）：pathname 派生 Astro 的 base
  const siteUrl = parseHttpsBase(read(env, 'SITE_URL'), 'SITE_URL', { allowSitePath: true })

  const channels = {}
  for (const key of CHANNEL_KEYS) {
    const label = CHANNEL_ENV[key]
    channels[key] = parseHttpsBase(read(env, label), label, { allowPath: true })
  }

  return {
    siteUrl,
    basePath: basePathFrom(siteUrl),
    github: normalizeRepository(pkg.repository),
    gitee: parseHttpsBase(read(env, 'GITEE_URL'), 'GITEE_URL', { allowPath: true }),
    channels,
    icp: read(env, 'ICP_BEIAN'),
    police: read(env, 'POLICE_BEIAN')
  }
}

/** 渠道状态摘要（check-versions 与构建日志共用，避免两处各写一套判断） */
export function channelStates(links) {
  return CHANNEL_KEYS.map((key) => ({
    key,
    configured: links.channels[key] !== '',
    url: links.channels[key]
  }))
}
