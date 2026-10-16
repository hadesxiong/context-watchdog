<script setup lang="ts">
// 自定义档案编辑面板（Phase 4/5）：类别开关 / 灵敏度 / 默认策略 / 白名单 / AI 标签 / 自定义正则 / 导入导出
// 编辑本地草稿，点击保存时提交；内置档案不渲染本组件
import { ref, reactive, watch } from 'vue'
import { useDetectionStore } from '../stores/detection'
import { validateCustomRule, CUSTOM_PATTERN_MAX_LENGTH } from '../core/detector/rules/customRules'
import type { ProfileConfig, RuleCategory, Sensitivity, DetectionType, CustomRule } from '../core/types'

const emit = defineEmits<{
    (e: 'close'): void
    (e: 'delete'): void
}>()

const store = useDetectionStore()

// ---- 本地草稿（深拷贝激活档案，避免直接改 store） ----
const draft = reactive<ProfileConfig>(structuredClone(store.activeProfile))
// customRules 可选字段 → 组件内用必备数组操作，保存时写回 draft
const customRules = ref<CustomRule[]>([...(draft.customRules || [])])
const whitelistText = ref((store.activeProfile.whitelist || []).join('\n'))
const error = ref('')
const saving = ref(false)

// ---- 自定义正则规则编辑（Phase 5） ----
const newRule = reactive<{ name: string; pattern: string; type: DetectionType; confidence: 'high' | 'medium' | 'low' }>({
    name: '',
    pattern: '',
    type: 'ENV_PASSWORD',
    confidence: 'high'
})
const ruleError = ref('')
const showRuleForm = ref(false)

const RULE_TYPE_OPTIONS: Array<{ key: DetectionType; label: string }> = [
    { key: 'ENV_PASSWORD', label: '密码' },
    { key: 'API_KEY', label: 'API 密钥' },
    { key: 'DB_PASSWORD', label: '连接串密码' },
    { key: 'JWT', label: 'JWT' },
    { key: 'PRIVATE_KEY', label: '私钥' },
    { key: 'HIGH_ENTROPY', label: '高熵串' },
    { key: 'EMAIL', label: '邮箱' },
    { key: 'PHONE', label: '手机号/座机' },
    { key: 'ID_CARD', label: '身份证' },
    { key: 'BANK_CARD', label: '银行卡' },
    { key: 'IP_ADDRESS', label: 'IP 地址' },
    { key: 'PLATE', label: '车牌' },
    { key: 'NAME', label: '姓名' },
    { key: 'ADDRESS', label: '地址' }
]

const addRule = () => {
    ruleError.value = ''
    const validation = validateCustomRule(newRule, customRules.value)
    if (!validation.ok) {
        ruleError.value = validation.error || '规则不合法'
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

// ---- 档案导入导出（Phase 5） ----
const ioMessage = ref('')
const ioError = ref('')

const onExport = async () => {
    ioError.value = ''
    const json = store.exportProfilesJson()
    if (!json) {
        ioMessage.value = ''
        ioError.value = '没有可导出的自定义档案（内置档案无需导出）'
        return
    }
    try {
        await navigator.clipboard.writeText(json)
        ioMessage.value = '全部自定义档案 JSON 已复制到剪贴板'
        ioError.value = ''
    } catch {
        ioError.value = '复制失败，请检查剪贴板权限'
    }
}

const onImport = async () => {
    ioMessage.value = ''
    ioError.value = ''
    let json = ''
    try {
        json = await navigator.clipboard.readText()
    } catch {
        ioError.value = '读取剪贴板失败，请手动粘贴'
        return
    }
    if (!json.trim()) {
        ioError.value = '剪贴板为空，请先复制档案 JSON'
        return
    }
    try {
        const count = await store.importProfilesJson(json)
        ioMessage.value = `成功导入 ${count} 个档案（重名已自动加序号）`
    } catch (e) {
        ioError.value = e instanceof Error ? e.message : '导入失败'
    }
}

// GLiNER 标签预设（与 profiles.ts 内置集一致）
const LABEL_PRESETS: Record<string, string[]> = {
    pii: ['person name', 'phone number', 'home address', 'email address', 'ID card number', 'bank card number'],
    secret: ['password', 'secret', 'api key', 'access token', 'private key', 'connection string']
}
LABEL_PRESETS.all = [...LABEL_PRESETS.pii, ...LABEL_PRESETS.secret]

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
const CATEGORY_LABELS: Array<{ key: RuleCategory; label: string }> = [
    { key: 'secret', label: '密钥凭据' },
    { key: 'pii', label: '个人信息' },
    { key: 'entropy', label: '高熵字符串' }
]

const toggleCategory = (cat: RuleCategory) => {
    const idx = draft.enabledCategories.indexOf(cat)
    if (idx >= 0) draft.enabledCategories.splice(idx, 1)
    else draft.enabledCategories.push(cat)
}

// ---- 灵敏度档位 ----
const SENSITIVITY_LABELS: Array<{ key: Sensitivity; label: string }> = [
    { key: 'loose', label: '宽松' },
    { key: 'standard', label: '标准' },
    { key: 'strict', label: '严格' }
]

// ---- 分类型默认策略 ----
const ACTION_TYPES: Array<{ key: DetectionType; label: string }> = [
    { key: 'ENV_PASSWORD', label: '密码' },
    { key: 'API_KEY', label: 'API 密钥' },
    { key: 'DB_PASSWORD', label: '连接串密码' },
    { key: 'HIGH_ENTROPY', label: '高熵串' },
    { key: 'EMAIL', label: '邮箱' },
    { key: 'PHONE', label: '手机号/座机' },
    { key: 'ID_CARD', label: '身份证' },
    { key: 'BANK_CARD', label: '银行卡' },
    { key: 'IP_ADDRESS', label: 'IP 地址' },
    { key: 'PLATE', label: '车牌' }
]

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
        error.value = e instanceof Error ? e.message : '保存失败'
    } finally {
        saving.value = false
    }
}
</script>

<template>
    <!-- 表单主体：外壳（标题/遮罩/关闭/动画）由外层 Dialog 提供 -->
    <div class="text-xs space-y-3">
        <!-- 名称与描述 -->
        <div class="space-y-1">
            <label class="block text-muted-foreground">档案名称</label>
            <input v-model="draft.name" maxlength="20"
                class="w-full px-2 py-1 rounded-sm border bg-muted/50 border-border text-foreground focus:outline-none focus:border-ring" />
            <label class="block text-muted-foreground">描述</label>
            <input v-model="draft.description" maxlength="100"
                class="w-full px-2 py-1 rounded-sm border bg-muted/50 border-border text-foreground focus:outline-none focus:border-ring" />
        </div>

        <!-- 规则类别开关 -->
        <div class="space-y-1">
            <label class="block text-muted-foreground">检测类别</label>
            <div class="flex gap-2">
                <label v-for="cat in CATEGORY_LABELS" :key="cat.key"
                    class="flex items-center gap-1 cursor-pointer text-foreground">
                    <input type="checkbox" :checked="draft.enabledCategories.includes(cat.key)"
                        @change="toggleCategory(cat.key)" class="accent-primary" />
                    {{ cat.label }}
                </label>
            </div>
        </div>

        <!-- 灵敏度 -->
        <div class="space-y-1">
            <label class="block text-muted-foreground">高熵灵敏度</label>
            <div class="flex gap-1">
                <button v-for="s in SENSITIVITY_LABELS" :key="s.key"
                    @click="draft.sensitivity = { ...draft.sensitivity, entropy: s.key }"
                    :class="[
                        'px-2 py-1 rounded-sm border text-xs transition-colors',
                        (draft.sensitivity.entropy || 'standard') === s.key
                            ? 'border-ring text-primary bg-primary/10'
                            : 'border-border text-muted-foreground hover:border-input'
                    ]">
                    {{ s.label }}
                </button>
            </div>
        </div>

        <!-- 置信度分层 -->
        <label class="flex items-center gap-1.5 cursor-pointer text-foreground">
            <input type="checkbox" v-model="draft.tierLowConfidence" class="accent-primary" />
            中低置信度仅提示（不替换）
        </label>

        <!-- 分类型默认策略 -->
        <div class="space-y-1">
            <label class="block text-muted-foreground">默认策略</label>
            <div class="grid grid-cols-2 gap-1">
                <div v-for="t in ACTION_TYPES" :key="t.key"
                    class="flex items-center justify-between gap-1 text-foreground">
                    <span class="truncate">{{ t.label }}</span>
                    <select :value="draft.defaultActions[t.key] || 'replace'"
                        @change="draft.defaultActions = { ...draft.defaultActions, [t.key]: ($event.target as HTMLSelectElement).value as 'replace' | 'keep' }"
                        class="px-1 py-0.5 rounded-sm border bg-muted/50 border-border text-xs">
                        <option value="replace">替换</option>
                        <option value="keep">保留</option>
                    </select>
                </div>
            </div>
        </div>

        <!-- 值白名单 -->
        <div class="space-y-1">
            <label class="block text-muted-foreground">值白名单（每行一个，精确匹配不检测）</label>
            <textarea v-model="whitelistText" rows="3" placeholder="example.com&#10;test-account-001"
                class="w-full px-2 py-1 rounded-sm border bg-muted/50 border-border text-foreground font-mono text-xs focus:outline-none focus:border-ring resize-y"></textarea>
        </div>

        <!-- 自定义正则规则（Phase 5） -->
        <div class="space-y-1">
            <div class="flex items-center justify-between">
                <label class="block text-muted-foreground">自定义正则（{{ customRules.length }} 条）</label>
                <button @click="showRuleForm = !showRuleForm"
                    class="px-1.5 py-0.5 rounded-sm text-primary hover:bg-primary/10 transition-colors">
                    {{ showRuleForm ? '收起' : '＋ 添加' }}
                </button>
            </div>

            <!-- 规则列表 -->
            <div v-for="rule in customRules" :key="rule.id"
                class="flex items-center gap-1 p-1.5 rounded-sm bg-muted/50 border border-border">
                <input type="checkbox" v-model="rule.enabled" class="accent-primary shrink-0" :title="rule.enabled ? '已启用' : '已停用'" />
                <div class="flex-1 min-w-0">
                    <p class="text-xs text-foreground truncate">{{ rule.name }}
                        <span class="text-muted-foreground">→ {{ RULE_TYPE_OPTIONS.find(t => t.key === rule.type)?.label }}</span>
                    </p>
                    <p class="text-xs text-muted-foreground font-mono truncate">{{ rule.pattern }}</p>
                </div>
                <button @click="removeRule(rule.id)" class="text-muted-foreground hover:text-destructive shrink-0" title="删除规则">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>
            </div>

            <!-- 添加表单 -->
            <div v-if="showRuleForm" class="p-2 space-y-1.5 rounded-sm border border-primary/20 bg-primary/5">
                <input v-model="newRule.name" maxlength="20" placeholder="规则名称（如：工号）"
                    class="w-full px-2 py-1 rounded-sm border bg-background border-border text-foreground text-xs focus:outline-none focus:border-ring" />
                <input v-model="newRule.pattern" :maxlength="CUSTOM_PATTERN_MAX_LENGTH" placeholder="正则（如：EMP-\d{6}）"
                    class="w-full px-2 py-1 rounded-sm border bg-background border-border text-foreground font-mono text-xs focus:outline-none focus:border-ring" />
                <div class="flex gap-1">
                    <select v-model="newRule.type"
                        class="flex-1 px-1 py-1 rounded-sm border bg-background border-border text-xs text-foreground">
                        <option v-for="t in RULE_TYPE_OPTIONS" :key="t.key" :value="t.key">{{ t.label }}</option>
                    </select>
                    <select v-model="newRule.confidence"
                        class="px-1 py-1 rounded-sm border bg-background border-border text-xs text-foreground">
                        <option value="high">高置信</option>
                        <option value="medium">中置信</option>
                        <option value="low">低置信</option>
                    </select>
                </div>
                <p v-if="ruleError" class="text-destructive text-xs">{{ ruleError }}</p>
                <button @click="addRule"
                    class="w-full px-2 py-1 rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 text-xs transition-colors">
                    添加规则
                </button>
            </div>
            <p class="text-xs text-muted-foreground">
                拒绝嵌套量词（如 <code>(a+)+</code>）防 ReDoS；每条规则有 50ms 执行预算
            </p>
        </div>

        <!-- AI 检测标签 -->
        <div class="space-y-1">
            <label class="block text-muted-foreground">AI 模型检测目标（GLiNER 标签）</label>
            <div class="flex gap-1 flex-wrap">
                <button v-for="(preset, key) in { pii: '个人信息集', secret: '密钥集', all: '全部', custom: '自定义' }"
                    :key="key" @click="currentPreset = key as typeof currentPreset"
                    :class="[
                        'px-2 py-0.5 rounded-sm border text-xs transition-colors',
                        currentPreset === key
                            ? 'border-ring text-primary bg-primary/10'
                            : 'border-border text-muted-foreground hover:border-input'
                    ]">
                    {{ preset }}
                </button>
            </div>
            <textarea v-if="currentPreset === 'custom'" v-model="customLabelsText" rows="2"
                placeholder="person name, phone number"
                class="w-full px-2 py-1 rounded-sm border bg-muted/50 border-border text-foreground font-mono text-xs focus:outline-none focus:border-ring resize-y"></textarea>
        </div>

        <!-- 错误提示 -->
        <p v-if="error" class="text-destructive text-xs">{{ error }}</p>

        <!-- 档案导入导出（Phase 5） -->
        <div class="space-y-1 pt-1 border-t border-border">
            <div class="flex gap-1">
                <button @click="onExport"
                    class="flex-1 px-2 py-1 rounded-sm border border-border text-muted-foreground hover:border-input transition-colors">
                    导出档案 JSON
                </button>
                <button @click="onImport"
                    class="flex-1 px-2 py-1 rounded-sm border border-border text-muted-foreground hover:border-input transition-colors">
                    从剪贴板导入
                </button>
            </div>
            <p v-if="ioMessage" class="text-success text-xs">{{ ioMessage }}</p>
            <p v-if="ioError" class="text-destructive text-xs">{{ ioError }}</p>
        </div>

        <!-- 操作 -->
        <div class="flex items-center justify-between pt-1 border-t border-border">
            <button @click="emit('delete')"
                class="px-2 py-1 rounded-sm text-destructive hover:bg-destructive/10 transition-colors">
                删除档案
            </button>
            <div class="flex gap-1">
                <button @click="emit('close')"
                    class="px-2 py-1 rounded-sm border border-border text-muted-foreground hover:border-input transition-colors">
                    取消
                </button>
                <button @click="onSave" :disabled="saving"
                    class="px-2 py-1 rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
                    {{ saving ? '保存中…' : '保存' }}
                </button>
            </div>
        </div>
    </div>
</template>
