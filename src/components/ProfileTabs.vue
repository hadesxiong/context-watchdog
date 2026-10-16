<script setup lang="ts">
import { ref } from 'vue'
import { useDetectionStore } from '../stores/detection'
import { Dialog } from '../ui'
import ProfileSettings from './ProfileSettings.vue'

const store = useDetectionStore()
const showSettings = ref(false)

const onCreate = async () => {
    // 基于当前激活档案新建并自动激活
    await store.createUserProfile()
    showSettings.value = true
}

const onDelete = async () => {
    if (confirm('确定删除该自定义档案？')) {
        showSettings.value = false
        await store.deleteUserProfile(store.activeProfileId)
    }
}
</script>

<template>
    <div class="px-3 pt-3">
        <div class="flex gap-1 p-0.5 rounded-md bg-muted/50 border border-border">
            <button
                v-for="profile in store.profiles"
                :key="profile.id"
                @click="store.setActiveProfile(profile.id)"
                :title="profile.description"
                :class="[
                    'flex-1 px-2 py-1.5 text-xs font-medium rounded-sm transition-all duration-150',
                    store.activeProfileId === profile.id
                        ? 'bg-card text-primary shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                ]"
            >
                {{ profile.name }}
            </button>
            <!-- 新建自定义档案：基于当前激活档案克隆 -->
            <button
                @click="onCreate"
                title="基于当前档案新建自定义档案"
                class="px-2 py-1.5 text-xs font-medium rounded-sm text-muted-foreground hover:text-primary transition-colors"
            >
                ＋
            </button>
            <!-- 编辑：仅自定义档案显示 -->
            <button
                v-if="store.isActiveProfileCustom"
                @click="showSettings = true"
                title="编辑当前自定义档案"
                class="px-2 py-1.5 text-xs font-medium rounded-sm text-muted-foreground hover:text-primary transition-colors"
            >
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
            </button>
        </div>
        <p class="mt-1.5 text-xs text-muted-foreground">
            {{ store.activeProfile.description }}
        </p>
        <!-- 自定义档案设置弹窗 -->
        <Dialog
            v-model:open="showSettings"
            title="自定义档案设置"
            :description="store.activeProfile.description"
            width="max-w-lg"
            @close="showSettings = false"
        >
            <ProfileSettings
                v-if="store.isActiveProfileCustom"
                @close="showSettings = false"
                @delete="onDelete"
            />
        </Dialog>
    </div>
</template>
