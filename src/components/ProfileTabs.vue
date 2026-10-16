<script setup lang="ts">
import { ref } from 'vue'
import { useDetectionStore } from '../stores/detection'
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
    <div class="px-3 pb-2">
        <div class="flex gap-1 p-0.5 rounded-sm bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
            <button
                v-for="profile in store.profiles"
                :key="profile.id"
                @click="store.setActiveProfile(profile.id)"
                :title="profile.description"
                :class="[
                    'flex-1 px-2 py-1.5 text-xs font-medium rounded-sm transition-all duration-150',
                    store.activeProfileId === profile.id
                        ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                ]"
            >
                {{ profile.name }}
            </button>
            <!-- 新建自定义档案：基于当前激活档案克隆 -->
            <button
                @click="onCreate"
                title="基于当前档案新建自定义档案"
                class="px-2 py-1.5 text-xs font-medium rounded-sm text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            >
                ＋
            </button>
            <!-- 编辑/删除：仅自定义档案显示 -->
            <button
                v-if="store.isActiveProfileCustom"
                @click="showSettings = !showSettings"
                :title="showSettings ? '收起档案设置' : '编辑当前自定义档案'"
                :class="[
                    'px-2 py-1.5 text-xs font-medium rounded-sm transition-colors',
                    showSettings
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-gray-400 hover:text-blue-600 dark:hover:text-blue-400'
                ]"
            >
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
            </button>
        </div>
        <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
            {{ store.activeProfile.description }}
        </p>
        <!-- 自定义档案设置面板 -->
        <ProfileSettings
            v-if="showSettings && store.isActiveProfileCustom"
            @close="showSettings = false"
            @delete="onDelete"
        />
    </div>
</template>
