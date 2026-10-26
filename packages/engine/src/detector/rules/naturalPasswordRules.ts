// 自然语言口令规则：散文/工单里的「新密码是 …」形态；精度防线三层（连接词必需 / 值域限定 ASCII 可打印 / 值含数字或非字母），再叠 shouldSkipValue；纯字母串不检出（误报 > 漏报）。

import type { DetectionRule } from '../../types'
import { shouldSkipValue } from './valueFilters'

export const naturalPasswordRules: DetectionRule[] = [
  {
    type: 'ENV_PASSWORD',
    pattern: /(?:密码|口令|通行码|\b(?:password|passwd|pwd|passphrase)\b)[\t ]*(?:(?:是|为|is)[\t ]*[:：=＝]?|[:：=＝])[\t ]*([!-~]{4,})/gi,
    confidence: 'high',
    extractor: (match) => {
      let startIndex = match.index! + match[0].length - match[1].length
      let value = match[1].replace(/[.,;]+$/, '')
      // 成对引号内缩（与 CLI / KEY=value 规则只认引号内层一致）：不内缩则 span 含引号且比 CLI 分支早 1 位，重叠仲裁会赢下 CLI
      if (value.length >= 3 && (value[0] === '"' || value[0] === "'") && value.endsWith(value[0])) {
        value = value.slice(1, -1)
        startIndex += 1
      }
      const endIndex = startIndex + value.length

      const { skip, reason } = shouldSkipValue(value)
      if (skip) {
        console.log('[ContextWatchdog] Skipping natural-language password:', value, `(${reason})`)
        return null
      }
      if (/^[A-Za-z]+$/.test(value)) {
        console.log('[ContextWatchdog] Skipping pure-letter natural-language value:', value)
        return null
      }
      return { original: value, startIndex, endIndex }
    }
  }
]
