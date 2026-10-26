#!/usr/bin/env node
// 重测落地页「证据」数字（断言数 / 探针数）写入 data/evidence.json，页面只读不算数——手写的数字
// 会随测试增长静默过期。见 docs/spec.md §11.1。--check 只比对不写入（供 CI / 发布前）。
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const evidencePath = fileURLToPath(new URL('../apps/site/src/data/evidence.json', import.meta.url))

const checkOnly = process.argv.includes('--check')

const run = (command) =>
  execSync(command, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/** 今天（本地日期，YYYY-MM-DD）——用本地而不是 UTC，读者看到的是发布者的日历 */
const today = () => {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

console.log('[evidence] 运行测试套件…')
const testOutput = run('npx vitest run')
const testMatch = /Tests\s+(\d+) passed/.exec(testOutput)
if (!testMatch) {
  console.error('[evidence] 没能从 vitest 输出里解析出断言数。输出尾部：')
  console.error(testOutput.slice(-2000))
  process.exit(1)
}

console.log('[evidence] 运行布局探针…')
const probeOutput = run('npm run probe:layout')
const probeCount = (probeOutput.match(/✓ PASS/g) ?? []).length
if (probeCount === 0) {
  console.error('[evidence] 没能从探针输出里数出 PASS 数。输出尾部：')
  console.error(probeOutput.slice(-2000))
  process.exit(1)
}

const measured = {
  tests: Number(testMatch[1]),
  probes: probeCount,
  measuredAt: today()
}

const current = JSON.parse(readFileSync(evidencePath, 'utf8'))
const same =
  current.tests === measured.tests &&
  current.probes === measured.probes &&
  current.measuredAt === measured.measuredAt

if (checkOnly) {
  if (!same) {
    console.error(
      `[evidence] 过期：页面写的是 tests=${current.tests} probes=${current.probes}@${current.measuredAt}，` +
        `实测 tests=${measured.tests} probes=${measured.probes}`
    )
    process.exit(1)
  }
  console.log(`[evidence] 与实测一致：tests=${measured.tests} probes=${measured.probes}`)
  process.exit(0)
}

writeFileSync(evidencePath, `${JSON.stringify(measured, null, 2)}\n`, 'utf8')
console.log(
  `[evidence] 已写入 tests=${measured.tests} / probes=${measured.probes} / measuredAt=${measured.measuredAt}` +
    (same ? '（无变化）' : '')
)
