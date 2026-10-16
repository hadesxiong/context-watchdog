import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { DetectionItem, ReplaceConfig, MappingTable, ProfileConfig } from '../core/types'
import { detect, preloadModels } from '../core/detector'
import { getProfileById, DEFAULT_PROFILE_ID } from '../core/detector/profiles'
import { UserProfileManager, createChromeStorage } from '../core/detector/userProfiles'
import { getReplacer } from '../core/replacer'

// 模型状态类型
type ModelStatus = 'idle' | 'loading' | 'success' | 'error' | 'timeout' | 'disabled'

// 检测引擎状态
interface DetectionEngineStatus {
    sceneModel: boolean        // 场景识别（启发式）
    contentModel: boolean      // 内容检测模型
    regexRules: boolean        // 正则规则
}

// Profile 持久化 key
const PROFILE_STORAGE_KEY = 'pasteguard.activeProfile'
// AI 增强检测显式开关（Phase UI：默认关闭，零网络请求零报错）
const AI_ENABLED_KEY = 'pasteguard.aiEnabled'

// 计算某检测项的默认替换动作：Profile 显式配置 > 置信度分层 > 替换
const resolveDefaultAction = (
    profile: ProfileConfig,
    type: DetectionItem['type'],
    confidence: DetectionItem['confidence']
): 'replace' | 'keep' => {
    const explicit = profile.defaultActions[type]
    if (explicit) return explicit
    // tierLowConfidence：中低置信度降为仅提示（keep）
    if (profile.tierLowConfidence && confidence !== 'high') return 'keep'
    return 'replace'
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
    const nerError = ref<string | null>(null)
    const nerRetryCount = ref(0)
    // AI 增强检测开关（用户显式启用后才会下载模型）
    const aiEnabled = ref(false)

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

    // 恢复 AI 增强开关：仅在用户此前显式启用时才加载模型（默认零网络请求）
    storageLocal?.get(AI_ENABLED_KEY, (result: Record<string, unknown>) => {
        if (result?.[AI_ENABLED_KEY] === true) {
            aiEnabled.value = true
            initNER()
        }
    })

    // 检测引擎状态
    const engineStatus = ref<DetectionEngineStatus>({
        sceneModel: false,
        contentModel: false,
        regexRules: true
    })

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

        console.log('[PasteGuard] Starting detection for text:', text.substring(0, 100) + '...')

        try {
        const result = await detect(text, activeProfile.value)
        detections.value = result.items

        console.log('[PasteGuard] Detection completed. Found', result.items.length, 'items:')

        // 初始化替换配置（按 Profile 分类型默认策略 + 置信度分层）
        replaceConfigs.value = result.items.map(item => ({
            itemId: item.id,
            action: resolveDefaultAction(activeProfile.value, item.type, item.confidence)
        }))

        console.log('[PasteGuard] Detection configs initialized')
        } catch (error) {
        console.error('[PasteGuard] Detection failed:', error)
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
        console.log('[PasteGuard] Profile switched to:', profileId)

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
        console.log('[PasteGuard] User profile updated:', updated.id)
        if (updated.id === activeProfileId.value && originalText.value) {
            await detectText(originalText.value)
        }
    }

    // 删除用户档案；若为当前激活档案则回落到默认档案
    const deleteUserProfile = async (id: string) => {
        await profileManager.remove(id)
        userProfilesVersion.value++
        console.log('[PasteGuard] User profile deleted:', id)
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
        console.log('[PasteGuard] Copied sanitized text to clipboard')
        return true
        } catch (error) {
        console.error('[PasteGuard] Failed to copy text:', error)
        return false
        }
    }

    // 后台加载模型（仅在用户显式启用 AI 增强后调用）
    const initNER = async () => {
        console.log('[PasteGuard] Initializing models...')
        nerStatus.value = 'loading'
        nerLoadProgress.value = 0
        nerIndeterminate.value = false
        nerError.value = null

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
                        console.warn('[PasteGuard] Model load timeout (no progress for 60s)')
                        resolve()
                    }, STALL_TIMEOUT)
                }
                resetTimeout = arm
                arm()
            })

            // 真实下载进度：-1 表示无法获取 Content-Length（不定进度）
            const onProgress = (percent: number) => {
                resetTimeout()
                if (percent < 0) {
                    nerIndeterminate.value = true
                } else {
                    nerLoadProgress.value = percent
                }
            }

            const loadPromise = preloadModels(onProgress).then(() => {
                settled = true
                if (timeoutTimer) clearTimeout(timeoutTimer)
                nerStatus.value = 'success'
                nerRetryCount.value = 0
                nerLoadProgress.value = 100
                engineStatus.value.sceneModel = true
                engineStatus.value.contentModel = true
                console.log('[PasteGuard] Models loaded successfully')
            }).catch(error => {
                // 降噪：warn 而非 error（AI 增强为可选功能，基础检测不受影响）
                console.warn('[PasteGuard] Model preload failed (optional feature):', error)
                settled = true
                if (timeoutTimer) clearTimeout(timeoutTimer)
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
                nerError.value = '模型下载超时（60 秒无进展），请检查网络连接'
                engineStatus.value.sceneModel = false
                engineStatus.value.contentModel = false
            }
        } catch (error) {
            console.warn('[PasteGuard] Model initialization failed (optional feature):', error)
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
        console.log('[PasteGuard] AI enhancement', enabled ? 'enabled' : 'disabled')

        if (enabled) {
            await initNER()
        } else {
            nerStatus.value = 'disabled'
            nerLoadProgress.value = 0
            nerIndeterminate.value = false
            nerError.value = null
            engineStatus.value.sceneModel = false
            engineStatus.value.contentModel = false
        }
    }

    // 重新加载模型
    const retryLoadNER = async () => {
        console.log('[PasteGuard] Retrying model load...')
        await initNER()
    }

    // 禁用模型（降级模式）
    const disableNER = () => {
        nerStatus.value = 'disabled'
        engineStatus.value.sceneModel = false
        engineStatus.value.contentModel = false
        console.log('[PasteGuard] Models disabled')
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
        nerError,
        nerRetryCount,
        aiEnabled,
        setAiEnabled,

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
