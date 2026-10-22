// 侧栏开合状态的跨浏览器解析（Chrome 与 Firefox 两套 API）+ 弹窗兜底窗口的自追踪。
//
// 结构由三段事实决定（2026-10-22 Firefox 真机验收复盘，缺陷见 TODO/CHANGELOG ⑱）：
// 1) Chrome/Edge：runtime.getContexts 是唯一查询路径，filter 必须是**复数数组**形态
//    （documentUrls / contextTypes），单数写法会被运行时以 Unexpected property 抛错
//    （CHANGELOG ⑮ 的根因）。开/关事件 sidePanel.onOpened/onClosed 要 141/142+，
//    2s 轮询始终是兜底。
// 2) Firefox：既没有 getContexts，也没有任何侧栏开/关事件；但有 sidebarAction.isOpen()
//    （FF 59+）——按窗口查最上层窗口、不要求手势，语义正是「存在即打开」的对等物。
//    （只查最上层窗口是取舍：挂件所在页面必然是用户正看着的窗口，与 Chrome 分支
//    「别个窗口开着侧栏时本窗口也显示已打开」的既有取舍同一口径。）
// 3) Firefox 的 sidebarAction.open() 只认用户手势，而页面挂件 content script 发来的
//    消息**不算手势**（MDN User actions 明文，bug 1800401 维持该行为）→ 挂件在
//    Firefox 上必然走 windows.create 弹窗兜底。这个窗口是我们自己创建的：把 id 记进
//    storage.session，之后 windows.get 探活——基础 windows API 不需要 windows/tabs
//    权限（本 manifest 也没有这两个权限）；id 复用防线是顺手校验 type === 'popup'；
//    浏览器重启时 storage.session 与窗口一起消失，天然自洽；SW 被回收不影响
//    （storage.session 属扩展上下文，MV3 下跨 SW 存活）。
import type { PanelKind } from '@engine/messages'

/** 解析结果：undefined = 该宿主查不到任何状态（调用方按「没开」处理，语义不倒退） */
export type PanelState = { open: true; kind: PanelKind } | { open: false }

const PANEL_POPUP_WINDOW_KEY = 'contextwatchdog.panelPopupWindowId'

/** FF 构建 manifest 产出的 sidebar_action（Chrome 上整个对象不存在） */
export interface SidebarActionLike {
  open?: () => Promise<void> | void
  isOpen?: (details: Record<string, never>) => Promise<boolean> | boolean
}

const sidebarActionOf = (): SidebarActionLike | undefined =>
  (chrome as unknown as { sidebarAction?: SidebarActionLike }).sidebarAction

/**
 * 挂件「打开」按钮的 i18n 键按宿主选：Chrome/Edge 点了直达真侧栏，文案说侧栏；
 * Firefox 的手势死路决定了点开的必然是弹窗兜底面板，文案必须说「面板」不许撒谎。
 */
export const openButtonLabelKey = (hasSidePanel: boolean): string =>
  hasSidePanel ? 'site_widget_open' : 'site_widget_open_panel'

/** 弹窗兜底窗口记账（OPEN_SIDE_PANEL 成功走弹窗分支时调用）；记不上不阻断打开 */
export const trackPopupWindow = async (windowId: number): Promise<void> => {
  try {
    await chrome.storage.session.set({ [PANEL_POPUP_WINDOW_KEY]: windowId })
  } catch {
    // 只损失「弹窗态的关闭同步」，打开本身不受影响，下个轮询周期按未知处理
  }
}

/** 记账的弹窗窗口是否还活着；id 失效/类型不符/浏览器重启过都清账返回 false */
const trackedPopupAlive = async (): Promise<boolean> => {
  let id: unknown
  try {
    const stored = await chrome.storage.session.get(PANEL_POPUP_WINDOW_KEY)
    id = stored[PANEL_POPUP_WINDOW_KEY]
  } catch {
    return false // storage 读不了：按没开处理，下轮轮询自愈
  }
  if (typeof id !== 'number') return false
  try {
    const win = await chrome.windows.get(id)
    if (win?.type === 'popup') return true
  } catch {
    // windows.get 抛错 = 窗口已不在，落到下面清账
  }
  try {
    await chrome.storage.session.remove(PANEL_POPUP_WINDOW_KEY)
  } catch {
    // 清不掉只是下次多查一次，不影响判定
  }
  return false
}

/** 面板开合的权威查询：Chrome 走 getContexts（原路径零改动），Firefox 走 isOpen + 弹窗自追踪 */
export const readPanelState = async (): Promise<PanelState | undefined> => {
  // ---- Chrome / Edge（有 getContexts） ----
  const runtime = chrome.runtime as unknown as {
    getContexts?: (filter: Record<string, unknown>) => Promise<unknown[]>
  }
  if (typeof runtime.getContexts === 'function') {
    try {
      const panels = await runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })
      if (panels.length > 0) return { open: true, kind: 'sidebar' }
      // 无侧栏 API 时按钮退回的「弹窗面板」是 TAB context，按文档 URL 认：
      // 否则弹窗一开按钮又亮回可点，用户会连开好几个窗口
      const popups = await runtime.getContexts({
        contextTypes: ['TAB'],
        documentUrls: [chrome.runtime.getURL('src/sidepanel/index.html')]
      })
      if (popups.length > 0) return { open: true, kind: 'popup' }
      return { open: false }
    } catch {
      return undefined // 运行时抛错（旧版/字段不认识）= 未知，不冒充「没开」以外的结论
    }
  }

  // ---- Firefox（无 getContexts）：isOpen 真侧栏 + 弹窗自追踪 ----
  const action = sidebarActionOf()
  const sidebarKnown = typeof action?.isOpen === 'function'
  if (action?.isOpen) {
    try {
      if ((await action.isOpen({})) === true) return { open: true, kind: 'sidebar' }
    } catch {
      // 单次查询失败不整段作废：继续用弹窗自追踪收尾
    }
  }
  if (await trackedPopupAlive()) return { open: true, kind: 'popup' }
  // isOpen 可用且两头都没开 = 确定的「没开」；连 isOpen 都没有（极老宿主）= 未知
  return sidebarKnown ? { open: false } : undefined
}
