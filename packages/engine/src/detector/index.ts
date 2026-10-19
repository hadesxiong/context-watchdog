import type { DetectionResult, ProfileConfig } from '../types'
import { detect as pipelineDetect } from './pipeline'
import { getProfileById, DEFAULT_PROFILE_ID } from './profiles'

// 新管线配置（正则恒开、场景识别为 AI 分支内部细节，故仅暴露 AI 检测开关）
interface DetectorConfig {
  enableContentDetection: boolean
}

// 主检测函数 - 委托给新管线（profile 为检测配置档案，缺省用"不限"）
//
// 注意：模型的预加载与就绪状态**不属于引擎**。宿主通过
// `@engine/detector/backend` 的 setInferenceBackend() 注册自己的实现，
// 再用自己的入口（如扩展的 src/model）去下载与加载模型。
// 引擎只在检测时问一句 getInferenceBackend()?.isReady()。
export const detect = async (
  text: string,
  profile?: ProfileConfig,
  config: Partial<DetectorConfig> = {}
): Promise<DetectionResult> => {
  return pipelineDetect(text, profile || getProfileById(DEFAULT_PROFILE_ID), config)
}

// AI 后端注入点（宿主用）
export {
  setInferenceBackend,
  getInferenceBackend,
  categorizeEntity,
  CONFIDENCE_THRESHOLDS
} from './backend'
export type { InferenceBackend, InferenceEntity, ContentEntity, EntityCategory, ModelProgress } from './backend'
