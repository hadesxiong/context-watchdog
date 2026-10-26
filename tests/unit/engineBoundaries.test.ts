// 引擎边界护栏（结构约束，改坏会直接红）：packages/engine 要同时服务浏览器扩展与后续的 Node
// 代理服务 —— 引擎里一旦出现 chrome.* 或 onnxruntime 的静态引用，Node 侧就再也起不来；因此
// 引擎内 import 只能是自身相对路径，宿主能力由宿主经 backend.ts 注入。禁用清单见 docs/spec.md §15。

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const ENGINE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../packages/engine')

/** 静态引用即违规的包名。chrome 与 node:* 连类型都不许引——它们是宿主能力 */
const FORBIDDEN_BARE_SPECIFIERS = [
  'chrome',
  'vue',
  'pinia',
  'reka-ui',
  'gliner',
  'onnxruntime-web',
  'onnxruntime-common',
  'onnxruntime-node',
  '@xenova/transformers',
  '@huggingface/jinja'
]

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return entry.name.endsWith('.ts') ? [full] : []
  })

/** 抽出文件里所有 import/export 的模块标识符（含动态 import 与 export-from） */
const collectSpecifiers = (source: string): string[] => {
  // 先剥掉注释，否则注释里的 import 示例会被误判
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const specifiers: string[] = []
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?[\w$*{},\s]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s+['"]([^'"]+)['"]/g
  ]
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) specifiers.push(match[1])
  }
  return specifiers
}

const engineFiles = walk(ENGINE_ROOT)

describe('引擎边界 - 不得静态引用宿主 API 或模型运行时', () => {
  it('packages/engine/src 下有可扫描的源文件（护栏自身未失效）', () => {
    expect(engineFiles.length).toBeGreaterThan(5)
  })

  it.each(engineFiles.map((file) => [relative(ENGINE_ROOT, file), file] as const))(
    '%s 不得静态 import 宿主或运行时包',
    (_label, file) => {
      const specifiers = collectSpecifiers(readFileSync(file, 'utf8'))
      const bare = specifiers.filter((s) => !s.startsWith('.') && !s.startsWith('/'))
      const offenders = bare.filter((s) =>
        FORBIDDEN_BARE_SPECIFIERS.some((bad) => s === bad || s.startsWith(`${bad}/`))
      )
      expect(offenders, `禁止静态引用：${offenders.join(', ')} —— 宿主能力请走 backend.ts 注入`).toEqual([])
    }
  )

  it.each(engineFiles.map((file) => [relative(ENGINE_ROOT, file), file] as const))(
    '%s 不得 import node:* 内置模块',
    (_label, file) => {
      const specifiers = collectSpecifiers(readFileSync(file, 'utf8'))
      expect(specifiers.filter((s) => s.startsWith('node:')), '引擎须能在浏览器内运行').toEqual([])
    }
  )

  it('相对 import 不得逃出引擎包（否则形成对扩展层的反向依赖）', () => {
    const escapes: string[] = []
    for (const file of engineFiles) {
      for (const specifier of collectSpecifiers(readFileSync(file, 'utf8'))) {
        if (!specifier.startsWith('.')) continue
        const target = resolve(dirname(file), specifier)
        const candidates = [target, `${target}.ts`, join(target, 'index.ts')]
        const hit = candidates.find((c) => existsSync(c))
        if (!hit) {
          escapes.push(`${relative(ENGINE_ROOT, file)} → ${specifier}（无法解析）`)
          continue
        }
        if (isAbsolute(relative(ENGINE_ROOT, hit)) || relative(ENGINE_ROOT, hit).startsWith('..')) {
          escapes.push(`${relative(ENGINE_ROOT, file)} → ${specifier}`)
        }
      }
    }
    expect(escapes, `相对引用跑出 packages/engine：\n${escapes.join('\n')}`).toEqual([])
  })
})

describe('引擎边界 - 硬约束文档与实现一致', () => {
  it('docs/spec.md §15 记录的禁用清单与测试一致', () => {
    const spec = readFileSync(resolve(ENGINE_ROOT, '../../docs/spec.md'), 'utf8')
    for (const name of ['gliner', '@xenova/transformers', 'onnxruntime-web', 'vue', 'pinia']) {
      expect(spec, `spec §15 未记录对 ${name} 的禁用`).toContain(name)
    }
  })
})
