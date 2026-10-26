<script setup lang="ts">
// 自定义档案编辑面板：编辑本地草稿，保存时才提交；内置档案不渲染本组件。字段清单见 docs/spec.md §5
import { ref, reactive, watch } from 'vue'
import { useDetectionStore } from '../stores/detection'
import { Button, Input, Textarea, Switch } from '../ui'
import { validateCustomRule, CUSTOM_PATTERN_MAX_LENGTH } from '@engine/detector/rules/customRules'
import type { ProfileConfig, RuleCategory, Sensitivity, DetectionType, CustomRule } from '@engine/types'
import { useI18n } from '../i18n'

const { t, typeLabel } = useI18n()

const emit = defineEmits<{
    (e: 'close'): void
    (e: 'delete'): void
}>()

const store = useDetectionStore()

// ---- 本地草稿（深拷贝激活档案，避免直接改 store） ----
const draft = reactive<ProfileConfig>(structuredClone(store.activeProfile))
// customRules 可选字段 → 组件内按必备数组操作，保存时写回 draft
const customRules = ref<CustomRule[]>([...(draft.customRules || [])])
const whitelistText = ref((store.activeProfile.whitelist || []).join('\n'))
const error = ref('')
const saving = ref(false)

// ---- 自定义正则规则 ----
const newRule = reactive<{ name: string; pattern: string; type: DetectionType; confidence: 'high' | 'medium' | 'low' }>({
    name: '',
    pattern: '',
    type: 'ENV_PASSWORD',
    confidence: 'high'
})
const ruleError = ref('')
const showRuleForm = ref(false)

// 类型只存 key，显示名统一走 typeLabel()（词条随语言变化，不在此求值）
const RULE_TYPE_OPTIONS: DetectionType[] = [
    'ENV_PASSWORD',
    'API_KEY',
    'DB_PASSWORD',
    'JWT',
    'PRIVATE_KEY',
    'HIGH_ENTROPY',
    'EMAIL',
    'PHONE',
    'ID_CARD',
    'BANK_CARD',
    'IP_ADDRESS',
    'PLATE',
    'NAME',
    'ADDRESS',
    'SSN',
    'EIN',
    'IBAN',
    'VAT'
]

const addRule = () => {
    ruleError.value = ''
    const validation = validateCustomRule(newRule, customRules.value)
    if (!validation.ok) {
        ruleError.value = validation.error || t('ps_rule_err_invalid')
        return
    }

    customRules.value.push({
        id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: newRule.name.trim(),
        pattern: newRule.pattern.trim(),
        type: newRule.type,
        confidence: newRule.confidence,
        enabled: true
    } as CustomRule)

    newRule.name = ''
    newRule.pattern = ''
    showRuleForm.value = false
}

const removeRule = (id: string) => {
    const idx = customRules.value.findIndex(r => r.id === id)
    if (idx >= 0) customRules.value.splice(idx, 1)
}

// ---- 档案导入导出 ----
const ioMessage = ref('')
const ioError = ref('')

const onExport = async () => {
    ioError.value = ''
    const json = store.exportProfilesJson()
    if (!json) {
        ioMessage.value = ''
        ioError.value = t('ps_err_no_export')
        return
    }
    try {
        await navigator.clipboard.writeText(json)
        ioMessage.value = t('ps_ok_exported')
        ioError.value = ''
    } catch {
        ioError.value = t('ps_err_copy_failed')
    }
}

const onImport = async () => {
    ioMessage.value = ''
    ioError.value = ''
    let json = ''
    try {
        json = await navigator.clipboard.readText()
    } catch {
        ioError.value = t('ps_err_read_failed')
        return
    }
    if (!json.trim()) {
        ioError.value = t('ps_err_empty_clipboard')
        return
    }
    try {
        const count = await store.importProfilesJson(json)
        ioMessage.value = t('ps_ok_imported', { count })
    } catch (e) {
        ioError.value = e instanceof Error ? e.message : t('ps_err_import_failed')
    }
}

// GLiNER 标签预设（须与 profiles.ts 内置集保持一致）
const LABEL_PRESETS: Record<string, string[]> = {
    pii: ['person name', 'phone number', 'home address', 'email address', 'ID card number', 'bank card number'],
    secret: ['password', 'secret', 'api key', 'access token', 'private key', 'connection string']
}
LABEL_PRESETS.all = [...LABEL_PRESETS.pii, ...LABEL_PRESETS.secret]

// 预设按钮显示名走词条；标签本身是 GLiNER 的英文标签，不能翻译
const LABEL_PRESET_LABELS: Record<'pii' | 'secret' | 'all' | 'custom', string> = {
    pii: 'ps_label_preset_pii',
    secret: 'ps_label_preset_secret',
    all: 'ps_label_preset_all',
    custom: 'ps_label_preset_custom'
}

const currentPreset = ref<'pii' | 'secret' | 'all' | 'custom'>(
    LABEL_PRESETS.all.join('|') === draft.glinerLabels.join('|') ? 'all'
    : LABEL_PRESETS.pii.join('|') === draft.glinerLabels.join('|') ? 'pii'
    : LABEL_PRESETS.secret.join('|') === draft.glinerLabels.join('|') ? 'secret'
    : 'custom'
)
const customLabelsText = ref(draft.glinerLabels.join(', '))

watch(currentPreset, preset => {
    if (preset !== 'custom') {
        draft.glinerLabels = [...LABEL_PRESETS[preset]]
        customLabelsText.value = draft.glinerLabels.join(', ')
    }
})

watch(customLabelsText, () => {
    if (currentPreset.value === 'custom') {
        draft.glinerLabels = customLabelsText.value
            .split(',')
            .map(l => l.trim())
            .filter(l => l !== '')
            .slice(0, 30)
    }
})

// ---- 类别开关 ----
const CATEGORY_LABELS: Array<{ key: RuleCategory; labelKey: string }> = [
    { key: 'secret', labelKey: 'ps_category_secret' },
    { key: 'pii', labelKey: 'ps_category_pii' },
    { key: 'entropy', labelKey: 'ps_category_entropy' },
    { key: 'us', labelKey: 'ps_category_us' },
    { key: 'eu', labelKey: 'ps_category_eu' }
]

const toggleCategory = (cat: RuleCategory) => {
    const idx = draft.enabledCategories.indexOf(cat)
    if (idx >= 0) draft.enabledCategories.splice(idx, 1)
    else draft.enabledCategories.push(cat)
}

// ---- 灵敏度档位 ----
const SENSITIVITY_LABELS: Array<{ key: Sensitivity; labelKey: string }> = [
    { key: 'loose', labelKey: 'ps_sensitivity_loose' },
    { key: 'standard', labelKey: 'ps_sensitivity_standard' },
    { key: 'strict', labelKey: 'ps_sensitivity_strict' }
]

// ---- 分类型默认策略（Switch：开 = 替换，关 = 保留） ----
const ACTION_TYPES: DetectionType[] = [
    'ENV_PASSWORD',
    'API_KEY',
    'DB_PASSWORD',
    'HIGH_ENTROPY',
    'EMAIL',
    'PHONE',
    'ID_CARD',
    'BANK_CARD',
    'IP_ADDRESS',
    'PLATE',
    'SSN',
    'EIN',
    'IBAN',
    'VAT'
]

const currentAction = (key: DetectionType): 'replace' | 'keep' =>
    draft.defaultActions[key] || 'replace'

const setDefaultAction = (key: DetectionType, replace: boolean) => {
    draft.defaultActions = { ...draft.defaultActions, [key]: replace ? 'replace' : 'keep' }
}

// ---- 保存 ----
const onSave = async () => {
    error.value = ''
    draft.whitelist = whitelistText.value
        .split('\n')
        .map(w => w.trim())
        .filter(w => w !== '')
        .slice(0, 200)
    draft.customRules = [...customRules.value]

    saving.value = true
    try {
        await store.updateUserProfile(draft)
        emit('close')
    } catch (e) {
        error.value = e instanceof Error ? e.message : t('ps_err_save_failed')
    } finally {
        saving.value = false
    }
}
</script>

<template>
    <!-- 表单主体：外壳（标题/遮罩/关闭/动画）由外层 Dialog 提供；与底部操作区同为
         弹窗 100% 宽度，边距由自身 padding 提供 -->
    <div class="text-sm px-4 py-4 space-y-4">
        <div class="space-y-3">
            <div class="space-y-1.5">
                <label class="block text-sm font-medium text-foreground">{{ t('ps_name') }}</label>
                <Input v-model="draft.name" maxlength="20" :placeholder="t('ps_name_placeholder')" />
            </div>
            <div class="space-y-1.5">
                <label class="block text-sm font-medium text-foreground">{{ t('ps_description') }}</label>
                <Input v-model="draft.description" maxlength="100"
                    :placeholder="t('ps_description_placeholder')" />
            </div>
        </div>

        <!-- 规则类别开关：流式换行——词条长短差异很大，单行 flex 会把长词条挤成多行窄块 -->
        <div class="space-y-1.5">
            <label class="block text-sm font-medium text-foreground">{{ t('ps_categories') }}</label>
            <div class="flex flex-wrap gap-x-4 gap-y-2">
                <label v-for="cat in CATEGORY_LABELS" :key="cat.key"
                    class="flex items-center gap-1.5 cursor-pointer text-sm text-foreground">
                    <input type="checkbox" :checked="draft.enabledCategories.includes(cat.key)"
                        @change="toggleCategory(cat.key)" class="accent-primary h-3.5 w-3.5 shrink-0" />
                    {{ t(cat.labelKey) }}
                </label>
            </div>
        </div>

        <div class="space-y-1.5">
            <label class="block text-sm font-medium text-foreground">{{ t('ps_entropy_sensitivity') }}</label>
            <div class="flex gap-1.5">
                <button v-for="s in SENSITIVITY_LABELS" :key="s.key"
                    @click="draft.sensitivity = { ...draft.sensitivity, entropy: s.key }"
                    :class="[
                        'px-3 py-1.5 rounded-md border text-sm font-medium transition-colors',
                        (draft.sensitivity.entropy || 'standard') === s.key
                            ? 'border-ring text-primary bg-primary/10'
                            : 'border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    ]">
                    {{ t(s.labelKey) }}
                </button>
            </div>
        </div>

        <label class="flex items-center gap-1.5 cursor-pointer text-sm text-foreground">
            <input type="checkbox" v-model="draft.tierLowConfidence" class="accent-primary h-3.5 w-3.5" />
            {{ t('ps_tier_low') }}
        </label>

        <div class="space-y-1.5">
            <label class="block text-sm font-medium text-foreground">{{ t('ps_default_actions') }}</label>
            <div class="grid grid-cols-2 gap-x-4 gap-y-2">
                <div v-for="type in ACTION_TYPES" :key="type"
                    class="flex items-center justify-between gap-2 text-sm text-foreground">
                    <span class="truncate">{{ typeLabel(type) }}</span>
                    <span class="flex items-center gap-1.5 shrink-0">
                        <span class="w-7 text-right text-xs"
                            :class="currentAction(type) === 'replace' ? 'text-primary' : 'text-muted-foreground'">
                            {{ currentAction(type) === 'replace' ? t('common_replace') : t('common_keep') }}
                        </span>
                        <Switch size="small"
                            :model-value="currentAction(type) === 'replace'"
                            @update:model-value="setDefaultAction(type, $event)" />
                    </span>
                </div>
            </div>
        </div>

        <div class="space-y-1.5">
            <label class="block text-sm font-medium text-foreground">{{ t('ps_whitelist') }}</label>
            <Textarea v-model="whitelistText" :rows="3" placeholder="example.com&#10;test-account-001" />
            <p class="text-xs text-muted-foreground">{{ t('ps_whitelist_help') }}</p>
        </div>

        <div class="space-y-1.5">
            <div class="flex items-center justify-between">
                <label class="block text-sm font-medium text-foreground">
                    {{ t('ps_custom_rules', { count: customRules.length }) }}</label>
                <Button variant="secondary" btnType="text" size="sm" @click="showRuleForm = !showRuleForm">
                    {{ showRuleForm ? t('common_collapse') : t('ps_rule_add_short') }}</Button>
            </div>

            <div v-for="rule in customRules" :key="rule.id"
                class="flex items-center gap-2 p-2 rounded-md bg-muted/50 border border-border">
                <input type="checkbox" v-model="rule.enabled" class="accent-primary h-3.5 w-3.5 shrink-0"
                    :title="rule.enabled ? t('ps_rule_enabled') : t('ps_rule_disabled')" />
                <div class="flex-1 min-w-0">
                    <p class="text-sm text-foreground truncate">{{ rule.name }}
                        <span class="text-xs text-muted-foreground">→ {{ typeLabel(rule.type) }}</span>
                    </p>
                    <p class="text-xs text-muted-foreground font-mono truncate">{{ rule.pattern }}</p>
                </div>
                <button @click="removeRule(rule.id)"
                    class="text-muted-foreground hover:text-destructive shrink-0 p-1 rounded-md
                        hover:bg-destructive/10 transition-colors" :title="t('ps_rule_delete')">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>
            </div>

            <div v-if="showRuleForm" class="p-3 space-y-1.5 rounded-md border border-primary/20 bg-primary/5">
                <Input v-model="newRule.name" maxlength="20" :placeholder="t('ps_rule_name_placeholder')" />
                <Input v-model="newRule.pattern" :maxlength="CUSTOM_PATTERN_MAX_LENGTH"
                    :placeholder="t('ps_rule_pattern_placeholder')" />
                <div class="flex gap-1.5">
                    <select v-model="newRule.type"
                        class="flex-1 px-2 py-1.5 rounded-md border border-input bg-background text-sm text-foreground
                            focus:outline-none focus:ring-1 focus:ring-ring focus:border-transparent">
                        <option v-for="opt in RULE_TYPE_OPTIONS" :key="opt" :value="opt">{{ typeLabel(opt) }}</option>
                    </select>
                    <select v-model="newRule.confidence"
                        class="px-2 py-1.5 rounded-md border border-input bg-background text-sm text-foreground
                            focus:outline-none focus:ring-1 focus:ring-ring focus:border-transparent">
                        <option value="high">{{ t('ps_rule_confidence_high') }}</option>
                        <option value="medium">{{ t('ps_rule_confidence_medium') }}</option>
                        <option value="low">{{ t('ps_rule_confidence_low') }}</option>
                    </select>
                </div>
                <p v-if="ruleError" class="text-destructive text-xs">{{ ruleError }}</p>
                <Button class="w-full" size="sm" @click="addRule">{{ t('ps_rule_add') }}</Button>
            </div>
            <p class="text-xs text-muted-foreground">
                {{ t('ps_rule_redos_hint') }}
            </p>
        </div>

        <div class="space-y-1.5">
            <label class="block text-sm font-medium text-foreground">{{ t('ps_ai_labels') }}</label>
            <div class="flex gap-1.5 flex-wrap">
                <button v-for="(preset, key) in LABEL_PRESET_LABELS"
                    :key="key" @click="currentPreset = key as typeof currentPreset"
                    :class="[
                        'px-3 py-1.5 rounded-md border text-sm font-medium transition-colors',
                        currentPreset === key
                            ? 'border-ring text-primary bg-primary/10'
                            : 'border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    ]">
                    {{ t(preset) }}
                </button>
            </div>
            <Textarea v-if="currentPreset === 'custom'" v-model="customLabelsText" :rows="2"
                placeholder="person name, phone number" />
        </div>
    </div>

    <!-- 操作区：sticky 固定于弹窗可视区底部（不随内容滚动）；关闭由标题栏 × / Esc 承担，不设取消 -->
    <div class="sticky bottom-0 bg-card border-t border-border px-4 pt-3 pb-4 space-y-1.5">
        <div class="flex items-center gap-2">
            <Button variant="secondary" btnType="outline"
                :title="t('ps_export_title')" @click="onExport">{{ t('ps_export') }}</Button>
            <Button variant="secondary" btnType="outline"
                :title="t('ps_import_title')" @click="onImport">{{ t('ps_import') }}</Button>
            <div class="ml-auto flex items-center gap-2">
                <Button variant="danger" @click="emit('delete')">
                    {{ t('ps_delete') }}</Button>
                <Button :loading="saving" @click="onSave">
                    {{ saving ? t('common_saving') : t('common_save') }}</Button>
            </div>
        </div>
        <p v-if="error" class="text-destructive text-xs">{{ error }}</p>
        <p v-if="ioMessage" class="text-success text-xs">{{ ioMessage }}</p>
        <p v-if="ioError" class="text-destructive text-xs">{{ ioError }}</p>
    </div>
</template>
