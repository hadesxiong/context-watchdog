// offscreen 模型宿主的协议：SW ── Port「pg-model-host」── offscreen 文档。用 Port 而非 runtime.sendMessage：
// sendMessage 是广播，SW/侧栏/offscreen 谁先回、回给谁都不确定，Port 点对点 SW 才能当唯一路由器；token 用于
// 对上同一请求（ENSURE 分钟级与 DETECT 秒级同 Port 并存）；DETECT 回包带 items 供侧栏渲染，粘贴只用 sanitized。

import type { DetectionItem, ProfileConfig } from '@engine/types'
import type { ModelHostState } from './state'

/** 端口名。offscreen 启动即连，SW 重启后由宿主侧重连。 */
export const MODEL_HOST_PORT = 'pg-model-host'

/** offscreen 文档地址（相对扩展根，与 vite 产物布局一致） */
export const MODEL_HOST_URL = 'src/offscreen/index.html'

/** 宿主持有的状态写在 storage.session 的这个键下（面板订阅它） */
export const MODEL_HOST_STATE_KEY = 'contextwatchdog.modelHost'

export type ModelHostOp = 'PING' | 'ENSURE' | 'DETECT'

export interface ModelHostPingRequest {
  op: 'PING'
  token: string
}

/** 幂等加载模型。加载可能持续数分钟（首次要下 183MB），因此**没有超时**。 */
export interface ModelHostEnsureRequest {
  op: 'ENSURE'
  token: string
}

export interface ModelHostDetectRequest {
  op: 'DETECT'
  token: string
  text: string
  /** 缺省 = 引擎的默认档案（与 detect() 的默认行为一致） */
  profile?: ProfileConfig
}

export type ModelHostRequest = ModelHostPingRequest | ModelHostEnsureRequest | ModelHostDetectRequest

/**
 * 宿主 → SW 的状态通知（**不是**请求：没有 token、不回包）。
 * offscreen 文档**只暴露 chrome.runtime**（chrome.storage / chrome.i18n 均 undefined，
 * 见 docs/site-ai-offscreen-host.md §3.1），自己写不了 storage.session，只能 SW 代写。
 */
export interface ModelHostNotice {
  op: 'STATUS'
  state: ModelHostState
}

/**
 * 回包。字段可选而非判别联合：负载都很小，共用一种形状可省掉泛型体操；
 * 真正需要区分的只有 ok / ready / items。
 */
export interface ModelHostReply {
  token: string
  ok: boolean
  /** 模型当前是否就绪（DETECT 未就绪时 ok=false + error='model-not-ready'） */
  ready?: boolean
  sanitized?: string
  count?: number
  items?: DetectionItem[]
  error?: string
}

// ---------- SW ↔ 扩展页面（侧栏 / 调试）的运行时消息 ----------
// 不属于宿主协议，而是**外部入口**：侧栏经它们请求加载/检测，调试时也可在控制台驱动。

export const MODEL_HOST_ENSURE = 'MODEL_HOST_ENSURE'
export const MODEL_HOST_DETECT = 'MODEL_HOST_DETECT'
export const MODEL_HOST_STATUS = 'MODEL_HOST_STATUS'
/** 关闭全局 AI：销毁 offscreen 文档，模型内存随之释放 */
export const MODEL_HOST_CLOSE = 'MODEL_HOST_CLOSE'

/**
 * 主动关闭宿主时在途请求的失败原因；SW 见到它不写 error 状态
 * ——否则「用户关掉 AI」会变成面板上的一条报错。
 */
export const MODEL_HOST_CLOSED_REASON = '模型宿主已关闭'

/**
 * MODEL_HOST_DETECT 的回包（SW → 侧栏）：ok=false 时调用方保留本地/正则结果，
 * 绝不把原文当脱敏结果。
 */
export interface ModelHostDetectResponse {
  ok: boolean
  sanitized?: string
  count?: number
  items?: DetectionItem[]
  error?: string
}

export interface ModelHostStatusResponse {
  supported: boolean
  /** storage.session 里的状态；宿主还没写过时为 null */
  state: unknown
}

/** 端口消息的类型守卫：对端是不可信输入（扩展内也可能被其他代码误发） */
export const isModelHostRequest = (value: unknown): value is ModelHostRequest => {
  if (!value || typeof value !== 'object') return false
  const request = value as { op?: unknown; token?: unknown }
  if (typeof request.token !== 'string' || request.token === '') return false
  return request.op === 'PING' || request.op === 'ENSURE' || request.op === 'DETECT'
}

export const isModelHostReply = (value: unknown): value is ModelHostReply => {
  if (!value || typeof value !== 'object') return false
  const reply = value as { token?: unknown; ok?: unknown }
  return typeof reply.token === 'string' && typeof reply.ok === 'boolean'
}

export const isModelHostNotice = (value: unknown): value is ModelHostNotice => {
  if (!value || typeof value !== 'object') return false
  const notice = value as { op?: unknown; state?: unknown }
  if (notice.op !== 'STATUS') return false
  const state = notice.state as { phase?: unknown } | null
  return !!state && typeof state === 'object' && typeof state.phase === 'string'
}
