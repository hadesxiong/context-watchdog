<script setup lang="ts">
interface Props {
    padding?: boolean
    hover?: boolean
}

withDefaults(defineProps<Props>(), {
    padding: true,
    hover: false
})
</script>

<template>
    <div :class="[
        'bg-card text-card-foreground rounded-lg border border-border',
        'shadow-xs transition-all duration-200',
        hover && 'hover:shadow-md hover:border-border/60',
        padding && 'px-3 py-3']">
        <slot></slot>
    </div>
</template>
