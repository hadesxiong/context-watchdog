// DB_PASSWORD 规则：密码须位于 ':' 之后（无密码的 mysql://user@ 不得把用户名误捕为密码）；密码内可含 '@'——回溯锚定最后一个 '@' 为分隔符并校验其后为 host 形态；偏移按 '://' + user 长度精确计算；值一律过 shouldSkipValue。

import type { DetectionRule } from '../../types'
import { DB_SCHEMES } from './constants'
import { shouldSkipValue } from './valueFilters'

const HOST_LOOKAHEAD = '(?=[a-zA-Z0-9.-])'

export const dbPasswordRules: DetectionRule[] = [
  {
    type: 'DB_PASSWORD',
    pattern: new RegExp(
      `(${DB_SCHEMES.join('|')}):\\/\\/([\\w.-]*):((?:[^@\\s]*@)*[^@\\s]+)@${HOST_LOOKAHEAD}`,
      'g'
    ),
    confidence: 'high',
    extractor: (match) => {
      const user = match[2] || ''
      const password = match[3]
      if (!password) return null

      const { skip } = shouldSkipValue(password)
      if (skip) return null

      const schemeSepIndex = match[0].indexOf('://')
      const passwordIndex = schemeSepIndex + 3 + user.length + 1

      console.log('[ContextWatchdog] Found DB_PASSWORD in connection string:', password.substring(0, 20) + (password.length > 20 ? '...' : ''))

      return {
        original: password,
        startIndex: match.index! + passwordIndex,
        endIndex: match.index! + passwordIndex + password.length
      }
    }
  },
  {
    type: 'DB_PASSWORD',
    pattern: /(?<![a-zA-Z0-9])([^:/\s@]{2,30}):([^@\s:]{1,50}(?:@[^@\s:]+)*)@(?=[a-zA-Z0-9])/g,
    confidence: 'medium',
    extractor: (match, fullText) => {
      const user = match[1]
      const password = match[2]

      if (password.length > 100) return null
      if (/^\d+$/.test(user)) return null

      // match[0] 结束于 '@'，@ 之后的 host 必须从完整文本取
      const afterAt = fullText.substring(match.index! + match[0].length)
      if (!/^[a-zA-Z0-9.-]+/.test(afterAt)) return null

      // 邮件片段防护：冒号 + 纯小写「密码」+ 域名 host 大概率是被截断的邮箱，交给 EMAIL 规则避免误报
      if (/^[a-z]+$/.test(password) && /^[a-z0-9.-]+\.[a-z]{2,}/i.test(afterAt)) return null

      const { skip } = shouldSkipValue(password)
      if (skip) return null

      const passwordIndex = user.length + 1

      console.log('[ContextWatchdog] Found DB_PASSWORD (standalone):', password.substring(0, 20) + (password.length > 20 ? '...' : ''))

      return {
        original: password,
        startIndex: match.index! + passwordIndex,
        endIndex: match.index! + passwordIndex + password.length
      }
    }
  }
]
