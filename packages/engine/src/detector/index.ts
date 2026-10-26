import type { DetectionResult, ProfileConfig } from '../types'
import { detect as pipelineDetect } from './pipeline'
import { getProfileById, DEFAULT_PROFILE_ID } from './profiles'

export const detect = async (
  text: string,
  profile?: ProfileConfig,
  config: Partial<{ enableContentDetection: boolean }> = {}
): Promise<DetectionResult> => {
  return pipelineDetect(text, profile || getProfileById(DEFAULT_PROFILE_ID), config)
}

export {
  setInferenceBackend,
  getInferenceBackend,
  categorizeEntity,
  CONFIDENCE_THRESHOLDS
} from './backend'
export type { InferenceBackend, InferenceEntity, ContentEntity, EntityCategory, ModelProgress } from './backend'
