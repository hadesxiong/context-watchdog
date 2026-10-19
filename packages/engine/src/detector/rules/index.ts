// 规则模块汇总导出

import type { DetectionRule, RuleCategory } from '../../types'
import { envPasswordRules } from './envPasswordRules'
import { dbPasswordRules } from './dbPasswordRules'
import { apiKeyRules } from './apiKeyRules'
import { privateKeyRules } from './privateKeyRules'
import { emailRules } from './emailRules'
import { piiRules } from './piiRules'
import { kvPasswordRules } from './kvRules'
import { usRules } from './usRules'
import { euRules } from './euRules'

// 所有正则规则（按优先级排列）
export const regexRules: DetectionRule[] = [
  ...envPasswordRules,
  ...kvPasswordRules,
  ...dbPasswordRules,
  ...apiKeyRules,
  ...privateKeyRules,
  ...piiRules,
  ...usRules,
  ...euRules,
  ...emailRules
]

// 按类别分组的规则集（Profile 按类别启用）
export const rulesByCategory: Record<RuleCategory, DetectionRule[]> = {
  secret: [...envPasswordRules, ...kvPasswordRules, ...dbPasswordRules, ...apiKeyRules, ...privateKeyRules],
  pii: [...piiRules, ...emailRules],
  entropy: [], // 高熵检测独立于 regexRules，由 scanner 特殊处理
  us: usRules,
  eu: euRules
}

// 重新导出扫描器
export { scanRegexRules } from './scanner'

// 重新导出常量和过滤器（供外部使用）
export { SENSITIVE_KEYWORDS, NON_SENSITIVE_KEYWORDS, DB_SCHEMES } from './constants'
export { isWeakPassword, isTooShort, isNumericOnly, shouldSkipValue, WEAK_PASSWORDS } from './valueFilters'
export { detectHighEntropy, calculateEntropy } from './highEntropyRules'
