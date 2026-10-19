#!/usr/bin/env node
// 打包发布产物（F5）
//
// 解决的问题：CWS / AMO / Edge 都要求上传**内容位于 zip 根目录**的压缩包
// （manifest.json 不能藏在一个外层文件夹里）。手动 `zip -r` 很容易把目录结构
// 一起压进去，而症状是商店后台报一句很难懂的「找不到 manifest」。
// 这里固定做法，并在打包后回读 zip 条目验证根目录里确实有 manifest.json。
//
// 同时生成 SHA256SUMS：Release 页面附上它，用户下载后可以自己核验。
//
// 用法：node scripts/pack-release.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = `${root}release`

const abs = (p) => `${root}${p}`

const manifest = JSON.parse(readFileSync(abs('packages/extension/src/manifest.json'), 'utf8'))
const version = manifest.version

/** 打包一个目标目录；返回 { file, bytes } */
const pack = (label, sourceDir, suffix) => {
  if (!existsSync(abs(sourceDir))) {
    throw new Error(`[pack] ${label} 产物不存在（${sourceDir}/）——先跑 npm run build${suffix}`)
  }
  // 与 check-versions 的护栏呼应：漏带许可文件的分发包不能出厂
  for (const legal of ['LICENSE', 'NOTICE', 'THIRD-PARTY-NOTICES.txt', 'manifest.json']) {
    if (!existsSync(abs(`${sourceDir}/${legal}`))) {
      throw new Error(`[pack] ${label} 产物缺少 ${legal}——先跑 npm run build${suffix}`)
    }
  }

  const file = `${outDir}/pasteguard-${version}-${label}.zip`
  rmSync(file, { force: true })

  // -r 递归；-X 去掉多余的文件属性（可复现性更好）；在源目录内运行，保证
  // 压出来的是「目录内容」而不是「目录本身」。
  execFileSync('zip', ['-r', '-X', '-q', file, '.'], { cwd: abs(sourceDir) })

  // 回读验证：根目录里必须有 manifest.json，且不能有外层文件夹
  const listing = execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (!listing.includes('manifest.json')) {
    throw new Error(`[pack] ${label} 压缩包的根目录里没有 manifest.json（商店会拒收）`)
  }
  if (!listing.includes('_locales/')) {
    throw new Error(`[pack] ${label} 压缩包里没有 _locales/（商店会因缺少本地化资源报警）`)
  }

  const bytes = readFileSync(file).length
  return { file, bytes, entries: listing.length }
}

mkdirSync(outDir, { recursive: true })

const chrome = pack('chrome', 'dist', '')
const firefox = pack('firefox', 'dist-firefox', ':firefox')

const relative = (p) => p.slice(root.length)
const human = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`

console.log(`[pack] 版本 ${version}`)
for (const [label, result] of [
  ['Chrome', chrome],
  ['Firefox', firefox]
]) {
  console.log(`  ✓ ${label}: ${relative(result.file)}  ${human(result.bytes)}  ${result.entries} 个条目`)
}

// SHA256SUMS：`shasum -a 256` 的输出格式，用户下载后 `shasum -a 256 -c SHA256SUMS` 即可核验
const sums = [chrome, firefox]
  .map((result) => {
    const digest = execFileSync('shasum', ['-a', '256', result.file], { encoding: 'utf8' }).trim()
    // 只保留相对文件名，便于用户在任何目录下核验
    return digest.replace(result.file, relative(result.file).replace(/^release\//, ''))
  })
  .join('\n')

writeFileSync(`${outDir}/SHA256SUMS`, `${sums}\n`, 'utf8')
console.log(`  ✓ ${relative(`${outDir}/SHA256SUMS`)}`)
console.log('\n[pack] 下一步：把两个 zip 与 SHA256SUMS 作为附件挂到 Release，然后按 docs/releasing.md 提交三个渠道。')
