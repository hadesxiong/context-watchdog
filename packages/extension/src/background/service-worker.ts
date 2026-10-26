// Service Worker：侧栏入口、粘贴检测、受保护站点按需注入、模型宿主路由。
// 模型不在 SW 里跑（无法加载 WASM 且随时被终止）：offscreen 持有唯一运行时，本文件只创建/销毁文档并转发 ENSURE / DETECT（见 modelHost/client.ts）。
import { detect } from '@engine/detector'
import { getProfileById, DEFAULT_PROFILE_ID } from '@engine/detector/profiles'
import { sanitizeWithProfile } from '@engine/replacer'
import { setPlaceholderLocale } from '@engine/replacer/placeholder'
import { matchSite, matchedSitePattern, readProtectedSites, PROTECTED_SITES_KEY } from '@engine/sites'
import {
  OPEN_SIDE_PANEL,
  PASTE_AI_RESULT,
  PASTE_DETECT,
  SITE_AI_GET,
  SITE_AI_PANEL_STATE,
  SITE_AI_SET,
  type PanelKind,
  type PasteAiResult,
  type PasteDetectResponse,
  type SiteAiGetResponse,
  type SiteAiOpenPanelResponse,
  type SiteAiPanelStatePush,
  type SiteAiSetResponse,
  type SiteAiState
} from '@engine/messages'
import {
  AI_ENABLED_KEY,
  SITE_AI_ENABLED_KEY,
  isEffectiveAI,
  readBooleanMap
} from '@engine/settings'
import type { ProfileConfig } from '@engine/types'
import { contextWatchdogEntryPoint } from './pasteEntryPoint'
import {
  openButtonLabelKey,
  readPanelState,
  trackPopupWindow,
  type SidebarActionLike
} from './panelState'
// 挂件内嵌 mark 的唯一来源：注入函数读不到模块与扩展资源，SW 构建期读入 logo.svg 原文（?raw）随 args 递过去，染色在注入侧做。
import logoMarkSvg from '../../../../public/icons/logo.svg?raw'
import {
  attachModelHostPort,
  closeModelHost,
  detectViaModelHost,
  ensureModelHost,
  isModelHostSupported,
  readModelHostState
} from '@/modelHost/client'
import {
  MODEL_HOST_CLOSED_REASON,
  MODEL_HOST_CLOSE,
  MODEL_HOST_DETECT,
  MODEL_HOST_ENSURE,
  MODEL_HOST_STATE_KEY,
  MODEL_HOST_STATUS,
  type ModelHostDetectResponse
} from '@/modelHost/protocol'
import { initialModelHostState, withError } from '@/modelHost/state'

// 占位符语言：SW 拿不到 localStorage（界面语言偏好在那儿），只能按浏览器语言定；与用户显式选的可能不同，仅影响粘贴拦截一路的占位符用词。
setPlaceholderLocale(chrome.i18n.getUILanguage().toLowerCase().startsWith('zh') ? 'zh_CN' : 'en')

chrome.runtime.onInstalled.addListener(() => {
  console.log('[ContextWatchdog] installed')
})

// 单次粘贴送检的字符上限：超长文本多半不是「粘贴一段配置」，直接放行避免拖垮 SW
const MAX_PASTE_CHARS = 20000

// ---------- 侧栏入口（Chrome / Firefox 共用） ----------

interface SidePanelLike {
  open?: (options: { tabId: number }) => Promise<void>
  /** Chrome 141+：侧栏打开的原生推送；旧版无此事件，靠挂件轮询兜底 */
  onOpened?: { addListener: (cb: (info: { tabId?: number }) => void) => void }
  /** Chrome 142+：侧栏关闭的原生推送；同上 */
  onClosed?: { addListener: (cb: (info: { tabId?: number }) => void) => void }
}

chrome.action.onClicked.addListener(async tab => {
  const sidePanel = (chrome as unknown as { sidePanel?: SidePanelLike }).sidePanel
  if (typeof sidePanel?.open === 'function' && typeof tab.id === 'number') {
    try {
      await sidePanel.open({ tabId: tab.id })
      return
    } catch (error) {
      console.warn('[ContextWatchdog] sidePanel.open 失败，回退 sidebarAction:', error)
    }
  }

  // Firefox：sidebar_action 打开同一面板页面；open() 需要用户手势，点击扩展图标即满足
  const sidebarAction = (chrome as unknown as { sidebarAction?: SidebarActionLike }).sidebarAction
  try {
    await sidebarAction?.open?.()
  } catch (error) {
    console.warn('[ContextWatchdog] 打开侧栏失败:', error)
  }
})

// ---------- 粘贴自动拦截：受保护站点注入 ----------

let protectedPatterns: string[] = []

// ---------- 站点挂件的授权与状态 ----------

// 站点条目只认 sender.url（浏览器给的，伪造不了），在授权列表里取命中的最具体条目；页面上报的消息内容一律不信。
const authorizedSitePattern = async (sender: chrome.runtime.MessageSender): Promise<string | null> => {
  if (!sender.url) return null
  const sites = await readProtectedSites()
  return matchedSitePattern(sender.url, sites)
}

// 宿主是否就绪：Chrome/Edge 看 session 状态；Firefox 的 LocalHost 在侧栏里、SW 观测不到，按可用处理
const readHostReady = async (): Promise<boolean> => {
  if (!isModelHostSupported()) return true
  try {
    const stored = await chrome.storage.session.get(MODEL_HOST_STATE_KEY)
    const state = stored[MODEL_HOST_STATE_KEY] as { phase?: string } | undefined
    return state?.phase === 'ready'
  } catch {
    return false
  }
}

// 面板开合的权威查询在 ./panelState（跨浏览器差异与坑都收在那里），这里只取结果。

// 把侧栏开/关的真实状态推给挂件（顶层文档才有挂件），onOpened/onClosed 的落点：绑定标签页时精准推；
// 全局侧栏没有 tabId → 广播所有标签页，未授权站点没挂件，reject 静默吞掉即可。
const pushPanelState = (
  tabId: number | undefined,
  panelOpen: boolean,
  panelKind?: PanelKind
): void => {
  const message: SiteAiPanelStatePush = {
    type: SITE_AI_PANEL_STATE,
    panelOpen,
    // 形态只在「开着」时带：关闭态挂件只认 panelOpen=false，kind 无意义
    ...(panelOpen && panelKind ? { panelKind } : {})
  }
  if (typeof tabId === 'number') {
    chrome.tabs.sendMessage(tabId, message, { frameId: 0 }).catch(() => undefined)
    return
  }
  chrome.tabs
    .query({})
    .then(tabs => {
      for (const tab of tabs) {
        if (typeof tab.id === 'number') {
          chrome.tabs.sendMessage(tab.id, message, { frameId: 0 }).catch(() => undefined)
        }
      }
    })
    .catch(() => undefined)
}

// 原生实时推送（Chrome 141+ onOpened / 142+ onClosed）叠加在挂件轮询之上；旧版无这两个事件，特性检测跳过，轮询兜底。
const sidePanelApi = (chrome as unknown as { sidePanel?: SidePanelLike }).sidePanel
sidePanelApi?.onOpened?.addListener?.(info => pushPanelState(info?.tabId, true, 'sidebar'))
sidePanelApi?.onClosed?.addListener?.(info => pushPanelState(info?.tabId, false))

// 本站 AI 是否生效：全局允许 ∧ 本站开启 ∧ 宿主就绪（三者缺一即退回正则档）
const isAiEffectiveForSite = async (pattern: string): Promise<boolean> => {
  const [globalStore, siteMap, hostReady] = await Promise.all([
    chrome.storage.local.get(AI_ENABLED_KEY),
    readBooleanMap(SITE_AI_ENABLED_KEY),
    readHostReady()
  ])
  return isEffectiveAI({
    globalEnabled: globalStore[AI_ENABLED_KEY] === true,
    siteEnabled: siteMap[pattern] === true,
    hostReady
  })
}

// 站点移除后清掉它的逐站配置，避免「删了再加回来还是开着」
const pruneSiteSettings = async (sites: string[]): Promise<void> => {
  const allowed = new Set(sites)
  const map = await readBooleanMap(SITE_AI_ENABLED_KEY)
  const next = Object.fromEntries(Object.entries(map).filter(([pattern]) => allowed.has(pattern)))
  if (Object.keys(next).length !== Object.keys(map).length) {
    await chrome.storage.local.set({ [SITE_AI_ENABLED_KEY]: next })
  }
}

const injectContextWatchdog = (tabId: number): void => {
  // 文案在 SW 侧取好经 args 传入（注入函数读不到模块）；chrome.i18n 读 postbuild 生成的 _locales，兜底用英文免得只显示一个数字。
  const toastRedacted = chrome.i18n.getMessage('paste_toast_redacted') || '{count} redacted'
  const toastAi = chrome.i18n.getMessage('paste_toast_ai') || '{count} redacted with AI'
  // 打开按钮文案按宿主选键：Firefox 手势死路（content script 消息不算手势，见 MDN User actions）决定点击必然走弹窗兜底，文案必须说「面板」。
  const hasSidePanel =
    typeof (chrome as unknown as { sidePanel?: SidePanelLike }).sidePanel?.open === 'function'
  const widget = {
    ai: chrome.i18n.getMessage('site_widget_ai') || 'AI enhancement',
    open: chrome.i18n.getMessage(openButtonLabelKey(hasSidePanel)) ||
      (hasSidePanel ? 'Open side panel' : 'Open panel'),
    opened: chrome.i18n.getMessage('site_widget_opened') || 'Side panel is open',
    openedPopup: chrome.i18n.getMessage('site_widget_opened_popup') || 'Panel is open',
    openFailed: chrome.i18n.getMessage('site_widget_open_failed') || 'Could not open the side panel',
    needAi: chrome.i18n.getMessage('site_widget_need_ai') || 'Enable AI in the side panel first',
    loading: chrome.i18n.getMessage('site_widget_loading') || 'AI model is still loading',
    preparing: chrome.i18n.getMessage('site_widget_preparing') || 'AI model is starting…',
    cost: chrome.i18n.getMessage('site_widget_cost') || 'The first paste may take 1–2s longer',
    collapse: chrome.i18n.getMessage('site_widget_collapse') || 'Collapse'
  }
  chrome.scripting
    .executeScript({
      target: { tabId, allFrames: true },
      func: contextWatchdogEntryPoint,
      args: [{ toastRedacted, toastAi, widget, mark: logoMarkSvg }]
    })
    .catch(error => console.warn('[ContextWatchdog] 注入粘贴监听失败:', error))
}

// 对已打开的匹配标签页立即注入（新增站点即生效，无需等刷新）
const injectIntoOpenTabs = async (): Promise<void> => {
  const tabs = await chrome.tabs.query({})
  for (const tab of tabs) {
    if (typeof tab.id !== 'number' || !tab.url) continue
    if (matchSite(tab.url, protectedPatterns)) injectContextWatchdog(tab.id)
  }
}

// 站点列表变化 → 刷新缓存并对已打开页面注入；已注入的监听不会自动卸载，停止注入由页面重载自然生效
void readProtectedSites().then(sites => {
  protectedPatterns = sites
})

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return
  if (changes[PROTECTED_SITES_KEY]) {
    void readProtectedSites().then(async sites => {
      protectedPatterns = sites
      await pruneSiteSettings(sites)
      return injectIntoOpenTabs()
    })
  }
})

// 页面导航/重载时按需注入（无需在 manifest 声明 content_scripts，未授权站点完全不接触）
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading') return
  const url = tab.url ?? changeInfo.url
  if (!url || !matchSite(url, protectedPatterns)) return
  injectContextWatchdog(tabId)
})

// ---------- 检测服务 ----------

// 正则回包后的 AI 增量：仅本站 AI 生效时才向宿主要一份完整结果；任何失败只打日志——正则结果已落地，AI 失败不能影响首答。
const upgradeWithAI = async (
  text: string,
  token: string,
  sender: chrome.runtime.MessageSender
): Promise<void> => {
  const tabId = sender.tab?.id
  if (typeof tabId !== 'number' || !sender.url) return
  // 逐站开关的键是用户列表里的条目（可能带路径），必须按条目查
  const pattern = matchedSitePattern(sender.url, await readProtectedSites())
  if (!pattern) return
  if (!(await isAiEffectiveForSite(pattern))) return

  const result = await detectViaModelHost(text)
  if (!result) {
    console.log('[ContextWatchdog] AI 二次升级跳过：宿主不可用')
    return
  }

  const message: PasteAiResult = {
    type: PASTE_AI_RESULT,
    token,
    sanitized: result.sanitized,
    count: result.count
  }
  try {
    await chrome.tabs.sendMessage(tabId, message, { frameId: sender.frameId ?? 0 })
  } catch (error) {
    // 页面已导航/关闭：丢弃这次升级即可
    console.log('[ContextWatchdog] AI 结果回传失败:', error)
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const request = message as {
    type?: string
    text?: string
    token?: unknown
    profile?: ProfileConfig
    enabled?: unknown
  } | null

  if (request?.type === PASTE_DETECT) {
    if (typeof request.text !== 'string') return undefined

    const text = request.text.slice(0, MAX_PASTE_CHARS)
    const token =
      typeof request.token === 'string' && request.token.length <= 128 ? request.token : undefined
    // 档案缺省退回「不限」；detect 与脱敏必须用同一份档案，否则识别判据与替换策略会各说各话
    const profile = request.profile ?? getProfileById(DEFAULT_PROFILE_ID)
    // SW 恒走正则档（模型在 offscreen，AI 结果回包后再补发）；正则基础引擎恒开，无需开关配置
    detect(text, profile)
      .then(result => {
        // 按档案默认策略脱敏：判定「保留」的项原样留下，不能用 sanitizeText 无条件替换全部
        const { sanitizedText } = sanitizeWithProfile(result.text, result.items, profile)
        const response: PasteDetectResponse = {
          ok: true,
          sanitized: sanitizedText,
          count: result.items.length
        }
        sendResponse(response)

        // 首答已发出：AI 是增量，不阻塞、不影响正则结果
        if (token) void upgradeWithAI(text, token, sender)
      })
      .catch((error: unknown) => {
        const response: PasteDetectResponse = {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        }
        sendResponse(response)
      })

    // 返回 true = 允许异步 sendResponse（否则 SW 在 listener 返回后即关闭响应通道）
    return true
  }

  // ---------- 站点挂件（控制面）：一律以 sender.url 解析授权条目，页面消息内容不可信 ----------
  if (request?.type === SITE_AI_GET) {
    void (async () => {
      const pattern = await authorizedSitePattern(sender)
      if (!pattern) {
        sendResponse({ ok: false, error: 'unauthorized' } satisfies SiteAiGetResponse)
        return
      }
      const [globalStore, siteMap, hostReady] = await Promise.all([
        chrome.storage.local.get(AI_ENABLED_KEY),
        readBooleanMap(SITE_AI_ENABLED_KEY),
        readHostReady()
      ])
      const globalEnabled = globalStore[AI_ENABLED_KEY] === true
      const siteEnabled = siteMap[pattern] === true
      // 预热：宿主可能已随上次会话收掉、而模型文件早在本地——页面一开就叫起来，否则开关开着却一直显示"尚未就绪"。
      if (globalEnabled && siteEnabled && !hostReady && isModelHostSupported()) {
        void ensureModelHost().catch(() => undefined)
      }
      const panel = await readPanelState()
      const state: SiteAiState = {
        pattern,
        globalEnabled,
        siteEnabled,
        hostReady,
        // 未知（undefined）与「没开」（false）在挂件侧等价：都按可点处理
        panelOpen: panel?.open,
        panelKind: panel?.open === true ? panel.kind : undefined
      }
      sendResponse({ ok: true, state } satisfies SiteAiGetResponse)
    })()
    return true
  }

  if (request?.type === SITE_AI_SET) {
    void (async () => {
      const pattern = await authorizedSitePattern(sender)
      if (!pattern) {
        sendResponse({ ok: false, error: 'unauthorized' } satisfies SiteAiSetResponse)
        return
      }
      const map = await readBooleanMap(SITE_AI_ENABLED_KEY)
      if (request.enabled === true) map[pattern] = true
      else delete map[pattern]
      await chrome.storage.local.set({ [SITE_AI_ENABLED_KEY]: map })
      sendResponse({ ok: true } satisfies SiteAiSetResponse)
    })()
    return true
  }

  if (request?.type === OPEN_SIDE_PANEL) {
    const tabId = sender.tab?.id
    const sidePanel = (chrome as unknown as { sidePanel?: SidePanelLike }).sidePanel
    const sidebarAction = (chrome as unknown as { sidebarAction?: SidebarActionLike }).sidebarAction
    // 同步发车：sidePanel.open() 只认「用户手势」，监听器返回后的第一个异步任务手势就过期（表现为按钮
    // 点了没反应）；Firefox 的 content script 消息不算手势（bug 1800401）→ 走弹窗兜底，回包如实带 panelKind。
    const opened: Promise<unknown> =
      typeof sidePanel?.open === 'function' && typeof tabId === 'number'
        ? sidePanel.open({ tabId })
        : typeof sidebarAction?.open === 'function'
          ? Promise.resolve(sidebarAction.open())
          : Promise.reject(new Error('side panel api unavailable'))
    void (async () => {
      try {
        await opened
        // 主动推一次开态：部分 Chrome 版本不触发 onOpened、全局侧栏不带 tabId，不能只依赖它
        pushPanelState(tabId, true, 'sidebar')
        sendResponse({ ok: true, panelKind: 'sidebar' } satisfies SiteAiOpenPanelResponse)
        return
      } catch (error) {
        console.warn('[ContextWatchdog] 打开侧栏失败，退回弹窗面板:', error)
      }
      // 无侧栏 API / 手势已失效 / Firefox 手势死路：同一份面板页面开成弹窗，按钮必须有反应
      try {
        const popup = await chrome.windows.create({
          url: chrome.runtime.getURL('src/sidepanel/index.html'),
          type: 'popup',
          width: 420,
          height: 640
        })
        // 记账给 readPanelState 探活：Firefox 的 isOpen 只认真侧栏，弹窗态的「开着」全靠这条
        if (typeof popup?.id === 'number') void trackPopupWindow(popup.id)
        // 弹窗也是开：同样广播，其他标签页的挂件一并切到已打开态
        pushPanelState(tabId, true, 'popup')
        sendResponse({ ok: true, panelKind: 'popup' } satisfies SiteAiOpenPanelResponse)
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        } satisfies SiteAiOpenPanelResponse)
      }
    })()
    return true
  }

  // 模型宿主入口只接受扩展页面（侧栏 / offscreen / 调试页）：不能只看 sender.tab（content script 的 url
  // 是宿主页面），用扩展自身 origin 判定最准。
  const fromExtensionPage = sender.url?.startsWith(chrome.runtime.getURL('')) ?? false
  if (!fromExtensionPage) return undefined

  if (request?.type === MODEL_HOST_ENSURE) {
      // 立即回包（ENSURE 首次要下 183MB，不能挂住消息通道几分钟）；进度与结果统一经 storage.session 呈现。
    void ensureModelHost().then(result => {
      if (!result.supported || result.ok) return
      // 用户主动关闭 AI：这是在途请求被取消，不是故障，不写 error 状态
      if (result.error === MODEL_HOST_CLOSED_REASON) return
      // 文档都没起来（或端口没连上）：写一条错误状态，别让侧栏一直转圈
      const state = withError(
        initialModelHostState(Date.now()),
        result.error ?? '模型宿主启动失败',
        Date.now()
      )
      void chrome.storage.session.set({ [MODEL_HOST_STATE_KEY]: state }).catch(() => undefined)
    })
    sendResponse({ ok: true, started: true })
    return false
  }

  if (request?.type === MODEL_HOST_DETECT && typeof request.text === 'string') {
    void detectViaModelHost(request.text.slice(0, MAX_PASTE_CHARS), request.profile).then(result => {
      const response: ModelHostDetectResponse = result
        ? { ok: true, sanitized: result.sanitized, count: result.count, items: result.items }
        : { ok: false, error: 'model-host-unavailable' }
      sendResponse(response)
    })
    return true
  }

  if (request?.type === MODEL_HOST_CLOSE) {
    void closeModelHost().then(() => sendResponse({ ok: true }))
    return true
  }

  if (request?.type === MODEL_HOST_STATUS) {
    void readModelHostState().then(state => sendResponse({ supported: isModelHostSupported(), state }))
    return true
  }

  return undefined
})

// ---------- 模型宿主连接 ----------

// offscreen 启动即连上来（端口名见 protocol.ts）；SW 被回收重启时宿主会重连，故这里必须幂等——只登记端口，不做事。
chrome.runtime.onConnect.addListener(attachModelHostPort)
