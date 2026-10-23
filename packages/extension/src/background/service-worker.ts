// Service Worker
// 职责：
// 1) 点击扩展图标打开侧栏：Chrome/Edge 走 sidePanel，Firefox 走 sidebar_action（同一面板页面）
// 2) 粘贴自动拦截的检测服务：content script 把粘贴文本发到这里跑检测管线并回传脱敏结果
//    （GLiNER 模型仍然不在 SW 里加载——SW 无法加载 WASM，且会被随时终止）
// 3) 受保护站点的按需注入：只有用户授权过的站点才注入粘贴监听，未授权站点零接触
// 4) 模型宿主的路由：offscreen 文档持有唯一一份模型运行时（Chrome/Edge），
//    本文件只负责创建/销毁文档并转发 ENSURE / DETECT（见 src/modelHost/client.ts）
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
// 挂件内嵌 mark 的唯一来源：注入函数在隔离世界里读不到模块也读不到扩展资源，
// 由 SW 在构建期把 logo.svg 原文读进来（?raw）随 args 递过去；
// 染色（跟随页面明暗主题）在注入侧做，SW 只管原文。
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

// 占位符语言：SW 里拿不到 localStorage（侧栏的界面语言偏好存在那儿），
// 只能按浏览器语言定。用户显式改过界面语言时两者可能不同——
// 影响仅限于「粘贴拦截走 SW 检测」这条路生成的占位符用词。
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

  // Firefox：manifest 的 sidebar_action 打开同一面板页面。
  // sidebarAction.open() 需要用户手势，点击扩展图标这一事件即满足
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

// 从消息 sender 推导站点条目：只认 sender.url（浏览器给的，伪造不了），
// 在用户的授权列表里找出命中的最具体条目。消息内容一律不信——以前要求页面
// 上报 pattern 做「双校验」，但带路径的条目页面根本算不出来，索性不传了。
const authorizedSitePattern = async (sender: chrome.runtime.MessageSender): Promise<string | null> => {
  if (!sender.url) return null
  const sites = await readProtectedSites()
  return matchedSitePattern(sender.url, sites)
}

// 宿主是否就绪：Chrome/Edge 看 session 状态；Firefox 的 LocalHost 在侧栏里，
// SW 观测不到，按可用处理（数据面自行降级，不把开关锁死）。
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

// 面板开合的权威查询在 ./panelState（「存在即打开」语义、getContexts 复数 filter 的
// ⑮坑、Firefox 无 getContexts 时的 isOpen + 弹窗自追踪都在那边），这里只取结果。

// 把侧栏开/关的真实状态推给挂件（顶层文档才有挂件）。
// 这是 onOpened/onClosed 原生事件的落点：外部关掉侧栏时由浏览器主动通知，
// 不必等挂件的下一次轮询。
// 侧栏绑定在某个标签页上（sidePanel.open({tabId}) 打开的）时精准推给它；用户从
// 工具栏图标打开的全局侧栏，onOpened/onClosed 的 info.tabId 是 undefined——此时
// 不能一丢了之（挂件按钮会永远停在旧状态），广播到所有标签页补上：未授权站点
// 没有挂件，sendMessage reject 静默吞掉即可，有挂件的授权站点才会更新。
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

// 原生实时推送（Chrome 141+ onOpened / 142+ onClosed）：叠加在挂件轮询之上，
// 把「别处关掉侧栏 → 按钮复位」的延迟从最坏一个轮询周期压到即时。
// 旧版浏览器没有这两个事件，注册处用特性检测跳过，轮询照常兜底。
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
  // 文案在 SW 侧取好再传进去：注入函数在页面的隔离世界里执行，引用不到模块，
  // 而 chrome.i18n 读的正是 postbuild 从同一份 catalog 生成的 _locales。
  // 兜底用英文（default_locale），免得 _locales 缺失时只显示一个数字。
  const toastRedacted = chrome.i18n.getMessage('paste_toast_redacted') || '{count} redacted'
  const toastAi = chrome.i18n.getMessage('paste_toast_ai') || '{count} redacted with AI'
  // 打开按钮的文案按宿主选键：Chrome/Edge 点了直达真侧栏，说「侧栏」；Firefox 的
  // 手势死路（MDN User actions：页面 content script 消息不算手势）决定点击必然走
  // 弹窗兜底，文案必须说「面板」——⑱ 挂件按钮文案缺陷的根治处。
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

// 站点列表变化 → 刷新缓存并对已打开页面注入（移除站点时停止注入由页面重载自然生效，
// 已注入的监听不会自动卸载，但只在有权限的站点上才会收到消息）
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

// 页面导航/重载时按需注入（无需在 manifest 声明 content_scripts，
// 因此未授权站点完全不接触）
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading') return
  const url = tab.url ?? changeInfo.url
  if (!url || !matchSite(url, protectedPatterns)) return
  injectContextWatchdog(tabId)
})

// ---------- 检测服务 ----------

// 正则回包之后的 AI 增量：仅当本站 AI 生效时，向宿主要一份完整结果再回传。
// 任何失败都只打日志——正则结果已经落地，AI 失败不能影响首答。
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
    // 侧栏选中的档案随请求带来，缺省退回「不限」。detect 与脱敏必须用同一份档案，
    // 否则识别判据（规则/阈值）与替换策略（keep/replace）会各说各话。
    const profile = request.profile ?? getProfileById(DEFAULT_PROFILE_ID)
    // SW 恒走正则档（模型在 offscreen 里，S3 在回包后把 AI 结果补发回来）——
    // 正则基础引擎恒开，无需任何开关配置
    detect(text, profile)
      .then(result => {
        // 按档案默认策略脱敏：判定为「保留」的项（如不限档的邮箱/高熵/IP）原样留下。
        // 不能用 sanitizeText 无条件替换全部——那会把「保留」也一并脱敏掉。
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

  // ---------- 站点挂件（控制面） ----------
  // 一律以 sender.url 在用户的授权列表里解析条目：页面隔离世界里的消息内容不可信。
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
      // 预热：宿主可能已随上次会话收掉（浏览器重启 / 关过面板），而模型文件早在
      // 本地——页面一开就把它叫起来，几秒后 ready，挂件的轮询会自己翻到可用。
      // 不预热的话，开关明明是开的却一直显示"尚未就绪"，首段粘贴也拿不到 AI。
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
    // 同步发车：sidePanel.open() 只认「用户手势」，而手势在本监听器返回后的第一个
    // 异步任务就过期了（实测报 "may only be called in response to a user gesture"，
    // 表现为按钮点了没反应）。授权校验并行进行，只决定回包内容——能触发这条消息的
    // 只有我们自己注入的内容脚本，打开我们自己的面板不触碰任何站点数据。
    // Firefox 更死板：页面 content script 的消息**根本不算手势**（MDN User actions，
    // bug 1800401 维持该行为），这里必然 reject 走弹窗兜底——回包如实带 panelKind，
    // 挂件按「面板」文案显示，不许冒充侧栏（⑱ 文案缺陷）。
    const opened: Promise<unknown> =
      typeof sidePanel?.open === 'function' && typeof tabId === 'number'
        ? sidePanel.open({ tabId })
        : typeof sidebarAction?.open === 'function'
          ? Promise.resolve(sidebarAction.open())
          : Promise.reject(new Error('side panel api unavailable'))
    void (async () => {
      try {
        await opened
        // 主动推一次开态：不依赖 onOpened 是否到达（部分 Chrome 版本不触发、
        // 全局侧栏不带 tabId），确保「点开按钮 → 所有挂件同步为已打开」必然发生
        pushPanelState(tabId, true, 'sidebar')
        sendResponse({ ok: true, panelKind: 'sidebar' } satisfies SiteAiOpenPanelResponse)
        return
      } catch (error) {
        console.warn('[ContextWatchdog] 打开侧栏失败，退回弹窗面板:', error)
      }
      // 无侧栏 API（无头/旧版浏览器）、手势已失效、或 Firefox 的手势死路：
      // 同一份面板页面开成弹窗，按钮必须有反应
      try {
        const popup = await chrome.windows.create({
          url: chrome.runtime.getURL('src/sidepanel/index.html'),
          type: 'popup',
          width: 420,
          height: 640
        })
        // 记账给 readPanelState 探活：Firefox 的 isOpen 只认真侧栏，弹窗态的
        // 「开着」全靠这条（否则挂件下个轮询就把已打开翻回可点、重复点击叠窗）
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

  // 模型宿主入口：只接受扩展页面（侧栏 / offscreen / 调试页）。
  // 不能只看 sender.tab：侧栏被当成普通标签页打开时同样有 tab，而 content script
  // 的 url 是宿主页面。用扩展自身的 origin 判定最准确。
  const fromExtensionPage = sender.url?.startsWith(chrome.runtime.getURL('')) ?? false
  if (!fromExtensionPage) return undefined

  if (request?.type === MODEL_HOST_ENSURE) {
    // 立即回包：ENSURE 首次可能要下载 580MB，让消息通道挂着几分钟没有意义。
    // 进度与结果统一经 storage.session 呈现（宿主写，SW 代转）。
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

// offscreen 文档启动后会连上来（端口名见 protocol.ts）。SW 被回收重启时，
// 宿主的 onDisconnect 会触发重连——所以这里必须是幂等的：只登记端口，不做事。
chrome.runtime.onConnect.addListener(attachModelHostPort)
