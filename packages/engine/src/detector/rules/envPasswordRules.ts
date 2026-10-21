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
  // 三种形态（2026-10-21 真机漏检 `mysql -p'Qy7#mP2!vL9@'` 后补齐）：
  //   1) 分隔形：`-p <pwd>` / `--password <pwd>` / `--password=<pwd>`（可引号包裹，span 只锚内层值）
  //   2) 直连引号形：mysql 风格 `-p'<pwd>'` / `-p"<pwd>"`
  //   3) 直连裸值形：`-p<pwd>` —— 选项混淆风险最高（-pretty / -P3306 / -port=8080 都长得像），
  //      精度锚在正则里：首字符必须字母数字、体不含 =、且必含一个非字母数字下划线的符号位
  //      （真口令几乎都带符号；纯字母数字的直连值一律按短选项变体放弃，宁缺勿误）
  {
    type: 'ENV_PASSWORD',
    pattern: /((?:--(?:require)?pass(?:word)?|-(?:p|password)))(?:([\t ]*=[\t ]*|[\t ]+)(?:(['"])([^'"\n]{3,})\3|([^\s'"]{3,}))|(?:(['"])([^'"\n]{3,})\6)|([A-Za-z0-9](?=[^\s'"=]*[^A-Za-z0-9_=\s'"])[^\s'"=]{3,}))/gi,
    confidence: 'high',
    extractor: (match) => {
      const password = match[4] ?? match[7] ?? match[5] ?? match[8]
      if (!password) return null

      // 值起点 = 旗标 + 分隔符 + 引号的长度。不用 indexOf(value) 猜位置：
      // 值文本恰好出现在旗标内（如 --password word 的 "word"）时会错位到旗标里
      const valueStartInMatch =
        match[1].length +
        (match[2] ?? '').length +
        (match[3] ?? '').length +
        (match[6] ?? '').length

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
        startIndex: match.index! + valueStartInMatch,
        endIndex: match.index! + valueStartInMatch + password.length
      }
    }
  }
]
