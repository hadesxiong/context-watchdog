<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info'
  size?: 'sm' | 'md'
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default',
  size: 'sm'
})

const variantClasses = computed(() => {
  switch (props.variant) {
    case 'success':
      return 'bg-success/10 text-success'
    case 'warning':
      return 'bg-warning/10 text-warning'
    case 'danger':
      return 'bg-destructive/10 text-destructive'
    case 'info':
      return 'bg-primary/10 text-primary'
    default:
      return 'bg-muted text-muted-foreground'
  }
})

const sizeClasses = computed(() => {
  switch (props.size) {
    case 'sm':
      return 'px-2 py-1 text-xs'
    case 'md':
      return 'px-2.5 py-1.5 text-sm'
    default:
      return ''
  }
})
</script>

<template>
  <span
    :class="[
      'inline-flex items-center font-medium rounded-sm transition-colors',
      variantClasses,
      sizeClasses
    ]"
  >
    <slot />
  </span>
</template>
