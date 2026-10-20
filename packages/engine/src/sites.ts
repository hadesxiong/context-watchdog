// 受保护站点（粘贴自动拦截）的规范化与匹配
// 纯逻辑供 service worker 与侧栏 UI 共用；单测见 tests/unit/sites.test.ts

// 站点列表在 chrome.storage.local 中的键
export const PROTECTED_SITES_KEY = 'contextwatchdog.protectedSites'

// 用户输入 → 站点匹配模式（只保留 origin，路径与查询丢弃）：
//   'chat.example.com'             → 'https://chat.example.com/*'
//   'https://chat.example.com/p'   → 'https://chat.example.com/*'
//   'http://localhost:5173'        → 'http://localhost:5173/*'
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

  // 域名需含点，或为 localhost / IPv4 字面量
  const isLocalhost = url.hostname === 'localhost'
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname)
  if (!url.hostname.includes('.') && !isLocalhost && !isIpv4) return null

  return `${url.protocol}//${url.host}/*`
}

// URL 是否命中任一模式（模式形如 https://host[:port]/*；子域需单独添加）
export const matchSite = (url: string, patterns: string[]): boolean => {
  if (!patterns.length) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false

  const target = `${parsed.protocol}//${parsed.host}/`
  return patterns.some(pattern => {
    const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern
    return target.startsWith(prefix)
  })
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
