// HIGH_ENTROPY 规则：阈值由 Profile 类别灵敏度提供；剥离 "KEY=" 前缀、含 '@' 的候选先让位给 EMAIL / DB_PASSWORD 规则。

import type { DetectionItem } from '../../types'
import { generateId } from '../../utils/id'

export const calculateEntropy = (str: string): number => {
  const freq: Record<string, number> = {}
  for (const char of str) {
    freq[char] = (freq[char] || 0) + 1
  }
  const len = str.length
  let entropy = 0
  for (const count of Object.values(freq)) {
    const p = count / len
    entropy -= p * Math.log2(p)
  }
  return entropy
}

export const detectHighEntropy = (
  text: string,
  thresholds: { minLength: number; minEntropy: number } = { minLength: 25, minEntropy: 3.5 }
): DetectionItem[] => {
  const items: DetectionItem[] = []
  const pattern = new RegExp(`[A-Za-z0-9!@#$%^&*()_+\\-=\\/\\\\[\\]{}:;"'.,<>?~\`|]{${thresholds.minLength},}`, 'g')
  let match

  while ((match = pattern.exec(text)) !== null) {
    let str = match[0]
    let strStart = match.index!

    // 剥离 "KEY=" 前缀：候选常吞掉整个赋值行、把 key 名也一并替换掉；值部分交给 ENV_PASSWORD 规则
    const assignmentPrefix = str.match(/^([A-Z0-9_]{2,40})=/)
    if (assignmentPrefix) {
      strStart += assignmentPrefix[0].length
      str = str.substring(assignmentPrefix[0].length)
      if (str.length < thresholds.minLength) continue
    }

    // 含 '@' 的候选先做邮箱/连接串判定，命中则让位给 EMAIL / DB_PASSWORD 规则，避免高熵 span 吞掉 '@' 后半段造成截断式替换
    if (str.includes('@')) {
      const isEmailLike = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(str)
      const isConnectionLike = /:\S*@\S/.test(str)
      if (isEmailLike || isConnectionLike) {
        console.log('[ContextWatchdog] High-entropy candidate yields to EMAIL/DB rule:', str.substring(0, 30) + '...')
        continue
      }
    }

    const entropy = calculateEntropy(str)

    // 熵值>3.5 且至少包含 2 类字符（大小写/数字/特殊字符）
    const hasLower = /[a-z]/.test(str)
    const hasUpper = /[A-Z]/.test(str)
    const hasDigit = /[0-9]/.test(str)
    const hasSpecial = /[^A-Za-z0-9]/.test(str)
    const charClasses = [hasLower, hasUpper, hasDigit, hasSpecial].filter(Boolean).length

    if (entropy > thresholds.minEntropy && charClasses >= 2) {
      console.log('[ContextWatchdog] Found HIGH_ENTROPY:', str.substring(0, 30) + (str.length > 30 ? '...' : ''), 'entropy:', entropy.toFixed(2))
      items.push({
        id: generateId(),
        type: 'HIGH_ENTROPY',
        original: str,
        placeholder: `<<SECRET:${items.length + 1}>>`,
        startIndex: strStart,
        endIndex: strStart + str.length,
        confidence: 'low',
        context: text.substring(Math.max(0, strStart - 20), strStart + str.length + 20)
      })
    }
  }

  return items
}
