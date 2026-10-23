import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { DetectionItem, ReplaceConfig, MappingTable, ProfileConfig } from '@engine/types'
import { detect } from '@engine/detector'
import { preloadModels, isContentModelReady } from '@/model'
import { getProfileById, DEFAULT_PROFILE_ID, resolveDefaultAction } from '@engine/detector/profiles'
import { UserProfileManager, createChromeStorage } from '@engine/detector/userProfiles'
import { getReplacer } from '@engine/replacer'
import {
    MODEL_HOST_CLOSE,
    MODEL_HOST_DETECT,
    MODEL_HOST_ENSURE,
    MODEL_HOST_STATE_KEY,
    MODEL_HOST_STATUS,
    type ModelHostDetectResponse,
    type ModelHostStatusResponse
} from '@/modelHost/protocol'
import type { ModelHostState } from '@/modelHost/state'
import { AI_ENABLED_KEY } from '@engine/settings'

// 模型状态类型
type ModelStatus = 'idle' | 'loading' | 'success' | 'error' | 'timeout' | 'disabled'

// 检测引擎状态
interface DetectionEngineStatus {
    sceneModel: boolean        // 场景识别（启发式）
    contentModel: boolean      // 内容检测模型
    regexRules: boolean        // 正则规则
}

// Profile 持久化 key
const PROFILE_STORAGE_KEY = 'contextwatchdog.activeProfile'
// AI 增强首启引导弹窗「已展示」标记（展示过一次后永不再弹，无论用户是否开启）
const AI_ONBOARDING_KEY = 'contextwatchdog.aiOnboardingSeen'

// 默认替换动作（keep/replace）的判定已上收到 engine 的 profiles.ts：
// 侧栏、粘贴正则首答、AI 二次升级三条链路共用同一份策略，避免各说各话。
// 侧栏 → SW 的单次请求（SW 再转给 offscreen 宿主）。
// SW 未响应/不可用时返回 null，调用方自行降级——绝不抛异常打断检测。
const sendRuntimeMessage = <T>(message: unknown): Promise<T | null> => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return Promise.resolve(null)
    return new Promise(resolve => {
        try {
            chrome.runtime.sendMessage(message, (response: T) => {
                // 读 lastError 抑制 "Unchecked runtime.lastError" 噪音
                if (chrome.runtime.lastError) {
                    resolve(null)
                    return
                }
                resolve(response ?? null)
            })
        } catch {
            resolve(null)
        }
    })
}

export const useDetectionStore = defineStore('detection', () => {
    // 状态
    const originalText = ref('')
    const detections = ref<DetectionItem[]>([])
    const replaceConfigs = ref<ReplaceConfig[]>([])
    const isProcessing = ref(false)

    // 模型状态（向后兼容旧变量名）
    const nerStatus = ref<ModelStatus>('disabled')
    const nerLoadProgress = ref(0)
    // 不定进度（服务端未返回 Content-Length 时为 true，进度条走循环动画）
    const nerIndeterminate = ref(false)
    // 已下载字节 / 总字节：UI 进度始终并显「xx.x / 183 MB」（十进制口径，见 App.vue progressLabel）
    const nerLoadBytes = ref(0)
    const nerLoadTotal = ref(0)
    // 另一窗口正在下载模型、本窗口等待中（UI 显示「另一窗口下载中」，见 modelDownload 的多窗口锁）
    const nerWaitingOtherWindow = ref(false)
    // 确认正在走网络下载（缓存未命中/已作废）：UI 据此显示下载提示；
    // 缓存命中全程静默（仅控制台日志），不再弹「已命中缓存」之类的提示打扰用户
    const nerDownloadStarted = ref(false)
    const nerError = ref<string | null>(null)
    // AI 增强检测开关（用户显式启用后才会下载模型）
    const aiEnabled = ref(false)
    // 首启引导弹窗是否已展示过（持久化；展示即置位，与用户选择无关）
    const aiOnboardingSeen = ref(false)
    // storage 恢复是否完成（App 侧据此避免在恢复前误判「从未展示过」而误弹引导）
    const onboardingRestored = ref(false)

    // 激活的检测配置档案（Tab 切换，持久化）
    const activeProfileId = ref<string>(DEFAULT_PROFILE_ID)

    // 用户自定义档案管理器（内置 + 用户，CRUD 持久化于 chrome.storage.local）
    const profileManager = new UserProfileManager(createChromeStorage())
    const userProfilesVersion = ref(0)

    const profiles = computed(() => {
        void userProfilesVersion.value  // 依赖追踪：用户档案变更后重算
        return profileManager.getAll()
    })

    const activeProfile = computed(() => {
        void userProfilesVersion.value
        return profileManager.get(activeProfileId.value) || getProfileById(activeProfileId.value)
    })

    // 从 chrome.storage 恢复上次选择（用户档案加载完成后校验 id 仍存在）
    const storageLocal = typeof chrome !== 'undefined' ? chrome.storage?.local : undefined
    let pendingActiveId: string | null = null
    storageLocal?.get(PROFILE_STORAGE_KEY, (result: Record<string, unknown>) => {
        const saved = result?.[PROFILE_STORAGE_KEY]
        if (typeof saved === 'string') {
            pendingActiveId = saved
            if (profileManager.get(saved)) {
                activeProfileId.value = saved
            }
        }
    })

    // 异步加载用户档案，完成后二次校验激活 id（防止已删除档案残留）
    profileManager.load().then(() => {
        userProfilesVersion.value++
        if (pendingActiveId && profileManager.get(pendingActiveId)) {
            activeProfileId.value = pendingActiveId
        }
    })

    // 恢复 AI 增强开关与首启引导标记：仅在用户此前显式启用时才加载模型（默认零网络请求）
    if (storageLocal) {
        storageLocal.get([AI_ENABLED_KEY, AI_ONBOARDING_KEY], (result: Record<string, unknown>) => {
            aiOnboardingSeen.value = result?.[AI_ONBOARDING_KEY] === true
            if (result?.[AI_ENABLED_KEY] === true) {
                aiEnabled.value = true
                initNER()
            }
            onboardingRestored.value = true
        })
    } else {
        // 无 storage（node 测试环境）：视为已恢复，保持默认未看过引导
        onboardingRestored.value = true
    }

    // 是否应展示首启引导：storage 已恢复 + 从未展示过 + 当前未启用 AI
    //（已启用过 AI 的老用户不弹——尊重既有选择）
    const shouldShowOnboarding = computed(
        () => onboardingRestored.value && !aiOnboardingSeen.value && !aiEnabled.value
    )

    // 检测引擎状态
    const engineStatus = ref<DetectionEngineStatus>({
        sceneModel: false,
        contentModel: false,
        regexRules: true
    })

    // ---- 模型宿主（Chrome / Edge）----
    // 侧栏只是客户端：模型跑在唯一的 offscreen 文档里，状态由 SW 代写 storage.session。
    // Firefox 没有 chrome.offscreen：hostMode=false，继续走本地加载（initLocalNER）。
    const HOST_STALL_TIMEOUT = 60000
    let hostCheck: Promise<boolean> | null = null
    let stallTimer: ReturnType<typeof setTimeout> | null = null
    const storageApi = typeof chrome !== 'undefined' ? chrome.storage : undefined

    const clearStallTimer = (): void => {
        if (stallTimer) {
            clearTimeout(stallTimer)
            stallTimer = null
        }
    }

    // 宿主侧停滞超时：只要还有进度推进就重新计时（与本地路径的 60s 语义一致）
    const armStallTimer = (): void => {
        clearStallTimer()
        stallTimer = setTimeout(() => {
            if (nerStatus.value !== 'loading') return
            nerStatus.value = 'timeout'
            nerWaitingOtherWindow.value = false
            nerError.value = '模型下载超时（60 秒无进展），请检查网络连接'
            engineStatus.value.sceneModel = false
            engineStatus.value.contentModel = false
        }, HOST_STALL_TIMEOUT)
    }

    const resetModelUi = (): void => {
        clearStallTimer()
        nerLoadProgress.value = 0
        nerIndeterminate.value = false
        nerLoadBytes.value = 0
        nerLoadTotal.value = 0
        nerWaitingOtherWindow.value = false
        nerDownloadStarted.value = false
        nerError.value = null
    }

    // 把 storage.session 里的宿主状态映射到既有 UI 字段（组件零改动）
    const applyHostState = (raw: unknown): void => {
        if (!raw || typeof raw !== 'object') return
        const state = raw as ModelHostState
        if (typeof state.phase !== 'string') return

        if (state.phase === 'ready') {
            clearStallTimer()
            nerStatus.value = 'success'
            nerLoadProgress.value = 100
            nerIndeterminate.value = false
            nerWaitingOtherWindow.value = false
            nerError.value = null
            engineStatus.value.sceneModel = true
            engineStatus.value.contentModel = true
            return
        }

        if (state.phase === 'error') {
            clearStallTimer()
            nerStatus.value = 'error'
            nerWaitingOtherWindow.value = false
            nerError.value = state.error || '模型加载失败'
            engineStatus.value.sceneModel = false
            engineStatus.value.contentModel = false
            return
        }

        if (state.phase === 'loading') {
            nerStatus.value = 'loading'
            nerWaitingOtherWindow.value = state.waiting === true
            nerDownloadStarted.value = state.downloadStarted === true
            if (typeof state.received === 'number') nerLoadBytes.value = state.received
            if (typeof state.total === 'number') nerLoadTotal.value = state.total
            if (state.percent < 0) {
                nerIndeterminate.value = true
            } else {
                nerIndeterminate.value = false
                nerLoadProgress.value = state.percent
            }
            if (state.error) nerError.value = state.error
            armStallTimer()
        }
    }

    // 能力探测：Chrome/Edge true，Firefox false。成功结果缓存；失败不缓存（下次再问）
    const detectHostMode = async (): Promise<boolean> => {
        if (hostCheck) return hostCheck
        const result = await sendRuntimeMessage<ModelHostStatusResponse>({ type: MODEL_HOST_STATUS })
        if (!result) return false
        hostCheck = Promise.resolve(result.supported === true)
        return hostCheck
    }

    // 宿主状态变化 → 立即反映到面板。AI 关闭时忽略，避免"已关闭却显示就绪"。
    storageApi?.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'session') return
        const change = changes[MODEL_HOST_STATE_KEY]
        if (!change || !aiEnabled.value) return
        applyHostState(change.newValue)
    })

    // 引擎开关持久化已移除：正则为基础引擎恒开、场景识别并入 AI 分支（pipeline 内部处理）

    // 计算属性
    const isNERReady = computed(() => nerStatus.value === 'success')

    const sanitizedText = computed(() => {
        if (!originalText.value || detections.value.length === 0) {
        return originalText.value
        }

        const replacer = getReplacer()
        const { sanitizedText: result } = replacer.apply(
            originalText.value,
            detections.value,
            replaceConfigs.value
        )

        return result
    })

    // 映射表由检测结果 + 替换配置派生（纯计算，修复原先在 apply 之前读取旧值的时序问题）
    const mappingTable = computed<MappingTable>(() => {
        if (!originalText.value || detections.value.length === 0) {
            return {}
        }

        const replacer = getReplacer()
        return replacer.apply(
            originalText.value,
            detections.value,
            replaceConfigs.value
        ).mappingTable
    })

    const detectionCount = computed(() => detections.value.length)

    const highConfidenceCount = computed(
        () => detections.value.filter(d => d.confidence === 'high').length
    )

    // 操作
    const detectText = async (text: string) => {
        isProcessing.value = true
        originalText.value = text

        console.log('[ContextWatchdog] Starting detection for text:', text.substring(0, 100) + '...')

        try {
        let items: DetectionItem[] | null = null

        // Chrome/Edge 且 AI 就绪：走唯一模型宿主（正则 + AI 同一条管线）。
        // AI 未开 / 未就绪时直接用本地正则，省掉一次消息往返。
        if (aiEnabled.value && isNERReady.value && (await detectHostMode())) {
            const hosted = await sendRuntimeMessage<ModelHostDetectResponse>({
                type: MODEL_HOST_DETECT,
                text,
                profile: activeProfile.value
            })
            if (hosted?.ok && Array.isArray(hosted.items)) {
                items = hosted.items
            } else {
                console.warn('[ContextWatchdog] 宿主检测不可用，回退本地/正则:', hosted?.error)
                // 宿主可能被浏览器回收：后台幂等重建（单飞），下一次检测再走宿主
                void sendRuntimeMessage({ type: MODEL_HOST_ENSURE })
            }
        }

        if (!items) {
            const result = await detect(text, activeProfile.value, {
                enableContentDetection: aiEnabled.value
            })
            items = result.items
        }

        detections.value = items

        console.log('[ContextWatchdog] Detection completed. Found', items.length, 'items:')

        // 初始化替换配置（按 Profile 分类型默认策略 + 置信度分层）
        replaceConfigs.value = items.map(item => ({
            itemId: item.id,
            action: resolveDefaultAction(activeProfile.value, item.type, item.confidence)
        }))

        console.log('[ContextWatchdog] Detection configs initialized')
        } catch (error) {
        console.error('[ContextWatchdog] Detection failed:', error)
        detections.value = []
        } finally {
        isProcessing.value = false
        }
    }

    const setReplaceAction = (
        itemId: string,
        action: 'replace' | 'keep'
    ) => {
        const config = replaceConfigs.value.find(c => c.itemId === itemId)
        if (config) {
        config.action = action
        } else {
        replaceConfigs.value.push({ itemId, action })
        }
    }

    // 切换检测配置档案（Tab），持久化并对已有文本重新检测
    const setActiveProfile = async (profileId: string) => {
        if (profileId === activeProfileId.value) return
        activeProfileId.value = profileId
        storageLocal?.set({ [PROFILE_STORAGE_KEY]: profileId })
        console.log('[ContextWatchdog] Profile switched to:', profileId)

        if (originalText.value) {
            await detectText(originalText.value)
        }
    }

    // ---- 用户自定义档案 CRUD（Phase 4） ----

    // 当前激活档案是否为用户自定义（内置档案不显示编辑/删除入口）
    const isActiveProfileCustom = computed(() => {
        void userProfilesVersion.value
        return profileManager.isUserOwned(activeProfileId.value)
    })

    // 基于指定档案（缺省当前激活）新建，自动命名「自定义 N」并激活
    const createUserProfile = async (baseId?: string): Promise<ProfileConfig> => {
        const base = profileManager.get(baseId ?? activeProfileId.value) || getProfileById(DEFAULT_PROFILE_ID)
        const existingNames = new Set(profileManager.getAll().map(p => p.name))
        let n = 1
        while (existingNames.has(`自定义 ${n}`)) n++

        const profile = await profileManager.create(base, `自定义 ${n}`)
        userProfilesVersion.value++
        await setActiveProfile(profile.id)
        return profile
    }

    // 更新用户档案；若为当前激活档案则重新检测
    const updateUserProfile = async (profile: ProfileConfig) => {
        const updated = await profileManager.update(profile)
        userProfilesVersion.value++
        console.log('[ContextWatchdog] User profile updated:', updated.id)
        if (updated.id === activeProfileId.value && originalText.value) {
            await detectText(originalText.value)
        }
    }

    // 删除用户档案；若为当前激活档案则回落到默认档案
    const deleteUserProfile = async (id: string) => {
        await profileManager.remove(id)
        userProfilesVersion.value++
        console.log('[ContextWatchdog] User profile deleted:', id)
        if (id === activeProfileId.value) {
            await setActiveProfile(DEFAULT_PROFILE_ID)
        }
    }

    // 导出全部用户档案为 JSON（无可导出时返回 null）
    const exportProfilesJson = (): string | null => {
        const json = profileManager.exportJson()
        return json.includes('"profiles": []') ? null : json
    }

    // 从 JSON 导入用户档案，返回导入数量
    const importProfilesJson = async (json: string): Promise<number> => {
        const imported = await profileManager.importFromJson(json)
        userProfilesVersion.value++
        return imported.length
    }

    const replaceAll = () => {
        replaceConfigs.value = detections.value.map(item => ({
        itemId: item.id,
        action: 'replace' as const
        }))
    }

    const keepAll = () => {
        replaceConfigs.value = detections.value.map(item => ({
        itemId: item.id,
        action: 'keep' as const
        }))
    }

    const clearMapping = () => {
        // 映射表现在由 computed 派生，无需手动清空；保留方法以兼容现有 UI 调用
    }

    const clearAll = () => {
        originalText.value = ''
        detections.value = []
        replaceConfigs.value = []
    }

    const copySanitizedText = async () => {
        try {
        await navigator.clipboard.writeText(sanitizedText.value)
        console.log('[ContextWatchdog] Copied sanitized text to clipboard')
        return true
        } catch (error) {
        console.error('[ContextWatchdog] Failed to copy text:', error)
        return false
        }
    }

    // 后台加载模型（仅在用户显式启用 AI 增强后调用）
    const initNER = async () => {
        console.log('[ContextWatchdog] Initializing models...')
        resetModelUi()
        nerStatus.value = 'loading'

        if (!(await detectHostMode())) {
            await initLocalNER()
            return
        }

        // 宿主路径：状态完全由 storage.session 驱动，ENSURE 不阻塞 UI。
        // 先读一次快照（宿主可能已被上一个侧栏会话加载好），再请求幂等加载。
        void storageApi?.session?.get(MODEL_HOST_STATE_KEY).then((stored: Record<string, unknown>) => {
            const snapshot = stored?.[MODEL_HOST_STATE_KEY]
            if (snapshot) applyHostState(snapshot)
        })
        armStallTimer()
        void sendRuntimeMessage({ type: MODEL_HOST_ENSURE })
    }

    // Firefox 回退：侧栏内加载（与 S2 之前一致）
    const initLocalNER = async () => {
        try {
            // 停滞超时：只要下载进度还在更新就不算超时（183MB 模型慢网下可能需要数分钟）；
            // 60 秒内无任何进度推进才判定超时
            const STALL_TIMEOUT = 60000
            let timeoutTimer: ReturnType<typeof setTimeout> | null = null
            let resetTimeout: () => void = () => {}
            let settled = false

            const timeoutPromise = new Promise<void>((resolve) => {
                const arm = () => {
                    if (timeoutTimer) clearTimeout(timeoutTimer)
                    timeoutTimer = setTimeout(() => {
                        console.warn('[ContextWatchdog] Model load timeout (no progress for 60s)')
                        resolve()
                    }, STALL_TIMEOUT)
                }
                resetTimeout = arm
                arm()
            })

            // 真实下载进度：percent < 0 表示未知总长（不定进度）。
            // 每次回调都 resetTimeout —— 只要还有字节进来就绝不误判「60 秒无进展」超时
            //（修复：无 Content-Length 时此前只在开始上报一次，60 秒后必然假超时）
            const onProgress = (percent: number, received?: number, total?: number) => {
                resetTimeout()
                if (typeof received === 'number') nerLoadBytes.value = received
                if (typeof total === 'number' && total > 0) nerLoadTotal.value = total
                if (percent < 0) {
                    nerIndeterminate.value = true
                } else {
                    nerIndeterminate.value = false
                    nerLoadProgress.value = percent
                }
            }

            const onWaiting = (waiting: boolean) => {
                nerWaitingOtherWindow.value = waiting
            }

            // 确认走网络下载才置位（缓存命中全程静默，仅控制台日志）—— UI 据此显示下载提示
            const onDownloadStart = () => {
                nerDownloadStarted.value = true
            }

            const loadPromise = preloadModels(onProgress, onWaiting, onDownloadStart).then(() => {
                settled = true
                if (timeoutTimer) clearTimeout(timeoutTimer)
                nerWaitingOtherWindow.value = false
                // 以模型真实状态为准：promise resolve 但模型没就绪 → 视为失败（防假成功）
                if (!isContentModelReady()) {
                    throw new Error('模型加载结果异常：模型未就绪，请重试')
                }
                nerStatus.value = 'success'
                nerLoadProgress.value = 100
                engineStatus.value.sceneModel = true
                engineStatus.value.contentModel = true
                console.log('[ContextWatchdog] Models loaded successfully')
            }).catch(error => {
                // 降噪：warn 而非 error（AI 增强为可选功能，基础检测不受影响）
                console.warn('[ContextWatchdog] Model preload failed (optional feature):', error)
                settled = true
                if (timeoutTimer) clearTimeout(timeoutTimer)
                nerWaitingOtherWindow.value = false
                nerStatus.value = 'error'
                nerError.value = error instanceof Error ? error.message : '网络请求被阻止或模型下载失败'
                engineStatus.value.sceneModel = false
                engineStatus.value.contentModel = false
            })

            await Promise.race([loadPromise, timeoutPromise])

            // 仍在加载 = 停滞超时触发（成功/失败已在上面各自处理）
            if (!settled && nerStatus.value === 'loading') {
                if (timeoutTimer) clearTimeout(timeoutTimer)
                nerStatus.value = 'timeout'
                nerWaitingOtherWindow.value = false
                nerError.value = '模型下载超时（60 秒无进展），请检查网络连接'
                engineStatus.value.sceneModel = false
                engineStatus.value.contentModel = false
            }
        } catch (error) {
            console.warn('[ContextWatchdog] Model initialization failed (optional feature):', error)
            nerStatus.value = 'error'
            nerError.value = error instanceof Error ? error.message : '未知错误'
            engineStatus.value.sceneModel = false
            engineStatus.value.contentModel = false
        }
    }

    // AI 增强开关（持久化）：开启才下载模型；关闭则卸载状态并回退纯正则
    const setAiEnabled = async (enabled: boolean) => {
        aiEnabled.value = enabled
        storageLocal?.set({ [AI_ENABLED_KEY]: enabled })
        console.log('[ContextWatchdog] AI enhancement', enabled ? 'enabled' : 'disabled')

        if (enabled) {
            await initNER()
        } else {
            // Chrome/Edge：销毁 offscreen 文档，模型内存随之释放
            if (await detectHostMode()) {
                void sendRuntimeMessage({ type: MODEL_HOST_CLOSE })
            }
            nerStatus.value = 'disabled'
            resetModelUi()
            engineStatus.value.sceneModel = false
            engineStatus.value.contentModel = false
        }
    }

    // 重新加载模型
    const retryLoadNER = async () => {
        console.log('[ContextWatchdog] Retrying model load...')
        await initNER()
    }

    // 首启引导「已展示」置位（展示即调用，持久化后永不再弹）
    const markOnboardingSeen = () => {
        aiOnboardingSeen.value = true
        storageLocal?.set({ [AI_ONBOARDING_KEY]: true })
    }

    // 禁用模型（降级模式）
    const disableNER = () => {
        nerStatus.value = 'disabled'
        nerLoadProgress.value = 0
        nerIndeterminate.value = false
        nerLoadBytes.value = 0
        nerLoadTotal.value = 0
        nerWaitingOtherWindow.value = false
        engineStatus.value.sceneModel = false
        engineStatus.value.contentModel = false
        console.log('[ContextWatchdog] Models disabled')
    }

    return {
        // 状态
        originalText,
        detections,
        replaceConfigs,
        mappingTable,
        isProcessing,

        // Profile
        activeProfileId,
        activeProfile,
        profiles,
        setActiveProfile,
        isActiveProfileCustom,
        createUserProfile,
        updateUserProfile,
        deleteUserProfile,
        exportProfilesJson,
        importProfilesJson,

        // 模型状态
        nerStatus,
        nerLoadProgress,
        nerIndeterminate,
        nerLoadBytes,
        nerLoadTotal,
        nerWaitingOtherWindow,
        nerDownloadStarted,
        nerError,
        aiEnabled,
        setAiEnabled,
        aiOnboardingSeen,
        shouldShowOnboarding,
        markOnboardingSeen,

        // 引擎状态
        engineStatus,

        // 计算属性
        isNERReady,
        sanitizedText,
        detectionCount,
        highConfidenceCount,

        // 操作
        detect: detectText,
        setReplaceAction,
        replaceAll,
        keepAll,
        clearMapping,
        clearAll,
        copySanitizedText,
        initNER,
        retryLoadNER,
        disableNER
    }
})
