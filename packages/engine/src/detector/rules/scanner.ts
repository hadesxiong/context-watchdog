// 扫描器：执行所有正则规则并合并结果；无 extractor 时按 '=' 与匹配之间只有空白判定 ENV_PASSWORD；高熵检测可选。

import type { DetectionRule, DetectionItem, DetectionType } from '../../types'
import { SENSITIVE_KEYWORDS, NON_SENSITIVE_KEYWORDS, FUNCTION_PATTERNS } from './constants'
import { detectHighEntropy } from './highEntropyRules'
import { generateId } from '../../utils/id'

export const scanRegexRules = (
  text: string,
  rules: DetectionRule[],
  options: { enableEntropy?: boolean; entropyThresholds?: { minLength: number; minEntropy: number } } = {}
): DetectionItem[] => {
  const { enableEntropy = true, entropyThresholds } = options
  const items: DetectionItem[] = []

  console.log('[ContextWatchdog] Scanning regex rules...')

  for (const rule of rules) {
    let match
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags)
    let ruleMatchCount = 0

    while ((match = pattern.exec(text)) !== null) {
      ruleMatchCount++

      if (rule.extractor) {
        const extracted = rule.extractor(match, text)
        if (extracted) {
          const existingItem = items.find(
            item => item.startIndex <= extracted.startIndex && item.endIndex >= extracted.endIndex
          )

          if (existingItem) {
            if (!existingItem.detectionTypes) {
              existingItem.detectionTypes = [existingItem.type]
            }
            if (!existingItem.detectionTypes.includes(rule.type)) {
              existingItem.detectionTypes.push(rule.type)
              console.log('[ContextWatchdog] Merged detection types:', existingItem.detectionTypes)
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
        const original = match[0]
        const startIndex = match.index!
        const endIndex = startIndex + original.length

        // 仅当 '=' 与匹配之间只有空白（即匹配就是 env 值本身）才重归类为 ENV_PASSWORD
        const lineStart = text.lastIndexOf('\n', startIndex) + 1
        const prefix = text.substring(lineStart, startIndex)
        const varMatch = prefix.match(/^([A-Z0-9_]+)[\t ]*=[\t ]*$/)

        if (varMatch) {
          const varName = varMatch[1]

          if (NON_SENSITIVE_KEYWORDS.some(kw => varName.includes(kw))) {
            console.log('[ContextWatchdog] Skipping whitelisted variable:', varName)
            continue
          }

          if (FUNCTION_PATTERNS.some(pattern => pattern.test(varName))) {
            console.log('[ContextWatchdog] Skipping function call:', varName)
            continue
          }

          if (varName.includes('.')) {
            console.log('[ContextWatchdog] Skipping object property:', varName)
            continue
          }

          const isSensitive = SENSITIVE_KEYWORDS.some(kw => varName.includes(kw))

          const existingItem = items.find(
            item => item.startIndex <= startIndex && item.endIndex >= endIndex
          )

          if (existingItem) {
            const newTypes: DetectionType[] = isSensitive ? [rule.type, 'ENV_PASSWORD'] : [rule.type]
            if (!existingItem.detectionTypes) {
              existingItem.detectionTypes = [existingItem.type]
            }
            for (const t of newTypes) {
              if (!existingItem.detectionTypes.includes(t)) {
                existingItem.detectionTypes.push(t)
                console.log('[ContextWatchdog] Merged detection types:', existingItem.detectionTypes)
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
              context: prefix + original,
              detectionTypes: [isSensitive ? 'ENV_PASSWORD' : rule.type]
            })
          }
        } else {
          const existingItem = items.find(
            item => item.startIndex <= startIndex && item.endIndex >= endIndex
          )

          if (existingItem) {
            if (!existingItem.detectionTypes) {
              existingItem.detectionTypes = [existingItem.type]
            }
            if (!existingItem.detectionTypes.includes(rule.type)) {
              existingItem.detectionTypes.push(rule.type)
              console.log('[ContextWatchdog] Merged detection types:', existingItem.detectionTypes)
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
      console.log(`[ContextWatchdog] Rule ${rule.type} matched ${ruleMatchCount} times`)
    }
  }

  if (enableEntropy) {
    console.log('[ContextWatchdog] Detecting high entropy strings...')
    const highEntropyItems = detectHighEntropy(text, entropyThresholds)
    console.log('[ContextWatchdog] Found', highEntropyItems.length, 'high entropy strings')
    for (const item of highEntropyItems) {
      const existingItem = items.find(
        existing => existing.startIndex <= item.startIndex && existing.endIndex >= item.endIndex
      )

      if (existingItem) {
        if (!existingItem.detectionTypes) {
          existingItem.detectionTypes = [existingItem.type]
        }
        if (!existingItem.detectionTypes.includes('HIGH_ENTROPY')) {
          existingItem.detectionTypes.push('HIGH_ENTROPY')
          console.log('[ContextWatchdog] Merged detection types:', existingItem.detectionTypes)
        }
      } else {
        items.push({
          ...item,
          detectionTypes: ['HIGH_ENTROPY']
        })
      }
    }
  }

  console.log('[ContextWatchdog] Total items found:', items.length)
  return items
}
