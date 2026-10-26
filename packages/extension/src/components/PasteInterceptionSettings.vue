<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Button, Input } from '../ui'
import { PROTECTED_SITES_KEY, normalizeSiteInput, sitePermissionOrigins } from '@engine/sites'
import { useI18n } from '../i18n'

const { t } = useI18n()

// 粘贴自动拦截：逐站授权（optional_host_permissions），仅授权站点才注入粘贴监听（详见 docs/spec.md §8）
const sites = ref<string[]>([])
const siteInput = ref('')
const busy = ref(false)
const notice = ref('')
const noticeKind = ref<'info' | 'error'>('info')

const setNotice = (text: string, kind: 'info' | 'error' = 'info') => {
    notice.value = text
    noticeKind.value = kind
}

const loadSites = async () => {
    const result = await chrome.storage.local.get(PROTECTED_SITES_KEY)
    const stored = result[PROTECTED_SITES_KEY]
    sites.value = Array.isArray(stored) ? stored.filter((site): site is string => typeof site === 'string') : []
}

const persist = async (next: string[]) => {
    sites.value = next
    await chrome.storage.local.set({ [PROTECTED_SITES_KEY]: next })
}

const addSite = async () => {
    const pattern = normalizeSiteInput(siteInput.value)
    if (!pattern) {
        setNotice(t('paste_err_invalid'), 'error')
        return
    }
    if (sites.value.includes(pattern)) {
        setNotice(t('paste_err_exists'))
        return
    }

    busy.value = true
    try {
        // 授权须用户手势触发；带路径条目要「精确路径 + 子树」两条 origin，http 条目 http/https 各一条
        const origins = sitePermissionOrigins(pattern)
        const granted = await chrome.permissions.request({ origins })
        if (!granted) {
            setNotice(t('paste_err_denied'), 'error')
            return
        }
        await persist([...sites.value, pattern])
        siteInput.value = ''
        setNotice(t('paste_ok_added'))
    } catch (error) {
        setNotice(t('paste_err_grant_failed', { error: error instanceof Error ? error.message : String(error) }), 'error')
    } finally {
        busy.value = false
    }
}

const removeSite = async (pattern: string) => {
    await persist(sites.value.filter(site => site !== pattern))
    try {
        // 撤销必须与申请时同一份 origin 清单（路径 + 子树、http + https 多条）
        await chrome.permissions.remove({ origins: sitePermissionOrigins(pattern) })
    } catch {
        // 权限可能被其他条目共享，忽略
    }
    setNotice(t('paste_ok_removed'))
}

onMounted(loadSites)
</script>

<template>
    <!-- 全宽贴边区块（p-4），块内分隔一律走 padding 不用 margin（与引擎卡片同规格） -->
    <div class="p-4 bg-muted/50">
        <div>
            <p class="text-sm font-medium text-foreground">{{ t('paste_section_title') }}</p>
            <p class="text-xs text-muted-foreground pt-0.5 line-clamp-2">
                {{ t('paste_section_desc') }}</p>
        </div>

        <!-- 输入与按钮等高 32px；按钮 shrink-0 防压窄换行，输入 min-w-0 允许收缩 -->
        <div class="pt-4 flex items-center gap-2">
            <Input v-model="siteInput" :placeholder="t('paste_input_placeholder')" :disabled="busy"
                class="h-8 min-w-0 input-fixed" @keyup.enter="addSite" />
            <Button size="sm" :disabled="busy" @click="addSite" class="shrink-0">{{ t('common_add') }}</Button>
        </div>

        <p v-if="notice" class="pt-4 text-xs"
            :class="noticeKind === 'error' ? 'text-warning' : 'text-muted-foreground'">
            {{ notice }}
        </p>

        <ul v-if="sites.length" class="pt-4 space-y-1">
            <li v-for="site in sites" :key="site" class="flex items-center justify-between gap-2">
                <span class="text-xs font-mono text-foreground truncate">{{ site }}</span>
                <button class="text-xs text-warning hover:underline shrink-0" @click="removeSite(site)">
                    {{ t('common_remove') }}
                </button>
            </li>
        </ul>
        <p v-else class="pt-4 text-xs text-muted-foreground">
            {{ t('paste_empty') }}
        </p>
    </div>
</template>

<style scoped>
.input-fixed {
    padding: 10px !important
}
</style>