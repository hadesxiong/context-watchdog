#!/usr/bin/env node
// 版本一致性与发布就绪检查：版本号散落在根 package.json、扩展 manifest、产物 manifest、
// 落地页注入值四处，漏改一处的症状是「商店与落地页版本不一样」，且往往过很久才被发现。
// 用法：node scripts/check-versions.mjs [--release]——常规模式只验证已存在之物自洽，
// --release 要求一切已就位，回答「现在能打 tag 了吗」。
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tagsForVersion } from './lib/version-tag.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const release = process.argv.includes('--release')

const results = []
const fail = (message) => results.push({ level: 'fail', message })
const warn = (message) => results.push({ level: 'warn', message })
const pass = (message) => results.push({ level: 'pass', message })

const abs = (p) => `${root}${p}`
const readJson = (p) => JSON.parse(readFileSync(abs(p), 'utf8'))
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

// ---------------------------------------------------------------- 源版本号

let version = null
try {
  const pkg = readJson('/package.json')
  version = pkg.version
  if (!SEMVER.test(version)) fail(`package.json 的 version 不是合法 semver：${version}`)
} catch (error) {
  fail(`读不到 package.json：${error.message}`)
}

let manifestVersion = null
try {
  const manifest = readJson('/packages/extension/src/manifest.json')
  manifestVersion = manifest.version
  if (!SEMVER.test(manifestVersion)) {
    fail(`扩展 manifest 的 version 不是合法 semver：${manifestVersion}`)
  }
} catch (error) {
  fail(`读不到 packages/extension/src/manifest.json：${error.message}`)
}

if (version && manifestVersion && version === manifestVersion) {
  pass(`包版本与扩展 manifest 一致：${version}`)
} else if (version && manifestVersion) {
  fail(`版本号不一致：package.json=${version}，扩展 manifest=${manifestVersion}`)
}

// ---------------- 落地页部署身份（来自 env，不进仓库；与构建期同一套纯函数，理由见 lib/site-links.mjs）
import { loadEnv } from 'vite'
import { channelStates, resolveSiteLinks, resolveUmami } from './lib/site-links.mjs'

const STORE_KEYS = ['edge', 'cws', 'amo']

const siteEnv = loadEnv('production', abs('/apps/site'), '')

let siteLinks = null
try {
  siteLinks = resolveSiteLinks(siteEnv, { repository: readJson('/package.json').repository })
} catch (error) {
  fail(`落地页部署身份不合法：${error instanceof Error ? error.message : String(error)}`)
}

let umami = null
try {
  umami = resolveUmami(siteEnv)
} catch (error) {
  fail(`访问统计配置不合法：${error instanceof Error ? error.message : String(error)}`)
}

if (siteLinks) {
  if (siteLinks.siteUrl) {
    pass(
      `落地页站点地址已配置：${siteLinks.siteUrl}` +
        (siteLinks.basePath ? `（部署于子路径 ${siteLinks.basePath}）` : '')
    )
  } else if (release) {
    fail('发布前必须配置 SITE_URL（apps/site/.env）—— 否则线上 canonical 是相对路径')
  } else {
    warn('SITE_URL 未配置：canonical 为相对路径（仅本地预览 / fork 可接受）')
  }

  const states = channelStates(siteLinks)
  const configured = states.filter((state) => state.configured).map((state) => state.key)
  const missing = states.filter((state) => !state.configured).map((state) => state.key)
  const stores = configured.filter((key) => STORE_KEYS.includes(key))

  if (release && stores.length === 0) {
    fail('发布前至少要配置一个商店渠道（EDGE_URL / CWS_URL / AMO_URL）')
  } else if (missing.length > 0) {
    warn(`渠道未配置，页面显示「即将上架」：${missing.join(', ')}`)
  } else {
    pass('五个渠道均已配置')
  }

  // 中文页指向镜像时，镜像 Release 需已传同样的 zip（否则中文用户点下载 404）；不联网探测，只做提醒
  if (siteLinks.gitee) {
    pass(`中文页的源码 / 下载指向镜像：${siteLinks.gitee}（发布时记得在镜像上传同样的 zip）`)
  }
}

let evidence = null
try {
  evidence = readJson('/apps/site/src/data/evidence.json')
  if (!Number.isInteger(evidence.tests) || evidence.tests <= 0) {
    fail(`evidence.json 的 tests 不合法：${JSON.stringify(evidence.tests)}`)
  }
  if (!Number.isInteger(evidence.probes) || evidence.probes <= 0) {
    fail(`evidence.json 的 probes 不合法：${JSON.stringify(evidence.probes)}`)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(evidence.measuredAt ?? '')) {
    fail(`evidence.json 的 measuredAt 应为 YYYY-MM-DD：${evidence.measuredAt}`)
  }
} catch (error) {
  fail(`读不到 apps/site/src/data/evidence.json：${error.message}`)
}

// evidence 是否过期只有跑真实套件才知道（npm run site:evidence:check），这里做便宜的代理检查：发布当天必须是当天测的
if (release && evidence) {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  if (evidence.measuredAt !== today) {
    fail(
      `evidence.json 不是今天测的（${evidence.measuredAt}，今天 ${today}）——` +
        `发布前先跑 npm run site:evidence`
    )
  } else {
    pass(`落地页证据数字为今日实测（tests=${evidence.tests} probes=${evidence.probes}）`)
  }
}

// ---------------------------------------------------------------- 构建产物

const LEGAL_FILES = ['LICENSE', 'NOTICE', 'THIRD-PARTY-NOTICES.txt']

for (const [label, dir] of [
  ['Chrome', 'dist'],
  ['Firefox', 'dist-firefox']
]) {
  const dirExists = existsSync(abs(`/${dir}`))
  if (!dirExists) {
    if (release) fail(`${label} 产物不存在（${dir}/）——先跑 npm run build${label === 'Firefox' ? ':firefox' : ''}`)
    else warn(`${label} 产物未构建（${dir}/），跳过产物检查`)
    continue
  }

  try {
    const built = readJson(`/${dir}/manifest.json`)
    if (built.version !== manifestVersion) {
      fail(
        `${label} 产物里的 manifest 版本与源不一致：产物=${built.version}，源=${manifestVersion}（需重新构建）`
      )
    } else {
      pass(`${label} 产物版本与源一致：${built.version}`)
    }
  } catch (error) {
    fail(`读不到 ${dir}/manifest.json：${error.message}`)
  }

  // Apache-2.0 §4(d) 要求随附 NOTICE、§4(a)(b)(c) 要求保留 LICENSE 与第三方声明；漏带不报错，只会让分发悄悄违约
  const present = new Set(readdirSync(abs(`/${dir}`)))
  const missing = LEGAL_FILES.filter((file) => !present.has(file))
  if (missing.length > 0) {
    fail(`${label} 产物缺少许可文件：${missing.join(', ')}`)
  } else {
    pass(`${label} 产物随附 LICENSE / NOTICE / THIRD-PARTY-NOTICES.txt`)
  }
}

// 落地页产物里的版本号（构建期经 vite.define 注入）
const siteDist = abs('/apps/site/dist')
const siteIndex = abs('/apps/site/dist/index.html')
if (existsSync(siteIndex)) {
  const html = readFileSync(siteIndex, 'utf8')
  if (html.includes(`v${version}`)) {
    pass(`落地页产物已注入版本号 v${version}`)
  } else {
    fail(`落地页产物里找不到 v${version}（需重新构建落地页）`)
  }

  // 每页 canonical 必须指向它自己：写死成首页等于告诉搜索引擎所有子页都是首页的副本，会直接不被收录且毫无报错
  const htmlFiles = []
  const walkHtml = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`
      if (entry.isDirectory()) walkHtml(path)
      else if (entry.name.endsWith('.html')) htmlFiles.push(path)
    }
  }
  walkHtml(siteDist)

  let canonicalProblems = 0
  let scriptProblems = 0
  const origins = new Set()
  // 部署子路径（由 SITE_URL 的 pathname 派生，见 site-links.mjs）：产物路径不含它、canonical 含它，比对时两边都要补上；拼绝对地址只能用 origin
  const siteBase = siteLinks?.basePath ?? ''
  const siteOrigin = siteLinks?.siteUrl ? new URL(siteLinks.siteUrl).origin : ''
  // 外链脚本白名单：只放行 env 配置的统计地址，启用时每页必须含它
  const umamiSrc = umami?.enabled ? umami.scriptUrl : ''
  for (const file of htmlFiles) {
    const relative = file.slice(siteDist.length + 1)
    // 构建用 format: 'directory'，子页面服务的真实地址带尾斜杠
    const pagePath = relative === 'index.html' ? '/' : `/${relative.replace(/index\.html$/, '')}`
    const expectedPath = `${siteBase}${pagePath}`
    const html = readFileSync(file, 'utf8')

    const canonical = /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1]
    if (!canonical) {
      fail(`落地页 ${relative} 缺少 canonical`)
      canonicalProblems += 1
    } else {
      // 两种合法形态（未配置 SITE_URL 的相对路径 / 已配置的绝对地址），同一份产物必须统一——混用说明 env 只对部分页面生效了
      const isAbsolute = /^https:\/\//.test(canonical)
      let actualPath = canonical
      if (isAbsolute) {
        try {
          const url = new URL(canonical)
          origins.add(url.origin)
          actualPath = url.pathname
        } catch {
          fail(`落地页 ${relative} 的 canonical 不是合法 URL：${canonical}`)
          canonicalProblems += 1
          continue
        }
      }

      if (actualPath !== expectedPath) {
        fail(`落地页 ${relative} 的 canonical 应为 ${expectedPath}，实际为 ${actualPath}`)
        canonicalProblems += 1
      } else if (isAbsolute && siteLinks?.siteUrl && canonical !== `${siteOrigin}${expectedPath}`) {
        // 产物里的域名与当前 env 不一致 = 改了 .env 却没重建，或构建时用的是另一份 .env
        fail(
          `落地页 ${relative} 的 canonical 与 SITE_URL 不一致：${canonical} ≠ ${siteOrigin}${expectedPath}` +
            `（env 改过？重新跑 npm run site:build）`
        )
        canonicalProblems += 1
      } else if (!isAbsolute && release) {
        fail(`发布前 ${relative} 的 canonical 仍是相对路径 —— 配置 SITE_URL 后重新构建落地页`)
        canonicalProblems += 1
      }
    }

    const scriptSrcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1])
    const rogueSrcs = scriptSrcs.filter((src) => src !== umamiSrc)
    if (rogueSrcs.length > 0) {
      fail(`落地页 ${relative} 引用了外部脚本：${rogueSrcs.join('、')}（只允许 .env 配置的 Umami 统计地址）`)
      scriptProblems += 1
    }
    if (umamiSrc && !scriptSrcs.includes(umamiSrc)) {
      fail(`落地页 ${relative} 缺少配置的 Umami 统计脚本（env 改过？重新跑 npm run site:build）`)
      scriptProblems += 1
    }
  }

  if (origins.size > 1) {
    fail(`落地页各页的 canonical 指向了多个域名：${[...origins].join(', ')}`)
    canonicalProblems += 1
  }

  if (canonicalProblems === 0 && scriptProblems === 0) {
    const scriptNote = umami?.enabled ? '仅含配置的 Umami 统计脚本' : '均无外部脚本'
    pass(`落地页 ${htmlFiles.length} 个页面的 canonical 各自正确、且${scriptNote}`)
  }
} else if (release) {
  fail('落地页产物不存在（apps/site/dist/index.html）——先跑 npm run site:build')
} else {
  warn('落地页未构建（apps/site/dist/），跳过产物检查')
}

// ---------------------------------------------------------------- 动态代码（商店审核预检）

const jsFiles = (dir) => {
  const out = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = `${current}/${entry.name}`
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.js')) out.push(path)
    }
  }
  walk(abs(`/${dir}`))
  return out
}

// MV3 扩展页默认 CSP 不允许 eval / new Function：出现即可能被商店审核（AMO 的 addons-linter
// 尤其敏感）标记不安全，运行期真执行到也是功能故障。KNOWN_DYNAMIC_CODE 登记依赖带进来的已知
// 误报（protobufjs inquire、webpack 的 globalThis polyfill）——依赖升级引入新 eval 时这里报红。
const KNOWN_DYNAMIC_CODE = [
  { marker: 'protobufjs-inquire', test: (snippet) => snippet.includes('quire') && snippet.includes('replace') },
  {
    marker: 'webpack-globalThis',
    test: (snippet) => /new Function\(["']return this["']\)/.test(snippet)
  }
]

const scanDynamicCode = (label, dir) => {
  if (!existsSync(abs(`/${dir}`))) return
  const unknown = []
  const known = []
  for (const file of jsFiles(dir)) {
    const source = readFileSync(file, 'utf8')
    const pattern = /\beval\(|new Function\(/g
    let match
    while ((match = pattern.exec(source)) !== null) {
      const snippet = source.slice(Math.max(0, match.index - 100), match.index + 80)
      const hit = KNOWN_DYNAMIC_CODE.find((entry) => entry.test(snippet))
      const where = `${label}:${file.slice(abs(`/${dir}`).length)}`
      if (hit) known.push(`${hit.marker} @${where}`)
      else unknown.push(`${where} @${match.index}: ${snippet.replace(/\s+/g, ' ').trim()}`)
    }
  }
  if (unknown.length > 0) {
    fail(
      `${label} 产物出现未登记的 eval/new Function（${unknown.length} 处）——` +
        `商店审核可能拒收，且运行期可能直接失败：\n      ${unknown.join('\n      ')}`
    )
  } else if (known.length > 0) {
    pass(`${label} 产物的 eval/new Function 均为已知误报（${known.length} 处：protobufjs / webpack）`)
  } else {
    pass(`${label} 产物无 eval / new Function`)
  }
}

scanDynamicCode('Chrome', 'dist')
scanDynamicCode('Firefox', 'dist-firefox')

// ---------------------------------------------------------------- 标签
// 形态见 scripts/lib/version-tag.mjs（<version>-<target>，不用 v 前缀）；一个版本对应 ext / site / app 三个 tag，一次性查重。

if (version) {
  let tags = null
  try {
    tags = tagsForVersion(version)
  } catch (error) {
    fail(`无法由版本号推出发布标签：${error instanceof Error ? error.message : String(error)}`)
  }

  if (tags) {
    try {
      const existing = execSync(`git tag -l ${tags.map((tag) => `"${tag}"`).join(' ')}`, {
        cwd: root,
        encoding: 'utf8'
      }).trim()
      if (existing) {
        if (release) fail(`标签已存在，不能重复发布：${existing.split('\n').join(', ')}`)
        else warn(`标签已存在：${existing.split('\n').join(', ')}`)
      } else {
        pass(`待打标签 ${tags.join(' / ')} 尚未占用`)
      }
    } catch {
      warn('git 不可用，跳过标签检查')
    }
  }
}

// ---------------------------------------------------------------- 输出

const icon = { pass: '✓', warn: '!', fail: '✗' }
for (const result of results) {
  const line = `  ${icon[result.level]} ${result.message}`
  if (result.level === 'fail') console.error(line)
  else console.log(line)
}

const failures = results.filter((result) => result.level === 'fail').length
const warnings = results.filter((result) => result.level === 'warn').length

if (failures > 0) {
  console.error(`\n✗ check-versions 失败：${failures} 项（警告 ${warnings} 项）`)
  process.exit(1)
}

console.log(`\n✓ check-versions 通过${warnings > 0 ? `（${warnings} 项警告）` : ''}${release ? ' · 发布就绪模式' : ''}`)
