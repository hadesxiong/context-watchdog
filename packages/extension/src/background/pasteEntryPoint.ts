// 注入到页面的粘贴监听器：经 executeScript 序列化执行，必须自包含——读不到模块作用域与 i18n，
// 文案由 SW 取好经 args 传入。可测版本见 src/content/pasteText.ts，改动需两边同步。
export const contextWatchdogEntryPoint = (messages?: {
  toastRedacted?: string
  toastAi?: string
  /** 看门狗 mark 的 SVG 原文：注入函数读不到模块，只能随 args 传 */
  mark?: string
  widget?: {
    ai?: string
    open?: string
    opened?: string
    /** 弹窗兜底面板开着时的已打开文案（真侧栏开着仍用 opened） */
    openedPopup?: string
    openFailed?: string
    needAi?: string
    loading?: string
    preparing?: string
    cost?: string
    collapse?: string
  }
}): void => {
  const toastTemplate = messages?.toastRedacted ?? '{count}'
  const toastAiTemplate = messages?.toastAi ?? '{count}'
  const globalRef = window as unknown as Record<string, unknown>
  if (globalRef.__contextWatchdogInstalled) return
  globalRef.__contextWatchdogInstalled = true

  // 主题跟随宿主页面的 prefers-color-scheme：注入侧不能写 <style>（宿主 style-src 拦），色板只能在 JS 里取值、切换时整体重绘。
  const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
  let darkMode = darkQuery?.matches === true
  const palette = () =>
    darkMode
      ? {
          surface: 'rgba(24, 24, 27, 0.96)',
          ink: '#fafafa',
          muted: 'rgba(250, 250, 250, 0.62)',
          // 暗色页面上 0.18 的边几乎看不见，面板会和背景连成一片
          border: 'rgba(250, 250, 250, 0.3)',
          soft: 'rgba(250, 250, 250, 0.08)',
          mark: '#fafafa',
          warning: '#fbbf24',
          shadow: '0 10px 30px rgba(0, 0, 0, 0.55)',
          fabBg: 'rgba(24, 24, 27, 0.92)',
          fabShadow: '0 6px 18px rgba(0, 0, 0, 0.55)',
          toggleOff: 'rgba(250, 250, 250, 0.22)'
        }
      : {
          surface: 'rgba(255, 255, 255, 0.98)',
          ink: '#18181b',
          muted: 'rgba(24, 24, 27, 0.62)',
          border: 'rgba(24, 24, 27, 0.14)',
          soft: 'rgba(24, 24, 27, 0.05)',
          mark: '#18181b',
          warning: '#b45309',
          shadow: '0 8px 24px rgba(0, 0, 0, 0.14)',
          fabBg: 'rgba(255, 255, 255, 0.98)',
          fabShadow: '0 4px 14px rgba(0, 0, 0, 0.14)',
          toggleOff: 'rgba(24, 24, 27, 0.18)'
        }

  // 与 service-worker.ts / content/pasteText.ts 的 MAX_PASTE_CHARS 保持一致（注入函数自包含，只能内联）
  const MAX_PASTE_CHARS = 20000

  // 处理单行/多行与 contenteditable；password 等绝不处理（下方类型判断为双保险）
  const isTextEditable = (el: EventTarget | null): boolean => {
    if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly
    if (el instanceof HTMLInputElement) {
      if (el.disabled || el.readOnly) return false
      return el.type === 'text' || el.type === 'search'
    }
    // isContentEditable 覆盖各种写法与继承；选区落在子节点时 target 是编辑宿主后代，同样为真
    return el instanceof HTMLElement && el.isContentEditable
  }

  // 必须用原型原生 setter 赋值：直接 el.value = x 会经过 React 的 value tracker（DOM 显示脱敏文、state 仍是原文）；绕开后补 InputEvent 让框架感知（与 pasteText.ts 的 applySanitized 同步）。
  const setNativeValue = (el: HTMLInputElement | HTMLTextAreaElement, next: string): void => {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    if (setter) {
      setter.call(el, next)
    } else {
      el.value = next
    }
    // 纯 input 事件即可触发 React onChange；不伪造 data/inputType，避免 Lexical 类编辑器按 data 重建内容被干扰
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  // 「已脱敏 N 处」轻提示：2s 自消、pointer-events:none、纯内联样式——不依赖宿主页面 CSS，也不引入 class 污染它
  const showToast = (count: number, template = toastTemplate): void => {
    document.getElementById('context-watchdog-toast')?.remove()
    const colors = palette()
    const toast = document.createElement('div')
    toast.id = 'context-watchdog-toast'
    toast.setAttribute('role', 'status')
    toast.textContent = template.split('{count}').join(String(count))
    Object.assign(toast.style, {
      position: 'fixed',
      top: '16px',
      right: '16px',
      zIndex: '2147483647',
      padding: '9px 14px',
      borderRadius: '10px',
      border: `1px solid ${colors.border}`,
      background: colors.surface,
      color: colors.ink,
      font: '15px/1.45 system-ui, sans-serif',
      boxShadow: colors.shadow,
      pointerEvents: 'none'
    })
    ;(document.body ?? document.documentElement).appendChild(toast)
    setTimeout(() => toast.remove(), 2000)
  }

  // ---------- AI 二次升级（正则先落地，AI 是增量）：仅 input/textarea，contenteditable 保持正则档 ----------
  interface PendingAiUpgrade {
    token: string
    el: HTMLInputElement | HTMLTextAreaElement
    appliedText: string
    start: number
    end: number
    valueAfterApply: string
    appliedAt: number
  }
  let pendingUpgrade: PendingAiUpgrade | null = null
  // 与 content/pasteText.ts 的 AI_UPGRADE_TTL 一致（注入函数不能 import）
  const AI_UPGRADE_TTL = 8000

  // 四道守卫全部通过才替换（定义见 docs/site-ai-offscreen-host.md §3.5 P6）；任一不过都保留正则结果，绝不回退原文。
  chrome.runtime.onMessage.addListener((message: unknown) => {
    const result = message as
      | { type?: string; token?: string; sanitized?: string; count?: number }
      | null
    if (result?.type !== 'PASTE_AI_RESULT' || typeof result.token !== 'string') return

    const pending = pendingUpgrade
    if (!pending || pending.token !== result.token) return
    pendingUpgrade = null

    const aiSanitized = result.sanitized
    if (typeof aiSanitized !== 'string') return
    const el = pending.el
    if (!el.isConnected) return

    // a) 用户没继续输入
    if (el.value !== pending.valueAfterApply) return
    // b) 正则结果仍在原位
    if (pending.start < 0 || pending.end > el.value.length) return
    if (el.value.slice(pending.start, pending.end) !== pending.appliedText) return
    // c) AI 确实有增量
    if (aiSanitized === pending.appliedText) return
    // d) 时效
    if (Date.now() - pending.appliedAt > AI_UPGRADE_TTL) return

    const delta = aiSanitized.length - pending.appliedText.length
    const caret = el.selectionStart ?? el.value.length
    const nextValue =
      el.value.slice(0, pending.start) + aiSanitized + el.value.slice(pending.end)
    const nextCaret =
      caret <= pending.start
        ? caret
        : caret >= pending.end
          ? caret + delta
          : pending.start + aiSanitized.length

    setNativeValue(el, nextValue)
    const clamped = Math.max(0, Math.min(nextCaret, nextValue.length))
    el.selectionStart = clamped
    el.selectionEnd = clamped
    showToast(result.count ?? 1, toastAiTemplate)
    console.log('[ContextWatchdog] AI 二次升级完成，共脱敏', result.count ?? 0, '处')
  })

  // contenteditable 改写：富文本做不了逐字校验（换行建模不一致、Lexical/ProseMirror 会重排 DOM）→ 阻止
  // 默认 → 选区快照 → 异步检测 → execCommand 插入（异常路径一律补插原文、绝不吞粘贴）。见 docs/spec.md §8。
  const handleContentEditablePaste = (
    el: HTMLElement,
    pasted: string,
    event: ClipboardEvent
  ): void => {
    event.preventDefault()
    const selection = window.getSelection()
    const snapshot =
      selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null
    const host = el.closest('[contenteditable]') ?? el

    const insert = (text: string, count: number): void => {
      // 选区快照已随 DOM 变更漂出宿主（内容被整块替换/删除）→ 放弃，避免插到别处
      if (snapshot && !host.contains(snapshot.startContainer)) {
        console.log('[ContextWatchdog] 放弃插入：选区已脱离编辑区域')
        return
      }
      const sel = window.getSelection()
      if (!sel) return
      sel.removeAllRanges()
      if (snapshot) sel.addRange(snapshot)
      if (!document.execCommand('insertText', false, text)) {
        console.log('[ContextWatchdog] 放弃插入：execCommand insertText 失败')
        return
      }
      if (count > 0) {
        showToast(count)
        console.log('[ContextWatchdog] 富文本粘贴已就地脱敏', count, '处')
      }
    }

    chrome.runtime.sendMessage({ type: 'PASTE_DETECT', text: pasted }, response => {
      if (chrome.runtime.lastError) {
        console.log('[ContextWatchdog] 检测不可用，按原文插入:', chrome.runtime.lastError.message)
        insert(pasted, 0)
        return
      }
      const result = response as { ok?: boolean; sanitized?: string; count?: number } | undefined
      if (!result?.ok || typeof result.sanitized !== 'string') {
        console.log('[ContextWatchdog] 检测服务返回异常，按原文插入:', result)
        insert(pasted, 0)
        return
      }
      if (result.sanitized === pasted) {
        insert(pasted, 0) // 未检出敏感内容（正常路径，静默）
        return
      }
      insert(result.sanitized, result.count ?? 0)
    })
  }

  // capture 阶段注册：即便页面自己 stopPropagation 也能收到
  document.addEventListener(
    'paste',
    (event: ClipboardEvent) => {
      const target = event.target
      if (!isTextEditable(target)) return
      // 换行归一化：textarea.value 按规范把 \r\n 归一成 \n，剪贴板（尤其 Windows）常带 \r\n——不归一则逐字校验必然失配，链路静默失效
      const pasted = (event.clipboardData?.getData('text/plain') ?? '').replace(/\r\n?/g, '\n')
      if (!pasted) return

      // 超长直接原样放行、不发检测消息：仅靠 SW 侧 slice 截断会用「截断后的脱敏结果」整体改写、吞掉尾部
      if (pasted.length > MAX_PASTE_CHARS) return

      if (target instanceof HTMLElement && target.isContentEditable) {
        handleContentEditablePaste(target, pasted, event)
        return
      }

      const el = target as HTMLInputElement | HTMLTextAreaElement

      // 不阻止默认：先插入原文（不被检测阻塞），下一宏任务读到插入后的值，检测回来再就地替换
      setTimeout(() => {
        const value = el.value
        const caret = el.selectionStart ?? value.length
        const start = caret - pasted.length
        // 插入文本必须与剪贴板逐字吻合：站点改写/IME/并发输入都会破坏该前提 → 放弃改写
        if (start < 0 || value.slice(start, caret) !== pasted) {
          console.log('[ContextWatchdog] 放弃改写：插入文本与剪贴板不吻合（站点改写/并发输入）')
          return
        }

        // 一次粘贴链路一个 token：AI 结果必须能对上是哪一次粘贴
        const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
        chrome.runtime.sendMessage({ type: 'PASTE_DETECT', text: pasted, token }, response => {
          if (chrome.runtime.lastError) {
            console.log('[ContextWatchdog] 放弃改写：消息发送失败（SW 未响应）:', chrome.runtime.lastError.message)
            return
          }
          const result = response as { ok?: boolean; sanitized?: string; count?: number } | undefined
          if (!result?.ok || typeof result.sanitized !== 'string') {
            console.log('[ContextWatchdog] 放弃改写：检测服务返回异常:', result)
            return
          }
          if (el.value !== value) {
            console.log('[ContextWatchdog] 放弃改写：用户在检测期间继续输入')
            return
          }

          const sanitized = result.sanitized
          if (sanitized !== pasted) {
            setNativeValue(el, value.slice(0, start) + sanitized + value.slice(caret))
            const nextCaret = start + sanitized.length
            el.selectionStart = nextCaret
            el.selectionEnd = nextCaret
            console.log('[ContextWatchdog] 粘贴已就地脱敏', result.count ?? 0, '处')
            showToast(result.count ?? 1)
          }

          // 无论正则是否命中都记快照（AI 可能补出正则漏掉的实体）；只留最近一次，TTL 后清掉以免长期持有元素引用
          pendingUpgrade = {
            token,
            el,
            appliedText: sanitized,
            start,
            end: start + sanitized.length,
            valueAfterApply: el.value,
            appliedAt: Date.now()
          }
          setTimeout(() => {
            if (pendingUpgrade?.token === token) pendingUpgrade = null
          }, AI_UPGRADE_TTL + 500)
        })
      }, 0)
    },
    true
  )

  // ---------- 站点挂件（控制面，设计见 docs/site-ai-offscreen-host.md §3.4） ----------
  // 只挂顶层文档（挂件出现在 iframe 里只是噪音）；样式全内联 + Shadow DOM，不依赖也不污染宿主 CSS。
  const mountSiteWidget = (): void => {
    const t = {
      ai: messages?.widget?.ai ?? 'AI enhancement',
      open: messages?.widget?.open ?? 'Open side panel',
      opened: messages?.widget?.opened ?? 'Side panel is open',
      openedPopup: messages?.widget?.openedPopup ?? 'Panel is open',
      openFailed: messages?.widget?.openFailed ?? 'Could not open the side panel, click the toolbar icon',
      needAi: messages?.widget?.needAi ?? 'Enable AI in the side panel first',
      loading: messages?.widget?.loading ?? 'AI model is still loading',
      // 本站开关已开、宿主正在预热（模型文件已在本地）：是"马上就好"而非"没就绪"，文案分开
      preparing: messages?.widget?.preparing ?? 'AI model is starting…',
      cost: messages?.widget?.cost ?? 'First paste may take 1–2s longer',
      collapse: messages?.widget?.collapse ?? 'Collapse'
    }

    const ROOT_ID = 'context-watchdog-widget'
    if (document.getElementById(ROOT_ID)) return

    let expanded = false
    let ready = false
    let globalEnabled = false
    let siteEnabled = false
    let hostReady = false
    // 侧栏是否开着由 SW 的 readPanelState 查真实状态，别处关掉也能同步回来
    let panelOpen = false
    // 开着的形态：真侧栏用 opened、弹窗兜底用 openedPopup——Firefox 点击必然开弹窗，文案不许冒充侧栏
    let panelKind: 'sidebar' | 'popup' | undefined
    // 打开在途与失败提示的 3s 窗口都是局部 UI 态，由 render 一起重建
    let opening = false
    let openFailed = false

    const host = document.createElement('div')
    host.id = ROOT_ID

    // 内嵌看门狗 mark：SVG 原文随 args 传入、按主题染色；不能用 <img src>（宿主 CSP img-src 拦）也不能
    // fetch 扩展资源。染色必须整串替换 #18181b，逐 path 改 fill 会填实描边。
    const makeMark = (size: number, color: string): Element | null => {
      const raw = messages?.mark
      if (!raw) return null
      const svg = new DOMParser()
        .parseFromString(raw.replace(/#18181b/g, color), 'image/svg+xml')
        .documentElement
      if (svg.localName !== 'svg') return null
      svg.setAttribute('width', String(size))
      svg.setAttribute('height', String(size))
      return svg
    }

    Object.assign(host.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: '2147483647',
      display: 'block'
    })
    const shadow = host.attachShadow({ mode: 'closed' })

    const root = document.createElement('div')
    Object.assign(root.style, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      font: '14px/1.5 system-ui, -apple-system, sans-serif'
    })

    const panel = document.createElement('div')
    panel.id = 'cw-panel'
    Object.assign(panel.style, {
      width: '280px',
      marginBottom: '10px',
      padding: '16px',
      borderRadius: '12px',
      display: 'none'
    })

    const fab = document.createElement('button')
    fab.type = 'button'
    fab.setAttribute('aria-label', 'ContextWatchdog')
    fab.setAttribute('aria-controls', 'cw-panel')
    fab.title = 'ContextWatchdog'
    Object.assign(fab.style, {
      width: '44px',
      height: '44px',
      padding: '0',
      borderRadius: '12px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      font: '600 14px/1 system-ui, -apple-system, sans-serif',
      letterSpacing: '0.02em',
      cursor: 'pointer'
    })
    const paintFab = (): void => {
      const colors = palette()
      const mark = makeMark(26, colors.mark)
      // 万一 mark 没传进来（构建异常），退回原来的「AI」字样
      if (mark) fab.replaceChildren(mark)
      else fab.textContent = 'AI'
    }
    paintFab()
    fab.addEventListener('click', () => setExpanded(!expanded))

    root.append(panel, fab)
    shadow.appendChild(root)
    document.documentElement.appendChild(host)

    const paintTheme = (): void => {
      const colors = palette()
      Object.assign(root.style, { color: colors.ink })
      Object.assign(panel.style, {
        background: colors.surface,
        color: colors.ink,
        border: `1px solid ${colors.border}`,
        boxShadow: colors.shadow
      })
      Object.assign(fab.style, {
        background: colors.fabBg,
        border: `1px solid ${colors.border}`,
        boxShadow: colors.fabShadow
      })
      paintFab()
      render()
    }
    paintTheme()
    darkQuery?.addEventListener?.('change', event => {
      darkMode = event.matches
      paintTheme()
    })

    // 挂件常驻：MutationObserver 防站点清 DOM，3s 心跳兜住 document.open/write 与 documentElement 被整体替换（观察器会随旧节点失效）
    const reattach = (): void => {
      if (!document.documentElement) return
      if (!document.documentElement.contains(host)) document.documentElement.appendChild(host)
    }
    const observer = new MutationObserver(reattach)
    observer.observe(document.documentElement, { childList: true })
    setInterval(reattach, 3000)

    // 面板外的点击与 Esc 只做「收起」，挂件本身始终留在页面上
    document.addEventListener(
      'pointerdown',
      event => {
        if (!expanded) return
        if (event.composedPath().includes(host)) return
        setExpanded(false)
      },
      true
    )
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !expanded) return
      setExpanded(false)
    })

    const send = (message: unknown, done?: (response: unknown) => void): void => {
      chrome.runtime.sendMessage(message, response => {
        if (chrome.runtime.lastError) {
          done?.(undefined)
          return
        }
        done?.(response)
      })
    }

    // 一次状态同步：开关、宿主就绪、侧栏开没开。展开期间每 2s 一次，收起即停、不空转打扰 SW
    const syncState = (): void => {
      send({ type: 'SITE_AI_GET' }, response => {
        const result = response as
          | {
              ok?: boolean
              state?: {
                globalEnabled?: boolean
                siteEnabled?: boolean
                hostReady?: boolean
                panelOpen?: boolean
                panelKind?: 'sidebar' | 'popup'
              }
            }
          | undefined
        // SW 瞬时不可用（休眠/重启）不卸载挂件：保持禁用态，下一次同步仍可重试
        if (!result?.ok || !result.state) return

        globalEnabled = result.state.globalEnabled === true
        siteEnabled = result.state.siteEnabled === true
        hostReady = result.state.hostReady === true
        // panelOpen 缺省按「没开」处理（按钮照常可点）；开着但缺 kind 的旧回包按侧栏文案兜底
        panelOpen = result.state.panelOpen === true
        panelKind = panelOpen ? result.state.panelKind ?? 'sidebar' : undefined
        ready = true
        render()
        applySyncSchedule()
      })
    }

    // 轮询：展开 2s；收起后若「本站已开、宿主未就绪」以 4s 续询到就绪（否则首屏永远停在「尚未就绪」）
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let pollInterval = 0

    const applySyncSchedule = (): void => {
      const ms = expanded ? 2000 : ready && globalEnabled && siteEnabled && !hostReady ? 4000 : 0
      if (ms === pollInterval) return
      if (pollTimer) clearInterval(pollTimer)
      pollInterval = ms
      pollTimer = ms ? setInterval(syncState, ms) : null
    }

    // 收放统一从这里走：除了渲染，还要起停状态轮询
    const setExpanded = (next: boolean): void => {
      expanded = next
      render()
      applySyncSchedule()
    }

    // 侧栏开/关实时推送（SW 转发 141+ onOpened / 142+ onClosed）：别处关掉立即复位，Firefox 无此事件靠
    // 2s 轮询兜底；推送不动 opening / openFailed，那由 OPEN_SIDE_PANEL 回包收尾。
    chrome.runtime.onMessage.addListener((message: unknown) => {
      const push = message as { type?: string; panelOpen?: boolean; panelKind?: 'sidebar' | 'popup' } | null
      if (push?.type !== 'SITE_AI_PANEL_STATE') return
      if (typeof push.panelOpen !== 'boolean') return
      // 形态跟着开态走：开着且推送带了 kind 才更新；关着就清空（下次开重新定）
      const nextKind = push.panelOpen ? push.panelKind ?? panelKind ?? 'sidebar' : undefined
      if (push.panelOpen === panelOpen && nextKind === panelKind) return
      panelOpen = push.panelOpen
      panelKind = nextKind
      render()
    })

    function disabledReason(): string {
      // 状态回包前（或 SW 瞬时不可用）一律禁用：宁可晚一点可点，也不能显示错的状态
      if (!ready) return t.loading
      if (!globalEnabled) return t.needAi
      // 本站已开但宿主未就绪：SW 已在预热（模型在本地则秒级就绪），说"正在启动"比"尚未就绪"准确
      if (!hostReady) return siteEnabled ? t.preparing : t.loading
      return ''
    }

    function render(): void {
      panel.replaceChildren()
      panel.style.display = expanded ? 'block' : 'none'
      fab.setAttribute('aria-expanded', String(expanded))

      const colors = palette()
      const header = document.createElement('div')
      Object.assign(header.style, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '12px'
      })
      const brand = document.createElement('span')
      Object.assign(brand.style, { display: 'flex', alignItems: 'center', gap: '6px' })
      const headerMark = makeMark(20, colors.mark)
      if (headerMark) brand.append(headerMark)
      const title = document.createElement('span')
      title.textContent = 'ContextWatchdog'
      Object.assign(title.style, { fontWeight: '600', fontSize: '14px', opacity: '0.92' })
      brand.append(title)
      const collapseButton = document.createElement('button')
      collapseButton.type = 'button'
      collapseButton.textContent = '×'
      collapseButton.setAttribute('aria-label', t.collapse)
      collapseButton.title = t.collapse
      Object.assign(collapseButton.style, {
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        fontSize: '18px',
        lineHeight: '1',
        padding: '0 2px',
        opacity: '0.7'
      })
      collapseButton.addEventListener('click', event => {
        event.stopPropagation()
        setExpanded(false)
      })
      header.append(brand, collapseButton)

      const row = document.createElement('div')
      Object.assign(row.style, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px'
      })
      const label = document.createElement('span')
      label.textContent = t.ai
      Object.assign(label.style, { fontSize: '14px' })

      const reason = disabledReason()
      const disabled = Boolean(reason)
      const toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.setAttribute('role', 'switch')
      toggle.setAttribute('aria-checked', String(siteEnabled))
      toggle.setAttribute('aria-label', t.ai)
      toggle.disabled = disabled
      Object.assign(toggle.style, {
        position: 'relative',
        flex: '0 0 auto',
        width: '36px',
        height: '20px',
        padding: '0',
        borderRadius: '999px',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: siteEnabled ? '#6366f1' : colors.toggleOff,
        opacity: disabled ? '0.5' : '1',
        transition: 'background 0.15s ease'
      })
      const knob = document.createElement('span')
      Object.assign(knob.style, {
        position: 'absolute',
        top: '2px',
        left: siteEnabled ? '18px' : '2px',
        width: '16px',
        height: '16px',
        borderRadius: '50%',
        background: '#fff',
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.25)',
        transition: 'left 0.15s ease'
      })
      toggle.appendChild(knob)
      toggle.addEventListener('click', () => {
        if (disabled) return
        const next = !siteEnabled
        siteEnabled = next
        render()
        send({ type: 'SITE_AI_SET', enabled: next }, response => {
          const result = response as { ok?: boolean } | undefined
          if (result?.ok) return
          // 写失败就回滚：不能让 UI 显示一个没落库的开关
          siteEnabled = !next
          render()
        })
      })
      row.append(label, toggle)

      const hint = document.createElement('p')
      hint.textContent = reason || t.cost
      Object.assign(hint.style, {
        margin: '10px 0 14px',
        fontSize: '13px',
        lineHeight: '1.5',
        color: reason ? colors.warning : colors.muted
      })

      // 「在侧边栏中打开」：三种态由渲染重建，绝不在 DOM 上残留灰态/转圈光标
      const openButton = document.createElement('button')
      openButton.type = 'button'
      openButton.textContent = openFailed
        ? t.openFailed
        : panelOpen
          ? panelKind === 'popup'
            ? t.openedPopup
            : t.opened
          : t.open
      openButton.disabled = opening || panelOpen
      Object.assign(openButton.style, {
        width: '100%',
        padding: '10px 12px',
        borderRadius: '8px',
        border: `1px solid ${colors.border}`,
        background: colors.soft,
        color: colors.ink,
        font: 'inherit',
        cursor: opening ? 'wait' : panelOpen ? 'default' : 'pointer',
        opacity: opening ? '0.6' : '1'
      })
      openButton.addEventListener('click', () => {
        if (openButton.disabled) return
        opening = true
        render()
        send({ type: 'OPEN_SIDE_PANEL' }, response => {
          opening = false
          const result = response as { ok?: boolean; panelKind?: 'sidebar' | 'popup' } | undefined
          if (result?.ok) {
            // 打开成功即切「已打开」（形态以回包为准，免得等一轮轮询才纠正）；别处的关闭交给轮询
            panelOpen = true
            panelKind = result.panelKind ?? 'sidebar'
            render()
            return
          }
          // 失败（无侧栏 API / 手势过期且弹窗兜底也失败）：就地提示 3s
          openFailed = true
          render()
          setTimeout(() => {
            openFailed = false
            render()
          }, 3000)
        })
      })

      panel.append(header, row, hint, openButton)
    }

    render()
    syncState()
  }

  if (window.top === window) {
    if (document.documentElement) mountSiteWidget()
    else document.addEventListener('DOMContentLoaded', mountSiteWidget, { once: true })
  }
}
