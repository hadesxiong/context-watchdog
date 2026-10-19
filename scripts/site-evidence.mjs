#!/usr/bin/env node
// 重新测量落地页「证据」区块里的数字（测试断言数 / 布局探针数）
//
// 为什么要有这个脚本：落地页上写「288 项断言」是一句**会过期的事实**。
// 手写在页面里，下一次加测试它就变成假话，而且没人会注意到。
// 这里把它变成「跑一遍真实套件，然后写入 data/evidence.json」，
// 页面只读文件、不写数字。
//
// 用法：
//   node scripts/site-evidence.mjs        # 测量并写入
//   node scripts/site-evidence.mjs --check # 只比较，不看是否过期（供 CI/发布前校验）
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
