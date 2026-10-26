// 模型检出形状门禁：GLiNER 零样本实体必须「形似」其标签，否则视为幻觉丢弃。
// 单字乱指（如「户」→ person name 0.456）会经 uncertain「复检不中低置信保留」路径
// 变成用户可见的错替换；与 env 规则的值质量校验同一思路：宁可漏检，不可错替换。
// 用例见 docs/test-cases.md TC-06-5；形似词幻觉仍可能过门禁属模型能力限制，见 spec §13-4。

// 中文句读：ASCII 冒号/逗号对 connection string（redis://user:pass@host）等是合法字符，故不进公共集合，各标签按需自管
const CJK_SENTENCE_PUNCT = /[，。；：！？、]/

// 密钥族标签（含 profiles.ts 的空格式与 contentDetector 默认的下划线式，归一化后匹配）
const SECRET_FAMILY = new Set([
  'password',
  'secret',
  'api key',
  'access token',
  'private key',
  'connection string',
  'database credentials',
  'jwt token',
  'credential',
  'token'
])

const countDigits = (text: string): number => (text.match(/\d/g) ?? []).length

// 判定单个模型检出是否形似其标签（label 大小写/下划线不敏感）
export function isPlausibleEntity(spanText: string, label: string): boolean {
  const text = spanText.trim()
  const key = label.toLowerCase().replace(/_/g, ' ').trim()

  switch (key) {
    case 'person name':
      // 2–15 字、仅字母/组合符号/空格：拦住单字幻觉（户），也拦数字与标点混入
      return text.length >= 2 && text.length <= 15 && /^[\p{L}\p{M} ]+$/u.test(text)
    case 'email address':
      // 经典形状：非空白非@ + @ + 非空白非@ + . + 非空白非@（拦下无@的「订」）
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)
    case 'phone number':
      return countDigits(text) >= 7
    case 'home address':
      // ≥3 字且不含句读：拦「前台」（2 字）与跨句边界的碎片
      return text.length >= 3 && !CJK_SENTENCE_PUNCT.test(text)
    case 'id card number':
      return countDigits(text) >= 15
    case 'bank card number':
      return countDigits(text) >= 13
    default:
      if (SECRET_FAMILY.has(key)) {
        // ≥8 字符、无空白、无中文句读（ASCII 特殊字符对密钥合法）
        return text.length >= 8 && !/\s/.test(text) && !CJK_SENTENCE_PUNCT.test(text)
      }
      // 未知标签默认：≥2 字且不含中文句读——宽松，但单字幻觉一律拦下
      return text.length >= 2 && !CJK_SENTENCE_PUNCT.test(text)
  }
}
