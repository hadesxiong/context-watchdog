import type { DetectionResult, ProfileConfig } from '../types'

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
  const { detect: pipelineDetect } = await import('./pipeline')
  const { getProfileById, DEFAULT_PROFILE_ID } = await import('./profiles')
  return pipelineDetect(text, profile || getProfileById(DEFAULT_PROFILE_ID), config)
}

// 预加载所有模型
export const preloadModels = async (): Promise<void> => {
  const { preloadModels: pipelinePreload } = await import('./pipeline')
  await pipelinePreload()
}

// 向后兼容：预加载 NER（已废弃，现在预加载所有模型）
export const preloadNER = async (): Promise<void> => {
  await preloadModels()
}
