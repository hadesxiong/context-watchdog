<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { useDetectionStore } from '../stores/detection'
import InputArea from '../components/InputArea.vue'
import DetectionList from '../components/DetectionList.vue'
import ActionBar from '../components/ActionBar.vue'
import ProfileTabs from '../components/ProfileTabs.vue'
import { Button, Switch, Logo, LoadingOverlay } from '../ui'

const store = useDetectionStore()
const inputText = ref('')
const showOverlay = ref(false)
const hasResults = computed(() => store.detections.length > 0)
// 已发起过检测（即使结果为空也显示右列，给出"未检测到"的显式反馈）
const hasDetected = computed(() => store.originalText.trim() !== '')
const showEngineStatus = ref(false)

// 模型不再随面板挂载自动下载：仅当用户此前显式启用 AI 增强时，
// store 内部会自行恢复并加载（见 stores/detection.ts 的 AI_ENABLED_KEY 逻辑）

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

const handleDetect = async (text: string) => {
    showOverlay.value = true
    document.body.style.overflow = 'hidden'
    const minDelay = new Promise(resolve => setTimeout(resolve, 1000))
    await Promise.all([store.detect(text), minDelay])
    showOverlay.value = false
    document.body.style.overflow = ''
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

const openInNewTab = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/sidepanel/index.html') })
}

const engineStatusItems = computed(() => [
    {
        name: '正则规则',
        description: '密钥、连接串、PII（手机/身份证/银行卡）等模式匹配',
        enabled: store.engineStatus.regexRules,
        icon: 'regex'
    },
    {
        name: '场景识别',
        description: '启发式识别文本类型（零延迟，离线可用）',
        enabled: store.engineStatus.sceneModel,
        icon: 'scene'
    },
    {
        name: 'AI 模型',
        description: '姓名、地址等无固定格式实体（需联网加载模型）',
        enabled: store.engineStatus.contentModel,
        icon: 'content'
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
                                PasteGuard</h1>
                            <p class="text-sm text-muted-foreground">
                                AI脱敏助手</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <!-- 独立打开按钮 -->
                        <Button @click="openInNewTab" variant="secondary"
                            btn-type="text" size="sm">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                        </Button>
                        <!-- 引擎状态按钮 -->
                        <Button @click="toggleEngineStatus" variant="secondary"
                            btn-type="text" size="sm"
                            :class="{ 'text-success': store.isNERReady }">
                            <svg class="w-5 h-5" fill="none"
                                stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                            </svg>
                        </Button>
                    </div>
                </div>
            </div>
        </header>
        <!-- 引擎状态面板 -->
        <div v-if="showEngineStatus"
            class="p-3 rounded-lg shadow-lg border fixed z-50
                bg-card border-border"
                :style="{ top: 'var(--header-height)', right: '12px' }">
            <div class="flex items-center justify-between mb-4">
                <h3 class="text-sm font-semibold text-foreground">
                    检测引擎状态</h3>
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
            <!-- 引擎具体内容 -->
            <div class="flex flex-col gap-3">
                <div v-for="item in engineStatusItems" :key="item.name"
                    class="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div class="flex items-center gap-3">
                        <!-- <div
                        :class="[
                            'w-2 h-2 rounded-full',
                            item.enabled ? 'bg-success' : 'bg-muted'
                        ]"
                        /> -->
                        <div>
                            <p class="text-sm font-medium text-foreground">
                                {{ item.name }}
                            </p>
                            <p class="text-xs text-muted-foreground">
                                {{ item.description }}
                            </p>
                        </div>
                    </div>
                    <span :class="[
                        'text-xs font-medium px-2 py-1 rounded-full',
                        item.enabled
                            ? 'bg-success/10 text-success'
                            : 'bg-muted text-muted-foreground'
                        ]">
                        {{ item.enabled ? '生效' : '未生效' }}</span>
                </div>
            </div>
            <!-- AI 增强检测开关（默认关闭：不下载模型、零网络请求） -->
            <div class="mt-4 p-3 rounded-lg bg-muted/50">
                <div class="flex items-center justify-between">
                    <div class="pr-3">
                        <p class="text-sm font-medium text-foreground">
                            启用 AI 增强检测</p>
                        <p class="text-xs text-muted-foreground mt-0.5">
                            识别姓名、地址等无固定格式内容；需下载约 180MB 模型</p>
                    </div>
                    <Switch v-model="store.aiEnabled" size="small"
                        @update:model-value="(v: boolean) => store.setAiEnabled(v)" />
                </div>
                <!-- 加载进度 -->
                <div v-if="store.nerStatus === 'loading'" class="mt-2 w-full">
                    <div class="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>下载模型中...</span>
                        <span>{{ progressLabel }}</span>
                    </div>
                    <div class="w-full bg-muted rounded-full h-1.5">
                        <div class="bg-primary h-1.5 rounded-full transition-all duration-300"
                            :style="{ width: store.nerLoadProgress + '%' }"></div>
                    </div>
                </div>
                <!-- 失败提示（关闭开关或重试） -->
                <p v-if="store.nerStatus === 'error' || store.nerStatus === 'timeout'"
                    class="mt-2 text-xs text-warning">
                    {{ store.nerError || '模型下载失败，可关闭后重试；基础检测不受影响' }}
                </p>
            </div>
            <!-- NER 模型操作 -->
            <div
                v-if="store.nerStatus === 'error' || store.nerStatus === 'timeout'"
                class="mt-4 p-3 bg-warning/10 rounded-lg border border-warning/30"
            >
                <div class="flex items-center justify-between">
                <div>
                    <p class="text-sm font-medium text-warning">
                    NER模型未加载
                    </p>
                    <p class="text-xs text-warning">
                    {{ store.nerError || '基础检测功能仍可正常使用' }}
                    </p>
                </div>
                <Button
                    @click="store.retryLoadNER"
                    variant="secondary"
                    btnType="outline"
                    size="sm"
                >
                    重试
                </Button>
                </div>
            </div>
        </div>
        <!-- NER 模型状态条 -->
        <Transition name="ner-notify" @after-leave="onNotifyLeave">
            <div v-if="store.nerStatus === 'loading' && !dismissing"
                class="fixed z-50 left-1/2 -translate-x-1/2 top-[calc(var(--header-height)+8px)] m-3 p-3 max-w-125 min-w-80 w-auto
                    flex flex-col items-center gap-0.5
                    bg-card rounded-lg shadow-lg 
                    border border-primary/30">
                <div class="flex justify-between items-start w-full">
                    <p class="text-sm font-medium text-foreground">
                        正在加载NER模型...</p>
                    <div class="mt-1">
                        <svg class="w-4 h-4 text-primary animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10"
                                stroke="currentColor" stroke-width="4"/>
                            <path class="opacity-75" fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                        </svg>
                    </div>
                </div>
                <p v-if="store.nerLoadProgress === 0 && !store.nerIndeterminate"
                    class="text-xs text-primary w-full mt-1">
                    首次使用需要下载模型（约 180MB，量化版），请稍候</p>
                <div v-else class="w-full mt-1">
                    <div class="flex justify-between text-xs text-primary mb-1">
                        <span>下载中...</span>
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
                        {{ store.nerStatus === 'timeout' ? 'NER模型加载超时' : 'NER模型加载失败' }}</p>
                    <p class="text-xs text-warning mt-0.5">
                        {{ store.nerError || '基础检测功能仍可正常使用' }}</p>
                </div>
                <Button @click="store.retryLoadNER"
                    variant="secondary" btnType="outline" size="sm">
                    重试</Button>
                <svg class="w-5 h-5 text-warning" fill="none"
                    stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                </svg>
            </div>
        </Transition>
        <!-- NER 模型下载提示 - 成功 -->
        <Transition name="ner-notify" @after-leave="onNotifyLeave">
            <div v-if="store.nerStatus === 'success' && !dismissing"
                class="fixed z-50 left-1/2 -translate-x-1/2 top-[calc(var(--header-height)+8px)] m-3 p-3 gap-3 flex items-center max-w-125 min-w-80 w-auto
                    bg-card rounded-lg shadow-lg 
                    border border-success/40">
                <div class="flex-1">
                    <p class="text-sm font-medium text-success">
                        NER模型已就绪</p>
                    <p class="text-xs text-success mt-0.5">
                        增强检测已启用</p>
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
            hasResults && `min-h-[calc(100vh-58px)] min-[820px]:flex-row min-[820px]:h-[calc(100vh-64px)]`
            ]">
            <!-- 左侧列 -->
            <div :class="[
                'flex flex-col min-w-100',
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
                <!-- 场景 Tab -->
                <ProfileTabs />
                <!-- 输入项 -->
                <div :class="['px-3 pt-3',
                    hasDetected && `
                        min-[820px]:py-3
                        min-[820px]:flex 
                        min-[820px]:flex-col 
                        min-[820px]:flex-1 
                        min-[820px]:min-h-0`
                ]">
                    <InputArea v-model="inputText" :is-processing="showOverlay"
                        @detect="handleDetect" @clear="handleClear"/>
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