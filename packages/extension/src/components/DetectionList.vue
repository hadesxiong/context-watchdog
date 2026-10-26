<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DetectionItem } from '@engine/types'
import DetectionItemComponent from './DetectionItem.vue'
import { useI18n } from '../i18n'
import { AccordionRoot, AccordionItem, AccordionHeader, AccordionTrigger, AccordionContent } from 'reka-ui'

const props = defineProps<{
    detections: DetectionItem[]
}>()

const groupedDetections = computed(() => {
    const groups: Record<string, DetectionItem[]> = {}

    for (const item of props.detections) {
        if (!groups[item.type]) {
            groups[item.type] = []
        }
        groups[item.type].push(item)
    }

    return groups
})

const { t, typeLabel } = useI18n()

const openTypes = ref<string[]>([])

// 默认全部展开；三角朝向由 openTypes 显式驱动（reka-ui 的 data-[state=open] 变体实测不随折叠切换）
watch(() => props.detections, () => {
    openTypes.value = Object.keys(groupedDetections.value)
}, { immediate: true })
</script>

<template>
    <!-- 容器查询锚点：网格列数随结果列表自身宽度（右栏内宽）而非视口切换 -->
    <div class="@container space-y-4">
        <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
                <h2 class="text-base font-bold text-foreground">
                    {{ t('results_title') }}</h2>
                <span class="px-1.5 my-0.5 self-stretch text-xs leading-normal font-medium rounded-sm 
                        bg-primary/10 text-primary ">
                    {{ detections.length }}</span>
            </div>
        </div>
        <div v-if="detections.length === 0" class="text-center py-12">
            <div
                class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-success/10 mb-4">
                <svg class="w-8 h-8 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
            </div>
            <p class="text-foreground text-sm font-medium">
                {{ t('results_empty_title') }}</p>
            <p class="text-muted-foreground text-xs mt-1">
                {{ t('results_empty_desc') }}</p>
        </div>

        <AccordionRoot v-else v-model="openTypes" type="multiple" :collapsible="true" class="flex flex-col gap-3">
            <AccordionItem v-for="(items, type) in groupedDetections"
                class="overflow-hidden"
                :key="type" :value="type as string">
                <AccordionHeader>
                    <AccordionTrigger
                        class="flex items-center justify-between w-full px-0 pb-3 text-left hover:bg-muted/50 transition-colors">
                        <div class="flex items-center gap-2">
                            <span class="w-2 h-2 rounded-full bg-primary"></span>
                            <span class="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                                {{ typeLabel(type as string) }}
                            </span>
                            <span
                                class="px-1.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground rounded">
                                {{ items.length }}
                            </span>
                        </div>
                        <svg :class="['w-4 h-4 text-muted-foreground transition-transform duration-200 shrink-0',
                                openTypes.includes(type as string) ? 'rotate-180' : '']"
                            fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                        </svg>
                    </AccordionTrigger>
                </AccordionHeader>
                <AccordionContent class="p-0">
                    <!-- 卡片 320 + gap 12 → 2 列需 ≥652、3 列需 ≥984，留余量取 660/1000 -->
                    <div class="grid grid-cols-1 gap-3 
                        @[660px]:grid-cols-2 
                        @[1000px]:grid-cols-3">
                        <DetectionItemComponent v-for="item in items" :key="item.id" :item="item" />
                    </div>
                </AccordionContent>
            </AccordionItem>
        </AccordionRoot>
    </div>
</template>
