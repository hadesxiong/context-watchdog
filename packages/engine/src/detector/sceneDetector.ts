// 场景识别器 - 确定性启发式：扫描前若干行的结构特征打分（KEY=VALUE / KEY: value / JSON /
// 时间戳 / 代码）。0ms、可单测、离线可用、无模型下载

import type { SceneType } from '../types'

export type { SceneType }

export interface SceneResult {
  type: SceneType
  confidence: number
  scores: Record<SceneType, number>
}

// 各场景的结构特征
const PATTERNS: Record<Exclude<SceneType, 'plain'>, RegExp> = {
  env: /^[A-Z0-9_]+=[^\s]/m,
  yaml: /^[ \t]*[\w.-]+\s*:\s*\S/m,
  json: /^\s*[{[]|"[^"]+"\s*:\s*"/m,
  log: /\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}:\d{2}|^\[[A-Z]{4,}\]|^\d{4}-\d{2}-\d{2}/m,
  code: /\b(function|def|class|import|const|let|var|public|void|#include)\b/m
}

const SCENE_WEIGHTS: Record<Exclude<SceneType, 'plain'>, number> = {
  env: 1.2,   // KEY=VALUE 形态辨识度高，加权
  yaml: 1.0,
  json: 1.0,
  log: 1.1,
  code: 0.8
}

export const detectScene = async (text: string): Promise<SceneResult> => {
  // 只分析前 50 行，避免长文本上的无谓扫描
  const sample = text.split('\n').slice(0, 50).join('\n')

  const scores: Record<string, number> = {}
  let total = 0

  for (const [scene, pattern] of Object.entries(PATTERNS)) {
    const matches = sample.match(new RegExp(pattern.source, pattern.flags + 'g'))
    const count = matches ? matches.length : 0
    // 饱和计分：出现 3 次即视为该场景的强特征
    const score = Math.min(count, 3) / 3 * SCENE_WEIGHTS[scene as Exclude<SceneType, 'plain'>]
    scores[scene] = score
    total += score
  }

  if (total === 0) {
    return { type: 'plain', confidence: 1, scores }
  }

  const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]
  return {
    type: top[0] as SceneType,
    confidence: top[1] / total,
    scores: scores as Record<SceneType, number>
  }
}

// 启发式无需模型：恒为就绪（保留函数名以兼容 pipeline 调用）
export const isSceneModelReady = (): boolean => true

// 预留的预加载入口（无操作）
export const preloadSceneModel = async (): Promise<void> => {}
