#!/usr/bin/env node
// 文档结构一致性检查：相对链接 / 锚点 / 反引号路径 / 三处文档地图 / 测试基线数字。
// 人工规则见 CONTRIBUTING.md「文档索引与更新触发」；这里把可机器判定的部分变成硬失败。
// 用法：npm run check:docs（无参数；失败 exit 1，纳入回归）
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

const results = []
const fail = (message) => results.push({ level: 'fail', message })
const warn = (message) => results.push({ level: 'warn', message })
const pass = (message) => results.push({ level: 'pass', message })

const git = (pattern) =>
  execSync(`git ls-files "${pattern}"`, { cwd: root, encoding: 'utf8' })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
const read = (rel) => readFileSync(resolve(root, rel), 'utf8')

const mdFiles = git('*.md')

// ------------------------------------------------ 1) 相对链接与锚点

const githubSlug = (heading) =>
  heading
    .replace(/^#+\s*/, '')
    .replace(/[`*_]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-_]/gu, '')
    .replace(/\s+/g, '-')

const slugCache = new Map()
const headingsOf = (abs) => {
  if (slugCache.has(abs)) return slugCache.get(abs)
  const slugs = new Set()
  const counts = new Map()
  for (const line of readFileSync(abs, 'utf8').split(/\r?\n/)) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line)
    if (!m) continue
    const base = githubSlug(m[2])
    const n = counts.get(base) ?? 0
    counts.set(base, n + 1)
    slugs.add(n === 0 ? base : `${base}-${n}`)
  }
  slugCache.set(abs, slugs)
  return slugs
}

const LINK_RE = /\[[^\]]*\]\(\s*([^)\s]+?)(?:\s+"[^"]*")?\s*\)/g
let linkCount = 0
let anchorCount = 0
let linkProblems = 0

for (const rel of mdFiles) {
  for (const m of read(rel).matchAll(LINK_RE)) {
    const target = m[1]
    if (/^(https?:|mailto:)/.test(target)) continue
    linkCount += 1
    if (target.startsWith('#')) {
      anchorCount += 1
      const slug = decodeURIComponent(target.slice(1)).toLowerCase()
      if (!headingsOf(resolve(root, rel)).has(slug)) {
        linkProblems += 1
        fail(`${rel}: 站内锚点失效 → ${target}`)
      }
      continue
    }
    const hash = target.indexOf('#')
    const pathPart = hash === -1 ? target : target.slice(0, hash)
    const anchor = hash === -1 ? '' : target.slice(hash + 1)
    const targetAbs = resolve(root, dirname(rel), decodeURIComponent(pathPart))
    if (!existsSync(targetAbs)) {
      linkProblems += 1
      fail(`${rel}: 链接目标不存在 → ${target}`)
      continue
    }
    if (anchor && targetAbs.endsWith('.md')) {
      anchorCount += 1
      if (!headingsOf(targetAbs).has(decodeURIComponent(anchor).toLowerCase())) {
        linkProblems += 1
        fail(`${rel}: 目标锚点失效 → ${target}`)
      }
    }
  }
}
if (linkProblems === 0) {
  pass(`相对链接 ${linkCount} 条、锚点 ${anchorCount} 处全部有效（${mdFiles.length} 个 md）`)
}

// ------------------------------------------------ 2) 反引号路径提及

let mentionCount = 0
let mentionProblems = 0
for (const rel of mdFiles) {
  if (rel === 'CHANGELOG.md') continue // 历史流水：如实记录已移出的文档
  for (const m of read(rel).matchAll(/`(docs\/[A-Za-z0-9._/-]+\.md)(?:\s*§+\s*\d+(?:\.\d+)*)?`/g)) {
    mentionCount += 1
    if (!existsSync(resolve(root, m[1]))) {
      mentionProblems += 1
      fail(`${rel}: 反引号路径不存在 → ${m[1]}`)
    }
  }
}
if (mentionProblems === 0) {
  pass(`反引号 docs/ 路径提及 ${mentionCount} 处全部在仓（CHANGELOG 历史豁免）`)
}

// ------------------------------------------------ 3) 三处地图 vs docs/ 实际文件集

const actualDocs = git('docs/*.md')
const docsMentioned = (rel) => new Set(read(rel).match(/docs\/[A-Za-z0-9._/-]+\.md/g) ?? [])
const maps = {
  'README.md': docsMentioned('README.md'),
  'README.zh-CN.md': docsMentioned('README.zh-CN.md'),
  'CONTRIBUTING.md': docsMentioned('CONTRIBUTING.md')
}
let mapProblems = 0
for (const file of actualDocs) {
  for (const [mapName, set] of Object.entries(maps)) {
    if (!set.has(file)) {
      mapProblems += 1
      fail(`${mapName} 缺少 ${file} 的行/提及`)
    }
  }
}
for (const f of maps['README.md']) {
  if (!maps['README.zh-CN.md'].has(f)) {
    mapProblems += 1
    fail(`双语地图不同步：README.md 有而 zh 无 → ${f}`)
  }
}
for (const f of maps['README.zh-CN.md']) {
  if (!maps['README.md'].has(f)) {
    mapProblems += 1
    fail(`双语地图不同步：zh 有而 README.md 无 → ${f}`)
  }
}
for (const [mapName, set] of Object.entries(maps)) {
  for (const f of set) {
    if (!existsSync(resolve(root, f))) {
      mapProblems += 1
      fail(`${mapName} 提及不存在的文件 → ${f}`)
    }
  }
}
if (mapProblems === 0) {
  pass(`三处地图（README×2 / CONTRIBUTING）与 docs/ 实际 ${actualDocs.length} 份一致`)
}

// ------------------------------------------------ 4) 测试基线数字一致性

// 当前基线的各提及处（写法改了就同步更新这张表；CHANGELOG 不参与）
const baselineSpots = [
  { rel: 'README.md', re: /run the suite \((\d+) assertions\)/ },
  { rel: 'README.zh-CN.md', re: /运行测试套件（(\d+) 项断言）/ },
  { rel: 'docs/spec.md', re: /`npm test`：\*\*(\d+) 断言 \/ (\d+) 文件\*\*/ },
  { rel: 'docs/test-cases.md', re: /期望 \*\*(\d+) passed \/ (\d+) 文件\*\*/ },
  { rel: 'TODO.md', re: /\*\*(\d+) passed（(\d+) 文件）\*\*/ },
  { rel: 'docs/site-ai-offscreen-host.md', re: /当前基线 (\d+) 项/ }
]
const testHits = []
const fileHits = []
for (const spot of baselineSpots) {
  const m = spot.re.exec(read(spot.rel))
  if (!m) {
    warn(`${spot.rel}: 未命中当前基线模式（写法改了？同步更新 scripts/check-docs.mjs 的模式表）`)
    continue
  }
  testHits.push({ rel: spot.rel, n: Number(m[1]) })
  if (m[2] !== undefined) fileHits.push({ rel: spot.rel, n: Number(m[2]) })
}
let baselineOk = true
const testValues = new Set(testHits.map((h) => h.n))
if (testValues.size > 1) {
  baselineOk = false
  fail(`测试基线数字不一致：${testHits.map((h) => `${h.rel}=${h.n}`).join('、')}（对齐 npm test 实际结果）`)
}
const fileValues = new Set(fileHits.map((h) => h.n))
if (fileValues.size > 1) {
  baselineOk = false
  fail(`文件数基线不一致：${fileHits.map((h) => `${h.rel}=${h.n}`).join('、')}（对齐 npm test 实际结果）`)
}
if (baselineOk && testValues.size === 1 && fileValues.size === 1) {
  pass(`测试基线 ${testHits.length} 处一致：${[...testValues][0]} 项 / ${[...fileValues][0]} 文件`)
}

// ---------------------------------------------------------------- 输出

const icon = { pass: '✓', warn: '!', fail: '✗' }
for (const result of results) {
  const line = `  ${icon[result.level]} ${result.message}`
  if (result.level === 'fail') console.error(line)
  else console.log(line)
}

const failures = results.filter((r) => r.level === 'fail').length
const warnings = results.filter((r) => r.level === 'warn').length

if (failures > 0) {
  console.error(`\n✗ check:docs 失败：${failures} 项（警告 ${warnings} 项）`)
  process.exit(1)
}

console.log(`\n✓ check:docs 通过${warnings > 0 ? `（${warnings} 项警告）` : ''}`)
