// 引擎开关（正则规则 / 场景识别）的共享状态：侧栏 UI 与粘贴自动拦截（SW）共用同一份配置
// 开关关闭时对应引擎整体停用（含自定义正则与模型级联的正则复检），见 pipeline.ts 的
// enableRegexFallback / enableSceneDetection 接线；单测见 tests/unit/engineToggles.test.ts

// storage 键（chrome.storage.local）
export const ENGINE_TOGGLES_KEY = 'pasteguard.engineToggles'

export interface EngineToggles {
  regex: boolean
  scene: boolean
}

// 默认全开（保持历史行为：正则与场景识别始终参与检测）
export const DEFAULT_ENGINE_TOGGLES: EngineToggles = { regex: true, scene: true }

// storage 值 → 规范化开关对象（缺失/类型错误的字段回落默认值，绝不因脏数据抛错）
export const normalizeEngineToggles = (raw: unknown): EngineToggles => {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_ENGINE_TOGGLES }
  const record = raw as Record<string, unknown>
  return {
    regex: typeof record.regex === 'boolean' ? record.regex : DEFAULT_ENGINE_TOGGLES.regex,
    scene: typeof record.scene === 'boolean' ? record.scene : DEFAULT_ENGINE_TOGGLES.scene
  }
}

// 读取开关（storage 异常按默认值处理，绝不让 SW 启动失败——与 readProtectedSites 同策略）
export const readEngineToggles = async (): Promise<EngineToggles> => {
  try {
    const result = await chrome.storage.local.get(ENGINE_TOGGLES_KEY)
    return normalizeEngineToggles(result[ENGINE_TOGGLES_KEY])
  } catch {
    return { ...DEFAULT_ENGINE_TOGGLES }
  }
}
