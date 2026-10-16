<script setup lang="ts">
import { computed } from 'vue'
import type { DetectionItem } from '../core/types'
import { useDetectionStore } from '../stores/detection'
import { getPlaceholderDisplayText, getTypeDisplayName } from '../core/replacer/placeholder'
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
    switch (props.item.confidence) {
        case 'high':
            return { variant: 'success' as const, label: '高' }
        case 'medium':
            return { variant: 'warning' as const, label: '中' }
        case 'low':
            return { variant: 'danger' as const, label: '低' }
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
    <Card hover class="transition-all duration-200 min-w-[320px]">
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
