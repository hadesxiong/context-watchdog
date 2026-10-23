<script setup lang="ts">
// 能力矩阵（「关于」面板）
//
// 存在的理由：这个扩展有三套彼此独立的「语言/地区」能力，用户很容易把它们
// 当成一回事，于是产生错误的期待——「我切了界面语言，模型是不是就懂中文了？」
// 「我没开美国规则，是不是就漏检了？」
//
// 面板按 1-5 编号列出五条强调：区域规则集（随档案切换、可自定义）、模型语言
// 能力（不作承诺，拉丁语系更稳、中文靠正则档）、三轴独立（界面语言/区域规则/
// 模型语言互不影响）、数据（不出本机）、价格（免费、无付费解锁）。
//
// 规则集一栏只讲「可切换、可自定义」，不展示当前档案与区域启停状态——那是
// 设置面板的实时信息，写死在这里只会随状态漂移。
//
// 关闭只保留 Dialog 自带的右上角 X（Esc / 点击遮罩同样可关），不另设底部按钮。
import { Dialog } from '../ui'
import { useI18n } from '../i18n'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', value: boolean): void }>()

const { t } = useI18n()
</script>

<template>
    <Dialog :open="open" :title="t('about_title')" @update:open="emit('update:open', $event)">
        <div class="px-4 py-4 space-y-4">
            <!-- 1 · 区域规则集：只讲「可切换、可自定义」，实时状态留给设置面板 -->
            <div class="space-y-1">
                <p class="text-sm font-medium text-foreground">{{ t('about_axis_rules') }}</p>
                <p class="text-xs text-muted-foreground leading-relaxed">{{ t('about_rules_value') }}</p>
            </div>

            <!-- 2 · 模型语言能力（唯一一处明确「不承诺」的地方） -->
            <div class="space-y-1">
                <p class="text-sm font-medium text-foreground">{{ t('about_axis_model') }}</p>
                <p class="text-xs text-muted-foreground leading-relaxed">{{ t('about_model_value') }}</p>
            </div>

            <!-- 3 · 三轴独立：防止把「界面语言/区域规则/模型覆盖」当成一回事 -->
            <div class="space-y-1">
                <p class="text-sm font-medium text-foreground">{{ t('about_axes_title') }}</p>
                <p class="text-xs text-muted-foreground leading-relaxed">{{ t('about_axes_value') }}</p>
            </div>

            <!-- 4 · 数据 / 5 · 价格：两句声明，都是产品承诺，不含功能暗示 -->
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
