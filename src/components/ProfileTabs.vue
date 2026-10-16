<script setup lang="ts">
import { useDetectionStore } from '../stores/detection'

const store = useDetectionStore()
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
        </div>
        <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
            {{ store.activeProfile.description }}
        </p>
    </div>
</template>
