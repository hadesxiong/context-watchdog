// 受保护站点（粘贴自动拦截）的规范化与匹配
// 纯逻辑供 service worker 与侧栏 UI 共用；单测见 tests/unit/sites.test.ts

// 站点列表在 chrome.storage.local 中的键
export const PROTECTED_SITES_KEY = 'contextwatchdog.protectedSites'

// 用户输入 → 站点匹配模式（查询与锚点丢弃，路径保留到最后一级）：
//   'chat.example.com'                → 'https://chat.example.com/*'
//   'deepseek.com'                    → 'https://deepseek.com/*'          （连同其所有子域一起生效）
//   '*.deepseek.com'                  → 'https://deepseek.com/*'          （'*.' 前缀可写可不写）
//   'https://chat.example.com/docs'   → 'https://chat.example.com/docs'     （只写一级路径也认）
//   'https://chat.example.com/docs/*' → 'https://chat.example.com/docs/*'   （子树写法）
//   'http://localhost:5173'           → 'http://localhost:5173/*'           （写 http = 协议不限）
// 无法识别返回 null
export const normalizeSiteInput = (raw: string): string | null => {
  const input = (raw ?? '').trim()
  if (!input) return null

  let url: URL
  try {
    // 无协议时默认按 https 处理
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`)
  } catch {
    return null
  }

  // 只接受 http/https（javascript:/data: 等一律拒绝）
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!url.hostname) return null

  // '*.' 只是「要覆盖子域」的书写提示——子域本就一并覆盖，星号不入库
  const hostname = url.hostname.startsWith('*.') ? url.hostname.slice(2) : url.hostname
  if (!hostname) return null

  // 域名需含点，或为 localhost / IPv4 字面量
  const isLocalhost = hostname === 'localhost'
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)
  if (!hostname.includes('.') && !isLocalhost && !isIpv4) return null
  const host = url.port ? `${hostname}:${url.port}` : hostname

  // 结尾斜杠与多余星号统一掉：'a.com/docs/' 与 'a.com/docs'、'a.com/docs/*' 各归各位
  const wildcard = /\*+$/.test(url.pathname)
  const path = url.pathname.replace(/\*+$/, '').replace(/\/+$/, '')
  if (!path || path === '/') return `${url.protocol}//${host}/*`
  return `${url.protocol}//${host}${path}${wildcard ? '/*' : ''}`
}

// 解析已存的站点模式。整站条目（…://host/*）的 prefix 为空串；
// 带路径的条目 prefix 形如 '/docs'（不含结尾斜杠）。
interface SitePatternSpec {
  scheme: string
  host: string
  prefix: string
}

const parseSitePattern = (pattern: string): SitePatternSpec | null => {
  const matched = /^(https?):\/\/([^/]+)(\/.*)?$/i.exec(pattern ?? '')
  if (!matched) return null
  const scheme = `${matched[1].toLowerCase()}:`
  // '*.a.com' 与 'a.com' 是同一件事（子域本就一并覆盖），读的时候抹平写法差异
  const rawHost = (matched[2] ?? '').toLowerCase()
  const host = rawHost.startsWith('*.') ? rawHost.slice(2) : rawHost
  const rest = matched[3] ?? ''
  if (!host) return null
  if (!rest || rest === '/' || rest === '/*') return { scheme, host, prefix: '' }

  // 只认「结尾一个 *」的子树写法；路径中间出现 * 的一律不认，
  // 免得出现没人解释得清的匹配行为
  const trimmed = rest.replace(/\/+$/, '')
  if (trimmed.endsWith('/*')) {
    const base = trimmed.slice(0, -2).replace(/\/+$/, '')
    return { scheme, host, prefix: base || '' }
  }
  if (trimmed.includes('*')) return null
  return { scheme, host, prefix: trimmed }
}

// 协议：写 http 的条目视为**协议不限**——站点常从 http 跳到 https，
// 用户照地址栏写的 http 也必须能命中；写 https 的条目只匹配 https。
const schemeMatches = (patternScheme: string, urlScheme: string): boolean =>
  patternScheme === 'http:' ? true : urlScheme === patternScheme

// 主机名：条目写什么就精确覆盖什么，**外加它的所有子域**——
// 用户输入 deepseek.com，chat.deepseek.com 也应受保护（不必逐个子域去加）。
// 前缀伪造吃不到后缀（evil.com.a.com 结尾不是 '.a.com'）；带端口的条目只做精确比对，
// 因为端口不同的子域对不上，与其猜不如交给用户显式写。
const hostMatches = (specHost: string, urlHost: string): boolean => {
  if (specHost === urlHost) return true
  if (specHost.includes(':')) return false
  return urlHost.endsWith(`.${specHost}`)
}

// 路径：整站条目放行所有路径；带路径的条目命中「该路径本身」及其子树
const pathMatches = (prefix: string, pathname: string): boolean => {
  if (!prefix) return true
  const target = pathname.replace(/\/+$/, '') || '/'
  return target === prefix || target.startsWith(`${prefix}/`)
}

// URL 命中的站点条目（多条命中时取最具体的那条，保证逐站开关的键唯一）。
// 返回的是用户列表里的原样字符串，可直接作为存储键。
export const matchedSitePattern = (url: string, patterns: string[]): string | null => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null

  let best: string | null = null
  let bestLength = -1
  let bestHostLength = -1
  for (const pattern of patterns) {
    const spec = parseSitePattern(pattern)
    if (!spec) continue
    if (!hostMatches(spec.host, parsed.host.toLowerCase())) continue
    if (!schemeMatches(spec.scheme, parsed.protocol)) continue
    if (!pathMatches(spec.prefix, parsed.pathname)) continue
    // 路径最长者优先；路径一样长时主机名更长的更具体
    //（deepseek.com 与 chat.deepseek.com 同时存在时，chat 页归 chat 那条管）
    const isMoreSpecific =
      spec.prefix.length > bestLength ||
      (spec.prefix.length === bestLength && spec.host.length > bestHostLength)
    if (isMoreSpecific) {
      best = pattern
      bestLength = spec.prefix.length
      bestHostLength = spec.host.length
    }
  }
  return best
}

// URL 是否命中任一模式
export const matchSite = (url: string, patterns: string[]): boolean =>
  matchedSitePattern(url, patterns) !== null

// 站点模式 → 申请/撤销 host 权限时用的 origin 列表。
// - 带路径的条目同时给出「精确路径」与「子树」两条：权限按 match pattern 逐条校验，
//   少一条就会出现「列表里有站点但页面没被注入」
// - 写 http 的条目协议不限，http 与 https 两条都要申请，否则跳到 https 后注入不了
// - 域名条目同时申请 '*.' 那条：match pattern 里 '*.a.com' 只吃子域、不吃本域，
//   少了它子域页面匹配得到却没权限注入（IP 与带端口的条目没有子域，不申请）
export const sitePermissionOrigins = (pattern: string): string[] => {
  const spec = parseSitePattern(pattern)
  if (!spec) return []
  const schemes = spec.scheme === 'http:' ? ['http', 'https'] : ['https']
  const paths = spec.prefix ? [spec.prefix, `${spec.prefix}/*`] : ['/*']
  const hasSubdomains =
    spec.host.includes('.') &&
    !spec.host.includes(':') &&
    !/^\d{1,3}(\.\d{1,3}){3}$/.test(spec.host)
  const hosts = hasSubdomains ? [spec.host, `*.${spec.host}`] : [spec.host]
  return schemes.flatMap(scheme =>
    hosts.flatMap(host => paths.map(path => `${scheme}://${host}${path}`))
  )
}

// 读取站点列表（storage 异常时按空列表处理，绝不让 SW 启动失败）
export const readProtectedSites = async (): Promise<string[]> => {
  try {
    const result = await chrome.storage.local.get(PROTECTED_SITES_KEY)
    const stored = result[PROTECTED_SITES_KEY]
    return Array.isArray(stored) ? stored.filter((site): site is string => typeof site === 'string') : []
  } catch {
    return []
  }
}
