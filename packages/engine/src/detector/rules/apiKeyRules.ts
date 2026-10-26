// API_KEY 规则：短密钥族「前缀即证据」（无前缀 8–32 位随机不检测，高熵阈值不动；有厂商前缀的按规格收录，「短但有上下文」由 env/kv 兜底）。

import type { DetectionRule } from '../../types'

export const apiKeyRules: DetectionRule[] = [
  // OpenAI API Key (支持 sk- 和 sk-proj- 格式)
  { type: 'API_KEY', pattern: /sk-(?:proj-)?[A-Za-z0-9]{20,}/g, confidence: 'high' },
  // JWT Secret / 通用 Secret Key
  { type: 'API_KEY', pattern: /\b(?:jwt[_-]?secret|secret[_-]?key)[_-]?[A-Za-z0-9\-_]{16,}/gi, confidence: 'high' },
  // GitHub Token
  { type: 'API_KEY', pattern: /gh[pousr]_[A-Za-z0-9]{36,}/g, confidence: 'high' },
  // AWS Access Key ID
  { type: 'API_KEY', pattern: /AKIA[0-9A-Z]{16}/g, confidence: 'high' },
  // AWS Secret Key（40 位字符串）
  { type: 'API_KEY', pattern: /(?<![A-Z0-9])[A-Za-z0-9/+=]{40}(?![A-Z0-9])/g, confidence: 'medium' },
  // Google API Key
  { type: 'API_KEY', pattern: /AIza[0-9A-Za-z\-_]{35}/g, confidence: 'high' },
  // Slack Token
  { type: 'API_KEY', pattern: /xox[baprs]-[0-9A-Za-z\-]+/g, confidence: 'high' },
  // Stripe API Key
  { type: 'API_KEY', pattern: /[sr]k_(live|test)_[A-Za-z0-9]{20,}/g, confidence: 'high' },
  // Anthropic Claude（sk-ant-…，注意与 OpenAI 规则互不重叠：sk- 后紧跟 -ant- 使其无法命中）
  { type: 'API_KEY', pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g, confidence: 'high' },
  // sk- 品牌前缀 + 小写厂商段 + 纯小写十六进制体（≥32）：既有 OpenAI 规则只收 sk-[alnum]，带 -live- 的厂商段会整段失配、只落到 HIGH_ENTROPY（universal 默认 keep，真机漏替换）→ 置 high
  { type: 'API_KEY', pattern: /\bsk-[a-z]{2,12}-[0-9a-f]{32,}\b/g, confidence: 'high' },
  // Hugging Face
  { type: 'API_KEY', pattern: /hf_[A-Za-z0-9]{30,}/g, confidence: 'high' },
  // npm access token
  { type: 'API_KEY', pattern: /npm_[A-Za-z0-9]{36}/g, confidence: 'high' },
  // GitLab personal access token
  { type: 'API_KEY', pattern: /glpat-[A-Za-z0-9_-]{20}/g, confidence: 'high' },
  // SendGrid（SG.<body>.<secret>）
  { type: 'API_KEY', pattern: /SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, confidence: 'high' },
  // Postman
  { type: 'API_KEY', pattern: /PMAK-[A-Za-z0-9]{24}-[A-Za-z0-9]{24}/g, confidence: 'high' },
  // Shopify access token（shpat_/shpca_/shppa_/shpss_ + 32 hex）
  { type: 'API_KEY', pattern: /shp(?:at|ca|pa|ss)_[0-9a-f]{32}/g, confidence: 'high' },
  // DigitalOcean OAuth token
  { type: 'API_KEY', pattern: /dop_v1_[0-9a-f]{64}/g, confidence: 'high' },
  // Mailgun API key（key- + 32 hex；无独立品牌前缀故置 medium）
  { type: 'API_KEY', pattern: /\bkey-[0-9a-f]{32}\b/g, confidence: 'medium' },
  // Twilio API Key SID（SK + 32 hex，无分隔符故置 medium）
  { type: 'API_KEY', pattern: /\bSK[0-9a-fA-F]{32}\b/g, confidence: 'medium' },
  // JWT Token
  { type: 'JWT', pattern: /eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g, confidence: 'high' }
]
