// KEY: VALUE / "key": "value" 规则 - YAML / JSON 场景的密钥检测（纯正则降级模式下也不漏检）

import type { DetectionRule } from '../../types'
import { SENSITIVE_KEYWORDS, NON_SENSITIVE_KEYWORDS, FUNCTION_PATTERNS } from './constants'
import { shouldSkipValue } from './valueFilters'

// 判断 key 是否敏感（白名单/函数调用/敏感关键词的共用逻辑）
const isSensitiveKey = (key: string): boolean => {
  const cleanKey = key.replace(/^["']|["']$/g, '').toUpperCase()
  if (NON_SENSITIVE_KEYWORDS.some(kw => cleanKey.includes(kw))) return false
  if (FUNCTION_PATTERNS.some(p => p.test(cleanKey))) return false
  return SENSITIVE_KEYWORDS.some(kw => cleanKey.includes(kw))
}

export const kvPasswordRules: DetectionRule[] = [
  // YAML: KEY: value / "KEY": value（含缩进）
  {
    type: 'ENV_PASSWORD',
    pattern: /^[ \t]*["']?([A-Za-z_][\w.-]*)["']?[ \t]*:[ \t]*(.+)$/gm,
    confidence: 'high',
    extractor: (match) => {
      const key = match[1]
      let value = match[2].trim()

      if (!isSensitiveKey(key)) return null

      value = value.replace(/\s+#.*$/, '').replace(/^['"]|['"]$/g, '')
      const { skip } = shouldSkipValue(value)
      if (skip) return null

      const fullMatch = match[0]
      const rawValue = match[2].trim().replace(/\s+#.*$/, '').replace(/^['"]|['"]$/g, '')
      const valueStartInMatch = fullMatch.indexOf(rawValue)
      if (valueStartInMatch === -1) return null

      return {
        original: value,
        startIndex: match.index! + valueStartInMatch,
        endIndex: match.index! + valueStartInMatch + value.length
      }
    }
  },
  // JSON: "key": "value"
  {
    type: 'ENV_PASSWORD',
    pattern: /"([A-Za-z_][\w.-]*)"[ \t]*:[ \t]*"([^"\\]{4,})"/g,
    confidence: 'high',
    extractor: (match) => {
      const key = match[1]
      const value = match[2]

      if (!isSensitiveKey(key)) return null
      const { skip } = shouldSkipValue(value)
      if (skip) return null

      // value 在 fullMatch 中的偏移：key 部分 + 冒号 + 引号
      const valueStartInMatch = match[0].indexOf(`"${value}"`) + 1

      return {
        original: value,
        startIndex: match.index! + valueStartInMatch,
        endIndex: match.index! + valueStartInMatch + value.length
      }
    }
  }
]
