#!/usr/bin/env node
/**
 * 布局断点回归探针
 *
 * 为什么存在：本项目的断点失效过两类 bug，肉眼难复现、vitest 也测不到（jsdom 无布局）：
 *   A. 结果网格的列数断点按「视口宽度」触发，而网格实际活在右侧栏里
 *      （宽 = 视口 − 左栏 400px），导致 1200px 视口下 3 列每列仅 ~250px，
 *      卡片被 AccordionItem 的 overflow-hidden 裁掉 69px。
 *   B. 左栏基础类 min-w-100（400px）在所有宽度生效，面板拖窄到 <400px 时
 *      整页出现横向滚动。
 *
 * 本脚本用无头 Chrome + CDP 实测真实布局（jsdom 做不了），逐档视口宽度断言：
 *   1) 页面无横向溢出
 *   2) 结果网格无内部溢出、卡片不越出列
 *   3) 列数由容器宽度推导（= 当前设计意图：660/1000 阈值），而非固定视口值
 *   4) 宽视口 + 零检出时 main 仍为两栏（hasDetected 判定，而非 hasResults）
 *   5) 宽屏断点下输入区四边等距 12px（曾因缺 min-[820px]:pb-3 导致下边距为 0，
 *      输入框贴到列底 / 按钮栏顶边）
 *   6) 长文本检测遮罩时序：遮罩必须先上屏再开跑检测（App.vue handleDetect 的
 *      nextTick + rAF 时序）。退化表现：检测的同步长任务把遮罩渲染压到任务结束，
 *      而 1s 最小延时已在阻塞前过期 → 遮罩一闪而过甚至根本没出现
 *
 * 用法：
 *   npm run probe:layout          # 缺 dist 会先自动 build
 *   CHROME_PATH=/path/to/chrome npm run probe:layout
 *
 * 退出码：0 全部通过；1 有断言失败；2 环境不具备（无 Chrome / 无法构建）
 */
import http from 'node:http'
import { createReadStream, existsSync, mkdtempSync, rmSync } from 'node:fs'
import net from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const PAGE_PATH = '/src/sidepanel/index.html'

// DetectionList 容器查询阈值（改这里时同步改 src/components/DetectionList.vue）
const COLS_2_AT = 660
const COLS_3_AT = 1000

const sleep = ms => new Promise(r => setTimeout(r, ms))
const failures = []
const report = (name, ok, detail = '') => {
    console.log(`  ${ok ? '\u2713 PASS' : '\u2717 FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
    if (!ok) failures.push(`${name} ${detail}`.trim())
}

/* ---------- 1. 静态服务 ---------- */
const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm',
}
function serveDist() {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const file = path.join(DIST, decodeURIComponent(req.url.split('?')[0]))
            if (!file.startsWith(DIST) || !existsSync(file)) { res.writeHead(404).end('404'); return }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
            createReadStream(file).pipe(res)
        })
        server.on('error', reject)
        server.listen(0, '127.0.0.1', () => resolve(server))
    })
}
const freePort = () => new Promise((resolve, reject) => {
    const s = net.createServer()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) })
})

/* ---------- 2. Chrome ---------- */
function chromePath() {
    const candidates = [
        process.env.CHROME_PATH,
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    ].filter(Boolean)
    return candidates.find(p => existsSync(p)) || null
}

class CDP {
    constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map() }
    static async connect(url) {
        const ws = new WebSocket(url)
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
        const c = new CDP(ws)
        ws.onmessage = ev => {
            const m = JSON.parse(ev.data)
            if (m.id && c.pending.has(m.id)) {
                const { res, rej } = c.pending.get(m.id); c.pending.delete(m.id)
                m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
            }
        }
        return c
    }
    send(method, params = {}) {
        const id = ++this.id
        return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })) })
    }
    async eval(expression) {
        const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
        if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400))
        return r.result.value
    }
}

/* 页面内测量：一次性取全，避免多次注入表达式 */
const MEASURE = `(() => {
  const main = document.querySelector('main')
  const right = main && main.children[1]
  const grid = document.querySelector('div.grid')
  const cards = grid ? [...grid.children] : []
  const de = document.documentElement
  let container = grid ? grid.parentElement : null
  while (container && container !== document.body && getComputedStyle(container).containerType !== 'inline-size') container = container.parentElement
  const listW = container && getComputedStyle(container).containerType === 'inline-size' ? container.clientWidth : null
  const gridRect = grid ? grid.getBoundingClientRect() : null
  const dir = main ? getComputedStyle(main).flexDirection : null
  const col = main ? main.children[0] : null
  const header = document.querySelector('header')
  const wrap = col ? col.children[0] : null
  const ta = col ? col.querySelector('textarea') : null
  const barEl = col && col.children.length > 1 ? col.children[1] : null
  const bar = barEl && getComputedStyle(barEl).display !== 'none' ? barEl : null
  const borderR = col ? (parseFloat(getComputedStyle(col).borderRightWidth) || 0) : 0
  const rr = el => el ? el.getBoundingClientRect() : null
  const gapTop = (wrap && header && wrap.firstElementChild) ? Math.round(rr(wrap.firstElementChild).top - rr(header).bottom) : null
  const gapLeft = (ta && col) ? Math.round(rr(ta).left - rr(col).left) : null
  const gapRight = (ta && col) ? Math.round(rr(col).right - rr(ta).right - borderR) : null
  const gapBottom = ta ? Math.round(bar ? rr(bar).top - rr(ta).bottom : rr(col).bottom - rr(ta).bottom) : null
  const barBtns = bar ? [...bar.querySelectorAll('button')] : []
  const barPadBottom = barBtns.length ? Math.round(rr(bar).bottom - rr(barBtns[barBtns.length - 1]).bottom) : null
  return {
    vw: innerWidth,
    viewportNoScrollbar: de.clientWidth,
    pageScrollW: de.scrollWidth,
    dir,
    gapTop, gapLeft, gapRight, gapBottom, barPadBottom,
    listW,
    cols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
    gridOverflowX: grid ? grid.scrollWidth - grid.clientWidth : null,
    cardBeyondGrid: gridRect ? Math.max(0, ...cards.map(c => Math.round(c.getBoundingClientRect().right - gridRect.right))) : 0,
    cardCount: cards.length,
    cardW: cards[0] ? Math.round(cards[0].getBoundingClientRect().width) : 0,
  }
})()`

function clickButton(cdp, label) {
    return cdp.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(label)}); if (b) { b.click(); return true } return false })()`)
}
function setText(cdp, text) {
    return cdp.eval(`(() => { const ta = document.querySelector('textarea'); if (!ta) return false; const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; s.call(ta, ${JSON.stringify(text)}); ta.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
}
const PHONES = ['13800138001', '13800138002', '13800138003', '13800138004', '13800138005', '13800138006'].join('\u3001')
const CARDS = 6

async function main() {
    if (!existsSync(path.join(DIST, PAGE_PATH))) {
        console.log('dist 未构建，先执行 npm run build ...')
        const r = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' })
        if (r.status !== 0) { console.error('构建失败'); process.exit(2) }
    }
    const chrome = chromePath()
    if (!chrome) { console.error('找不到 Chrome/Chromium，可用 CHROME_PATH 指定'); process.exit(2) }

    const server = await serveDist()
    const baseUrl = `http://127.0.0.1:${server.address().port}`
    const profile = mkdtempSync(path.join(os.tmpdir(), 'pg-probe-'))
    const debugPort = await freePort()
    const child = spawn(chrome, [
        '--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
        '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions',
        '--disable-background-networking', 'about:blank',
    ], { stdio: 'ignore' })
    const cleanup = () => { try { child.kill('SIGKILL') } catch { } try { rmSync(profile, { recursive: true, force: true }) } catch { } try { server.close() } catch { } }
    process.on('exit', cleanup)
    const watchdog = setTimeout(() => { console.error('超时：探针 120s 未完成'); process.exit(1) }, 120000)

    // 等 CDP 就绪
    let wsUrl = null
    for (let i = 0; i < 100 && !wsUrl; i++) {
        try { wsUrl = (await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json()).webSocketDebuggerUrl } catch { await sleep(100) }
    }
    if (!wsUrl) { console.error('Chrome CDP 未就绪'); process.exit(2) }
    const browser = await CDP.connect(wsUrl)

    const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(baseUrl + PAGE_PATH)}`, { method: 'PUT' })).json()
    const cdp = await CDP.connect(target.webSocketDebuggerUrl)
    await cdp.send('Runtime.enable')

    for (let i = 0; i < 100; i++) { if (await cdp.eval('document.querySelectorAll("#app *").length > 10').catch(() => false)) break; await sleep(200) }
    const setW = w => cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false })
    await setW(1200)
    await sleep(400)
    await clickButton(cdp, '\u6682\u4e0d')          // 关闭首启 AI 引导弹窗（如有）
    await sleep(300)

    await setText(cdp, `\u5ba2\u6237\u8054\u7cfb\uff1a${PHONES}`)
    await sleep(200)
    await clickButton(cdp, '\u68c0\u6d4b')
    let got = 0
    for (let i = 0; i < 40; i++) {
        got = await cdp.eval(MEASURE).then(m => m.cardCount).catch(() => 0)
        if (got === CARDS) break
        await sleep(300)
    }
    console.log(`\n有检出态（${got} 张卡片）`)
    if (got !== CARDS) console.log(`  \u26a0 期望 ${CARDS} 张卡片，实际 ${got}（判定列数的断言可能失真）\n`)

    const widths = [320, 380, 500, 700, 819, 820, 900, 1084, 1100, 1200, 1360, 1400, 1424, 1500, 1600]
    for (const w of widths) {
        await setW(w); await sleep(220)
        const m = await cdp.eval(MEASURE)
        const expectedCols = m.listW == null ? m.cols : m.listW < COLS_2_AT ? 1 : m.listW < COLS_3_AT ? 2 : 3
        console.log(`\n\u25c0 vw=${w}  main=${m.dir}  容器内宽=${m.listW}  列=${m.cols}(期望${expectedCols})  卡片宽=${m.cardW}`)
        report('无整页横向溢出', m.pageScrollW <= m.viewportNoScrollbar + 1, `scrollW=${m.pageScrollW} vs 可视=${m.viewportNoScrollbar}`)
        report('网格内部无溢出', (m.gridOverflowX ?? 0) <= 1, `gridOverflowX=${m.gridOverflowX}`)
        report('卡片不越出网格右边界', m.cardBeyondGrid === 0, `超出=${m.cardBeyondGrid}px`)
        if (got === CARDS) report('列数=由容器宽度推导', m.cols === expectedCols, `${m.cols} vs ${expectedCols}`)
        if (m.dir === 'row') {
            const pad = `上=${m.gapTop} 下=${m.gapBottom} 左=${m.gapLeft} 右=${m.gapRight}`
            report('宽屏断点下输入区四边等距 12px',
                [m.gapTop, m.gapBottom, m.gapLeft, m.gapRight].every(g => g != null && Math.abs(g - 12) <= 1), pad)
            if (m.barPadBottom != null) report('底部按钮栏自身下边距 12px', Math.abs(m.barPadBottom - 12) <= 1, `barPadBottom=${m.barPadBottom}`)
        }
    }

    // 零检出态：宽视口下仍须两栏（main 判定用 hasDetected，ActionBar 仍按 hasResults）
    await setW(1400); await sleep(300)
    await setText(cdp, '\u4eca\u5929\u5929\u6c14\u4e0d\u9519\uff0c\u9002\u5408\u51fa\u53bb\u6563\u6b65\u3002'); await sleep(200)
    await clickButton(cdp, '\u68c0\u6d4b'); await sleep(1500)
    const z = await cdp.eval(MEASURE)
    console.log(`\n\u25c0 零检出态 vw=1400  main=${z.dir}  卡片=${z.cardCount}`)
    report('零检出时宽屏保持两栏', z.dir === 'row', `flexDirection=${z.dir}`)
    report('零检出态无整页横向溢出', z.pageScrollW <= z.viewportNoScrollbar + 1, `scrollW=${z.pageScrollW} vs 可视=${z.viewportNoScrollbar}`)
    report('零检出态（无按钮栏）输入区四边等距 12px',
        [z.gapTop, z.gapBottom, z.gapLeft, z.gapRight].every(g => g != null && Math.abs(g - 12) <= 1),
        `上=${z.gapTop} 下=${z.gapBottom} 左=${z.gapLeft} 右=${z.gapRight}`)

    // 6. 长文本检测遮罩时序：遮罩需先上屏再开跑检测（遮罩 DOM 增删 + 首帧 rAF 取证）
    console.log(`\n\u25c0 长文本检测遮罩时序（~155KB 文本）`)
    await setW(1400); await sleep(200)
    await clickButton(cdp, '\u6e05\u7a7a'); await sleep(300)
    const longLen = await cdp.eval(`(() => { const mk = n => { let s = ''; for (let i = 0; i < n; i++) { s += '\u8fd9\u662f\u4e00\u6bb5\u666e\u901a\u7684\u8bf4\u660e\u6587\u5b57\uff0c\u7528\u4e8e\u6a21\u62df\u957f\u6587\u672c\u8f93\u5165\u573a\u666f\u3002'; if (i % 20 === 0) s += ' \u8054\u7cfb\u7535\u8bdd1380013800' + (i % 9) + ' \u90ae\u7bb1u' + i + '@example.com'; } return s }; window.__long = mk(6000); return window.__long.length })()`)
    await cdp.eval(`(() => { const ta = document.querySelector('textarea'); const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; s.call(ta, window.__long); ta.dispatchEvent(new Event('input', { bubbles: true })); return 1 })()`)
    await sleep(300)
    const started = await cdp.eval(`(() => {
      window.__rec = { in: null, out: null, firstFrame: null }
      const has = () => { const el = document.querySelector('div.fixed.inset-0.z-50'); return !!(el && el.textContent.includes('\u68c0\u6d4b\u4e2d')) }
      new MutationObserver(() => {
        if (has() && window.__rec.in === null) { window.__rec.in = performance.now(); requestAnimationFrame(() => { if (window.__rec.firstFrame === null) window.__rec.firstFrame = performance.now() }) }
        if (!has() && window.__rec.in !== null && window.__rec.out === null) window.__rec.out = performance.now()
      }).observe(document.body, { childList: true, subtree: true, characterData: true })
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '\u68c0\u6d4b'); b.click(); return !!b
    })()`)
    let rec = null
    for (let i = 0; i < 600 && !rec; i++) { rec = await cdp.eval('window.__rec && window.__rec.out !== null ? window.__rec : null'); if (!rec) await sleep(30) }
    if (!started || !rec) {
        report('长文本遮罩出现并按时移除', false, started ? '遮罩未出现或未移除（超时）' : '检测按钮未找到')
    } else {
        const alive = Math.round(rec.out - rec.in)
        const firstFrame = rec.firstFrame === null ? null : Math.round(rec.firstFrame - rec.in)
        console.log(`  文本长度=${longLen}  遮罩存活=${alive}ms  首帧上屏=${firstFrame === null ? '未上屏' : firstFrame + 'ms'}`)
        report('长文本遮罩先上屏再跑检测（首帧 ≤100ms）', firstFrame !== null && firstFrame >= 0 && firstFrame <= 100, `首帧=${firstFrame}ms`)
        report('遮罩最短展示 ≥1000ms', alive >= 1000, `存活=${alive}ms`)
    }

    clearTimeout(watchdog)
    console.log(`\n${failures.length === 0 ? '\u2713 全部通过' : `\u2717 ${failures.length} 项失败：\n    - ${failures.join('\n    - ')}`}`)
    cleanup()
    process.exit(failures.length === 0 ? 0 : 1)
}

main().catch(e => { console.error('探针异常:', e); process.exit(1) })
