// ENV_PASSWORD 规则：值质量校验（空值/短值/弱密码/纯数字），命令行密码参数（分隔形/直连引号形/直连裸值形），精度锚确保首字符字母数字、体不含 =、必含符号位。

import type { DetectionRule } from '../../types'
import { SENSITIVE_KEYWORDS, NON_SENSITIVE_KEYWORDS, FUNCTION_PATTERNS } from './constants'
import { shouldSkipValue } from './valueFilters'

export const envPasswordRules: DetectionRule[] = [
  // 环境变量赋值：= 两侧用 [\t ]* 而非 \s*：防止跨行吞掉下一行赋值；值支持引号包裹或非空白串
  {
    type: 'ENV_PASSWORD',
    pattern: /^([A-Z0-9_]+)[\t ]*=[\t ]*("([^"\n]*)"|'([^'\n]*)'|[^\s]+)/gm,
    confidence: 'high',
    extractor: (match) => {
      const varName = match[1]
      const quotedInner = match[3] ?? match[4]
      const value = (quotedInner !== undefined ? quotedInner : match[2]).trim()

      if (NON_SENSITIVE_KEYWORDS.some(kw => varName.includes(kw))) {
        console.log('[ContextWatchdog] Skipping whitelisted variable:', varName)
        return null
      }

      if (FUNCTION_PATTERNS.some(pattern => pattern.test(varName))) {
        console.log('[ContextWatchdog] Skipping function call:', varName)
        return null
      }

      if (varName.includes('.')) {
        console.log('[ContextWatchdog] Skipping object property:', varName)
        return null
      }

      const isSensitive = SENSITIVE_KEYWORDS.some(kw => varName.includes(kw))
      if (!isSensitive) {
        console.log('[ContextWatchdog] Skipping non-sensitive variable:', varName)
        return null
      }

      const { skip, reason } = shouldSkipValue(value)
      if (skip) {
        console.log('[ContextWatchdog] Skipping value:', value, `(${reason})`)
        return null
      }

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
  // 命令行密码参数：分隔形 `-p <pwd>` / `--password <pwd>` / `--password=<pwd>`（可引号包裹）；直连引号形 `-p'<pwd>'` / `-p"<pwd>"`；直连裸值形 `-p<pwd>`
  {
    type: 'ENV_PASSWORD',
    pattern: /((?:--(?:require)?pass(?:word)?|-(?:p|password)))(?:([\t ]*=[\t ]*|[\t ]+)(?:(['"])([^'"\n]{3,})\3|([^\s'"]{3,}))|(?:(['"])([^'"\n]{3,})\6)|([A-Za-z0-9](?=[^\s'"=]*[^A-Za-z0-9_=\s'"])[^\s'"=]{3,}))/gi,
    confidence: 'high',
    extractor: (match) => {
      const password = match[4] ?? match[7] ?? match[5] ?? match[8]
      if (!password) return null

      const valueStartInMatch =
        match[1].length +
        (match[2] ?? '').length +
        (match[3] ?? '').length +
        (match[6] ?? '').length

      const { skip, reason } = shouldSkipValue(password)
      if (skip) {
        console.log('[ContextWatchdog] Skipping CLI password:', password, `(${reason})`)
        return null
      }

      if (/^https?:\/\//.test(password) || password.startsWith('/') || password.startsWith('-')) {
        return null
      }

      console.log('[ContextWatchdog] Found CLI password:', password.substring(0, 20) + (password.length > 20 ? '...' : ''))

      return {
        original: password,
        startIndex: match.index! + valueStartInMatch,
        endIndex: match.index! + valueStartInMatch + password.length
      }
    }
  }
]
