// 扩展侧的模型宿主入口：把 GLiNER 实现注册成引擎的 InferenceBackend 并提供便捷入口。
// 分工：引擎（@engine）只做纯逻辑（场景、正则、级联、仲裁、替换），
// 宿主（本目录）提供运行时能力（GLiNER 加载、onnxruntime-web、模型下载与缓存）。

import { getInferenceBackend, setInferenceBackend } from '@engine/detector/backend'
import type { ModelProgress } from '@engine/detector/backend'
import { LocalBackend } from './localBackend'

let installed = false

/** 幂等注册扩展侧后端。任一入口（侧栏 / service worker）首次需要模型时调用即可 */
export const installModelBackend = (): void => {
  if (installed) return
  installed = true
  setInferenceBackend(new LocalBackend())
}

/**
 * 预加载 GLiNER 模型。仅在用户显式启用 AI 增强后由 store 调用。
 * 回调语义：onProgress 真实字节进度（percent < 0 表示未知总长）；
 *           onWaiting 另一窗口正在下载；onDownloadStart 确认走网络下载才触发。
 */
export const preloadModels = async (
  onProgress?: ModelProgress,
  onWaiting?: (waiting: boolean) => void,
  onDownloadStart?: () => void
): Promise<void> => {
  installModelBackend()
  await getInferenceBackend()?.preload({ onProgress, onWaiting, onDownloadStart })
}

/** 模型是否就绪（同步）。未安装后端或模型未加载完成时为 false，管线据此走纯正则 */
export const isContentModelReady = (): boolean => getInferenceBackend()?.isReady() ?? false

export { LocalBackend }
export type { ModelProgress } from '@engine/detector/backend'
