import type { DetectionResult, ProfileConfig } from '../types'
import { detect as pipelineDetect, preloadModels as pipelinePreload } from './pipeline'
import { isContentModelReady } from './contentDetector'
import type { ModelProgress } from './modelDownload'
import { getProfileById, DEFAULT_PROFILE_ID } from './profiles'

// 新管线配置
interface DetectorConfig {
  enableSceneDetection: boolean
  enableContentDetection: boolean
  enableRegexFallback: boolean
}

// 主检测函数 - 委托给新管线（profile 为检测配置档案，缺省用"不限"）
export const detect = async (
  text: string,
  profile?: ProfileConfig,
  config: Partial<DetectorConfig> = {}
): Promise<DetectionResult> => {
  return pipelineDetect(text, profile || getProfileById(DEFAULT_PROFILE_ID), config)
}

// 预加载所有模型（仅在用户显式启用 AI 增强后由 store 调用）
// onCacheHit: 模型来自本地缓存（UI 据此显示「本地缓存加载中」而不是「下载模型中」）
export const preloadModels = async (
  onProgress?: ModelProgress,
  onWaiting?: (waiting: boolean) => void,
  onCacheHit?: () => void
): Promise<void> => {
  await pipelinePreload(onProgress, onWaiting, onCacheHit)
}

// 模型是否真正就绪（store 用它校验「成功」状态，避免假成功）
export { isContentModelReady }
