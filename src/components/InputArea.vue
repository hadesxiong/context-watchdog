<script setup lang="ts">
import { ref, watch } from 'vue'
import { Button } from '../ui'

const props = defineProps<{
    modelValue: string
    isProcessing: boolean
}>()

const emit = defineEmits<{
    (e: 'update:modelValue', value: string): void
    (e: 'detect', text: string): void
    (e: 'clear'): void
}>()

const textareaRef = ref<HTMLTextAreaElement | null>(null)
const localText = ref(props.modelValue)

let debounceTimer: ReturnType<typeof setTimeout> | null = null

watch(
    () => props.modelValue,
    (newVal) => {
        localText.value = newVal
    }
)

watch(localText, (newVal) => {
    emit('update:modelValue', newVal)

    if (debounceTimer) {
        clearTimeout(debounceTimer)
    }

    if (newVal.trim()) {
        debounceTimer = setTimeout(() => {
            emit('detect', newVal)
        }, 300)
    }
})

const handleDetect = () => {
    if (localText.value.trim()) {
        emit('detect', localText.value)
    }
}

const handleClear = () => {
    localText.value = ''
    emit('update:modelValue', '')
    emit('clear')
}

const handlePaste = (_event: ClipboardEvent) => {
    setTimeout(() => {
        if (textareaRef.value) {
            localText.value = textareaRef.value.value
        }
    }, 0)
}
</script>

<template>
    <div class="flex flex-col gap-3 h-full">
        <div class="flex items-center w-full justify-between">
            <label class="text-base font-bold text-foreground">
                输入文本</label>
            <div class="p-0 flex gap-3 border-t border-border/50 bg-background/50">
                <Button variant="primary" btnType="text"
                    @click="handleDetect"
                    :disabled="!localText.trim() || isProcessing"
                    :loading="isProcessing"
                    class="w-fit">
                    {{ isProcessing ? '检测中...' : '检测' }}</Button>
                <Button variant="danger" btnType="text"
                    @click="handleClear"
                    :disabled="!localText.trim() || isProcessing"
                    class="w-fit">
                    清空</Button>
            </div>
        </div>

        <div class="p-0 min-[720px]:flex-1 min-[720px]:flex min-[720px]:flex-col">
            <textarea ref="textareaRef"
                v-model="localText"
                @paste="handlePaste"
                placeholder="粘贴或输入包含敏感信息的文本..."
                class="w-full min-h-40 h-full px-3 py-2 text-sm font-mono rounded-sm resize-none 
                text-foreground bg-background 
                border border-border 
                focus:outline-none focus:ring-1 focus:ring-ring focus:border-transparent placeholder:text-muted-foreground transition-all duration-200"
                :disabled="isProcessing"></textarea>
        </div>
    </div>
</template>
