// 扩展侧 AI 后端：把 GLiNER（contentDetector）适配成引擎的 InferenceBackend。
//
// 这是浏览器扩展宿主的实现。offscreen 单宿主与 Node 本地代理会各自提供自己的
// 实现（模型只加载一次，多入口共享），但检测管线、规则、替换全部复用引擎代码。

import type { InferenceBackend, InferenceEntity } from '@engine/detector/backend'
import type { SceneType } from '@engine/detector/sceneDetector'
import { detectContent, isContentModelReady, preloadContentModel } from './contentDetector'

export class LocalBackend implements InferenceBackend {
  isReady(): boolean {
    return isContentModelReady()
  }

  preload(options?: {
    onProgress?: Parameters<typeof preloadContentModel>[0]
    onWaiting?: (waiting: boolean) => void
    onDownloadStart?: () => void
  }): Promise<void> {
    return preloadContentModel(options?.onProgress, options?.onWaiting, options?.onDownloadStart)
  }

  detectSegment(text: string, scene: SceneType, labels: string[]): Promise<InferenceEntity[]> {
    return detectContent(text, scene, labels)
  }
}
