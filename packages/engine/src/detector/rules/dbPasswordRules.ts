// DB_PASSWORD 规则 - 数据库连接串密码检测
// Phase 1 修复：
// 1. scheme 规则强制要求密码前有 ':' 分隔符 —— `mysql://user@host`（无密码）不再把用户名误捕为密码
// 2. 密码内可含 '@'，通过回溯锚定最后一个 '@' 为分隔符，并校验其后为 host 形态
// 3. 弃用 lastIndexOf 定位，改为基于 '://' + user 长度的精确偏移计算
// 4. extractor 补上 shouldSkipValue 值质量过滤

import type { DetectionRule } from '../../types'
import { DB_SCHEMES } from './constants'
import { shouldSkipValue } from './valueFilters'

// host 形态校验：@ 之后应为字母数字/点/连字符开头（域名或 IP）
const HOST_LOOKAHEAD = '(?=[a-zA-Z0-9.-])'

export const dbPasswordRules: DetectionRule[] = [
  // 带 scheme 的连接串：scheme://user:password@host 或 scheme://:password@host
  // 密码可包含 '@'（如 p@ssw0rd、pass@word），最后一个 '@' 视为分隔符
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

      // 值质量过滤（空值、过短、纯数字、弱密码）
      const { skip } = shouldSkipValue(password)
      if (skip) return null

      // 精确定位：scheme 分隔符 '://' + user + ':' 之后即为密码起点
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
  // 独立 user:password@host 格式（无 scheme 前缀）
  // password 段排除 ':'，防止把 "scheme://" 的冒号和路径吞进密码（Phase 1 修复）
  {
    type: 'DB_PASSWORD',
    pattern: /(?<![a-zA-Z0-9])([^:/\s@]{2,30}):([^@\s:]{1,50}(?:@[^@\s:]+)*)@(?=[a-zA-Z0-9])/g,
    confidence: 'medium',
    extractor: (match, fullText) => {
      const user = match[1]
      const password = match[2]

      if (password.length > 100) return null

      // 排除纯数字用户名（如时间 12:3456@...）
      if (/^\d+$/.test(user)) return null

      // host 形态校验：match[0] 结束于 '@'，必须从完整文本取 @ 之后的内容
      // （历史 bug：原实现取 match[0] 内部内容恒为空串，导致本规则从未产出过结果）
      const afterAt = fullText.substring(match.index! + match[0].length)
      if (!/^[a-zA-Z0-9.-]+/.test(afterAt)) return null

      // 邮件片段防护：'Contact:support@company.com' 这类冒号+纯小写密码+域名 host
      // 大概率是邮箱被截断，交给 EMAIL 规则处理，避免误报
      if (/^[a-z]+$/.test(password) && /^[a-z0-9.-]+\.[a-z]{2,}/i.test(afterAt)) return null

      // 值质量过滤
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
