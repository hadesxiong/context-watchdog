// 侧栏开合状态的跨浏览器解析（Chrome / Firefox 两套 API）+ 弹窗兜底窗口自追踪。Chrome/Edge：唯一查询
// 路径 runtime.getContexts（filter 必须复数数组，单数被抛错），开/关事件要 141/142+、2s 轮询兜底；
// Firefox 无 getContexts → sidebarAction.isOpen() + windows.create 弹窗兜底（open() 只认手势，bug 1800401），窗口 id 存 storage.session 供 windows.get 探活。
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

/** 挂件「打开」按钮的 i18n 键按宿主选：Chrome/Edge 说「侧栏」，Firefox 必然开弹窗兜底面板，说「面板」 */
export const openButtonLabelKey = (hasSidePanel: boolean): string =>
  hasSidePanel ? 'site_widget_open' : 'site_widget_open_panel'

/** 弹窗兜底窗口记账（OPEN_SIDE_PANEL 成功走弹窗分支时调用）；记不上不阻断打开 */
export const trackPopupWindow = async (windowId: number): Promise<void> => {
  try {
    await chrome.storage.session.set({ [PANEL_POPUP_WINDOW_KEY]: windowId })
  } catch {
    // 只损失弹窗态的关闭同步，下个轮询按未知处理
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
      // 无侧栏 API 时按钮退回的「弹窗面板」是 TAB context，按文档 URL 认——否则弹窗一开按钮又亮回可点
      const popups = await runtime.getContexts({
        contextTypes: ['TAB'],
        documentUrls: [chrome.runtime.getURL('src/sidepanel/index.html')]
      })
      if (popups.length > 0) return { open: true, kind: 'popup' }
      return { open: false }
    } catch {
      return undefined // 运行时抛错（旧版/字段不认识）= 未知，不冒充「没开」
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
