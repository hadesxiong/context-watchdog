#!/usr/bin/env node
// 版本一致性与发布就绪检查（F1）
//
// 为什么需要它：这个仓库的版本号出现在至少四个地方 —— 根 package.json、扩展
// manifest（商店读的就是它）、构建产物里的 manifest、以及落地页上注入的版本号。
// 手改漏一处，症状是「商店显示的版本和落地页不一样」，而且通常过很久才被发现。
//
// 用法：
//   node scripts/check-versions.mjs             # 常规检查，纳入回归
//   node scripts/check-versions.mjs --release    # 发布前检查：要求产物齐备、渠道已上架
//
// 两类检查的区别：常规检查只验证「存在的东西是否自洽」（产物还没构建时不报错）；
// --release 强制要求**一切都已就位**，用来回答「现在能打 tag 了吗」。
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

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

// ---------------------------------------------------------------- 落地页数据

let links = null
try {
  links = readJson('/apps/site/src/data/links.json')
} catch (error) {
  fail(`读不到 apps/site/src/data/links.json：${error.message}`)
}

if (links) {
  const channels = ['edge', 'cws', 'amo']
  let consistent = true
  for (const key of channels) {
    const channel = links[key]
    if (!channel) {
      fail(`links.json 缺少渠道 ${key}`)
      consistent = false
      continue
    }
    if (channel.available && !/^https:\/\/\S+$/.test(channel.url)) {
      fail(`links.json 渠道 ${key} 标记 available 但 url 不是 https：${JSON.stringify(channel.url)}`)
      consistent = false
    }
    if (!channel.available && channel.url !== '') {
      fail(`links.json 渠道 ${key} 未标记 available 却填了 url：${channel.url}`)
      consistent = false
    }
  }
  if (consistent) pass('落地页 links.json 的上架状态与链接自洽')

  const channelState = channels.map((key) => `${key}=${links[key]?.available ? '已上架' : '未上架'}`)
  if (release) {
    if (!/^https:\/\//.test(links.siteUrl ?? '')) {
      fail(`发布前必须填好 links.json 的 siteUrl（当前为 ${JSON.stringify(links.siteUrl)}）`)
    } else {
      pass(`落地页站点域名已配置：${links.siteUrl}`)
    }
    const pending = channels.filter((key) => !links[key]?.available)
    if (pending.length > 0) {
      fail(`发布前渠道仍未上架：${pending.join(', ')}`)
    } else {
      pass('三个渠道均已上架')
    }
  } else if (channelState.some((state) => state.includes('未上架'))) {
    warn(`渠道尚未上架（可接受，发布前需处理）：${channelState.join(' ')}`)
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

// evidence 是否过期，只有跑一遍真实套件才知道（npm run site:evidence:check）。
// 这里只做一个便宜的代理检查：发布当天必须是当天测的。
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

  // Apache-2.0 §4(d) 要求随附 NOTICE；§4(a)(b)(c) 要求保留 LICENSE 与第三方声明。
  // 漏带不会让构建失败，只会让分发悄悄违约，所以必须有一条硬护栏盯着。
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

  // 每个页面的 canonical 必须指向**它自己**，而不是恒指向首页。
  // 这是多语言站点最容易犯的错：canonical 写死成首页，等于告诉搜索引擎
  // 所有子页都是首页的副本，它们会直接不被收录（且没有任何报错）。
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
  for (const file of htmlFiles) {
    const relative = file.slice(siteDist.length + 1)
    // 构建用 format: 'directory'，子页面服务的真实地址带尾斜杠
    const expected =
      relative === 'index.html' ? '/' : `/${relative.replace(/index\.html$/, '')}`
    const html = readFileSync(file, 'utf8')

    const canonical = /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1]
    if (canonical !== expected) {
      fail(`落地页 ${relative} 的 canonical 应为 ${expected}，实际为 ${canonical ?? '(缺失)'}`)
      canonicalProblems += 1
    }

    // 「零客户端 JS」是这个站点的取向，也写进了文档；有脚本就直接失败
    if (/<script[^>]+src=/.test(html)) {
      fail(`落地页 ${relative} 引用了外部脚本——落地页的取向是零客户端 JS`)
      scriptProblems += 1
    }
  }

  if (canonicalProblems === 0 && scriptProblems === 0) {
    pass(`落地页 ${htmlFiles.length} 个页面的 canonical 各自正确、且均无外部脚本`)
  }
} else if (release) {
  fail('落地页产物不存在（apps/site/dist/index.html）——先跑 npm run site:build')
} else {
  warn('落地页未构建（apps/site/dist/），跳过产物检查')
}

// ---------------------------------------------------------------- 动态代码（商店审核预检）

/** 递归列出目录下的 .js 文件 */
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

// MV3 的扩展页面默认 CSP 不允许 eval / new Function。产物里出现它们有两个后果：
//   ① 商店审核（AMO 的 addons-linter 尤其敏感）可能直接标记为不安全；
//   ② 如果某条路径真的在运行期执行到，就是功能故障。
// 当前实测只有三处，全部来自依赖的经典写法，且都在 try/catch 里：
//   · protobufjs 的 inquire()：eval(`quire`.replace(/^/,`re`))（×2，ort 与 transformers 各一）
//   · webpack 的 globalThis polyfill：new Function("return this")（×1）
// 这些是已知误报，但**必须实测确认**——一旦某个依赖升级引入新的 eval，我们希望在
// 提交商店之前就发现，而不是等审核员来告诉我们。
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

if (version) {
  try {
    const existing = execSync(`git tag -l "ext-v${version}" "site-v${version}"`, {
      cwd: root,
      encoding: 'utf8'
    }).trim()
    if (existing) {
      if (release) fail(`标签已存在，不能重复发布：${existing.split('\n').join(', ')}`)
      else warn(`标签已存在：${existing.split('\n').join(', ')}`)
    } else {
      pass(`待打标签 ext-v${version} / site-v${version} 尚未占用`)
    }
  } catch {
    warn('git 不可用，跳过标签检查')
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
