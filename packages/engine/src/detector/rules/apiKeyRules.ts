// API_KEY 规则 - API 密钥检测

import type { DetectionRule } from '../../types'

export const apiKeyRules: DetectionRule[] = [
  // OpenAI API Key (支持 sk- 和 sk-proj- 格式)
  {
    type: 'API_KEY',
    pattern: /sk-(?:proj-)?[A-Za-z0-9]{20,}/g,
    confidence: 'high'
  },
  // JWT Secret / 通用 Secret Key（如 jwt-secret-key-xxx, secret-key-xxx 等）
  {
    type: 'API_KEY',
    pattern: /\b(?:jwt[_-]?secret|secret[_-]?key)[_-]?[A-Za-z0-9\-_]{16,}/gi,
    confidence: 'high'
  },
  // GitHub Token
  {
    type: 'API_KEY',
    pattern: /gh[pousr]_[A-Za-z0-9]{36,}/g,
    confidence: 'high'
  },
  // AWS Access Key ID
  {
    type: 'API_KEY',
    pattern: /AKIA[0-9A-Z]{16}/g,
    confidence: 'high'
  },
  // AWS Secret Key（40位字符串）
  {
    type: 'API_KEY',
    pattern: /(?<![A-Z0-9])[A-Za-z0-9/+=]{40}(?![A-Z0-9])/g,
    confidence: 'medium'
  },
  // Google API Key
  {
    type: 'API_KEY',
    pattern: /AIza[0-9A-Za-z\-_]{35}/g,
    confidence: 'high'
  },
  // Slack Token
  {
    type: 'API_KEY',
    pattern: /xox[baprs]-[0-9A-Za-z\-]+/g,
    confidence: 'high'
  },
  // Stripe API Key
  {
    type: 'API_KEY',
    pattern: /[sr]k_(live|test)_[A-Za-z0-9]{20,}/g,
    confidence: 'high'
  },
  // ---- 短密钥族（2026-10-18）：「前缀即证据」策略 ----
  // 阈值策略（曾因误报风险暂缓，此为拍板后的落地方案）：
  // - 无前缀短串（8–32 位随机）FP 不可控（会话号/设备号/订单号大量撞形）→ 维持不检测，
  //   高熵规则阈值不动；
  // - 有独特厂商前缀的官方短格式 = 前缀即证据 → 按各家规格精确长度/字符集收录；
  // - 「短但有上下文」的场景由 env/kv 键值规则兜底（KEY=xxx 行锚定 + 敏感变量名 + 值质量过滤）。
  // Anthropic Claude（sk-ant-…，注意与上方 OpenAI 规则互不重叠：sk- 后紧跟 -ant- 使其无法命中）
  {
    type: 'API_KEY',
    pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g,
    confidence: 'high'
  },
  // sk- 品牌前缀 + 小写厂商段 + 长十六进制体（如 sk-live-<32hex>）
  // 既有 OpenAI 规则只收 sk-[alnum]，中间带 -live- 这类厂商段会整段失配，
  // 只落到 HIGH_ENTROPY（universal 默认 keep ⇒ 真机漏替换，2026-10-21 实测）。
  // 精度锚在「体是纯小写十六进制且 ≥32」：随机本征足够强，也守住 FP 防线
  // （sk-an- + 混合大小写字面量因体非纯 hex 不命中，见 apiKeyRules.test.ts）。
  // 置 high：sk- 前缀即证据，且 universal tierLowConfidence 下非 high 会被默认 keep。
  {
    type: 'API_KEY',
    pattern: /\bsk-[a-z]{2,12}-[0-9a-f]{32,}\b/g,
    confidence: 'high'
  },
  // Hugging Face
  {
    type: 'API_KEY',
    pattern: /hf_[A-Za-z0-9]{30,}/g,
    confidence: 'high'
  },
  // npm access token
  {
    type: 'API_KEY',
    pattern: /npm_[A-Za-z0-9]{36}/g,
    confidence: 'high'
  },
  // GitLab personal access token
  {
    type: 'API_KEY',
    pattern: /glpat-[A-Za-z0-9_-]{20}/g,
    confidence: 'high'
  },
  // SendGrid（SG.<body>.<secret>）
  {
    type: 'API_KEY',
    pattern: /SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g,
    confidence: 'high'
  },
  // Postman
  {
    type: 'API_KEY',
    pattern: /PMAK-[A-Za-z0-9]{24}-[A-Za-z0-9]{24}/g,
    confidence: 'high'
  },
  // Shopify access token（shpat_/shpca_/shppa_/shpss_ + 32 hex）
  {
    type: 'API_KEY',
    pattern: /shp(?:at|ca|pa|ss)_[0-9a-f]{32}/g,
    confidence: 'high'
  },
  // DigitalOcean OAuth token
  {
    type: 'API_KEY',
    pattern: /dop_v1_[0-9a-f]{64}/g,
    confidence: 'high'
  },
  // Mailgun API key（key- + 32 hex；无独立品牌前缀故置 medium）
  {
    type: 'API_KEY',
    pattern: /\bkey-[0-9a-f]{32}\b/g,
    confidence: 'medium'
  },
  // Twilio API Key SID（SK + 32 hex，无分隔符故置 medium）
  {
    type: 'API_KEY',
    pattern: /\bSK[0-9a-fA-F]{32}\b/g,
    confidence: 'medium'
  },
  // JWT Token
  {
    type: 'JWT',
    pattern: /eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g,
    confidence: 'high'
  }
]
