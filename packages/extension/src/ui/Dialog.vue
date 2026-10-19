<script setup lang="ts">
// 通用对话框（shadcn Dialog 风格）：遮罩 + 居中卡片 + 进出动画
// 基于 reka-ui Dialog，teleport 到 body 避免父容器裁剪
import {
    DialogRoot,
    DialogPortal,
    DialogOverlay,
    DialogContent,
    DialogTitle,
    DialogDescription
} from 'reka-ui'

interface Props {
    open: boolean
    title?: string
    description?: string
    width?: string
}

withDefaults(defineProps<Props>(), {
    title: '',
    description: '',
    width: 'max-w-md'
})

const emit = defineEmits<{
    (e: 'update:open', value: boolean): void
    (e: 'close'): void
}>()

const onOpenChange = (open: boolean) => {
    emit('update:open', open)
    if (!open) emit('close')
}
</script>

<template>
    <DialogRoot :open="open" @update:open="onOpenChange">
        <DialogPortal>
            <DialogOverlay
                class="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]
                    data-[state=open]:pg-fade-in
                    data-[state=closed]:pg-fade-out" />
            <DialogContent
                :class="[
                    'fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2',
                    'max-h-[calc(100vh-4rem)] overflow-hidden flex flex-col',
                    'rounded-lg border border-border bg-card text-card-foreground shadow-lg',
                    // 各区域（标题/正文/操作区）占满弹窗宽度，边距由各区自身 padding 提供
                    'p-0',
                    'data-[state=open]:pg-dialog-in data-[state=closed]:pg-dialog-out',
                    width
                ]">
                <!-- 标题区：独立固定（shrink-0），长表单滚动时标题/描述/关闭按钮不跟随；
                     占满弹窗宽度、自身 px-4 提供边距，border-b 与底部操作区的 border-t 呼应 -->
                <div class="flex items-start justify-between gap-3 shrink-0 px-4 pt-4 pb-3 border-b border-border">
                    <div class="space-y-1">
                        <DialogTitle v-if="title" class="text-base font-semibold text-foreground">
                            {{ title }}
                        </DialogTitle>
                        <DialogDescription v-if="description" class="text-xs text-muted-foreground">
                            {{ description }}
                        </DialogDescription>
                    </div>
                    <!-- 关闭按钮 -->
                    <button
                        @click="onOpenChange(false)"
                        class="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground
                            hover:bg-accent transition-colors
                            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        <span class="sr-only">关闭</span>
                    </button>
                </div>
                <!-- 正文滚动区：仅内容滚动（含长表单），overscroll-contain 防滚动穿透到页面 -->
                <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                    <slot />
                </div>
            </DialogContent>
        </DialogPortal>
    </DialogRoot>
</template>

<style scoped>
/* 对话框进出动画（tailwind 4 无内建 animate-in，自定义实现） */
@keyframes pg-fade {
    from { opacity: 0; }
    to { opacity: 1; }
}
@keyframes pg-dialog {
    from {
        opacity: 0;
        transform: translate(-50%, -50%) scale(0.96);
    }
    to {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
    }
}
:deep([data-state='open'].pg-fade-in) {
    animation: pg-fade 0.2s ease-out;
}
:deep([data-state='closed'].pg-fade-out) {
    animation: pg-fade 0.15s ease-in reverse;
}
:deep([data-state='open'].pg-dialog-in) {
    animation: pg-dialog 0.2s ease-out;
}
:deep([data-state='closed'].pg-dialog-out) {
    animation: pg-dialog 0.15s ease-in reverse;
}
</style>
