// 单元用例 - 受保护站点的规范化与匹配（粘贴自动拦截）
import { describe, it, expect } from 'vitest'
import { normalizeSiteInput, matchSite } from '../../src/core/sites'

describe('normalizeSiteInput', () => {
  it('裸域名默认按 https 处理', () => {
    expect(normalizeSiteInput('chat.example.com')).toBe('https://chat.example.com/*')
    expect(normalizeSiteInput('  chat.example.com  ')).toBe('https://chat.example.com/*')
  })

  it('显式协议与端口被保留，路径与查询被丢弃', () => {
    expect(normalizeSiteInput('https://chat.example.com')).toBe('https://chat.example.com/*')
    expect(normalizeSiteInput('https://chat.example.com/path?q=1#x')).toBe('https://chat.example.com/*')
    expect(normalizeSiteInput('http://localhost:5173')).toBe('http://localhost:5173/*')
    expect(normalizeSiteInput('http://192.168.1.10:8080/admin')).toBe('http://192.168.1.10:8080/*')
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
    expect(normalizeSiteInput('localhost')).toBe('https://localhost/*') // 无协议默认 https
  })
})

describe('matchSite', () => {
  const patterns = ['https://chat.example.com/*', 'http://localhost:5173/*']

  it('精确命中协议 + 主机 + 端口', () => {
    expect(matchSite('https://chat.example.com/', patterns)).toBe(true)
    expect(matchSite('https://chat.example.com/app?q=1', patterns)).toBe(true)
    expect(matchSite('http://localhost:5173/', patterns)).toBe(true)
  })

  it('协议、子域、端口任一不同都不命中', () => {
    expect(matchSite('http://chat.example.com/', patterns)).toBe(false) // 协议不同
    expect(matchSite('https://www.chat.example.com/', patterns)).toBe(false) // 子域需单独添加
    expect(matchSite('https://chat.example.com:8443/', patterns)).toBe(false) // 端口不同
    expect(matchSite('http://localhost:5174/', patterns)).toBe(false)
    expect(matchSite('https://evil.com/', patterns)).toBe(false)
    expect(matchSite('https://chat.example.com.evil.com/', patterns)).toBe(false) // 前缀伪造
  })

  it('空列表与非法 URL 一律不命中', () => {
    expect(matchSite('https://chat.example.com/', [])).toBe(false)
    expect(matchSite('not-a-url', patterns)).toBe(false)
    expect(matchSite('chrome://extensions', patterns)).toBe(false)
    expect(matchSite('file:///etc/passwd', patterns)).toBe(false)
  })
})
