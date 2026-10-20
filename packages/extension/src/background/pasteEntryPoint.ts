// 注入到页面的粘贴监听器
//
// chrome.scripting.executeScript({ func, args }) 会把函数序列化后在页面的扩展隔离世界里执行，
// 因此该函数必须自包含：不能引用任何模块作用域的标识符（import 的常量/函数都会 ReferenceError）。
// 这也是界面文案**只能靠 args 传进来**的原因——函数里读不到 i18n 模块，
// 由 service worker（chrome.i18n.getMessage）取好再作为参数递进来。
//
// 规则与守卫逻辑的可测版本见 src/content/pasteText.ts（有单测），改动需两边同步；
// 消息类型常量见 @engine/messages。
export const contextWatchdogEntryPoint = (messages?: {
  toastRedacted?: string
  toastAi?: string
  widget?: {
    ai?: string
    open?: string
    needAi?: string
    loading?: string
    cost?: string
    hide?: string
  }
}): void => {
  // 语言模板（含 {count} 占位），缺失时退化为「只显示数字」，不至于报错或空白
  const toastTemplate = messages?.toastRedacted ?? '{count}'
  const toastAiTemplate = messages?.toastAi ?? '{count}'
  const globalRef = window as unknown as Record<string, unknown>
  if (globalRef.__contextWatchdogInstalled) return
  globalRef.__contextWatchdogInstalled = true

  // 超长粘贴守卫上限（与 service-worker.ts / content/pasteText.ts 的 MAX_PASTE_CHARS
  // 保持一致；注入函数必须自包含，只能内联副本）
  const MAX_PASTE_CHARS = 20000

  // 处理单行/多行文本输入与 contenteditable 富文本区域；
  // password 的值绝不外发（双保险，下面还有类型判断）
  const isTextEditable = (el: EventTarget | null): boolean => {
    if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly
    if (el instanceof HTMLInputElement) {
      if (el.disabled || el.readOnly) return false
      return el.type === 'text' || el.type === 'search'
    }
    // isContentEditable 覆盖 contenteditable="" / "true" / "plaintext-only" 及继承
    // 可编辑；选区落在子节点上时 event.target 可能是编辑宿主的后代，此判断同样为真
    return el instanceof HTMLElement && el.isContentEditable
  }

  // 用原型原生 setter 赋值：el.value = x 会经过 React 覆写的 value tracker，
  // 导致「DOM 显示脱敏文、React state 仍是原文」（发送时把未脱敏原文发出去，
  // 比不替换更危险）。原生 setter 绕开 tracker，再补 InputEvent 让框架感知。
  // （与 pasteText.ts 的 applySanitized 语义同步；油猴社区对 React 站点均用此写法）
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
    // 与油猴社区对 React textarea 的验证写法一致：纯 input 事件即可触发 React onChange；
    // 不带伪造的 data/inputType（避免 Lexical 类编辑器按 data 重建内容时被干扰）
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  // 「已脱敏 N 处」轻提示：拦截改写生效时在视口右上角短暂显示（2s 自动消失、
  // pointer-events:none 不挡操作）。纯内联样式：注入目标是宿主页面，不能依赖
  // 页面 CSS/主题，也不能引入 class 污染宿主页面
  const showToast = (count: number, template = toastTemplate): void => {
    document.getElementById('context-watchdog-toast')?.remove()
    const toast = document.createElement('div')
    toast.id = 'context-watchdog-toast'
    toast.setAttribute('role', 'status')
    toast.textContent = template.split('{count}').join(String(count))
    Object.assign(toast.style, {
      position: 'fixed',
      top: '16px',
      right: '16px',
      zIndex: '2147483647',
      padding: '6px 12px',
      borderRadius: '8px',
      background: 'rgba(17, 24, 39, 0.92)',
      color: '#fff',
      font: '13px/1.4 system-ui, sans-serif',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
      pointerEvents: 'none'
    })
    ;(document.body ?? document.documentElement).appendChild(toast)
    setTimeout(() => toast.remove(), 2000)
  }

  // ---------- AI 二次升级（正则先落地，AI 是增量） ----------
  // 只对 input/textarea 路径生效；contenteditable 本期保持正则档（见 handleContentEditablePaste）。
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

  // 四道守卫全部通过才替换：用户没继续输入 / 正则结果仍在原位 /
  // AI 确有增量 / 未超时。任何一条不通过都保留正则结果，绝不回退原文。
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

  // contenteditable 改写：富文本区域做不了「先插入后就地替换」的逐字校验——innerText
  // 与 Range.toString() 对 <div>/<br> 的换行建模互不一致，且 Lexical/ProseMirror 类
  // 编辑器会重排 DOM。改为「阻止默认 → 选区快照 → 异步检测 → execCommand 插入」：
  // - 快照 Range 会随后续 DOM 编辑自动调整，检测期间的并发输入不会把插入点写歪
  //（语义等价于 input/textarea 路径的「文本发散即放弃」守卫，且更稳）
  // - execCommand('insertText') 走编辑器标准输入管线（beforeinput/input + 撤销栈），
  // 框架感知与原生粘贴一致；返回 false 则放弃，不伪造 DOM
  // - 任一异常路径都补插原文，绝不吞掉用户的粘贴
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
      // 换行归一化：textarea.value 按规范把 \r\n/\r 归一化为 \n，而剪贴板原始文本
      //（尤其 Windows）常带 \r\n——不归一化则多行粘贴的逐字校验必然失配，整条链路静默失效
      const pasted = (event.clipboardData?.getData('text/plain') ?? '').replace(/\r\n?/g, '\n')
      if (!pasted) return

      // 超长守卫：直接原样放行（不发检测消息；contenteditable 顺带保住富文本粘贴形态）。
      // 此前仅靠 SW 侧 slice 截断——超限粘贴会被「截断后的脱敏结果」整体改写吞掉尾部
      if (pasted.length > MAX_PASTE_CHARS) return

      // contenteditable 走独立策略（见 handleContentEditablePaste 注释）
      if (target instanceof HTMLElement && target.isContentEditable) {
        handleContentEditablePaste(target, pasted, event)
        return
      }

      const el = target as HTMLInputElement | HTMLTextAreaElement

      // 不阻止默认粘贴（先插入原文，用户体验不被网络/检测阻塞），
      // 下一宏任务读到插入后的值，检测回来再就地替换
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

          // 无论正则是否命中都记快照：AI 可能补出正则漏掉的实体。
          // 只保留最近一次粘贴；TTL 过后清掉，避免长期持有元素引用。
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

  // ---------- 站点挂件（控制面） ----------
  // 只挂顶层文档：粘贴监听需要 allFrames，但挂件出现在广告/嵌入 iframe 里只会制造噪音。
  // 所有样式内联 + Shadow DOM 隔离：既不依赖宿主页面 CSS，也不污染宿主页面。
  const mountSiteWidget = (): void => {
    const t = {
      ai: messages?.widget?.ai ?? 'AI enhancement',
      open: messages?.widget?.open ?? 'Open side panel',
      needAi: messages?.widget?.needAi ?? 'Enable AI in the side panel first',
      loading: messages?.widget?.loading ?? 'AI model is still loading',
      cost: messages?.widget?.cost ?? 'First paste may take 1–2s longer',
      hide: messages?.widget?.hide ?? 'Hide this widget'
    }

    const ROOT_ID = 'context-watchdog-widget'
    if (document.getElementById(ROOT_ID)) return

    // 与 normalizeSiteInput 的输出同构；SW 会拿 sender.url 再算一遍做双校验
    const pattern = `${location.protocol}//${location.host}/*`
    let expanded = false
    let hidden = false
    let ready = false
    let globalEnabled = false
    let siteEnabled = false
    let hostReady = false

    const host = document.createElement('div')
    host.id = ROOT_ID
    Object.assign(host.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: '2147483647',
      display: 'none'
    })
    const shadow = host.attachShadow({ mode: 'closed' })

    const root = document.createElement('div')
    Object.assign(root.style, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      font: '13px/1.4 system-ui, -apple-system, sans-serif',
      color: '#f9fafb'
    })

    const panel = document.createElement('div')
    panel.id = 'cw-panel'
    Object.assign(panel.style, {
      width: '248px',
      marginBottom: '8px',
      padding: '12px',
      borderRadius: '12px',
      background: 'rgba(17, 24, 39, 0.96)',
      color: '#f9fafb',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.28)',
      display: 'none'
    })

    const fab = document.createElement('button')
    fab.type = 'button'
    fab.textContent = 'AI'
    fab.setAttribute('aria-label', 'ContextWatchdog')
    fab.setAttribute('aria-controls', 'cw-panel')
    fab.title = 'ContextWatchdog'
    Object.assign(fab.style, {
      width: '28px',
      height: '28px',
      padding: '0',
      borderRadius: '50%',
      border: 'none',
      background: 'rgba(17, 24, 39, 0.92)',
      color: '#fff',
      font: '600 10px/1 system-ui, -apple-system, sans-serif',
      letterSpacing: '0.02em',
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)'
    })
    fab.addEventListener('click', () => {
      expanded = !expanded
      render()
    })

    root.append(panel, fab)
    shadow.appendChild(root)
    document.documentElement.appendChild(host)

    // 失败关闭：未授权 / SW 不可用时不展示一个不能用的 UI
    const unmount = (): void => {
      hidden = true
      root.remove()
      host.remove()
    }

    const send = (message: unknown, done?: (response: unknown) => void): void => {
      chrome.runtime.sendMessage(message, response => {
        if (chrome.runtime.lastError) {
          done?.(undefined)
          return
        }
        done?.(response)
      })
    }

    function disabledReason(): string {
      if (!ready) return ''
      if (!globalEnabled) return t.needAi
      if (!hostReady) return t.loading
      return ''
    }

    function render(): void {
      panel.replaceChildren()
      panel.style.display = expanded ? 'block' : 'none'
      fab.setAttribute('aria-expanded', String(expanded))

      const header = document.createElement('div')
      Object.assign(header.style, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '8px'
      })
      const title = document.createElement('span')
      title.textContent = 'ContextWatchdog'
      Object.assign(title.style, { fontWeight: '600', fontSize: '12px', opacity: '0.92' })
      const hideButton = document.createElement('button')
      hideButton.type = 'button'
      hideButton.textContent = '×'
      hideButton.setAttribute('aria-label', t.hide)
      hideButton.title = t.hide
      Object.assign(hideButton.style, {
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        fontSize: '16px',
        lineHeight: '1',
        padding: '0 2px',
        opacity: '0.7'
      })
      hideButton.addEventListener('click', event => {
        event.stopPropagation()
        send({ type: 'SITE_WIDGET_HIDE', pattern })
        unmount()
      })
      header.append(title, hideButton)

      const row = document.createElement('div')
      Object.assign(row.style, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '10px'
      })
      const label = document.createElement('span')
      label.textContent = t.ai
      Object.assign(label.style, { fontSize: '13px' })

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
        background: siteEnabled ? '#6366f1' : 'rgba(255, 255, 255, 0.28)',
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
        transition: 'left 0.15s ease'
      })
      toggle.appendChild(knob)
      toggle.addEventListener('click', () => {
        if (disabled) return
        const next = !siteEnabled
        siteEnabled = next
        render()
        send({ type: 'SITE_AI_SET', pattern, enabled: next }, response => {
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
        margin: '6px 0 10px',
        fontSize: '11px',
        lineHeight: '1.45',
        color: reason ? '#fbbf24' : 'rgba(249, 250, 251, 0.62)'
      })

      const openButton = document.createElement('button')
      openButton.type = 'button'
      openButton.textContent = t.open
      Object.assign(openButton.style, {
        width: '100%',
        padding: '7px 10px',
        borderRadius: '8px',
        border: '1px solid rgba(255, 255, 255, 0.18)',
        background: 'rgba(255, 255, 255, 0.06)',
        color: '#f9fafb',
        font: 'inherit',
        cursor: 'pointer'
      })
      openButton.addEventListener('click', () => {
        send({ type: 'OPEN_SIDE_PANEL' })
      })

      panel.append(header, row, hint, openButton)
    }

    render()

    send({ type: 'SITE_AI_GET', pattern }, response => {
      const result = response as
        | {
            ok?: boolean
            state?: {
              globalEnabled?: boolean
              siteEnabled?: boolean
              hostReady?: boolean
              widgetHidden?: boolean
            }
          }
        | undefined
      if (!result?.ok || !result.state) {
        unmount()
        return
      }
      if (result.state.widgetHidden) {
        unmount()
        return
      }

      globalEnabled = result.state.globalEnabled === true
      siteEnabled = result.state.siteEnabled === true
      hostReady = result.state.hostReady === true
      ready = true
      host.style.display = 'block'
      render()

      // SPA 重渲染 / 站点脚本清理 DOM 时自动重挂（只监听自身是否还在 document 里）
      const observer = new MutationObserver(() => {
        if (hidden) return
        if (!document.documentElement.contains(host)) document.documentElement.appendChild(host)
      })
      observer.observe(document.documentElement, { childList: true })
    })
  }

  if (window.top === window) {
    if (document.documentElement) mountSiteWidget()
    else document.addEventListener('DOMContentLoaded', mountSiteWidget, { once: true })
  }
}
