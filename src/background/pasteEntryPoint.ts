// 注入到页面的粘贴监听器
//
// chrome.scripting.executeScript({ func }) 会把函数序列化后在页面的扩展隔离世界里执行，
// 因此该函数必须自包含：不能引用任何模块作用域的标识符（import 的常量/函数都会 ReferenceError）。
//
// 规则与守卫逻辑的可测版本见 src/content/pasteText.ts（有单测），改动需两边同步；
// 消息类型常量见 src/core/messages.ts。
export const pasteGuardEntryPoint = (): void => {
  const globalRef = window as unknown as Record<string, unknown>
  if (globalRef.__pasteGuardInstalled) return
  globalRef.__pasteGuardInstalled = true

  // 只处理单行/多行文本输入；password 的值绝不外发（双保险，下面还有类型判断）
  const isTextEditable = (el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement => {
    if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly
    if (el instanceof HTMLInputElement) {
      if (el.disabled || el.readOnly) return false
      return el.type === 'text' || el.type === 'search'
    }
    return false
  }

  // capture 阶段注册：即便页面自己 stopPropagation 也能收到
  document.addEventListener(
    'paste',
    (event: ClipboardEvent) => {
      const el = event.target
      if (!isTextEditable(el)) return
      const pasted = event.clipboardData?.getData('text/plain') ?? ''
      if (!pasted) return

      // 不阻止默认粘贴（先插入原文，用户体验不被网络/检测阻塞），
      // 下一宏任务读到插入后的值，检测回来再就地替换
      setTimeout(() => {
        const value = el.value
        const caret = el.selectionStart ?? value.length
        const start = caret - pasted.length
        // 插入文本必须与剪贴板逐字吻合：站点改写/IME/并发输入都会破坏该前提 → 放弃改写
        if (start < 0 || value.slice(start, caret) !== pasted) return

        chrome.runtime.sendMessage({ type: 'PASTE_DETECT', text: pasted }, response => {
          if (chrome.runtime.lastError) return // SW 未响应（如刚被回收）→ 保留原文
          const result = response as { ok?: boolean; sanitized?: string; count?: number } | undefined
          if (!result?.ok || typeof result.sanitized !== 'string') return
          if (result.sanitized === pasted) return // 未检出敏感内容
          if (el.value !== value) return // 用户在检测期间继续输入 → 放弃，避免覆盖新内容

          el.value = value.slice(0, start) + result.sanitized + value.slice(caret)
          const nextCaret = start + result.sanitized.length
          el.selectionStart = nextCaret
          el.selectionEnd = nextCaret
          // 让框架（Vue/React 受控输入）感知到值的变化
          el.dispatchEvent(new Event('input', { bubbles: true }))
          console.log('[PasteGuard] 粘贴已就地脱敏', result.count ?? 0, '处')
        })
      }, 0)
    },
    true
  )
}
