// 单元用例 - 受保护站点的规范化与匹配（粘贴自动拦截）
import { describe, it, expect } from 'vitest'
import {
  normalizeSiteInput,
  matchSite,
  matchedSitePattern,
  sitePermissionOrigins
} from '@engine/sites'

describe('normalizeSiteInput', () => {
  it('裸域名默认按 https 处理', () => {
    expect(normalizeSiteInput('chat.example.com')).toBe('https://chat.example.com/*')
    expect(normalizeSiteInput('  chat.example.com  ')).toBe('https://chat.example.com/*')
    expect(normalizeSiteInput('localhost')).toBe('https://localhost/*') // 无协议默认 https
  })

  it("'*.' 前缀被抹平（子域本来一并覆盖，星号不入库）", () => {
    expect(normalizeSiteInput('*.deepseek.com')).toBe('https://deepseek.com/*')
    expect(normalizeSiteInput('https://*.chat.example.com/docs')).toBe(
      'https://chat.example.com/docs'
    )
  })

  it('根路径整站收口成 …/*', () => {
    expect(normalizeSiteInput('https://chat.example.com')).toBe('https://chat.example.com/*')
    expect(normalizeSiteInput('https://chat.example.com/')).toBe('https://chat.example.com/*')
    expect(normalizeSiteInput('https://chat.example.com/?q=1#x')).toBe('https://chat.example.com/*')
  })

  it('路径保留到最后一级（查询与锚点丢弃）', () => {
    expect(normalizeSiteInput('https://chat.example.com/docs')).toBe('https://chat.example.com/docs')
    expect(normalizeSiteInput('https://chat.example.com/docs/')).toBe('https://chat.example.com/docs')
    expect(normalizeSiteInput('https://chat.example.com/docs?q=1#x')).toBe('https://chat.example.com/docs')
    expect(normalizeSiteInput('https://chat.example.com/a/b/c')).toBe('https://chat.example.com/a/b/c')
  })

  it('手写的子树写法（结尾 /*）被保留', () => {
    expect(normalizeSiteInput('https://chat.example.com/docs/*')).toBe('https://chat.example.com/docs/*')
    expect(normalizeSiteInput('https://chat.example.com/*')).toBe('https://chat.example.com/*')
  })

  it('显式 http 的条目原样保留（匹配时视为协议不限）', () => {
    expect(normalizeSiteInput('http://localhost:5173')).toBe('http://localhost:5173/*')
    expect(normalizeSiteInput('http://192.168.1.10:8080/admin')).toBe('http://192.168.1.10:8080/admin')
  })

  it('拒绝非 http(s) 协议与无法识别的输入', () => {
    expect(normalizeSiteInput('javascript:alert(1)')).toBeNull()
    expect(normalizeSiteInput('chrome://extensions')).toBeNull()
    expect(normalizeSiteInput('file:///etc/passwd')).toBeNull()
    expect(normalizeSiteInput('')).toBeNull()
    expect(normalizeSiteInput('   ')).toBeNull()
    expect(normalizeSiteInput('not a url at all ..')).toBeNull()
  })

  it('拒绝没有点且不是 localhost/IPv4 的主机名', () => {
    expect(normalizeSiteInput('intranet')).toBeNull()
  })
})

describe('matchedSitePattern', () => {
  it('返回用户列表里的原样条目（可直接作为逐站开关的键）', () => {
    const patterns = ['https://chat.example.com/*', 'http://localhost:5173/*']
    expect(matchedSitePattern('https://chat.example.com/app?q=1', patterns)).toBe(
      'https://chat.example.com/*'
    )
    expect(matchedSitePattern('http://localhost:5173/room/1', patterns)).toBe(
      'http://localhost:5173/*'
    )
  })

  it('多条命中时取最具体的那条', () => {
    const patterns = ['https://chat.example.com/*', 'https://chat.example.com/docs']
    expect(matchedSitePattern('https://chat.example.com/docs', patterns)).toBe(
      'https://chat.example.com/docs'
    )
    expect(matchedSitePattern('https://chat.example.com/docs/deep/page', patterns)).toBe(
      'https://chat.example.com/docs'
    )
    // 顺序不影响结果
    expect(matchedSitePattern('https://chat.example.com/docs', [...patterns].reverse())).toBe(
      'https://chat.example.com/docs'
    )
  })

  it('路径按目录边界命中：/docs 不吃 /docspage', () => {
    const patterns = ['https://chat.example.com/docs']
    expect(matchedSitePattern('https://chat.example.com/docs', patterns)).not.toBeNull()
    expect(matchedSitePattern('https://chat.example.com/docs/', patterns)).not.toBeNull()
    expect(matchedSitePattern('https://chat.example.com/docspage', patterns)).toBeNull()
    expect(matchedSitePattern('https://chat.example.com/', patterns)).toBeNull()
  })

  it('写 http 的条目协议不限（站点常从 http 跳 https）', () => {
    const patterns = ['http://dev.example.com/*']
    expect(matchedSitePattern('http://dev.example.com/', patterns)).not.toBeNull()
    expect(matchedSitePattern('https://dev.example.com/anywhere', patterns)).not.toBeNull()
  })

  it('写 https 的条目只匹配 https', () => {
    const patterns = ['https://chat.example.com/*']
    expect(matchedSitePattern('https://chat.example.com/', patterns)).not.toBeNull()
    expect(matchedSitePattern('http://chat.example.com/', patterns)).toBeNull()
  })

  it('子域由域名条目一并覆盖（不必逐个子域去加）', () => {
    const patterns = ['https://deepseek.com/*']
    expect(matchedSitePattern('https://deepseek.com/', patterns)).not.toBeNull()
    expect(matchedSitePattern('https://chat.deepseek.com/app?q=1', patterns)).not.toBeNull()
    expect(matchedSitePattern('https://www.a.b.deepseek.com/', patterns)).not.toBeNull()
    // 带路径的条目同样吃子域
    const withPath = ['https://deepseek.com/docs']
    expect(matchedSitePattern('https://chat.deepseek.com/docs/x', withPath)).not.toBeNull()
    expect(matchedSitePattern('https://chat.deepseek.com/other', withPath)).toBeNull()
    // '*.' 前缀的存量写法与不带前缀是同一条规则
    expect(matchedSitePattern('https://chat.deepseek.com/', ['https://*.deepseek.com/*'])).not.toBeNull()
  })

  it('同路径时主机名更长的更具体（chat 归 chat 那条管）', () => {
    const patterns = ['https://deepseek.com/*', 'https://chat.deepseek.com/*']
    expect(matchedSitePattern('https://chat.deepseek.com/chat', patterns)).toBe(
      'https://chat.deepseek.com/*'
    )
    expect(matchedSitePattern('https://other.deepseek.com/', patterns)).toBe('https://deepseek.com/*')
    expect(matchedSitePattern('https://deepseek.com/', patterns)).toBe('https://deepseek.com/*')
  })

  it('协议与端口不同不命中，前缀伪造不命中', () => {
    const patterns = ['https://chat.example.com/*', 'http://localhost:5173/*']
    expect(matchedSitePattern('https://chat.example.com:8443/', patterns)).toBeNull() // 端口不同
    expect(matchedSitePattern('http://localhost:5174/', patterns)).toBeNull()
    expect(matchedSitePattern('https://evil.com/', patterns)).toBeNull()
    expect(matchedSitePattern('https://chat.example.com.evil.com/', patterns)).toBeNull() // 前缀伪造
    expect(matchedSitePattern('https://evilchat.example.com/', patterns)).toBeNull() // 伪造成子域也吃不到
  })

  it('空列表、非法条目与非法 URL 一律不命中', () => {
    expect(matchedSitePattern('https://chat.example.com/', [])).toBeNull()
    expect(matchedSitePattern('not-a-url', ['https://chat.example.com/*'])).toBeNull()
    expect(matchedSitePattern('chrome://extensions', ['https://chat.example.com/*'])).toBeNull()
    expect(matchedSitePattern('file:///etc/passwd', ['https://chat.example.com/*'])).toBeNull()
    // 中间带 * 的条目无法解释，跳过而不是猜
    expect(
      matchedSitePattern('https://chat.example.com/a/b', ['https://chat.example.com/*/b'])
    ).toBeNull()
  })
})

describe('matchSite', () => {
  const patterns = ['https://chat.example.com/*', 'http://localhost:5173/*']

  it('精确命中协议 + 主机 + 端口', () => {
    expect(matchSite('https://chat.example.com/', patterns)).toBe(true)
    expect(matchSite('https://chat.example.com/app?q=1', patterns)).toBe(true)
    expect(matchSite('http://localhost:5173/', patterns)).toBe(true)
  })

  it('空列表与非法 URL 一律不命中', () => {
    expect(matchSite('https://chat.example.com/', [])).toBe(false)
    expect(matchSite('not-a-url', patterns)).toBe(false)
    expect(matchSite('chrome://extensions', patterns)).toBe(false)
    expect(matchSite('file:///etc/passwd', patterns)).toBe(false)
  })
})

describe('sitePermissionOrigins', () => {
  it('整站条目 = 本域 + 子域各一条', () => {
    expect(sitePermissionOrigins('https://chat.example.com/*')).toEqual([
      'https://chat.example.com/*',
      'https://*.chat.example.com/*'
    ])
    // '*.' 前缀的存量写法归一后同样成对
    expect(sitePermissionOrigins('https://*.chat.example.com/*')).toEqual([
      'https://chat.example.com/*',
      'https://*.chat.example.com/*'
    ])
  })

  it('带路径的条目：精确路径与子树 × 本域与子域', () => {
    expect(sitePermissionOrigins('https://chat.example.com/docs')).toEqual([
      'https://chat.example.com/docs',
      'https://chat.example.com/docs/*',
      'https://*.chat.example.com/docs',
      'https://*.chat.example.com/docs/*'
    ])
    expect(sitePermissionOrigins('https://chat.example.com/docs/*')).toEqual([
      'https://chat.example.com/docs',
      'https://chat.example.com/docs/*',
      'https://*.chat.example.com/docs',
      'https://*.chat.example.com/docs/*'
    ])
  })

  it('写 http 的条目协议不限，两种协议都要申请', () => {
    // 带端口的条目没有子域，只有协议两份
    expect(sitePermissionOrigins('http://localhost:5173/*')).toEqual([
      'http://localhost:5173/*',
      'https://localhost:5173/*'
    ])
    expect(sitePermissionOrigins('http://dev.example.com/admin')).toEqual([
      'http://dev.example.com/admin',
      'http://dev.example.com/admin/*',
      'http://*.dev.example.com/admin',
      'http://*.dev.example.com/admin/*',
      'https://dev.example.com/admin',
      'https://dev.example.com/admin/*',
      'https://*.dev.example.com/admin',
      'https://*.dev.example.com/admin/*'
    ])
  })

  it('IPv4 条目没有子域', () => {
    expect(sitePermissionOrigins('http://192.168.1.10:8080/admin')).toEqual([
      'http://192.168.1.10:8080/admin',
      'http://192.168.1.10:8080/admin/*',
      'https://192.168.1.10:8080/admin',
      'https://192.168.1.10:8080/admin/*'
    ])
  })

  it('非法条目返回空列表', () => {
    expect(sitePermissionOrigins('nonsense')).toEqual([])
    expect(sitePermissionOrigins('https://chat.example.com/*/x')).toEqual([])
  })
})
