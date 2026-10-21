// 自然语言口令规则 - 散文/工单里的「新密码是 Qy7#mP2!vL9@」形态
// 既有口令规则全部锚定结构化语法（KEY=value / YAML / JSON / CLI 参数 / 连接串），
// 中文客服对话中的口令声明一条都不命中（2026-10-21 真机漏检：新密码是 Qy7#mP2!vL9@）。
//
// 精度防线三层（缺任一层都会被「密码不能为空」「password is required」这类句子打穿）：
// 1. 连接词必需（是/为/is/:/：/= 之一）：孤立「密码xxx」不会起匹配；
// 2. 值域限定 ASCII 可打印 [!-~]（且禁止跨行，[\t ]* 而非 \s*）：
//    中文谓词（「不能为空」「是相同的」）落不进值域，自然不匹配；
// 3. 值必须含数字或非字母字符：挡掉 `password is required/invalid` 这类纯字母表语，
//    再叠加 shouldSkipValue（过短/纯数字/弱口令）兜底。
// 取舍：纯字母无数字口令（如 strawberry）在自然语言档不检出——误报代价高于漏报。

import type { DetectionRule } from '../../types'
import { shouldSkipValue } from './valueFilters'

export const naturalPasswordRules: DetectionRule[] = [
  {
    type: 'ENV_PASSWORD',
    pattern: /(?:密码|口令|通行码|\b(?:password|passwd|pwd|passphrase)\b)[\t ]*(?:(?:是|为|is)[\t ]*[:：=＝]?|[:：=＝])[\t ]*([!-~]{4,})/gi,
    confidence: 'high',
    extractor: (match) => {
      // 值是 match 的末段；trim 只砍尾部，故锚定「值起点」再取长度（右锚定会把句读算进 span）
      let startIndex = match.index! + match[0].length - match[1].length
      // 尾部 ASCII 句读多为标点而非口令成分（中文句读已被值域排除，如 @ 末尾不受影响）
      let value = match[1].replace(/[.,;]+$/, '')
      // 成对引号内缩：CLI / KEY=value 等结构化规则都只认引号内层，散文里
      // 新密码是 "Qy7#mP2!vL9@" 同理——不内缩则 span 含引号且比 CLI 分支早 1 位，
      // 重叠仲裁会赢下 CLI 的精确 span，替换时把引号一起换成占位符
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
      // 纯字母串大概率是表语而非口令（required/invalid/相同…），非字母即视为凭据
      if (/^[A-Za-z]+$/.test(value)) {
        console.log('[ContextWatchdog] Skipping pure-letter natural-language value:', value)
        return null
      }
      return { original: value, startIndex, endIndex }
    }
  }
]
