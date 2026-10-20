// 用户自定义正则规则（Phase 5）
// ReDoS 防护（双层）：
// 1. 静态：星号高度检查 —— 拒绝嵌套量词（如 (a+)+、(a*)*、(a?)+），这是灾难性回溯的主因
// 2. 运行时：每条规则 50ms 时间预算 + 匹配上限，超限即中断该规则（防慢规则拖垮检测）

import type { CustomRule, DetectionRule, DetectionItem, DetectionType } from '../../types'
import { generateId } from '../../utils/id'

// 自定义规则限制
export const CUSTOM_PATTERN_MAX_LENGTH = 200
export const CUSTOM_RULE_TIME_BUDGET_MS = 50
export const CUSTOM_RULE_MAX_MATCHES = 200

// ---- 静态校验 ----

// 星号高度检查：解析模式，跟踪每层括号内是否含量词；
// 若某括号组内已有量词且该组本身又被量化 → 嵌套量词 → 拒绝
const checkNestedQuantifier = (pattern: string): string | null => {
  const stack: Array<{ hasQuantifier: boolean }> = []
  let inCharClass = false

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]

    if (ch === '\\') { i++; continue }          // 转义：跳过下一个字符
    if (inCharClass) {
      if (ch === ']') inCharClass = false
      continue
    }
    if (ch === '[') { inCharClass = true; continue }

    if (ch === '(') {
      stack.push({ hasQuantifier: false })
      // 跳过扩展组语法，避免把 (?: 的 ? 误判为量词
      if (pattern[i + 1] === '?') {
        const next = pattern[i + 2]
        if (next === ':' || next === '=' || next === '!') {
          i += 2
        } else if (next === '<') {
          // 命名组 (?<name>... 或零宽后行断言 (?<= (?<! —— 统一跳到 '>'
          const gt = pattern.indexOf('>', i + 2)
          if (gt !== -1) i = gt
        }
      }
      continue
    }

    if (ch === ')') {
      const group = stack.pop()
      const next = pattern[i + 1]
      const quantified = next === '*' || next === '+' || next === '{' || next === '?'
      if (group?.hasQuantifier && quantified) {
        return '模式存在嵌套量词（如 (a+)+ 或 (a*)*），可能导致灾难性回溯，请改写为等价的非嵌套形式'
      }
      // 该组被量化 → 量词信息上传父层（父层再被量化即为嵌套）
      if (quantified && stack.length > 0) {
        stack[stack.length - 1].hasQuantifier = true
      }
      continue
    }

    if (ch === '*' || ch === '+' || ch === '{' || ch === '?') {
      if (stack.length > 0) stack[stack.length - 1].hasQuantifier = true
    }
  }

  return null
}

export interface PatternValidation {
  ok: boolean
  error?: string
}

// 正则模式校验：长度 / 语法 / 嵌套量词
export const validateCustomPattern = (pattern: string): PatternValidation => {
  if (!pattern.trim()) return { ok: false, error: '正则不能为空' }
  if (pattern.length > CUSTOM_PATTERN_MAX_LENGTH) {
    return { ok: false, error: `正则长度不能超过 ${CUSTOM_PATTERN_MAX_LENGTH} 字符` }
  }

  try {
    new RegExp(pattern, 'g')
  } catch (e) {
    return { ok: false, error: `正则语法错误：${e instanceof Error ? e.message : String(e)}` }
  }

  const nested = checkNestedQuantifier(pattern)
  if (nested) return { ok: false, error: nested }

  return { ok: true }
}

// 规则完整性校验（名称/模式/类型/重复）
export const validateCustomRule = (
  rule: Pick<CustomRule, 'name' | 'pattern' | 'type'>,
  existingRules: CustomRule[] = []
): PatternValidation => {
  if (!rule.name.trim()) return { ok: false, error: '规则名称不能为空' }
  if (rule.name.trim().length > 20) return { ok: false, error: '规则名称不能超过 20 字符' }
  if (existingRules.some(r => r.pattern === rule.pattern)) {
    return { ok: false, error: '相同正则已存在于该档案' }
  }
  return validateCustomPattern(rule.pattern)
}

// ---- 编译与执行 ----

// 编译为内部 DetectionRule（带 g flag）
export const compileCustomRule = (rule: CustomRule): DetectionRule | null => {
  const validation = validateCustomPattern(rule.pattern)
  if (!validation.ok) {
    console.warn('[ContextWatchdog] Custom rule rejected:', rule.name, validation.error)
    return null
  }

  return {
    type: rule.type,
    pattern: new RegExp(rule.pattern, 'g'),
    confidence: rule.confidence
  }
}

export interface CustomScanResult {
  items: DetectionItem[]
  warnings: string[]
}

// 扫描自定义规则：独立于主 scanner，带时间预算与匹配上限
export const scanCustomRules = (text: string, rules: CustomRule[]): CustomScanResult => {
  const items: DetectionItem[] = []
  const warnings: string[] = []

  for (const rule of rules) {
    if (!rule.enabled) continue

    const compiled = compileCustomRule(rule)
    if (!compiled) {
      warnings.push(`规则「${rule.name}」校验失败，已跳过`)
      continue
    }

    const startTime = performance.now()
    let matchCount = 0
    let match: RegExpExecArray | null

    while ((match = compiled.pattern.exec(text)) !== null) {
      // 时间预算：超限中断该规则（静态防护外的运行时兜底）
      if (performance.now() - startTime > CUSTOM_RULE_TIME_BUDGET_MS) {
        warnings.push(`规则「${rule.name}」执行超时（>${CUSTOM_RULE_TIME_BUDGET_MS}ms），已中断`)
        console.warn('[ContextWatchdog] Custom rule exceeded time budget:', rule.name)
        break
      }
      if (++matchCount > CUSTOM_RULE_MAX_MATCHES) {
        warnings.push(`规则「${rule.name}」匹配数超过上限（${CUSTOM_RULE_MAX_MATCHES}），已中断`)
        break
      }

      const original = match[0]
      if (original === '') {
        // 零宽匹配：推进 lastIndex 防死循环
        compiled.pattern.lastIndex++
        continue
      }

      const startIndex = match.index
      items.push({
        id: generateId(),
        type: rule.type,
        original,
        placeholder: '',
        startIndex,
        endIndex: startIndex + original.length,
        confidence: rule.confidence,
        context: text.substring(Math.max(0, startIndex - 20), startIndex + original.length + 20),
        detectionTypes: [rule.type as DetectionType],
        source: 'regex'
      })
    }
  }

  return { items, warnings }
}
