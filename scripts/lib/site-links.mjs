// 落地页「部署身份」（域名 / 商店页 / 备案号）的解析与校验：不进仓库——fork 不应静默
// 继承作者的部署身份；校验集中在此，拼错的地址建站时即报错，而不是等用户点出 404。

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

const stripTrailingSlash = (value) => value.replace(/\/+$/, '')

/**
 * 解析一个 https 基础地址；空值返回 ''（= 未配置，页面据此降级）。
 * @param {string} label 用于报错文案（环境变量名或「package.json 的 repository」）
 * @param {{ allowPath?: boolean, allowSitePath?: boolean }} [options] allowPath 允许任意路径（渠道页本身是具体页面），allowSitePath 允许站点部署在子路径
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
      // 产物默认是根地址形态；不显式允许子路径就报错，免得 canonical 与 base 各自猜路径
      throw new Error(`${label} 必须是站点根地址、不能带路径：${raw}`)
    }
    // 空段「//」会让站内链接变成协议相对地址（//foo/... 被浏览器读成 host=foo），是最难查的一类坏链接，挡在建站前
    if (url.pathname.includes('//')) {
      throw new Error(`${label} 的子路径不能包含空段「//」：${raw}`)
    }
  }
  return stripTrailingSlash(url.href)
}

/**
 * 从已归一化的站点地址派生部署子路径：根地址 → ''，带路径 → '/sub'（无尾斜杠）。astro.config.mjs
 * 的 base 取自它：SITE_URL 是 base 与 canonical 的唯一来源，两者不会不同步。
 * @param {string} siteUrl parseHttpsBase 的返回值
 */
export function basePathFrom(siteUrl) {
  if (!siteUrl) return ''
  const pathname = new URL(siteUrl).pathname
  return pathname === '/' ? '' : pathname.replace(/\/+$/, '')
}

/**
 * 把 package.json 的 repository 归一成 https 地址（接受 `git+https://host/o/r.git`、
 * `https://host/o/r`、`git@host:o/r.git` 三种写法）。
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

/** 解析全部部署身份；空值一律折叠成 ''（调用方据此降级），非法值直接抛错。 */
export function resolveSiteLinks(env, pkg = {}) {
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

/**
 * 解析可选的自托管 Umami 统计参数；留空不注入，启用后缺一抛错。WEBSITE_ID 会原样进入
 * HTML 属性，因此禁空白与引号/尖括号。
 * @returns {{ enabled: boolean, websiteId: string, scriptUrl: string, hostUrl: string, dnt: boolean, warnings: string[] }}
 */
export function resolveUmami(env) {
  const websiteId = read(env, 'UMAMI_WEBSITE_ID')
  const scriptUrl = parseHttpsBase(read(env, 'UMAMI_SCRIPT_URL'), 'UMAMI_SCRIPT_URL', {
    allowPath: true
  })
  const hostUrl = parseHttpsBase(read(env, 'UMAMI_HOST_URL'), 'UMAMI_HOST_URL', { allowPath: true })
  const dntRaw = read(env, 'UMAMI_DNT')

  if (/[\s"'<>]/.test(websiteId)) {
    throw new Error('UMAMI_WEBSITE_ID 不应包含空白或引号/尖括号（它会原样进入 HTML 属性）')
  }
  if (dntRaw !== '' && dntRaw !== 'true' && dntRaw !== 'false') {
    throw new Error(`UMAMI_DNT 只接受 true / false（当前 ${JSON.stringify(dntRaw)}）`)
  }
  if (Boolean(websiteId) !== Boolean(scriptUrl)) {
    throw new Error(
      'UMAMI_WEBSITE_ID 与 UMAMI_SCRIPT_URL 必须同填：' +
        '只有 ID 没有脚本地址（统计发不出去），或只有地址没有 ID（不知道记给谁站）都不允许'
    )
  }

  const enabled = websiteId !== ''
  const warnings = []
  if (!enabled && (hostUrl !== '' || dntRaw !== '')) {
    warnings.push(
      'UMAMI_HOST_URL / UMAMI_DNT 已设置但统计未启用（缺 UMAMI_WEBSITE_ID 或 UMAMI_SCRIPT_URL），本次不注入'
    )
  }

  return { enabled, websiteId, scriptUrl, hostUrl, dnt: dntRaw === 'true', warnings }
}

/** 渠道状态摘要（check-versions 与构建日志共用，避免两处各写一套判断） */
export function channelStates(links) {
  return CHANNEL_KEYS.map((key) => ({
    key,
    configured: links.channels[key] !== '',
    url: links.channels[key]
  }))
}
