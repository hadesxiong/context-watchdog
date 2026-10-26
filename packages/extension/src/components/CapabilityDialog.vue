<script setup lang="ts">
// 能力矩阵（「关于」面板）：讲清三套彼此独立的能力（界面语言 / 区域规则集 / 模型语言），避免用户混淆期待。
// 规则集一栏只讲「可切换、可自定义」——实时状态属于设置面板，写死在此会随状态漂移。
import { Dialog } from '../ui'
import { useI18n } from '../i18n'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', value: boolean): void }>()

const { t } = useI18n()
</script>

<template>
    <Dialog :open="open" :title="t('about_title')" @update:open="emit('update:open', $event)">
        <div class="px-4 py-4 space-y-4">
            <div class="space-y-1">
                <p class="text-sm font-medium text-foreground">{{ t('about_axis_rules') }}</p>
                <p class="text-xs text-muted-foreground leading-relaxed">{{ t('about_rules_value') }}</p>
            </div>

            <!-- 模型语言能力：全篇唯一明确「不承诺」处 -->
            <div class="space-y-1">
                <p class="text-sm font-medium text-foreground">{{ t('about_axis_model') }}</p>
                <p class="text-xs text-muted-foreground leading-relaxed">{{ t('about_model_value') }}</p>
            </div>

            <div class="space-y-1">
                <p class="text-sm font-medium text-foreground">{{ t('about_axes_title') }}</p>
                <p class="text-xs text-muted-foreground leading-relaxed">{{ t('about_axes_value') }}</p>
            </div>

            <div class="space-y-1">
                <p class="text-sm font-medium text-foreground">{{ t('about_privacy_title') }}</p>
                <p class="text-xs text-muted-foreground leading-relaxed">{{ t('about_privacy_value') }}</p>
            </div>

            <div class="space-y-1">
                <p class="text-sm font-medium text-foreground">{{ t('about_price_title') }}</p>
                <p class="text-xs text-muted-foreground leading-relaxed">{{ t('about_price_value') }}</p>
            </div>
        </div>
    </Dialog>
</template>
