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
import { matchSite, readProtectedSites, PROTECTED_SITES_KEY } from '@engine/sites'
import { PASTE_DETECT, type PasteDetectResponse } from '@engine/messages'
import type { ProfileConfig } from '@engine/types'
import { contextWatchdogEntryPoint } from './pasteEntryPoint'
import {
  attachModelHostPort,
  detectViaModelHost,
  ensureModelHost,
  isModelHostSupported,
  readModelHostState
} from '@/modelHost/client'
import { MODEL_HOST_DETECT, MODEL_HOST_ENSURE, MODEL_HOST_STATUS } from '@/modelHost/protocol'

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

const injectContextWatchdog = (tabId: number): void => {
  // 文案在 SW 侧取好再传进去：注入函数在页面的隔离世界里执行，引用不到模块，
  // 而 chrome.i18n 读的正是 postbuild 从同一份 catalog 生成的 _locales。
  // 兜底用英文（default_locale），免得 _locales 缺失时只显示一个数字。
  const toastRedacted = chrome.i18n.getMessage('paste_toast_redacted') || '{count} redacted'
  chrome.scripting
    .executeScript({
      target: { tabId, allFrames: true },
      func: contextWatchdogEntryPoint,
      args: [{ toastRedacted }]
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
    void readProtectedSites().then(sites => {
      protectedPatterns = sites
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

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const request = message as { type?: string; text?: string; profile?: ProfileConfig } | null

  if (request?.type === PASTE_DETECT) {
    if (typeof request.text !== 'string') return undefined

    const text = request.text.slice(0, MAX_PASTE_CHARS)
    // SW 恒走正则档（模型在 offscreen 里，S2 才把 AI 结果补发回来）—— 正则基础引擎恒开，
    // 无需任何开关配置
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

  // 模型宿主入口：只接受扩展页面（侧栏 / offscreen / 调试页）。
  // 不能只看 sender.tab：侧栏被当成普通标签页打开时同样有 tab，而 content script
  // 的 url 是宿主页面。用扩展自身的 origin 判定最准确。
  const fromExtensionPage = sender.url?.startsWith(chrome.runtime.getURL('')) ?? false
  if (!fromExtensionPage) return undefined

  if (request?.type === MODEL_HOST_ENSURE) {
    void ensureModelHost().then(sendResponse)
    return true
  }

  if (request?.type === MODEL_HOST_DETECT && typeof request.text === 'string') {
    void detectViaModelHost(request.text.slice(0, MAX_PASTE_CHARS), request.profile).then(result =>
      sendResponse(result ?? { ok: false, error: 'model-host-unavailable' })
    )
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
