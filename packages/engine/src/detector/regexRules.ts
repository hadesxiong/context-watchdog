// 正则规则代理层 - 保持向后兼容
// 实际规则已拆分到 rules/ 目录下的独立文件中

// 重新导出所有规则和工具函数
export { regexRules, scanRegexRules, rulesByCategory } from './rules'
export { SENSITIVE_KEYWORDS, NON_SENSITIVE_KEYWORDS, DB_SCHEMES } from './rules'
export { isWeakPassword, isTooShort, isNumericOnly, shouldSkipValue, WEAK_PASSWORDS } from './rules'
export { detectHighEntropy, calculateEntropy } from './rules'
