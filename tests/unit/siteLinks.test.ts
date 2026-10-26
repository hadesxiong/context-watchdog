import { describe, expect, it } from 'vitest'
import {
  CHANNEL_ENV,
  basePathFrom,
  channelStates,
  normalizeRepository,
  parseHttpsBase,
  resolveSiteLinks,
  resolveUmami
} from '../../scripts/lib/site-links.mjs'

// 落地页部署身份的解析护栏。这些值来自 env，**没有构建期类型兜底**（.env 里的字符串就是
// 字符串），规则必须在这层钉死：拼错的协议、被当成站点地址的带路径 URL、少写的 repository，
// 都要在建站前就报错，而不是等线上出现一个指向别处的 canonical。

const PKG = { repository: 'git+https://github.com/hadesxiong/context-watchdog.git' }

describe('normalizeRepository', () => {
  it('支持对象与字符串两种写法，并去掉 git+ / .git', () => {
    expect(normalizeRepository(PKG.repository)).toBe('https://github.com/hadesxiong/context-watchdog')
    expect(normalizeRepository({ type: 'git', url: PKG.repository })).toBe(
      'https://github.com/hadesxiong/context-watchdog'
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

  it('站点地址默认仍是根地址（不带路径），渠道地址必须允许路径', () => {
    expect(() => parseHttpsBase('https://example.com/sub', 'SITE_URL')).toThrow(/不能带路径/)
    // 渠道地址是具体页面，必须允许路径
    expect(parseHttpsBase('https://chromewebstore.google.com/detail/x/abc', 'CWS_URL', { allowPath: true })).toBe(
      'https://chromewebstore.google.com/detail/x/abc'
    )
  })

  it('显式允许子路径时接受带路径的站点地址，并归一化末尾斜杠', () => {
    expect(parseHttpsBase('https://aa.bb.com/context-watchdog', 'SITE_URL', { allowSitePath: true })).toBe(
      'https://aa.bb.com/context-watchdog'
    )
    expect(parseHttpsBase('https://aa.bb.com/context-watchdog/', 'SITE_URL', { allowSitePath: true })).toBe(
      'https://aa.bb.com/context-watchdog'
    )
    expect(parseHttpsBase('https://example.com', 'SITE_URL', { allowSitePath: true })).toBe('https://example.com')
    // 空段「//」派生出的子路径会以 // 开头 → 站内链接变成协议相对地址，必须挡住
    expect(() => parseHttpsBase('https://aa.bb.com//ctx', 'SITE_URL', { allowSitePath: true })).toThrow(/空段/)
  })

  it('拒绝查询串与锚点', () => {
    expect(() => parseHttpsBase('https://example.com/?a=1', 'X')).toThrow(/查询串/)
    expect(() => parseHttpsBase('https://example.com/#a', 'X', { allowPath: true })).toThrow(/查询串/)
  })
})

describe('basePathFrom', () => {
  it('未配置或根地址 → 空串（产物与根路径部署逐字节一致）', () => {
    expect(basePathFrom('')).toBe('')
    expect(basePathFrom('https://example.com')).toBe('')
  })

  it('带子路径 → /sub，且不带尾斜杠', () => {
    expect(basePathFrom('https://aa.bb.com/context-watchdog')).toBe('/context-watchdog')
    expect(basePathFrom('https://example.com/a/b')).toBe('/a/b')
  })
})

describe('resolveSiteLinks', () => {
  it('把 env 映射成页面用的配置；未配置的键为空串', () => {
    const links = resolveSiteLinks(
      {
        SITE_URL: 'https://contextwatchdog.example/',
        EDGE_URL: 'https://microsoftedge.microsoft.com/addons/detail/x/abc',
        GITEE_URL: 'https://gitee.com/hadesxiong/context-watchdog',
        ICP_BEIAN: '粤ICP备2026000000号-1'
      },
      PKG
    )

    expect(links.siteUrl).toBe('https://contextwatchdog.example')
    expect(links.basePath).toBe('')
    expect(links.github).toBe('https://github.com/hadesxiong/context-watchdog')
    expect(links.gitee).toBe('https://gitee.com/hadesxiong/context-watchdog')
    expect(links.channels.edge).toBe('https://microsoftedge.microsoft.com/addons/detail/x/abc')
    expect(links.channels.cws).toBe('')
    expect(links.channels.amo).toBe('')
    expect(links.channels.win).toBe('')
    expect(links.channels.mac).toBe('')
    expect(links.icp).toBe('粤ICP备2026000000号-1')
    expect(links.police).toBe('')
  })

  it('SITE_URL 带子路径时：siteUrl 保留路径，basePath 同步派生（同一来源）', () => {
    const links = resolveSiteLinks({ SITE_URL: 'https://aa.bb.com/context-watchdog/' }, PKG)

    expect(links.siteUrl).toBe('https://aa.bb.com/context-watchdog')
    expect(links.basePath).toBe('/context-watchdog')
    // canonical 的实际拼法（Base.astro 与 check:versions 同一套）：origin + 含 base 的站内路径
    expect(`${new URL(links.siteUrl).origin}${links.basePath}/en/privacy/`).toBe(
      'https://aa.bb.com/context-watchdog/en/privacy/'
    )
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

describe('resolveUmami', () => {
  it('全空 = 禁用：不注入，且没有任何警告', () => {
    const umami = resolveUmami({})
    expect(umami).toMatchObject({ enabled: false, websiteId: '', scriptUrl: '', hostUrl: '', dnt: false })
    expect(umami.warnings).toEqual([])
  })

  it('启用对齐全 = 开启，URL 归一化，DNT 与 hostUrl 各自独立', () => {
    const umami = resolveUmami({
      UMAMI_WEBSITE_ID: '3c8f0a1e-1f2b-4c5d-9e8f-0a1b2c3d4e5f',
      UMAMI_SCRIPT_URL: 'https://product.bearman.site/umami/script.js',
      UMAMI_HOST_URL: 'https://product.bearman.site/umami/',
      UMAMI_DNT: 'true'
    })
    expect(umami).toMatchObject({
      enabled: true,
      websiteId: '3c8f0a1e-1f2b-4c5d-9e8f-0a1b2c3d4e5f',
      scriptUrl: 'https://product.bearman.site/umami/script.js',
      hostUrl: 'https://product.bearman.site/umami', // 去尾斜杠（data-host-url 是基址）
      dnt: true
    })
    expect(umami.warnings).toEqual([])
  })

  it('半配置直接报错（只有 ID 或只有地址都不允许）', () => {
    expect(() => resolveUmami({ UMAMI_WEBSITE_ID: 'abc12345' })).toThrow(/UMAMI_SCRIPT_URL/)
    expect(() => resolveUmami({ UMAMI_SCRIPT_URL: 'https://x.example.com/script.js' })).toThrow(
      /UMAMI_WEBSITE_ID/
    )
  })

  it('脚本地址必须是 https、不带查询串与锚点', () => {
    const pair = { UMAMI_WEBSITE_ID: 'abc12345' }
    expect(() => resolveUmami({ ...pair, UMAMI_SCRIPT_URL: 'http://x.example.com/script.js' })).toThrow(/https/)
    expect(() => resolveUmami({ ...pair, UMAMI_SCRIPT_URL: 'https://x.example.com/script.js?v=1' })).toThrow(
      /查询串/
    )
    expect(() => resolveUmami({ ...pair, UMAMI_SCRIPT_URL: 'x.example.com/script.js' })).toThrow(/不是合法 URL/)
  })

  it('websiteId 会进 HTML 属性，出现空白/引号/尖括号即报错', () => {
    expect(() => resolveUmami({ UMAMI_WEBSITE_ID: 'ab c12345' })).toThrow(/空白|引号/)
    expect(() => resolveUmami({ UMAMI_WEBSITE_ID: 'ab"c12345' })).toThrow(/引号/)
    expect(() => resolveUmami({ UMAMI_WEBSITE_ID: 'ab<c12345' })).toThrow(/引号/)
  })

  it('DNT 只认 true / false / 空', () => {
    expect(resolveUmami({ UMAMI_DNT: 'false' }).dnt).toBe(false)
    expect(() => resolveUmami({ UMAMI_DNT: '1' })).toThrow(/UMAMI_DNT/)
  })

  it('修饰项单独出现 = 配了没启用：不报错，但给出警告', () => {
    const umami = resolveUmami({ UMAMI_HOST_URL: 'https://x.example.com/umami', UMAMI_DNT: 'true' })
    expect(umami.enabled).toBe(false)
    expect(umami.warnings).toHaveLength(1)
    expect(umami.warnings[0]).toMatch(/未启用/)
  })
})
