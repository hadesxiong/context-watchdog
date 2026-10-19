// 「证据」区块的数字
//
// 这三个值**不要手改**：由 `node scripts/site-evidence.mjs` 跑一遍真实套件后写入
// （它会执行 vitest 与 probe:layout，再把结果落到 evidence.json）。
// 这样页面上的数字与仓库当前状态一致，而不是发布那天的快照。
import raw from './evidence.json'

export interface Evidence {
  tests: number
  probes: number
  /** 测量日期 YYYY-MM-DD */
  measuredAt: string
}

const evidence = raw as Evidence

if (!Number.isInteger(evidence.tests) || evidence.tests <= 0) {
  throw new Error(`[site] evidence.json 的 tests 不合法：${JSON.stringify(evidence.tests)}`)
}
if (!Number.isInteger(evidence.probes) || evidence.probes <= 0) {
  throw new Error(`[site] evidence.json 的 probes 不合法：${JSON.stringify(evidence.probes)}`)
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(evidence.measuredAt)) {
  throw new Error(`[site] evidence.json 的 measuredAt 应为 YYYY-MM-DD：${evidence.measuredAt}`)
}

export const { tests, probes, measuredAt } = evidence

/** 千分位：288 不需要，但计数器迟早会到四位数 */
export const count = (value: number): string => value.toLocaleString('en-US')
