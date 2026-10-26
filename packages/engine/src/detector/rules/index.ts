// 规则模块汇总导出：所有正则规则（按优先级）、按类别分组（Profile 按类别启用）、重新导出扫描器/常量/过滤器。

import type { DetectionRule, RuleCategory } from '../../types'
import { envPasswordRules } from './envPasswordRules'
import { dbPasswordRules } from './dbPasswordRules'
import { apiKeyRules } from './apiKeyRules'
import { privateKeyRules } from './privateKeyRules'
import { emailRules } from './emailRules'
import { piiRules } from './piiRules'
import { kvPasswordRules } from './kvRules'
import { naturalPasswordRules } from './naturalPasswordRules'
import { usRules } from './usRules'
import { euRules } from './euRules'

export const regexRules: DetectionRule[] = [
  ...envPasswordRules,
  ...kvPasswordRules,
  ...naturalPasswordRules,
  ...dbPasswordRules,
  ...apiKeyRules,
  ...privateKeyRules,
  ...piiRules,
  ...usRules,
  ...euRules,
  ...emailRules
]

export const rulesByCategory: Record<RuleCategory, DetectionRule[]> = {
  secret: [...envPasswordRules, ...kvPasswordRules, ...naturalPasswordRules, ...dbPasswordRules, ...apiKeyRules, ...privateKeyRules],
  pii: [...piiRules, ...emailRules],
  entropy: [],
  us: usRules,
  eu: euRules
}

export { scanRegexRules } from './scanner'
export { SENSITIVE_KEYWORDS, NON_SENSITIVE_KEYWORDS, DB_SCHEMES } from './constants'
export { isWeakPassword, isTooShort, isNumericOnly, shouldSkipValue, WEAK_PASSWORDS } from './valueFilters'
export { detectHighEntropy, calculateEntropy } from './highEntropyRules'
