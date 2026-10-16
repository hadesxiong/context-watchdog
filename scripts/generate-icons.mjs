// 从 public/icons/logo.svg 生成扩展图标 PNG（16/32/48/128）
// 用法：npm run icons
// 注意：SVG 源用 CSS 变量（组件内联用），生成 PNG 时替换为固定色值
import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const svgPath = resolve(root, 'public/icons/logo.svg')
const outDir = resolve(root, 'public/icons')

// PNG 无法解析 CSS 变量：按 shadcn zinc 主题固定为深盾浅点
const svg = readFileSync(svgPath, 'utf-8')
  .replaceAll('var(--foreground)', '#18181B')
  .replaceAll('var(--background)', '#FAFAFA')

mkdirSync(outDir, { recursive: true })

for (const size of [16, 32, 48, 128]) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } })
  const png = resvg.render().asPng()
  const outPath = resolve(outDir, `icon-${size}.png`)
  writeFileSync(outPath, png)
  console.log(`✓ ${outPath} (${size}x${size}, ${png.length} bytes)`)
}
