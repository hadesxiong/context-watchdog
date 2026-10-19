// 感谢墙的分档渲染
//
// 为什么要分档：一个人名和两百个人名不能用同一种排版。名字少的时候可以一个个
// 大方地列出来；多起来以后，长列表会把页面撑成一堵墙，反而看不清。
//
// 分档规则（人数 → 形态）：
//   0        不渲染该区块（**空列表比没有更难看**，也容易被读成"没人支持"）
//   1–3      spotlight：单独露脸，字号更大
//   4–20     list：单列
//   21–100   grid：网格 + 总数
//   >100     recent：只显示最近 30 位 + 总数
//
// 这个函数是纯函数，因此有单测（tests/unit/siteSupporters.test.ts）。
// 页面只负责按 plan.mode 选样式。
import raw from './supporters.json'

export interface Supporter {
  /** 展示用昵称（**必须**取得本人同意后才录入） */
  name: string
  /** 可选的一句说明，例如"第一个提误报的人" */
  note?: string
  /** 加入时间，YYYY-MM */
  since?: string
}

export type ThanksPlan =
  | { mode: 'hidden' }
  | { mode: 'spotlight'; people: Supporter[] }
  | { mode: 'list'; people: Supporter[] }
  | { mode: 'grid'; people: Supporter[]; total: number }
  | { mode: 'recent'; shown: Supporter[]; total: number }

/** 超过这个人数就只显示最近的若干位 */
export const RECENT_LIMIT = 30

/**
 * 把支持者列表映射成渲染计划。
 * people 约定为**按时间升序**存放（新加入的追加在末尾），因此"最近"取尾部。
 */
export const thanksPlan = (people: readonly Supporter[]): ThanksPlan => {
  const total = people.length
  if (total === 0) return { mode: 'hidden' }
  if (total <= 3) return { mode: 'spotlight', people: [...people] }
  if (total <= 20) return { mode: 'list', people: [...people] }
  if (total <= 100) return { mode: 'grid', people: [...people], total }
  // 最新的排在前面
  return { mode: 'recent', shown: people.slice(-RECENT_LIMIT).reverse(), total }
}

export const supporters = (raw as { people?: Supporter[] }).people ?? []
export const supportersUpdated = (raw as { updated?: string }).updated ?? ''
export const plan = thanksPlan(supporters)
