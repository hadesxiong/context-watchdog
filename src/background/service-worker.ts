// Service Worker
// 职责：
// 1) 点击扩展图标打开侧栏（sidePanel）
// 2) 粘贴自动拦截的检测服务：content script 把粘贴文本发到这里跑检测管线并回传脱敏结果
//    （GLiNER 模型不会在 SW 中加载——isContentModelReady() 按上下文判定，自动走正则档）
// 3) 受保护站点的按需注入：只有用户授权过的站点才注入粘贴监听，未授权站点零接触
import { detect } from '../core/detector'
import { sanitizeText } from '../core/replacer'
import { matchSite, readProtectedSites, PROTECTED_SITES_KEY } from '../core/sites'
import { PASTE_DETECT, type PasteDetectResponse } from '../core/messages'
import { pasteGuardEntryPoint } from './pasteEntryPoint'

chrome.runtime.onInstalled.addListener(() => {
  console.log('[PasteGuard] installed')
})

// 单次粘贴送检的字符上限：超长文本多半不是「粘贴一段配置」，直接放行避免拖垮 SW
const MAX_PASTE_CHARS = 20000

// ---------- 侧栏入口（Chrome / Firefox 共用） ----------

interface SidePanelLike {
  open?: (options: { tabId: number }) => Promise<void>
}

chrome.action.onClicked.addListener(async tab => {
  const sidePanel = (chrome as unknown as { sidePanel?: SidePanelLike }).sidePanel
  if (typeof sidePanel?.open === 'function' && typeof tab.id === 'number') {
    try {
      await sidePanel.open({ tabId: tab.id })
      return
    } catch (error) {
      console.warn('[PasteGuard] sidePanel.open 失败:', error)
    }
  }
})

// ---------- 粘贴自动拦截：受保护站点注入 ----------

let protectedPatterns: string[] = []

const injectPasteGuard = (tabId: number): void => {
  chrome.scripting
    .executeScript({ target: { tabId, allFrames: true }, func: pasteGuardEntryPoint })
    .catch(error => console.warn('[PasteGuard] 注入粘贴监听失败:', error))
}

// 对已打开的匹配标签页立即注入（新增站点即生效，无需等刷新）
const injectIntoOpenTabs = async (): Promise<void> => {
  const tabs = await chrome.tabs.query({})
  for (const tab of tabs) {
    if (typeof tab.id !== 'number' || !tab.url) continue
    if (matchSite(tab.url, protectedPatterns)) injectPasteGuard(tab.id)
  }
}

// 站点列表变化 → 刷新缓存并对已打开页面注入（移除站点时停止注入由页面重载自然生效，
// 已注入的监听不会自动卸载，但只在有权限的站点上才会收到消息）
void readProtectedSites().then(sites => {
  protectedPatterns = sites
})

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[PROTECTED_SITES_KEY]) return
  void readProtectedSites().then(sites => {
    protectedPatterns = sites
    return injectIntoOpenTabs()
  })
})

// 页面导航/重载时按需注入（无需在 manifest 声明 content_scripts，
// 因此未授权站点完全不接触）
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading') return
  const url = tab.url ?? changeInfo.url
  if (!url || !matchSite(url, protectedPatterns)) return
  injectPasteGuard(tabId)
})

// ---------- 检测服务 ----------

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const request = message as { type?: string; text?: string } | null
  if (request?.type !== PASTE_DETECT || typeof request.text !== 'string') return undefined

  const text = request.text.slice(0, MAX_PASTE_CHARS)
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
})
