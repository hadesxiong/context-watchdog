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
        <div class="flex flex-wrap gap-3">
            <Button @click="handleCopy" variant="primary" class="flex-1 min-w-35">
                <!-- <svg v-if="!copySuccess" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                </svg>
                <svg v-else class="w-4 h-4 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M5 13l4 4L19 7"/>
                </svg> -->
                {{ copySuccess ? t('action_copied') : t('action_copy') }}
            </Button>
            <Button @click="handleReplaceAll" variant="secondary" btn-type="outline"
                class="flex-1">{{ t('action_replace_all') }}</Button>
            <Button @click="handleKeepAll" variant="secondary" btn-type="outline"
                class="flex-1">{{ t('action_keep_all') }}</Button>
        </div>
  </div>
</template>
