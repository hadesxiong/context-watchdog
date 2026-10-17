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

  // capture 阶段注册：即便页面自己 stopPropagation 也能收到
  document.addEventListener(
    'paste',
    (event: ClipboardEvent) => {
      const el = event.target
      if (!isTextEditable(el)) return
      // 换行归一化：textarea.value 按规范把 \r\n/\r 归一化为 \n，而剪贴板原始文本
      //（尤其 Windows）常带 \r\n——不归一化则多行粘贴的逐字校验必然失配，整条链路静默失效
      const pasted = (event.clipboardData?.getData('text/plain') ?? '').replace(/\r\n?/g, '\n')
      if (!pasted) return

      // 不阻止默认粘贴（先插入原文，用户体验不被网络/检测阻塞），
      // 下一宏任务读到插入后的值，检测回来再就地替换
      setTimeout(() => {
        const value = el.value
        const caret = el.selectionStart ?? value.length
        const start = caret - pasted.length
        // 插入文本必须与剪贴板逐字吻合：站点改写/IME/并发输入都会破坏该前提 → 放弃改写
        if (start < 0 || value.slice(start, caret) !== pasted) {
          console.log('[PasteGuard] 放弃改写：插入文本与剪贴板不吻合（站点改写/并发输入）')
          return
        }

        chrome.runtime.sendMessage({ type: 'PASTE_DETECT', text: pasted }, response => {
          if (chrome.runtime.lastError) {
            console.log('[PasteGuard] 放弃改写：消息发送失败（SW 未响应）:', chrome.runtime.lastError.message)
            return
          }
          const result = response as { ok?: boolean; sanitized?: string; count?: number } | undefined
          if (!result?.ok || typeof result.sanitized !== 'string') {
            console.log('[PasteGuard] 放弃改写：检测服务返回异常:', result)
            return
          }
          if (result.sanitized === pasted) return // 未检出敏感内容（正常路径，不打日志避免噪音）
          if (el.value !== value) {
            console.log('[PasteGuard] 放弃改写：用户在检测期间继续输入')
            return
          }

          setNativeValue(el, value.slice(0, start) + result.sanitized + value.slice(caret))
          const nextCaret = start + result.sanitized.length
          el.selectionStart = nextCaret
          el.selectionEnd = nextCaret
          console.log('[PasteGuard] 粘贴已就地脱敏', result.count ?? 0, '处')
        })
      }, 0)
    },
    true
  )
}
