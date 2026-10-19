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

const localText = ref(props.modelValue)

watch(
    () => props.modelValue,
    (newVal) => {
        localText.value = newVal
    }
)

watch(localText, (newVal) => {
    emit('update:modelValue', newVal)
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
</script>

<template>
    <div class="flex flex-col gap-3 h-full">
        <div class="flex items-center w-full justify-between gap-2">
            <div class="flex items-center gap-2 min-w-0">
                <!-- <label class="text-base font-bold text-foreground shrink-0">
                    输入文本</label> -->
                <!-- 档案下拉选择器（App 侧注入） -->
                <slot name="profile" />
            </div>
            <div class="p-0 flex gap-3 bg-background/50 shrink-0">
                <Button variant="primary" btnType="text"
                    @click="handleDetect"
                    :disabled="!localText.trim() || isProcessing"
                    :loading="isProcessing"
                    class="w-fit button-fixed">
                    {{ isProcessing ? '检测中...' : '检测' }}</Button>
                <Button variant="danger" btnType="text"
                    @click="handleClear"
                    :disabled="!localText.trim() || isProcessing"
                    class="w-fit button-fixed">
                    清空</Button>
            </div>
        </div>

        <div class="p-0 min-[720px]:flex-1 min-[720px]:flex min-[720px]:flex-col">
            <textarea
                v-model="localText"
                placeholder="粘贴或输入包含敏感信息的文本..."
                class="w-full min-h-40 h-full px-3 py-2 text-sm font-mono rounded-sm resize-none 
                text-foreground bg-background 
                border border-border 
                focus:outline-none focus:ring-1 focus:ring-ring focus:border-transparent placeholder:text-muted-foreground transition-all duration-200"
                :disabled="isProcessing"></textarea>
        </div>
    </div>
</template>

<style scoped>
.button-fixed {
    box-shadow: none !important;
}
</style>