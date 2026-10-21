#!/usr/bin/env node
/**
 * 站点挂件探针（控制面）
 *
 * 为什么存在：挂件是注入到宿主页面的 DOM，vitest（jsdom）测不到「真的挂上了、
 * 真的没碰未授权站点、真的没改变页面布局」这三件事。这里用无头 Chrome 实测：
 *   1) 授权站点顶层文档出现挂件（fixed / 最高 z-index）
 *   2) iframe 内不出现（粘贴监听 allFrames 注入，但挂件只挂顶层）
 *   3) 未授权站点完全不注入
 *   4) 不产生横向滚动条，不往 body 里塞节点
 *   5) 常驻：页面主动删除挂件后自动重挂
 *   6) 收起态 44×44、12px 圆角矩形（面板 display:none，host 盒子就是按钮）
 *   7) mark 跟随页面明暗主题换色（亮色 #18181b / 暗色 #fafafa）
 *   8) 「在侧边栏中打开」点击后确实打开面板（侧栏不可用时退回弹窗）
 *
 * 挂件在 closed Shadow DOM 里，页面 JS 读不到内部，因此 6)~8) 走 CDP 的
 * DOM.getDocument(pierce) 穿透读取节点树（与 DevTools 元素面板同一机制）。
 *
 * 为了免去 optional_host_permissions 的交互授权，脚本运行期间会临时给
 * dist/manifest.json 加上测试站的 host_permissions，结束后**原样恢复**。
 * dist 是构建产物，本就不入库。
 *
 * 用法：
 *   npm run probe:widget
 *   CHROME_PATH=/path/to/chrome npm run probe:widget
 */
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const DIST = join(root, 'dist')
const MANIFEST = join(DIST, 'manifest.json')
const WIDGET_ID = 'context-watchdog-widget'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/* ---------- 0. 前置：dist 存在 ---------- */

if (!existsSync(MANIFEST)) {
  console.log('[probe:widget] 缺少 dist/manifest.json，先执行 npm run build …')
  execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' })
}

/* ---------- 1. 测试站 ---------- */

const pageHtml = `<!doctype html><html><body>
  <textarea id="t" style="width:600px;height:120px"></textarea>
  <iframe src="/frame" style="width:320px;height:120px"></iframe>
</body></html>`
const frameHtml = '<!doctype html><html><body><textarea id="f"></textarea></body></html>'

const station = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(req.url === '/frame' ? frameHtml : pageHtml)
})
await new Promise((resolve, reject) => {
  station.on('error', reject)
  station.listen(0, '127.0.0.1', resolve)
})
const httpPort = station.address().port
const PATTERN = `http://127.0.0.1:${httpPort}/*`

/* ---------- 2. Chrome ---------- */

// 新版正式版 Chrome 会忽略 --load-extension（只允许商店安装），
// 因此优先找 Chrome for Testing / Chromium——它们支持加载未打包扩展。
function playwrightChromium() {
  const cache = join(process.env.HOME ?? '', 'Library/Caches/ms-playwright')
  if (!existsSync(cache)) return []
  return readdirSync(cache)
    .filter(name => name.startsWith('chromium-'))
    .flatMap(name => [
      join(cache, name, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
      join(cache, name, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
      join(cache, name, 'chrome-linux', 'chrome'),
      join(cache, name, 'chrome-win', 'chrome.exe')
    ])
    .filter(existsSync)
}

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    ...playwrightChromium(),
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'
  ].filter(Boolean)
  return candidates.find(candidate => existsSync(candidate)) ?? null
}

const freePort = () => new Promise((resolve, reject) => {
  const server = createTcpServer()
  server.on('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => resolve(port))
  })
})

const chrome = chromePath()
if (!chrome) {
  console.error('[probe:widget] 找不到 Chrome/Chromium，可用 CHROME_PATH 指定')
  process.exit(2)
}

const debugPort = await freePort()
const profile = join(root, 'node_modules', '.cache', `probe-widget-${process.pid}`)
rmSync(profile, { recursive: true, force: true })

// 扩展 ID：未打包扩展由绝对路径的 sha256 推导（前 32 个 hex → a-p）
const extensionId = [...createHash('sha256').update(DIST).digest('hex').slice(0, 32)]
  .map(char => String.fromCharCode(97 + parseInt(char, 16)))
  .join('')

/* ---------- 3. 临时授权 + 启动 ---------- */

const originalManifest = readFileSync(MANIFEST, 'utf8')
const patched = JSON.parse(originalManifest)
patched.host_permissions = [...(patched.host_permissions ?? []), PATTERN]
writeFileSync(MANIFEST, JSON.stringify(patched, null, 2))

let browser = null
let cdp = null
let failed = false

class CDP {
  constructor(url) {
    this.url = url
    this.id = 0
    this.pending = new Map()
  }

  async connect() {
    this.ws = new WebSocket(this.url)
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve
      this.ws.onerror = reject
    })
    this.ws.onmessage = event => {
      const message = JSON.parse(event.data)
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result)
    }
  }

  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async eval(expression, timeout = 20000) {
    const call = this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    const result = await Promise.race([call, sleep(timeout).then(() => ({ timeout: true }))])
    if (result.timeout) return 'TIMEOUT'
    if (result.exceptionDetails) {
      return `EXC: ${result.exceptionDetails.exception?.description ?? ''}`
    }
    return result.result.value
  }

  close() {
    try { this.ws.close() } catch { /* 已断开 */ }
  }
}

const check = (label, passed) => {
  console.log(`  ${passed ? '✓ PASS' : '✗ FAIL'}  ${label}`)
  if (!passed) failed = true
}

try {
  browser = spawn(chrome, [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    'about:blank'
  ], { stdio: 'ignore' })

  let pageTarget = null
  for (let i = 0; i < 60 && !pageTarget; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
      pageTarget = targets.find(target => target.type === 'page')
    } catch { /* Chrome 还没起来 */ }
    if (!pageTarget) await sleep(500)
  }
  if (!pageTarget) throw new Error('连不上 Chrome 调试端口')

  cdp = new CDP(pageTarget.webSocketDebuggerUrl)
  await cdp.connect()
  await cdp.send('Page.enable')

  // 写入站点配置（侧栏页作为扩展上下文）
  await cdp.send('Page.navigate', { url: `chrome-extension://${extensionId}/src/sidepanel/index.html` })
  await sleep(1500)
  const contextOk = await cdp.eval('typeof chrome !== "undefined" && typeof chrome.storage !== "undefined"')
  if (contextOk !== true) {
    throw new Error(
      '扩展未加载（chrome.storage 不可用）。新版正式版 Chrome 会忽略 --load-extension，' +
      '请用 CHROME_PATH 指向 Chrome for Testing / Chromium'
    )
  }
  const stored = await cdp.eval(`chrome.storage.local.set({
    'contextwatchdog.protectedSites': ${JSON.stringify([PATTERN])},
    'contextwatchdog.siteAiEnabled': { ${JSON.stringify(PATTERN)}: true },
    'contextwatchdog.aiEnabled': true
  }).then(() => 'ok')`)
  if (stored !== 'ok') throw new Error(`写入站点配置失败：${stored}`)
  await sleep(800)

  // ① 授权站点
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${httpPort}/` })
  await sleep(2000)
  const authorized = JSON.parse(await cdp.eval(`(() => {
    const host = document.getElementById('${WIDGET_ID}')
    const frame = document.querySelector('iframe')
    const frameDoc = frame ? frame.contentDocument : null
    return JSON.stringify({
      present: !!host,
      position: host ? getComputedStyle(host).position : null,
      zIndex: host ? getComputedStyle(host).zIndex : null,
      display: host ? getComputedStyle(host).display : null,
      frameWidget: frameDoc ? !!frameDoc.getElementById('${WIDGET_ID}') : null,
      bodyChildren: document.body.children.length,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    })
  })()`))

  console.log('[1] 授权站点 http://127.0.0.1:' + httpPort)
  check('顶层文档出现挂件', authorized.present === true)
  check('fixed 定位 + 最高 z-index', authorized.position === 'fixed' && authorized.zIndex === '2147483647')
  check('配置读取成功后可见', authorized.display === 'block')
  check('iframe 内不出现挂件', authorized.frameWidget === false)
  check('不往 body 里塞节点（body 仍为 textarea + iframe）', authorized.bodyChildren === 2)
  check('无横向滚动条', authorized.overflowX === false)

  // ② 收起态尺寸：面板 display:none，host 盒子 = 按钮（44×44）
  const size = JSON.parse(await cdp.eval(`(() => {
    const host = document.getElementById('${WIDGET_ID}')
    const r = host ? host.getBoundingClientRect() : null
    return JSON.stringify({ w: r ? Math.round(r.width) : 0, h: r ? Math.round(r.height) : 0 })
  })()`))
  console.log('[2] 收起态尺寸')
  check('收起态按钮 44×44', size.w === 44 && size.h === 44)

  // ③ closed Shadow DOM 内部（页面 JS 拿不到，走 CDP 穿透；与 DevTools 元素面板同机制）
  await cdp.send('DOM.enable')
  const attrOf = node => {
    const out = {}
    const flat = node.attributes ?? []
    for (let i = 0; i < flat.length; i += 2) out[flat[i]] = flat[i + 1]
    return out
  }
  const walk = node => [
    node,
    ...(node.children ?? []).flatMap(walk),
    ...(node.shadowRoots ?? []).flatMap(walk)
  ]
  const readWidget = async () => {
    const tree = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
    const hostNode = walk(tree.root).find(node => attrOf(node).id === WIDGET_ID)
    const inside = hostNode ? walk(hostNode) : []
    const buttons = inside.filter(node => node.nodeName === 'BUTTON')
    return {
      paths: inside.filter(node => node.nodeName === 'path').map(node => attrOf(node)),
      fab: buttons.find(node => (attrOf(node)['aria-controls'] ?? '') === 'cw-panel'),
      // 「在侧边栏中打开」是整行宽按钮（width:100%），靠样式定位避免依赖文案语言
      openButton: buttons.find(node => (attrOf(node).style ?? '').includes('width: 100%'))
    }
  }
  const emulateScheme = value =>
    cdp.send('Emulation.setEmulatedMedia', value ? { features: [{ name: 'prefers-color-scheme', value }] } : {})

  console.log('[3] Shadow DOM 内部 / 亮色主题')
  let widget = await readWidget()
  check('挂件内嵌两枚 mark（按钮 + 面板头部）', widget.paths.length >= 2)
  check('mark 跟随亮色主题用墨色（fill #18181b）',
    widget.paths.length > 0 && widget.paths.every(attr => attr.fill === '#18181b'))
  check('收起按钮是 12px 圆角矩形',
    (attrOf(widget.fab ?? {}).style ?? '').includes('border-radius: 12px'))

  console.log('[3b] 暗色主题')
  await emulateScheme('dark')
  await sleep(800)
  widget = await readWidget()
  check('mark 跟随暗色主题换浅色（fill #fafafa）',
    widget.paths.length > 0 && widget.paths.every(attr => attr.fill === '#fafafa'))
  await emulateScheme(null)
  await sleep(600)

  // ④ 「在侧边栏中打开」必须有反应：无侧栏 API（无头/旧版）或手势失效时退回弹窗面板
  console.log('[4] 打开侧栏按钮')
  const viewport = JSON.parse(await cdp.eval('JSON.stringify({ w: innerWidth, h: innerHeight })'))
  const fabX = viewport.w - 16 - 22
  const fabY = viewport.h - 16 - 22
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: fabX, y: fabY, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: fabX, y: fabY, button: 'left', clickCount: 1 })
  await sleep(500)
  widget = await readWidget()
  if (widget.openButton) {
    const box = await cdp.send('DOM.getBoxModel', { nodeId: widget.openButton.nodeId })
    const quad = box.model.content
    const x = (quad[0] + quad[4]) / 2
    const y = (quad[1] + quad[5]) / 2
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  }
  await sleep(1500)
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
  const panelOpened = targets.some(target =>
    target.type === 'page' && target.url.startsWith(`chrome-extension://${extensionId}/src/sidepanel/index.html`))
  check('点击后面板真的打开了（侧栏或弹窗）', Boolean(widget.openButton) && panelOpened)

  // ⑤ 常驻：页面主动删除 host 后，观察器应立即重挂
  await cdp.eval(`document.getElementById('${WIDGET_ID}')?.remove()`)
  await sleep(800)
  const remounted = await cdp.eval(`!!document.getElementById('${WIDGET_ID}')`)
  console.log('[5] 常驻')
  check('页面删除挂件后自动重挂', remounted === true)

  // ⑥ 未授权站点（host 不同 → pattern 不同）
  await cdp.send('Page.navigate', { url: `http://localhost:${httpPort}/` })
  await sleep(1500)
  const unauthorized = await cdp.eval(`!!document.getElementById('${WIDGET_ID}')`)
  console.log('[6] 未授权站点 http://localhost:' + httpPort)
  check('完全不注入挂件', unauthorized === false)

  console.log(failed ? '\n挂件探针失败 ✗' : '\n挂件探针全部通过 ✓')
  if (failed) process.exitCode = 1
} catch (error) {
  console.error('[probe:widget] 失败:', error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  cdp?.close()
  browser?.kill('SIGKILL')
  station.close()
  writeFileSync(MANIFEST, originalManifest)
  await sleep(300)
  rmSync(profile, { recursive: true, force: true })
}
