// 模型宿主状态的归并（纯函数）：宿主在 offscreen、UI 在侧栏，只能靠 storage.session 交换「到哪一步
// 了」；写成纯函数便于在 node 里钉死「下载中 → 就绪」「重试清 error」等分支（浏览器里只能肉眼观察）。
// 字段与既有 store 一一对应。

export type ModelHostPhase = 'idle' | 'loading' | 'ready' | 'error'

export interface ModelHostState {
  phase: ModelHostPhase
  /** 0–100；-1 = 未知总长 */
  percent: number
  received: number
  /** 总字节；0 = 未知 */
  total: number
  /** 另一个窗口正在下载，本宿主排队等待 */
  waiting: boolean
  /** 确认走网络下载（缓存命中全程为 false） */
  downloadStarted: boolean
  error: string | null
  updatedAt: number
}

export const initialModelHostState = (now = 0): ModelHostState => ({
  phase: 'idle',
  percent: -1,
  received: 0,
  total: 0,
  waiting: false,
  downloadStarted: false,
  error: null,
  updatedAt: now
})

/** 进度回调：received/total 可能缺省（沿用上一次的值） */
export const withProgress = (
  prev: ModelHostState,
  percent: number,
  received: number | undefined,
  total: number | undefined,
  now: number
): ModelHostState => ({
  ...prev,
  phase: 'loading',
  percent,
  received: received ?? prev.received,
  total: total ?? prev.total,
  // 新的进度意味着重试已开始，上一次的错误不再成立
  error: null,
  updatedAt: now
})

export const withWaiting = (prev: ModelHostState, waiting: boolean, now: number): ModelHostState => ({
  ...prev,
  phase: prev.phase === 'ready' ? 'ready' : 'loading',
  waiting,
  ...(waiting ? { error: null } : {}),
  updatedAt: now
})

export const withDownloadStarted = (prev: ModelHostState, now: number): ModelHostState => ({
  ...prev,
  phase: prev.phase === 'ready' ? 'ready' : 'loading',
  downloadStarted: true,
  updatedAt: now
})

export const withReady = (prev: ModelHostState, now: number): ModelHostState => ({
  ...prev,
  phase: 'ready',
  percent: 100,
  waiting: false,
  error: null,
  updatedAt: now
})

export const withError = (prev: ModelHostState, error: string, now: number): ModelHostState => ({
  ...prev,
  phase: 'error',
  waiting: false,
  error,
  updatedAt: now
})
