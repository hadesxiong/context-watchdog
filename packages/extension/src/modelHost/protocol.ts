// offscreen 模型宿主的协议。
//
// 谁在说话：
//   SW（service worker）  ── Port「pg-model-host」──  offscreen 文档
//
// 为什么用 Port 而不是 runtime.sendMessage：扩展里同时有 SW、侧栏、offscreen 三个
// 上下文，sendMessage 是广播，谁先回、回给谁都不确定（侧栏也可能顺手回一包）。
// Port 是点对点的，SW 因此能当唯一的路由器（设计文档 D3）。
//
// 为什么 token：一个 Port 上会同时挂着 ENSURE（可能跑几分钟）与 DETECT（秒级）。
// 回复必须能对上请求，否则 ENSURE 的进度回调会把 DETECT 的回复吃掉。
//
// 为什么 DETECT 要把 items 原样带回去：侧栏需要逐项渲染/改替换策略；粘贴路径只用
// sanitized。两条路复用同一个回包，避免"宿主算两遍"。

import type { DetectionItem, ProfileConfig } from '@engine/types'
import type { ModelHostState } from './state'

/** 端口名。offscreen 启动即连，SW 重启后由宿主侧重连。 */
export const MODEL_HOST_PORT = 'pg-model-host'

/** offscreen 文档地址（相对扩展根，与 vite 产物布局一致） */
export const MODEL_HOST_URL = 'src/offscreen/index.html'

/** 宿主持有的状态写在 storage.session 的这个键下（S2 面板订阅它） */
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
 * 宿主 → SW 的状态通知（**不是**请求，没有 token、不回包）。
 *
 * 为什么必须绕这一圈：offscreen 文档**只暴露 chrome.runtime**（实测：
 * chrome.storage / chrome.i18n 都是 undefined，见 docs/design/site-ai-offscreen-host.md），
 * 所以宿主自己写不了 storage.session，只能让 SW 代写。
 */
export interface ModelHostNotice {
  op: 'STATUS'
  state: ModelHostState
}

/**
 * 回包。字段可选而不是判别联合：三个 op 的负载都很小，共用一种形状让 SW 侧
 * 的路由与单测都不必写泛型体操；真正需要区分的只有 ok / ready / items。
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
//
// 这三个不是宿主协议的一部分，而是**外部入口**：S2 的侧栏会经它们请求加载/检测，
// S1 阶段则用它们在控制台里验收（没有它们，offscreen 里的模型没法从外面驱动）。

export const MODEL_HOST_ENSURE = 'MODEL_HOST_ENSURE'
export const MODEL_HOST_DETECT = 'MODEL_HOST_DETECT'
export const MODEL_HOST_STATUS = 'MODEL_HOST_STATUS'
/** 关闭全局 AI：销毁 offscreen 文档，模型内存随之释放 */
export const MODEL_HOST_CLOSE = 'MODEL_HOST_CLOSE'

/**
 * 主动关闭宿主时，在途请求的失败原因。
 * SW 见到这个原因不写 error 状态——否则「用户关掉 AI」会变成面板上的一条报错。
 */
export const MODEL_HOST_CLOSED_REASON = '模型宿主已关闭'

/**
 * MODEL_HOST_DETECT 的回包（SW → 侧栏）。
 * ok=false 时调用方保留自己的本地/正则结果，绝不把原文当脱敏结果。
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
