// 生成 THIRD-PARTY-NOTICES.txt（分发产物必须随附的第三方许可与署名）
//
//   node scripts/third-party-notices.mjs           → 写入仓库根 THIRD-PARTY-NOTICES.txt
//
// 由 postbuild.mjs 在构建后自动调用，并复制进 dist/ 与 dist-firefox/。
// 组件名、版本、许可标识一律从 node_modules 中**实际安装的** package.json 读取，
// 避免手写清单与 node_modules 漂移；版权行无法从机器可读字段获得，手工维护在 COPYRIGHTS 中。
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

// 会被打进产物的组件（含直接依赖与其在产物中出现的运行时依赖）。
// 若新增运行时依赖，请在此登记；否则分发时会漏掉许可声明。
const COMPONENTS = [
  'vue',
  'pinia',
  'reka-ui',
  'gliner',
  '@xenova/transformers',
  'onnxruntime-web',
  'onnxruntime-common',
  '@huggingface/jinja'
]

// package.json 里拿不到的版权行。来源：各包 LICENSE 文件首行的版权声明。
const COPYRIGHTS = {
  vue: 'Copyright (c) 2018-present, Yuxi (Evan) You',
  pinia: 'Copyright (c) 2019-present Eduardo San Martin Morote',
  'reka-ui': 'Copyright (c) 2023 UnoVue <https://github.com/unovue>',
  '@huggingface/jinja': 'Copyright (c) 2023 Hugging Face',
  gliner: 'Copyright (c) Urchade',
  '@xenova/transformers': 'Copyright (c) 2023 Xenova',
  'onnxruntime-web': 'Copyright (c) Microsoft Corporation',
  'onnxruntime-common': 'Copyright (c) Microsoft Corporation'
}

const HOMEPAGES = {
  vue: 'https://vuejs.org',
  pinia: 'https://pinia.vuejs.org',
  'reka-ui': 'https://reka-ui.com',
  gliner: 'https://github.com/urchade/gliner',
  '@xenova/transformers': 'https://github.com/huggingface/transformers.js',
  'onnxruntime-web': 'https://onnxruntime.ai',
  'onnxruntime-common': 'https://onnxruntime.ai',
  '@huggingface/jinja': 'https://huggingface.co/docs/huggingface_hub',
  'onnx-community/gliner_small-v2': 'https://huggingface.co/onnx-community/gliner_small-v2'
}

// 已知的许可标识差异：说明"以什么为准"，比简单罗列更可核查。
const LICENSE_NOTES = {
  gliner:
    '包内 LICENSE 文件为 Apache-2.0 全文，而 package.json 的 license 字段声明为 MIT。' +
    '以 LICENSE 文件为准，按 Apache-2.0 处理。',
  'onnxruntime-web':
    '包内未附 LICENSE 文件；package.json 声明 MIT，上游 Microsoft/onnxruntime 为 MIT。' +
    '按 MIT 处理。',
  'onnxruntime-common':
    '包内未附 LICENSE 文件；package.json 声明 MIT，上游 Microsoft/onnxruntime 为 MIT。' +
    '按 MIT 处理。'
}

const MIT_TEXT = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.`

// 同名包可能在依赖树中存在多个版本（如 onnxruntime-common 的 1.14.0 与 1.19.2 各有一份），
// 因此扫描全部安装位置，而不是只读根 node_modules —— 否则清单会漏掉实际打进产物的那个版本。
const installedVersions = (name) => {
  const seen = new Set()
  const probe = (base) => {
    const path = resolve(base, 'node_modules', name, 'package.json')
    if (existsSync(path)) {
      const pkg = JSON.parse(readFileSync(path, 'utf8'))
      if (pkg.version) seen.add(pkg.version)
    }
  }
  probe(root)
  for (const a of readdirSync(resolve(root, 'node_modules'))) {
    if (a.startsWith('.')) continue
    probe(resolve(root, 'node_modules', a))
    let nested
    try {
      nested = readdirSync(resolve(root, 'node_modules', a))
    } catch {
      continue
    }
    for (const b of nested) {
      if (b === 'node_modules') continue
      probe(resolve(root, 'node_modules', a, b))
    }
  }
  return [...seen].sort()
}

const readInstalled = (name) => {
  const versions = installedVersions(name)
  if (!versions.length) return null
  const license = existsSync(resolve(root, 'node_modules', name, 'package.json'))
    ? (JSON.parse(readFileSync(resolve(root, 'node_modules', name, 'package.json'), 'utf8')).license ?? 'NOASSERTION')
    : 'NOASSERTION'
  return { version: versions.join(' / '), license }
}

export const renderThirdPartyNotices = () => {
  const today = new Date().toISOString().slice(0, 10)
  const rows = []
  for (const name of COMPONENTS) {
    const installed = readInstalled(name)
    if (!installed) {
      rows.push({ name, version: '（未安装）', license: 'NOASSERTION' })
      continue
    }
    rows.push({
      name,
      version: installed.version,
      license: installed.license,
      copyright: COPYRIGHTS[name],
      homepage: HOMEPAGES[name],
      note: LICENSE_NOTES[name]
    })
  }

  const mitRows = rows.filter((r) => r.license === 'MIT')
  const apacheRows = rows.filter((r) => r.license.startsWith('Apache'))
  const otherRows = rows.filter((r) => r.license !== 'MIT' && !r.license.startsWith('Apache'))

  const line = (s = '') => s.padEnd(78, '-')

  const block = (r) =>
    [
      `  ${r.name}`,
      `    版本:       ${r.version}`,
      `    许可:       ${r.license}`,
      r.copyright ? `    版权:       ${r.copyright}` : null,
      r.homepage ? `    主页:       ${r.homepage}` : null,
      r.note ? `    说明:       ${r.note}` : null,
      ''
    ]
      .filter(Boolean)
      .join('\n')

  return [
    'PasteGuard — 第三方组件许可与署名声明',
    '='.repeat(78),
    '',
    `本文件由 scripts/third-party-notices.mjs 在构建时生成（${today}），请勿手工编辑。`,
    '组件名、版本与许可标识取自构建时 node_modules 中实际安装的 package.json。',
    '',
    '本产品以 Apache License, Version 2.0 发布，完整许可文本见随附的 LICENSE 文件。',
    '',
    line(),
    '一、随本产品一同分发的组件',
    line(),
    '',
    ...rows.map(block),
    line(),
    '二、MIT 许可全文（适用于上述所有许可标识为 MIT 的组件）',
    line(),
    '',
    'MIT License',
    '',
    ...mitRows.map((r) => `  ${r.copyright ?? r.name}`),
    '',
    MIT_TEXT,
    '',
    line(),
    '三、Apache License 2.0 组件',
    line(),
    '',
    '下列组件以 Apache License, Version 2.0 发布。该许可的完整文本与本产品所用的',
    '许可文本相同，见随附的 LICENSE 文件。按该许可第 4 条，此处保留上述组件的版权',
    '与署名信息（见"一、随本产品一同分发的组件"中的版权行）。',
    '',
    ...apacheRows.map(block),
    otherRows.length
      ? [
          line(),
          '四、其他许可',
          line(),
          '',
          ...otherRows.map(block)
        ].join('\n')
      : null,
    '',
    line(),
    '五、运行时下载的模型（不随本产品分发）',
    line(),
    '',
    '本产品在用户主动开启 AI 检测后，从白名单模型源下载下列模型文件。',
    '模型文件**不包含在扩展包内**，因此不属于"随本产品一同分发"的组件，',
    '但出于透明度考虑一并列出：',
    '',
    ...[
      {
        name: 'onnx-community/gliner_small-v2',
        version: '(运行时下载，不固定于本文件)',
        license: 'Apache-2.0',
        copyright: 'Copyright (c) Urchade（基础模型 urchade/gliner_small-v2）',
        homepage: HOMEPAGES['onnx-community/gliner_small-v2'],
        note:
          '基础模型 urchade/gliner_small-v2 在 v0/v1 为 CC-BY-NC-4.0（禁止商用），' +
          '自 v2 起改为 Apache-2.0。本产品锁定 v2，属合规性决策。'
      }
    ]
      .map(block)
      .join('\n'),
    '',
    '模型下载源：ModelScope（主源）/ Hugging Face（回退）。模型仅在本地推理，',
    '不上传任何用户数据。',
    '',
    line()
  ]
    .filter(Boolean)
    .join('\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = resolve(root, 'THIRD-PARTY-NOTICES.txt')
  writeFileSync(out, renderThirdPartyNotices())
  console.log('[notices] 已生成 →', out)
}
