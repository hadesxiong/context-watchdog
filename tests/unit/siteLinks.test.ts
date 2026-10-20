import { describe, expect, it } from 'vitest'
import {
  CHANNEL_ENV,
  channelStates,
  normalizeRepository,
  parseHttpsBase,
  resolveSiteLinks
} from '../../scripts/lib/site-links.mjs'

// 落地页部署身份的解析护栏。
//
// 这些值来自 env，**没有构建期类型兜底**（.env 里的字符串就是字符串）。所以规则
// 必须在这层钉死：拼错的协议、被当成站点地址的带路径 URL、少写的 repository，
// 都要在建站前就报错，而不是等线上出现一个指向别处的 canonical。

const PKG = { repository: 'git+https://github.com/hadesxiong/paste-guard.git' }

describe('normalizeRepository', () => {
  it('支持对象与字符串两种写法，并去掉 git+ / .git', () => {
    expect(normalizeRepository(PKG.repository)).toBe('https://github.com/hadesxiong/paste-guard')
    expect(normalizeRepository({ type: 'git', url: PKG.repository })).toBe(
      'https://github.com/hadesxiong/paste-guard'
    )
    expect(normalizeRepository('https://github.com/a/b')).toBe('https://github.com/a/b')
    expect(normalizeRepository('https://github.com/a/b.git')).toBe('https://github.com/a/b')
    expect(normalizeRepository('git+https://github.com/a/b.git')).toBe('https://github.com/a/b')
  })

  it('支持 scp 形式的 git 地址', () => {
    expect(normalizeRepository('git@github.com:a/b.git')).toBe('https://github.com/a/b')
  })

  it('缺失或非 https 直接报错（fork 必须改这一处）', () => {
    expect(() => normalizeRepository(undefined)).toThrow(/repository/)
    expect(() => normalizeRepository({})).toThrow(/repository/)
    expect(() => normalizeRepository('http://github.com/a/b')).toThrow(/https/)
    expect(() => normalizeRepository('git@github.com:a/b.git?x=1')).toThrow()
  })
})

describe('parseHttpsBase', () => {
  it('空值折叠成空串（= 未配置，页面据此降级）', () => {
    expect(parseHttpsBase('', 'X')).toBe('')
    expect(parseHttpsBase('   ', 'X')).toBe('')
    expect(parseHttpsBase(undefined, 'X')).toBe('')
  })

  it('保留协议与主机，去掉末尾斜杠', () => {
    expect(parseHttpsBase('https://example.com/', 'X')).toBe('https://example.com')
    expect(parseHttpsBase('  https://example.com//  ', 'X')).toBe('https://example.com')
  })

  it('拒绝非 https', () => {
    expect(() => parseHttpsBase('http://example.com', 'X')).toThrow(/https/)
    expect(() => parseHttpsBase('ftp://example.com', 'X')).toThrow(/https/)
    expect(() => parseHttpsBase('example.com', 'X')).toThrow(/不是合法 URL/)
  })

  it('站点地址不允许带路径（会让 new URL 把子路径整体丢掉）', () => {
    expect(() => parseHttpsBase('https://example.com/sub', 'SITE_URL')).toThrow(/不能带路径/)
    // 渠道地址是具体页面，必须允许路径
    expect(parseHttpsBase('https://chromewebstore.google.com/detail/x/abc', 'CWS_URL', { allowPath: true })).toBe(
      'https://chromewebstore.google.com/detail/x/abc'
    )
  })

  it('拒绝查询串与锚点', () => {
    expect(() => parseHttpsBase('https://example.com/?a=1', 'X')).toThrow(/查询串/)
    expect(() => parseHttpsBase('https://example.com/#a', 'X', { allowPath: true })).toThrow(/查询串/)
  })
})

describe('resolveSiteLinks', () => {
  it('把 env 映射成页面用的配置；未配置的键为空串', () => {
    const links = resolveSiteLinks(
      {
        SITE_URL: 'https://pasteguard.example/',
        EDGE_URL: 'https://microsoftedge.microsoft.com/addons/detail/x/abc',
        GITEE_URL: 'https://gitee.com/hadesxiong/paste-guard',
        ICP_BEIAN: '粤ICP备2026000000号-1',
        DONATE_QR: 'donate/qr.png'
      },
      PKG
    )

    expect(links.siteUrl).toBe('https://pasteguard.example')
    expect(links.github).toBe('https://github.com/hadesxiong/paste-guard')
    expect(links.gitee).toBe('https://gitee.com/hadesxiong/paste-guard')
    expect(links.channels.edge).toBe('https://microsoftedge.microsoft.com/addons/detail/x/abc')
    expect(links.channels.cws).toBe('')
    expect(links.channels.amo).toBe('')
    expect(links.channels.win).toBe('')
    expect(links.channels.mac).toBe('')
    expect(links.icp).toBe('粤ICP备2026000000号-1')
    expect(links.police).toBe('')
    expect(links.donateQr).toBe('donate/qr.png')
  })

  it('渠道键与环境变量名的映射是唯一的', () => {
    const links = resolveSiteLinks(
      Object.fromEntries(Object.values(CHANNEL_ENV).map((name, index) => [name, `https://c${index}.example.com`])),
      PKG
    )
    for (const [key, envName] of Object.entries(CHANNEL_ENV)) {
      expect(links.channels[key], envName).toMatch(/^https:\/\/c\d\.example\.com$/)
    }
  })

  it('任一渠道非法就整体报错（不允许静默跳过）', () => {
    expect(() => resolveSiteLinks({ AMO_URL: 'https://addons.mozilla.org/x', CWS_URL: 'not-a-url' }, PKG)).toThrow(
      /CWS_URL/
    )
  })
})

describe('channelStates', () => {
  it('按配置与否给出 已配置/未配置', () => {
    const links = resolveSiteLinks({ EDGE_URL: 'https://microsoftedge.microsoft.com/addons/detail/x/abc' }, PKG)
    const states = channelStates(links)
    expect(states).toHaveLength(5)
    expect(states.find((state) => state.key === 'edge')).toMatchObject({ configured: true })
    expect(states.filter((state) => state.configured)).toHaveLength(1)
  })
})
