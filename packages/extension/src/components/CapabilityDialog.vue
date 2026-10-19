<script setup lang="ts">
// 能力矩阵（「关于」面板）
//
// 存在的理由：这个扩展有三套彼此独立的「语言/地区」能力，用户很容易把它们
// 当成一回事，于是产生错误的期待——「我切了界面语言，模型是不是就懂中文了？」
// 「我没开美国规则，是不是就漏检了？」
//
// 三轴，正交，必须分开说：
//   1. 界面语言     真 i18n（UI 文案 + 占位符都跟随）
//   2. 区域规则集   随档案切换（默认关，避免给他区抬高误报）
//   3. 模型语言能力 不作承诺（本地小模型对拉丁语系更稳，中文靠正则档）
//
// 顺带把两件容易被误解的事写清楚：数据不出本机、功能不打赏解锁。
import { computed } from 'vue'
import { Dialog, Badge, Button } from '../ui'
import { useI18n } from '../i18n'
import { useDetectionStore } from '../stores/detection'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', value: boolean): void }>()

const store = useDetectionStore()
const { t, locale, localeNames, profileLabel } = useI18n()

const profileName = computed(() => profileLabel(store.activeProfile).name)

const REGION_CATEGORIES = ['us', 'eu'] as const

// 当前档案启用了哪些区域规则集（没启用时给出明确说明，而不是留空让人猜）
const enabledRegions = computed(() =>
    REGION_CATEGORIES.filter(cat => store.activeProfile.enabledCategories.includes(cat))
)
</script>

<template>
    <Dialog :open="open" :title="t('about_title')" @update:open="emit('update:open', $event)">
        <div class="px-4 py-4 space-y-4">
            <p class="text-xs text-muted-foreground leading-relaxed">{{ t('about_subtitle') }}</p>

            <!-- 轴 1：界面语言 -->
            <div class="space-y-1">
                <p class="text-sm font-medium text-foreground">{{ t('about_axis_ui') }}</p>
                <p class="text-xs text-muted-foreground leading-relaxed">
                    {{ t('about_ui_value') }}
                    <Badge variant="info">{{ localeNames[locale] }}</Badge>
                </p>
            </div>

            <!-- 轴 2：区域规则集 -->
            <div class="space-y-1">
                <p class="text-sm font-medium text-foreground">{{ t('about_axis_rules') }}</p>
                <p class="text-xs text-muted-foreground leading-relaxed">
                    {{ t('about_rules_current', { name: profileName }) }}
                    <Badge :variant="enabledRegions.length ? 'success' : 'default'">
                        {{ enabledRegions.length
                            ? enabledRegions.map(c => t(`ps_category_${c}`)).join(' / ')
                            : t('about_rules_regions_off') }}
                    </Badge>
                </p>
            </div>

            <!-- 轴 3：模型语言能力（唯一一处明确「不承诺」的地方） -->
            <div class="space-y-1">
                <p class="text-sm font-medium text-foreground">{{ t('about_axis_model') }}</p>
                <p class="text-xs text-muted-foreground leading-relaxed">{{ t('about_model_value') }}</p>
            </div>

            <p class="text-xs text-muted-foreground leading-relaxed border-t border-border pt-3">
                {{ t('about_axes_note') }}
            </p>

            <!-- 数据去向 + 价格：两句声明，都是产品承诺，不含功能暗示 -->
            <div class="space-y-2 border-t border-border pt-3">
                <p class="text-xs leading-relaxed">
                    <span class="font-medium text-foreground">{{ t('about_privacy_title') }}</span>
                    <span class="text-muted-foreground">{{ t('about_privacy_value') }}</span>
                </p>
                <p class="text-xs leading-relaxed">
                    <span class="font-medium text-foreground">{{ t('about_price_title') }}</span>
                    <span class="text-muted-foreground">{{ t('about_price_value') }}</span>
                </p>
            </div>

            <div class="flex justify-end">
                <Button variant="secondary" btnType="outline" size="sm"
                    @click="emit('update:open', false)">{{ t('common_close') }}</Button>
            </div>
        </div>
    </Dialog>
</template>
