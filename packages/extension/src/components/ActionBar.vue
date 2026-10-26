<script setup lang="ts">
import { ref } from 'vue'
import { useDetectionStore } from '../stores/detection'
import { Button } from '../ui'
import { useI18n } from '../i18n'

const { t } = useI18n()

const emit = defineEmits<{
    (e: 'copy'): void
    (e: 'replaceAll'): void
    (e: 'keepAll'): void
}>()

const store = useDetectionStore()
const copySuccess = ref(false)

const handleCopy = async () => {
    const success = await store.copySanitizedText()
    if (success) {
        copySuccess.value = true
        setTimeout(() => {
            copySuccess.value = false
        }, 2000)
    }
    emit('copy')
}

const handleReplaceAll = () => {
    store.replaceAll()
    emit('replaceAll')
}

const handleKeepAll = () => {
    store.keepAll()
    emit('keepAll')
}
</script>

<template>
  <div class="bg-card shadow-sm border-t border-border p-3">
        <!-- 三按钮等分且不换行（换行会让栏高随语言文案长度跳动）；
             省略号需块级包裹层，Button 的 slot 是裸文本节点，故每格套一层 span -->
        <div class="flex gap-2">
            <Button @click="handleCopy" variant="primary" class="flex-1 min-w-0">
                <!-- <svg v-if="!copySuccess" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                </svg>
                <svg v-else class="w-4 h-4 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M5 13l4 4L19 7"/>
                </svg> -->
                <span class="truncate min-w-0">{{ copySuccess ? t('action_copied') : t('action_copy') }}</span>
            </Button>
            <Button @click="handleReplaceAll" variant="secondary" btn-type="outline"
                class="flex-1 min-w-0"><span class="truncate min-w-0">{{ t('action_replace_all') }}</span></Button>
            <Button @click="handleKeepAll" variant="secondary" btn-type="outline"
                class="flex-1 min-w-0"><span class="truncate min-w-0">{{ t('action_keep_all') }}</span></Button>
        </div>
  </div>
</template>
