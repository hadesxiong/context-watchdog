import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// 独立于 vite.config.ts（避免 crx 插件干扰测试）
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'packages/extension/src'),
      '@engine': resolve(import.meta.dirname, 'packages/engine/src')
    }
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10000
  }
})
