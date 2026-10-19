<script setup lang="ts">
import { computed } from 'vue'
import type { DetectionItem } from '@engine/types'
import { useDetectionStore } from '../stores/detection'
import { getPlaceholderDisplayText, getTypeDisplayName } from '@engine/replacer/placeholder'
import { Badge, Card, Switch } from '../ui'

const props = defineProps<{
    item: DetectionItem
}>()

const store = useDetectionStore()

const currentConfig = computed(() => {
    return store.replaceConfigs.find(c => c.itemId === props.item.id)
})

const isReplace = computed({
    get: () => (currentConfig.value?.action || 'replace') === 'replace',
    set: (val: boolean) => {
        store.setReplaceAction(props.item.id, val ? 'replace' : 'keep')
    }
})

const confidenceConfig = computed(() => {
    // 颜色语义 = 风险等级（红=高风险/黄=中/绿=低），与「高=分析认为是敏感信息」的直觉一致
    switch (props.item.confidence) {
        case 'high':
            return { variant: 'danger' as const, label: '高' }
        case 'medium':
            return { variant: 'warning' as const, label: '中' }
        case 'low':
            return { variant: 'success' as const, label: '低' }
        default:
            return { variant: 'default' as const, label: '未知' }
    }
})

const detectionTypesDisplay = computed(() => {
    const types = props.item.detectionTypes || [props.item.type]
    return types.map(t => getTypeDisplayName(t)).join(' + ')
})
</script>

<template>
    <!-- 宽度交给网格轨道分配：minmax(0,1fr) 不会撑破；min-w 会在窄面板/多列时溢出并被 Accordion 裁切 -->
    <Card hover class="transition-all duration-200">
        <div class="flex flex-col gap-3">
            <!-- 头部: 标题 + 功能 -->
            <div class="flex items-center justify-between gap-4">
                <div class="flex items-center gap-2">
                    <Badge :variant="confidenceConfig.variant" size="sm">
                        {{ confidenceConfig.label }}
                    </Badge>
                    <span class="text-sm font-medium text-muted-foreground">
                        {{ detectionTypesDisplay }}
                    </span>
                </div>
                <!-- 切换: 保留/替换 -->
                <div class="flex items-center gap-2 shrink-0 pt-1">
                    <span class="text-xs font-medium text-foreground/80">
                        {{ isReplace ? '替换' : '保留' }}
                    </span>
                    <Switch v-model="isReplace" type="square" />
                </div>
            </div>
            <!-- 原文 -->
            <div class="flex flex-col gap-1.5">
                <span class="text-xs text-muted-foreground">原文:</span>
                <p class="text-sm font-mono text-foreground truncate bg-muted/50 rounded px-2 py-1">
                    {{ item.original }}
                </p>
            </div>
            <!-- 替换 -->
            <div class="flex flex-col gap-1.5">
                <span class="text-xs text-muted-foreground">替换为:</span>
                <p class="text-sm font-mono text-primary bg-primary/10 rounded px-2 py-1 mt-1">
                    {{ getPlaceholderDisplayText(item.placeholder) }}
                </p>
            </div>
            <!-- 匹配到的内容 -->
            <div v-if="item.context" class="text-xs text-muted-foreground truncate">
                {{ item.context }}
            </div>   
        </div>
    </Card>
</template>
