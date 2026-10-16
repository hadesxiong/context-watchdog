<script setup lang="ts">
import { ref, computed, watch, onUnmounted, onMounted } from 'vue'
import { useDetectionStore } from '../stores/detection'
import InputArea from '../components/InputArea.vue'
import DetectionList from '../components/DetectionList.vue'
import ActionBar from '../components/ActionBar.vue'
import ProfileTabs from '../components/ProfileTabs.vue'
import { Button, LoadingOverlay } from '../ui'

const store = useDetectionStore()
const inputText = ref('')
const showOverlay = ref(false)
const hasResults = computed(() => store.detections.length > 0)
const showEngineStatus = ref(false)

// [NER-disabled] 网络环境较差时禁用，启用时取消注释
onMounted(() => {
    store.initNER()
})

// WebDevtools 状态测试
;(window as any).__store = store

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
</script>

<template>
    <div class="min-h-screen bg-linear-to-br relative
        from-gray-50 to-gray-100 
        dark:from-gray-900 dark:to-gray-950">
        <!-- 头部 -->
        <header class="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
            <div class="p-3">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-sm bg-linear-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-sm">
                        </div>
                        <div class="flex items-baseline gap-2">
                            <h1 class="text-lg font-semibold text-gray-900 dark:text-white">
                                PasteGuard</h1>
                            <p class="text-sm text-gray-500 dark:text-gray-400">
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
                            :class="{ 'text-green-600 dark:text-green-400': store.isNERReady }">
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
            class="p-3 rounded-sm shadow-sm border fixed z-20
                bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"
                :style="{ top: 'var(--header-height)', right: '12px' }">
            <div class="flex items-center justify-between mb-4">
                <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">
                    检测引擎状态</h3>
                <button @click="showEngineStatus = false"
                    class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
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
                    class="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-900">
                    <div class="flex items-center gap-3">
                        <!-- <div
                        :class="[
                            'w-2 h-2 rounded-full',
                            item.enabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
                        ]"
                        /> -->
                        <div>
                            <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
                                {{ item.name }}
                            </p>
                            <p class="text-xs text-gray-500 dark:text-gray-400">
                                {{ item.description }}
                            </p>
                        </div>
                    </div>
                    <span :class="[
                        'text-xs font-medium px-2 py-1 rounded-full',
                        item.enabled
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                        ]">
                        {{ item.enabled ? '生效' : '未生效' }}</span>
                </div>
            </div>
            <!-- NER 模型操作 -->
            <div
                v-if="store.nerStatus === 'error' || store.nerStatus === 'timeout'"
                class="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800"
            >
                <div class="flex items-center justify-between">
                <div>
                    <p class="text-sm font-medium text-yellow-700 dark:text-yellow-300">
                    NER模型未加载
                    </p>
                    <p class="text-xs text-yellow-500 dark:text-yellow-400">
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
                class="fixed z-20 left-1/2 -translate-x-1/2 m-3 p-3 max-w-125 min-w-80 w-auto
                    flex flex-col items-center gap-0.5
                    bg-blue-50 dark:bg-blue-900/20 rounded-sm 
                    border border-blue-200 dark:border-blue-800">
                <div class="flex justify-between items-start w-full">
                    <p class="text-sm font-medium text-blue-700 dark:text-blue-300">
                        正在加载NER模型...</p>
                    <div class="mt-1">
                        <svg class="w-4 h-4 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10"
                                stroke="currentColor" stroke-width="4"/>
                            <path class="opacity-75" fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                        </svg>
                    </div>
                </div>
                <p v-if="store.nerLoadProgress === 0" class="text-xs text-blue-500 dark:text-blue-400 w-full mt-1">
                        首次使用需要下载模型，请稍候</p>
                <div v-else class="w-full mt-1">
                    <div class="flex justify-between text-xs text-blue-500 mb-1">
                        <span>下载中...</span>
                        <span>{{ Number(store.nerLoadProgress || 0).toFixed(2) }}%</span>
                    </div>
                    <div class="w-full bg-blue-200 rounded-full h-1.5">
                        <div class="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                            :style="{ width: store.nerLoadProgress + '%' }"></div>
                    </div>
                </div>
            </div>
        </Transition>
        <!-- NER 模型下载提示 - 失败 -->
        <Transition name="ner-notify" @after-leave="onNotifyLeave">
            <div v-if="store.nerStatus === 'error' || store.nerStatus === 'timeout' && store.nerRetryCount >= 3 && !dismissing" 
                class="fixed z-20 left-1/2 -translate-x-1/2 m-3 p-3 gap-3 flex items-center max-w-125 min-w-80 w-auto
                    bg-yellow-50 dark:bg-yellow-900/20 rounded-sm 
                    border border-yellow-200 dark:border-yellow-800">
                <div class="flex-1">
                    <p class="text-sm font-medium text-yellow-700 dark:text-yellow-300">
                        {{ store.nerStatus === 'timeout' ? 'NER模型加载超时' : 'NER模型加载失败' }}</p>
                    <p class="text-xs text-yellow-500 dark:text-yellow-400 mt-0.5">
                        {{ store.nerError || '基础检测功能仍可正常使用' }}</p>
                </div>
                <Button @click="store.retryLoadNER"
                    variant="secondary" btnType="outline" size="sm">
                    重试</Button>
                <svg class="w-5 h-5 text-yellow-500" fill="none"
                    stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                </svg>
            </div>
        </Transition>
        <!-- NER 模型下载提示 - 成功 -->
        <Transition name="ner-notify" @after-leave="onNotifyLeave">
            <div v-if="store.nerStatus === 'success' && !dismissing"
                class="fixed z-20 left-1/2 -translate-x-1/2 m-3 p-3 gap-3 flex items-center max-w-125 min-w-80 w-auto
                    bg-green-50 dark:bg-green-900/20 rounded-sm 
                    border border-green-200 dark:border-green-800">
                <div class="flex-1">
                    <p class="text-sm font-medium text-green-700 dark:text-green-300">
                        NER模型已就绪</p>
                    <p class="text-xs text-green-500 dark:text-green-400 mt-0.5">
                        增强检测已启用</p>
                </div>
                <svg class="w-5 h-5 text-green-500" fill="none"
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
                hasResults && `
                    min-[820px]:w-auto 
                    min-[820px]:min-w-100
                    min-[820px]:max-w-125 
                    min-[820px]:h-auto 
                    min-[820px]:overflow-y-auto 
                    min-[820px]:border-r 
                    min-[820px]:min-h-[calc(100vh-64px)]
                    min-[820px]:border-gray-300 
                    dark:min-[820px]:border-gray-700 `
                ]">
                <!-- 场景 Tab -->
                <ProfileTabs />
                <!-- 输入项 -->
                <div :class="['px-3 pt-3',
                    hasResults && `
                        min-[820px]:py-3
                        min-[820px]:flex 
                        min-[820px]:flex-col 
                        min-[820px]:flex-1 
                        min-[820px]:min-h-0`
                ]">
                    <InputArea v-model="inputText" :is-processing="showOverlay"
                        @detect="handleDetect" @clear="handleClear"/>
                </div>
                <!-- 底部操作 -->
                <div v-if="hasResults" class="hidden min-[820px]:block">
                    <ActionBar @copy="handleCopy" @replace-all="store.replaceAll" 
                        @keep-all="store.keepAll"/>
                </div>
            </div>
            <!-- 右侧列 -->
            <div v-if="hasResults" class="flex-1 min-[820px]:flex-1 
                min-[820px]:h-full min-[820px]:overflow-y-auto">
                <!-- 检查结果 -->
                <div class="p-3">
                    <DetectionList v-if="hasResults"
                        :detections="store.detections"/>
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
</style>