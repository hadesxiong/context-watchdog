// Service Worker
// 职责：
// 1) 点击扩展图标打开侧栏：Chrome/Edge 走 sidePanel，Firefox 走 sidebar_action（同一面板页面）
// 2) 粘贴自动拦截的检测服务：content script 把粘贴文本发到这里跑检测管线并回传脱敏结果
//    （GLiNER 模型仍然不在 SW 里加载——SW 无法加载 WASM，且会被随时终止）
// 3) 受保护站点的按需注入：只有用户授权过的站点才注入粘贴监听，未授权站点零接触
// 4) 模型宿主的路由：offscreen 文档持有唯一一份模型运行时（Chrome/Edge），
//    本文件只负责创建/销毁文档并转发 ENSURE / DETECT（见 src/modelHost/client.ts）
import { detect } from '@engine/detector'
import { sanitizeText } from '@engine/replacer'
import { setPlaceholderLocale } from '@engine/replacer/placeholder'
import { matchSite, readProtectedSites, sitePatternFromUrl, PROTECTED_SITES_KEY } from '@engine/sites'
import {
  OPEN_SIDE_PANEL,
  PASTE_AI_RESULT,
  PASTE_DETECT,
  SITE_AI_GET,
  SITE_AI_SET,
  type PasteAiResult,
  type PasteDetectResponse,
  type SiteAiGetResponse,
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
// 挂件内嵌 mark 的唯一来源：注入函数在隔离世界里读不到模块也读不到扩展资源，
// 由 SW 在构建期把 logo.svg 原文读进来（?raw），运行染白后随 args 递过去。
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
}

interface SidebarActionLike {
  open?: () => Promise<void> | void
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

// 从消息 sender 推导站点模式，并要求：① 与消息里上报的 pattern 一致；
// ② 在用户的授权列表里。页面隔离世界里的消息内容不可信，只有 sender.url 是浏览器给的。
const authorizedSitePattern = async (
  sender: chrome.runtime.MessageSender,
  claimed: unknown
): Promise<string | null> => {
  const actual = sitePatternFromUrl(sender.url)
  if (!actual) return null
  if (typeof claimed !== 'string' || claimed !== actual) return null
  const sites = await readProtectedSites()
  return sites.includes(actual) ? actual : null
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
  const widget = {
    ai: chrome.i18n.getMessage('site_widget_ai') || 'AI enhancement',
    open: chrome.i18n.getMessage('site_widget_open') || 'Open side panel',
    needAi: chrome.i18n.getMessage('site_widget_need_ai') || 'Enable AI in the side panel first',
    loading: chrome.i18n.getMessage('site_widget_loading') || 'AI model is still loading',
    cost: chrome.i18n.getMessage('site_widget_cost') || 'The first paste may take 1–2s longer',
    collapse: chrome.i18n.getMessage('site_widget_collapse') || 'Collapse'
  }
  // 挂件底色是深色，mark 染白后在收起的圆形按钮与展开面板的头部都能看清
  const mark = logoMarkSvg.replace(/#18181b/g, '#fff')
  chrome.scripting
    .executeScript({
      target: { tabId, allFrames: true },
      func: contextWatchdogEntryPoint,
      args: [{ toastRedacted, toastAi, widget, mark }]
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
  if (typeof tabId !== 'number') return
  const pattern = sitePatternFromUrl(sender.url)
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
    pattern?: unknown
    enabled?: unknown
  } | null

  if (request?.type === PASTE_DETECT) {
    if (typeof request.text !== 'string') return undefined

    const text = request.text.slice(0, MAX_PASTE_CHARS)
    const token =
      typeof request.token === 'string' && request.token.length <= 128 ? request.token : undefined
    // SW 恒走正则档（模型在 offscreen 里，S3 在回包后把 AI 结果补发回来）——
    // 正则基础引擎恒开，无需任何开关配置
    detect(text)
      .then(result => {
        // sanitizeText 是纯函数（局部 MappingManager），SW 内无状态依赖
        const { sanitizedText } = sanitizeText(result.text, result.items)
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
  // 一律先双校验 sender.url 与上报的 pattern：页面隔离世界里的消息内容不可信。
  if (request?.type === SITE_AI_GET) {
    void (async () => {
      const pattern = await authorizedSitePattern(sender, request.pattern)
      if (!pattern) {
        sendResponse({ ok: false, error: 'unauthorized' } satisfies SiteAiGetResponse)
        return
      }
      const [globalStore, siteMap, hostReady] = await Promise.all([
        chrome.storage.local.get(AI_ENABLED_KEY),
        readBooleanMap(SITE_AI_ENABLED_KEY),
        readHostReady()
      ])
      const state: SiteAiState = {
        pattern,
        globalEnabled: globalStore[AI_ENABLED_KEY] === true,
        siteEnabled: siteMap[pattern] === true,
        hostReady
      }
      sendResponse({ ok: true, state } satisfies SiteAiGetResponse)
    })()
    return true
  }

  if (request?.type === SITE_AI_SET) {
    void (async () => {
      const pattern = await authorizedSitePattern(sender, request.pattern)
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
    void (async () => {
      const authorized = await authorizedSitePattern(sender, sitePatternFromUrl(sender.url))
      if (!authorized) {
        sendResponse({ ok: false, error: 'unauthorized' } satisfies SiteAiSetResponse)
        return
      }
      const sidePanel = (chrome as unknown as { sidePanel?: SidePanelLike }).sidePanel
      const sidebarAction = (chrome as unknown as { sidebarAction?: SidebarActionLike }).sidebarAction
      try {
        if (typeof sidePanel?.open === 'function' && typeof sender.tab?.id === 'number') {
          await sidePanel.open({ tabId: sender.tab.id })
        } else {
          await sidebarAction?.open?.()
        }
        sendResponse({ ok: true } satisfies SiteAiSetResponse)
      } catch (error) {
        console.warn('[ContextWatchdog] 从挂件打开侧栏失败:', error)
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        } satisfies SiteAiSetResponse)
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
    // 立即回包：ENSURE 首次可能要下载 183MB，让消息通道挂着几分钟没有意义。
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
