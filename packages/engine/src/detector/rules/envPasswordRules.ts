// ENV_PASSWORD 规则 - 环境变量密码检测

import type { DetectionRule } from '../../types'
import { SENSITIVE_KEYWORDS, NON_SENSITIVE_KEYWORDS, FUNCTION_PATTERNS } from './constants'
import { shouldSkipValue } from './valueFilters'

export const envPasswordRules: DetectionRule[] = [
  // 环境变量赋值（优先级最高）
  // 注意 1：= 两侧用 [\t ]* 而非 \s*，防止 \s 跨行吞掉下一行赋值（如 EMPTY_PASSWORD=\nNEXT=xxx）
  // 注意 2：值支持引号包裹（含空格）或非空白串（空格即截断），防止吞掉行内后续文本
  //         如 API_KEY=xxx 与 support@example.com（整行吞值会导致邮箱漏检）
  {
    type: 'ENV_PASSWORD',
    pattern: /^([A-Z0-9_]+)[\t ]*=[\t ]*("([^"\n]*)"|'([^'\n]*)'|[^\s]+)/gm,
    confidence: 'high',
    extractor: (match) => {
      const varName = match[1]
      // 引号值取内层；裸值取非空白串
      const quotedInner = match[3] ?? match[4]
      const value = (quotedInner !== undefined ? quotedInner : match[2]).trim()

      // 检查是否在白名单中
      if (NON_SENSITIVE_KEYWORDS.some(kw => varName.includes(kw))) {
        console.log('[ContextWatchdog] Skipping whitelisted variable:', varName)
        return null
      }

      // 检查是否是函数调用（如 os.getenv、process.env）
      if (FUNCTION_PATTERNS.some(pattern => pattern.test(varName))) {
        console.log('[ContextWatchdog] Skipping function call:', varName)
        return null
      }

      // 检查变量名是否包含点号（对象属性访问）
      if (varName.includes('.')) {
        console.log('[ContextWatchdog] Skipping object property:', varName)
        return null
      }

      // 检查是否是敏感变量名
      const isSensitive = SENSITIVE_KEYWORDS.some(kw => varName.includes(kw))
      if (!isSensitive) {
        console.log('[ContextWatchdog] Skipping non-sensitive variable:', varName)
        return null
      }

      // 值质量校验（空值、短值、弱密码、纯数字）
      const { skip, reason } = shouldSkipValue(value)
      if (skip) {
        console.log('[ContextWatchdog] Skipping value:', value, `(${reason})`)
        return null
      }

      // 计算值在原始文本中的位置
      const fullMatch = match[0]
      const equalsIndex = fullMatch.indexOf('=')
      const valueStartInMatch = fullMatch.indexOf(value, equalsIndex)

      console.log('[ContextWatchdog] Found ENV_PASSWORD:', varName, '=', value.substring(0, 20) + (value.length > 20 ? '...' : ''))

      return {
        original: value,
        startIndex: match.index! + valueStartInMatch,
        endIndex: match.index! + valueStartInMatch + value.length
      }
    }
  },
  // 命令行密码参数（如 redis-server --requirepass RedisP@ss2024）
  {
    type: 'ENV_PASSWORD',
    pattern: /(?:--(?:require)?pass(?:word)?|-(?:p|password))\s+([^\s]{3,})/gi,
    confidence: 'high',
    extractor: (match) => {
      const password = match[1]
      const fullMatch = match[0]
      const passwordIndex = fullMatch.indexOf(password)

      // 值质量校验
      const { skip, reason } = shouldSkipValue(password)
      if (skip) {
        console.log('[ContextWatchdog] Skipping CLI password:', password, `(${reason})`)
        return null
      }

      // 排除看起来像路径、URL或标志的值
      if (/^https?:\/\//.test(password) || password.startsWith('/') || password.startsWith('-')) {
        return null
      }

      console.log('[ContextWatchdog] Found CLI password:', password.substring(0, 20) + (password.length > 20 ? '...' : ''))

      return {
        original: password,
        startIndex: match.index! + passwordIndex,
        endIndex: match.index! + passwordIndex + password.length
      }
    }
  }
]
