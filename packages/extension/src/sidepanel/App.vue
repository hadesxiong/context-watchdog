<script setup lang="ts">
import { ref, computed, watch, onUnmounted, nextTick } from 'vue'
import { useDetectionStore } from '../stores/detection'
import InputArea from '../components/InputArea.vue'
import DetectionList from '../components/DetectionList.vue'
import ActionBar from '../components/ActionBar.vue'
import ProfileSelect from '../components/ProfileSelect.vue'
import PasteInterceptionSettings from '../components/PasteInterceptionSettings.vue'
import CapabilityDialog from '../components/CapabilityDialog.vue'
import { Button, Switch, Logo, LoadingOverlay, Dialog } from '../ui'
import { useI18n } from '../i18n'
import { waitForPaint } from '../lib/paintBarrier'

const { t, localePreference, setLocalePreference, availableLocales, localeNames } = useI18n()

// 「能力与隐私」面板：三轴能力矩阵 + 数据去向/价格声明
const showCapability = ref(false)

// 界面语言：'auto' 跟随浏览器语言；改动立即生效（占位符语言一并切换）
const localeChoice = computed({
    get: () => localePreference.value,
    set: (value: 'auto' | 'en' | 'zh_CN') => setLocalePreference(value)
})

const store = useDetectionStore()
const inputText = ref('')
const showOverlay = ref(false)
const hasResults = computed(() => store.detections.length > 0)
// 已发起过检测（即使结果为空也显示右列，给出"未检测到"的显式反馈）
const hasDetected = computed(() => store.originalText.trim() !== '')
const showEngineStatus = ref(false)

// 模型不再随面板挂载自动下载：仅当用户此前显式启用 AI 增强时，
// store 内部会自行恢复并加载（见 stores/detection.ts 的 AI_ENABLED_KEY 逻辑）

// 首启引导弹窗：从未展示过 且 未启用过 AI 才弹；展示即置位（store 持久化），无论用户怎么选都永不再弹
const showOnboarding = ref(store.shouldShowOnboarding)
watch(() => store.shouldShowOnboarding, (val) => {
    if (val) {
        showOnboarding.value = true
        store.markOnboardingSeen()
    }
}, { immediate: true })

const onEnableAiFromDialog = () => {
    showOnboarding.value = false
    store.setAiEnabled(true)
}

const onDismissOnboarding = () => {
    showOnboarding.value = false
}

const dismissTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const dismissing = ref(false)

const onNotifyLeave = () => {
    if (dismissing.value) {
        dismissing.value = false
        store.nerStatus = 'idle'
    }
}


watch(() => store.nerStatus, (status) => {
    dismissing.value = false
    if (dismissTimer.value) {
        clearTimeout(dismissTimer.value)
        dismissTimer.value = null
    }
    if (status === 'success' || status === 'error' || status === 'timeout') {
            dismissTimer.value = setTimeout(() => {
            store.nerStatus = 'idle'
            dismissing.value = true
        }, 2000)
    }
})

onUnmounted(() => {
    if (dismissTimer.value) clearTimeout(dismissTimer.value)
})

// 等到一次真实渲染：nextTick 只保证 DOM 已更新，rAF 回调发生在**绘制之前**，
// 两者都不等于「已经上屏」。屏障实现与理由见 lib/paintBarrier.ts（含顺序单测）。
// 遮罩必须先上屏再开跑同步长任务，否则长文本检测会把这一帧的绘制整段跳过。
const handleDetect = async (text: string) => {
    showOverlay.value = true
    document.body.style.overflow = 'hidden'
    try {
        // 遮罩必须先上屏再开跑：长文本检测是同步重活（实测 516KB 触发 1.6s 长任务），
        // 若与检测同任务，遮罩的 DOM 更新会被压到长任务结束才渲染；又因 1s 最小延时
        // 在阻塞前就起了表，届时早已过期 → 表现为「遮罩一闪而过/根本没出现」。
        await nextTick()
        await waitForPaint()
        // 最小展示时长从「已上屏」起算，保证短文本也不会一闪而过
        const minDelay = new Promise<void>(resolve => setTimeout(resolve, 1000))
        await Promise.all([store.detect(text), minDelay])
    } finally {
        // 异常路径也要收尾，否则遮罩常驻且 body 滚动被永久锁死
        showOverlay.value = false
        document.body.style.overflow = ''
    }
}

const handleCopy = async () => {
    await store.copySanitizedText()
}

const handleClear = () => {
    store.clearAll()
    inputText.value = ''
}

const toggleEngineStatus = () => {
    showEngineStatus.value = !showEngineStatus.value
}

// 独立打开新标签页：暂时隐藏（保留实现与模板引用，恢复时把常量改回 true）
const SHOW_OPEN_IN_NEW_TAB = false

const openInNewTab = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/sidepanel/index.html') })
}

// 引擎卡片：正则为基础引擎恒开（Switch 禁止修改——SW 粘贴拦截仅依赖此档，
// 误关会使拦截整体失灵）；场景识别并入 AI（仅喂给 GLiNER 提示词，随 AI 开关走，
// 不单独设卡）；AI 开关即 aiEnabled
const engineStatusItems = computed(() => [
    {
        key: 'regex' as const,
        nameKey: 'engine_regex_name',
        descKey: 'engine_regex_desc',
        enabled: true,
        locked: true,
        toggle: (_v: boolean) => { /* 恒开，禁止修改 */ }
    },
    {
        key: 'ai' as const,
        nameKey: 'engine_ai_name',
        descKey: 'engine_ai_desc',
        enabled: store.aiEnabled,
        locked: false,
        toggle: (v: boolean) => store.setAiEnabled(v)
    }
])

// 模型加载进度文案：已知总长 → 百分比；未知总长 → 「已下 xx.x / 183 MB」（字节实时心跳）
const progressLabel = computed(() => {
    if (!store.nerIndeterminate) return `${Math.round(store.nerLoadProgress || 0)}%`
    if (store.nerLoadTotal > 0) {
        const done = (store.nerLoadBytes / 1048576).toFixed(1)
        const all = Math.round(store.nerLoadTotal / 1048576)
        return `${done} / ${all} MB`
    }
    return '…'
})

// 加载阶段文案（仅在确认网络下载后才展示，缓存命中全程静默）
const loadingCaption = computed(() => {
    if (store.nerWaitingOtherWindow) return t('engine_caption_waiting')
    return t('engine_caption_downloading')
})
</script>

<template>
    <div class="min-h-screen bg-linear-to-br relative
        from-background to-muted/50 
        ">
        <!-- 头部 -->
        <header class="bg-background/80 backdrop-blur-sm border-b border-border sticky top-0 z-10">
            <div class="p-3">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <Logo :size="32" class="shrink-0 drop-shadow-xs" />
                        <div class="flex items-baseline gap-2">
                            <h1 class="text-lg font-semibold text-foreground">
                                ContextWatchdog</h1>
                            <p class="text-sm text-muted-foreground">
                                {{ t('app_subtitle') }}</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <!-- 独立打开按钮：暂时隐藏（见 SHOW_OPEN_IN_NEW_TAB） -->
                        <Button v-if="SHOW_OPEN_IN_NEW_TAB" @click="openInNewTab" variant="secondary"
                            btn-type="text" size="sm">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                        </Button>
                        <!-- 能力与隐私（关于）：三轴能力矩阵 + 数据去向/价格声明 -->
                        <Button @click="showCapability = true" variant="secondary"
                            btn-type="text" size="sm" :title="t('about_tooltip')">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                            </svg>
                        </Button>
                        <!-- 引擎状态按钮（齿轮入口） -->
                        <Button @click="toggleEngineStatus" variant="secondary"
                            btn-type="text" size="sm" :title="t('engine_tooltip')"
                            :class="{ 'text-success': store.isNERReady }">
                            <svg class="w-5 h-5" fill="none"
                                stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                            </svg>
                        </Button>
                    </div>
                </div>
            </div>
        </header>
        <!-- 引擎状态面板：外壳无内边距，三个功能区块全宽贴边——
             内容（正则规则等）到面板边框的距离统一由区块自身 p-4 提供
             （16px，与标题行到边框的距离一致），无任何 margin -->
        <div v-if="showEngineStatus"
            class="rounded-lg shadow-lg border fixed z-50 w-80 overflow-hidden
                max-w-[calc(100vw-1.5rem)] bg-card border-border"
                :style="{ top: 'var(--header-height)', right: '12px' }">
            <!-- 标题行：px-4 pt-4 距上/左/右边框 16px，pb-4 与下方区块间隔 16px -->
            <div class="flex items-center justify-between px-4 pt-4 pb-4">
                <h3 class="text-sm font-semibold text-foreground">
                    {{ t('engine_panel_title') }}</h3>
                <button @click="showEngineStatus = false"
                    class="text-muted-foreground hover:text-foreground">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M6 18L18 6M6 6l12 12"
                    />
                </svg>
                </button>
            </div>
            <!-- 界面语言：直接决定 UI 文案与「脱敏占位符」语言（见 i18n/index.ts）。
                 放在面板最前——它是「你在用哪个语言」的前置设定，先于任何引擎开关。
                 边距与下方区块同构：px-4 pt-4（pb=0），与下一块的 pt-4 合成 16px 间距 -->
            <div class="px-4 pt-4 bg-muted/50 flex items-center justify-between gap-3">
                <p class="text-sm font-medium text-foreground">{{ t('settings_language') }}</p>
                <select v-model="localeChoice"
                    class="px-2 py-1.5 rounded-md border border-input bg-background text-sm text-foreground
                        focus:outline-none focus:ring-1 focus:ring-ring focus:border-transparent">
                    <option value="auto">{{ t('settings_language_auto') }}</option>
                    <option v-for="code in availableLocales" :key="code" :value="code">
                        {{ localeNames[code] }}</option>
                </select>
            </div>
            <!-- 引擎开关：正则恒开（禁改）+ AI 开关（含场景识别，合并下载）；
                 区块全宽贴边（无内缩），区块间 gap-4（16px），无 margin -->
            <div class="flex flex-col">
                <div v-for="item in engineStatusItems" :key="item.nameKey"
                    class="px-4 pt-4 bg-muted/50">
                    <!-- gap-3：文字块与 Switch 之间保留间距（行内自由空间为 0 时也不贴合） -->
                    <div class="flex items-center justify-between gap-3">
                        <div class="min-w-0 flex items-center gap-3">
                            <div>
                                <p class="text-sm font-medium text-foreground">
                                    {{ t(item.nameKey) }}
                                </p>
                                <!-- 描述：最多 2 行，超出省略 -->
                                <p class="text-xs text-muted-foreground line-clamp-2">
                                    {{ t(item.descKey) }}
                                </p>
                            </div>
                        </div>
                        <Switch :model-value="item.enabled" size="small"
                            :disabled="item.locked"
                            @update:model-value="item.toggle" />
                    </div>
                    <!-- AI 卡片附属：加载进度（仅真网络下载；缓存命中静默初始化）/ 失败重试 -->
                    <template v-if="item.key === 'ai'">
                        <div v-if="store.nerStatus === 'loading' && store.nerDownloadStarted"
                            class="pt-2 w-full">
                            <div class="flex justify-between text-xs text-muted-foreground pb-1">
                                <span>{{ loadingCaption }}</span>
                                <span>{{ progressLabel }}</span>
                            </div>
                            <div class="w-full bg-muted rounded-full h-1.5">
                                <div v-if="!store.nerIndeterminate"
                                    class="bg-primary h-1.5 rounded-full transition-all duration-300"
                                    :style="{ width: store.nerLoadProgress + '%' }"></div>
                                <div v-else class="h-1.5 w-1/3 bg-primary rounded-full pg-indeterminate"></div>
                            </div>
                        </div>
                        <!-- 失败提示（关闭开关或重试） -->
                        <div v-if="store.nerStatus === 'error' || store.nerStatus === 'timeout'"
                            class="pt-2 flex items-center justify-between gap-2">
                            <p class="text-xs text-warning">
                                {{ store.nerError || t('engine_load_failed') }}</p>
                            <Button @click="store.retryLoadNER" variant="secondary"
                                btnType="outline" size="sm" class="shrink-0">
                                {{ t('common_retry') }}
                            </Button>
                        </div>
                    </template>
                </div>
            </div>
            <!-- 粘贴自动拦截：逐站授权，只有授权站点才注入粘贴监听 -->
            <PasteInterceptionSettings />
        </div>
        <!-- NER 模型状态条（仅确认网络下载才显示；缓存命中全程静默） -->
        <Transition name="ner-notify" @after-leave="onNotifyLeave">
            <div v-if="store.nerStatus === 'loading' && store.nerDownloadStarted && !dismissing"
                class="fixed z-50 left-1/2 -translate-x-1/2 top-[calc(var(--header-height)+8px)] m-3 p-3 max-w-125 min-w-80 w-auto
                    flex flex-col items-center gap-0.5
                    bg-card rounded-lg shadow-lg 
                    border border-primary/30">
                <div class="flex justify-between items-start w-full">
                    <p class="text-sm font-medium text-foreground">
                        {{ store.nerWaitingOtherWindow ? t('ner_downloading_other') : t('ner_downloading') }}</p>
                    <div class="mt-1">
                        <svg class="w-4 h-4 text-primary animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10"
                                stroke="currentColor" stroke-width="4"/>
                            <path class="opacity-75" fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                        </svg>
                    </div>
                </div>
                <!-- 进度 0 → 首次下载提示；有进度 → 百分比/字节 -->
                <p v-if="store.nerLoadProgress === 0 && !store.nerIndeterminate"
                    class="text-xs text-primary w-full mt-1">
                    {{ t('ner_first_download') }}</p>
                <div v-else class="w-full mt-1">
                    <div class="flex justify-between text-xs text-primary mb-1">
                        <span>{{ t('ner_downloading_progress') }}</span>
                        <span>{{ progressLabel }}</span>
                    </div>
                    <!-- 定进度：按真实字节数填充；不定进度：循环滑动动画 -->
                    <div class="w-full bg-primary/20 rounded-full h-1.5 overflow-hidden">
                        <div v-if="!store.nerIndeterminate"
                            class="bg-primary h-1.5 rounded-full transition-all duration-300"
                            :style="{ width: store.nerLoadProgress + '%' }"></div>
                        <div v-else class="h-1.5 w-1/3 bg-primary rounded-full pg-indeterminate"></div>
                    </div>
                </div>
            </div>
        </Transition>
        <!-- NER 模型下载提示 - 失败 -->
        <Transition name="ner-notify" @after-leave="onNotifyLeave">
            <div v-if="(store.nerStatus === 'error' || store.nerStatus === 'timeout') && !dismissing" 
                class="fixed z-50 left-1/2 -translate-x-1/2 top-[calc(var(--header-height)+8px)] m-3 p-3 gap-3 flex items-center max-w-125 min-w-80 w-auto
                    bg-card rounded-lg shadow-lg 
                    border border-warning/40">
                <div class="flex-1">
                    <p class="text-sm font-medium text-warning">
                        {{ store.nerStatus === 'timeout' ? t('ner_timeout') : t('ner_failed') }}</p>
                    <p class="text-xs text-warning mt-0.5">
                        {{ store.nerError || t('ner_base_still_ok') }}</p>
                </div>
                <Button @click="store.retryLoadNER"
                    variant="secondary" btnType="outline" size="sm">
                    {{ t('common_retry') }}</Button>
                <svg class="w-5 h-5 text-warning" fill="none"
                    stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                </svg>
            </div>
        </Transition>
        <!-- NER 模型下载提示 - 成功（仅真下载后提示；缓存命中静默完成） -->
        <Transition name="ner-notify" @after-leave="onNotifyLeave">
            <div v-if="store.nerStatus === 'success' && store.nerDownloadStarted && !dismissing"
                class="fixed z-50 left-1/2 -translate-x-1/2 top-[calc(var(--header-height)+8px)] m-3 p-3 gap-3 flex items-center max-w-125 min-w-80 w-auto
                    bg-card rounded-lg shadow-lg 
                    border border-success/40">
                <div class="flex-1">
                    <p class="text-sm font-medium text-success">
                        {{ t('ner_ready') }}</p>
                    <p class="text-xs text-success mt-0.5">
                        {{ t('ner_ready_desc') }}</p>
                </div>
                <svg class="w-5 h-5 text-success" fill="none"
                    stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round"
                        stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
            </div>
        </Transition>
        <!-- 主内容 -->
        <main :class="[
            'flex flex-col relative',
            // 列宽/行向以「是否检测过」为准（与左右栏显示条件一致）；ActionBar 仍按是否有检出项显示
            hasDetected && `min-h-[calc(100vh-58px)] min-[820px]:flex-row min-[820px]:h-[calc(100vh-64px)]`
            ]">
            <!-- 左侧列 -->
            <div :class="[
                // 基础态随容器收缩：面板窄于 400px 时不再由 min-w 强撑出整页横向滚动
                'flex flex-col w-full min-w-0',
                hasDetected && `
                    min-[820px]:w-auto 
                    min-[820px]:min-w-100
                    min-[820px]:max-w-125 
                    min-[820px]:h-auto 
                    min-[820px]:overflow-y-auto 
                    min-[820px]:border-r 
                    min-[820px]:min-h-[calc(100vh-64px)]
                    min-[820px]:border-border 
                     `
                ]">
                <!-- 输入项（档案下拉挂在标题旁）
                     宽屏断点下四边等距：上/左/右 12px 已有，底部同样补 12px——
                     有按钮栏时作为输入框与按钮栏的间距，无按钮栏时作为输入框到列底的间距 -->
                <div :class="['px-3 pt-3 min-[820px]:pb-3',
                    hasDetected && `min-[820px]:pt-3
                        min-[820px]:flex 
                        min-[820px]:flex-col 
                        min-[820px]:flex-1 
                        min-[820px]:min-h-0`
                ]">
                    <InputArea v-model="inputText" :is-processing="showOverlay"
                        @detect="handleDetect" @clear="handleClear">
                        <template #profile>
                            <ProfileSelect />
                        </template>
                    </InputArea>
                </div>
                <!-- 底部操作（仅在有检出项时显示替换操作） -->
                <div v-if="hasResults" class="hidden min-[820px]:block">
                    <ActionBar @copy="handleCopy" @replace-all="store.replaceAll" 
                        @keep-all="store.keepAll"/>
                </div>
            </div>
            <!-- 右侧列：检测过即显示（无检出时给出显式空状态反馈） -->
            <div v-if="hasDetected" class="flex-1 min-[820px]:flex-1 
                min-[820px]:h-full min-[820px]:overflow-y-auto">
                <!-- 检查结果 -->
                <div class="p-3">
                    <DetectionList :detections="store.detections"/>
                </div>
            </div>
            <!-- 输入项: 小于820px下显示 -->
            <div v-if="hasResults" class="min-[820px]:hidden sticky bottom-0">
                <ActionBar @copy="handleCopy" @replace-all="store.replaceAll" 
                    @keep-all="store.keepAll"/>
            </div>
        </main>
        <!-- 全局检测中遮罩 -->
        <LoadingOverlay v-if="showOverlay" />
        <!-- 首启引导弹窗：AI 增强为可选项，开启才下载模型（选择权交还用户） -->
        <CapabilityDialog :open="showCapability" @update:open="showCapability = $event" />

        <Dialog :open="showOnboarding" :title="t('onboarding_title')"
            @update:open="(v: boolean) => { if (!v) onDismissOnboarding() }">
            <div class="px-4 py-4 space-y-3">
                <p class="text-xs text-muted-foreground leading-relaxed">
                    {{ t('onboarding_body') }}
                </p>
                <div class="flex justify-end gap-2">
                    <Button variant="secondary" btnType="outline" size="sm"
                        @click="onDismissOnboarding">
                        {{ t('onboarding_later') }}
                    </Button>
                    <Button size="sm" @click="onEnableAiFromDialog">
                        {{ t('onboarding_enable') }}
                    </Button>
                </div>
            </div>
        </Dialog>
    </div>
</template>

<style scoped>
/* 进入：从上方滑入 + 淡入 */
.ner-notify-enter-from {
    opacity: 0;
    transform: translateY(-8px);
}
.ner-notify-enter-active {
    transition: all 0.3s ease-out;
}

/* 退出：向上滑出 + 淡出 */
.ner-notify-leave-to {
    opacity: 0;
    transform: translateY(-8px);
}
.ner-notify-leave-active {
    transition: all 0.3s ease-in;
}

/* 不定进度（无法获取 Content-Length 时）：循环滑动 */
.pg-indeterminate {
    animation: pg-indeterminate 1.2s ease-in-out infinite;
}
@keyframes pg-indeterminate {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(300%); }
}
</style>