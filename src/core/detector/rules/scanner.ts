// 扫描器 - 执行所有正则规则并合并结果

import type { DetectionRule, DetectionItem, DetectionType } from '../../types'
import { SENSITIVE_KEYWORDS, NON_SENSITIVE_KEYWORDS, FUNCTION_PATTERNS } from './constants'
import { detectHighEntropy } from './highEntropyRules'
import { generateId } from '../../utils/id'

// 扫描正则规则
// options.enableEntropy: 是否附带高熵检测（Profile 停用 entropy 类别时传 false）
// options.entropyThresholds: 高熵阈值（来自 Profile 类别灵敏度）
export const scanRegexRules = (
  text: string,
  rules: DetectionRule[],
  options: { enableEntropy?: boolean; entropyThresholds?: { minLength: number; minEntropy: number } } = {}
): DetectionItem[] => {
  const { enableEntropy = true, entropyThresholds } = options
  const items: DetectionItem[] = []

  console.log('[PasteGuard] Scanning regex rules...')

  for (const rule of rules) {
    let match
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags)
    let ruleMatchCount = 0

    while ((match = pattern.exec(text)) !== null) {
      ruleMatchCount++

      // 有 extractor 的规则需要特殊处理
      if (rule.extractor) {
        const extracted = rule.extractor(match, text)
        if (extracted) {
          // 检查是否已有相同位置的检测项
          const existingItem = items.find(
            item => item.startIndex <= extracted.startIndex && item.endIndex >= extracted.endIndex
          )

          if (existingItem) {
            // 合并检测类型
            if (!existingItem.detectionTypes) {
              existingItem.detectionTypes = [existingItem.type]
            }
            if (!existingItem.detectionTypes.includes(rule.type)) {
              existingItem.detectionTypes.push(rule.type)
              console.log('[PasteGuard] Merged detection types:', existingItem.detectionTypes)
            }
          } else {
            items.push({
              id: generateId(),
              type: rule.type,
              original: extracted.original,
              placeholder: `<<${rule.type}:${items.length + 1}>>`,
              startIndex: extracted.startIndex,
              endIndex: extracted.endIndex,
              confidence: rule.confidence,
              context: text.substring(Math.max(0, extracted.startIndex - 20), extracted.endIndex + 20),
              detectionTypes: [rule.type]
            })
          }
        }
      } else {
        // 普通匹配（无 extractor）
        const original = match[0]
        const startIndex = match.index!
        const endIndex = startIndex + original.length

        // 检查是否是环境变量赋值
        const lineStart = text.lastIndexOf('\n', startIndex) + 1
        const line = text.substring(lineStart, endIndex)
        const varMatch = line.match(/^([A-Z0-9_]+)\s*=/)

        if (varMatch) {
          const varName = varMatch[1]

          // 检查是否在白名单中
          if (NON_SENSITIVE_KEYWORDS.some(kw => varName.includes(kw))) {
            console.log('[PasteGuard] Skipping whitelisted variable:', varName)
            continue
          }

          // 检查是否是函数调用
          if (FUNCTION_PATTERNS.some(pattern => pattern.test(varName))) {
            console.log('[PasteGuard] Skipping function call:', varName)
            continue
          }

          // 检查变量名是否包含点号
          if (varName.includes('.')) {
            console.log('[PasteGuard] Skipping object property:', varName)
            continue
          }

          // 检查是否是敏感变量名
          const isSensitive = SENSITIVE_KEYWORDS.some(kw => varName.includes(kw))

          // 检查是否已有相同位置的检测项
          const existingItem = items.find(
            item => item.startIndex <= startIndex && item.endIndex >= endIndex
          )

          if (existingItem) {
            // 合并检测类型（保留规则自身类型 + 敏感变量名的 ENV_PASSWORD 归类）
            const newTypes: DetectionType[] = isSensitive ? [rule.type, 'ENV_PASSWORD'] : [rule.type]
            if (!existingItem.detectionTypes) {
              existingItem.detectionTypes = [existingItem.type]
            }
            for (const t of newTypes) {
              if (!existingItem.detectionTypes.includes(t)) {
                existingItem.detectionTypes.push(t)
                console.log('[PasteGuard] Merged detection types:', existingItem.detectionTypes)
              }
            }
          } else {
            items.push({
              id: generateId(),
              type: isSensitive ? 'ENV_PASSWORD' : rule.type,
              original,
              placeholder: `<<${isSensitive ? 'ENV_PASSWORD' : rule.type}:${items.length + 1}>>`,
              startIndex,
              endIndex,
              confidence: isSensitive ? 'high' : rule.confidence,
              context: line.trim(),
              detectionTypes: [isSensitive ? 'ENV_PASSWORD' : rule.type]
            })
          }
        } else {
          // 检查是否已有相同位置的检测项
          const existingItem = items.find(
            item => item.startIndex <= startIndex && item.endIndex >= endIndex
          )

          if (existingItem) {
            // 合并检测类型
            if (!existingItem.detectionTypes) {
              existingItem.detectionTypes = [existingItem.type]
            }
            if (!existingItem.detectionTypes.includes(rule.type)) {
              existingItem.detectionTypes.push(rule.type)
              console.log('[PasteGuard] Merged detection types:', existingItem.detectionTypes)
            }
          } else {
            items.push({
              id: generateId(),
              type: rule.type,
              original,
              placeholder: `<<${rule.type}:${items.length + 1}>>`,
              startIndex,
              endIndex,
              confidence: rule.confidence,
              context: text.substring(Math.max(0, startIndex - 20), endIndex + 20),
              detectionTypes: [rule.type]
            })
          }
        }
      }
    }

    if (ruleMatchCount > 0) {
      console.log(`[PasteGuard] Rule ${rule.type} matched ${ruleMatchCount} times`)
    }
  }

  // 添加高熵字符串检测
  if (enableEntropy) {
    console.log('[PasteGuard] Detecting high entropy strings...')
    const highEntropyItems = detectHighEntropy(text, entropyThresholds)
    console.log('[PasteGuard] Found', highEntropyItems.length, 'high entropy strings')
    for (const item of highEntropyItems) {
      // 检查是否已有相同位置的检测项
      const existingItem = items.find(
        existing => existing.startIndex <= item.startIndex && existing.endIndex >= item.endIndex
      )

      if (existingItem) {
        // 合并检测类型
        if (!existingItem.detectionTypes) {
          existingItem.detectionTypes = [existingItem.type]
        }
        if (!existingItem.detectionTypes.includes('HIGH_ENTROPY')) {
          existingItem.detectionTypes.push('HIGH_ENTROPY')
          console.log('[PasteGuard] Merged detection types:', existingItem.detectionTypes)
        }
      } else {
        items.push({
          ...item,
          detectionTypes: ['HIGH_ENTROPY']
        })
      }
    }
  }

  console.log('[PasteGuard] Total items found:', items.length)
  return items
}
