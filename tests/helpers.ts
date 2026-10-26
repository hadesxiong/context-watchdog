import { detect } from '@engine/detector/pipeline'
import { getProfileById } from '@engine/detector/profiles'
import type { DetectionItem, DetectionResult, ProfileConfig } from '@engine/types'

// 以指定 profile 运行检测（缺省 universal）
export const runDetect = async (
  text: string,
  profileId = 'universal'
): Promise<DetectionResult> => {
  const profile: ProfileConfig = getProfileById(profileId)
  return detect(text, profile)
}

// 模拟替换引擎的按位置替换（与 Replacer.apply 逻辑一致）
export const applyReplace = (
  text: string,
  items: DetectionItem[],
  keepIds: Set<string> = new Set()
): string => {
  const sorted = [...items].sort((a, b) => b.startIndex - a.startIndex)
  let out = text
  for (const it of sorted) {
    if (keepIds.has(it.id)) continue
    out = out.substring(0, it.startIndex) + it.placeholder + out.substring(it.endIndex)
  }
  return out
}

// 断言检测项区间互不重叠
export const assertNoOverlap = (items: DetectionItem[]): void => {
  const sorted = [...items].sort((a, b) => a.startIndex - b.startIndex)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startIndex < sorted[i - 1].endIndex) {
      throw new Error(
        `区间重叠: [${sorted[i - 1].startIndex},${sorted[i - 1].endIndex}) 与 [${sorted[i].startIndex},${sorted[i].endIndex})`
      )
    }
  }
}

// 断言所有检测项的 span 与 original 一致（CJK 偏移验证核心）
export const assertSpansConsistent = (text: string, items: DetectionItem[]): void => {
  for (const item of items) {
    const sliced = text.substring(item.startIndex, item.endIndex)
    if (sliced !== item.original) {
      throw new Error(
        `span 与 original 不一致: span 内容=${JSON.stringify(sliced)}, original=${JSON.stringify(item.original)}`
      )
    }
  }
}
