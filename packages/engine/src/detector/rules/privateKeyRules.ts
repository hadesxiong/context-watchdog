// PRIVATE_KEY 规则 - 私钥检测

import type { DetectionRule } from '../../types'

export const privateKeyRules: DetectionRule[] = [
  {
    type: 'PRIVATE_KEY',
    pattern: /-----BEGIN (RSA|EC|OPENSSH|PGP|DSA) PRIVATE KEY-----[\s\S]*?-----END (?:RSA|EC|OPENSSH|PGP|DSA) PRIVATE KEY-----/g,
    confidence: 'high'
  }
]
