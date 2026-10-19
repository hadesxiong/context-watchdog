<script setup lang="ts">
import { computed } from 'vue'
import { Primitive, type PrimitiveProps } from 'reka-ui'

interface Props extends PrimitiveProps {
  variant?: 'primary' | 'secondary' | 'danger' | 'disabled'
  btnType?: 'normal' | 'outline' | 'text'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  as: 'button',
  variant: 'primary',
  btnType: 'normal',
  size: 'md',
  loading: false,
  disabled: false
})

defineEmits<{ (e: 'click', value: MouseEvent): void }>()

const variantClasses = computed(() => {
  if (props.variant === 'disabled') {
    return 'bg-muted text-muted-foreground border-transparent'
  }

  const colors = {
    primary: {
      normal: 'bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring shadow-sm',
      outline: 'bg-transparent text-foreground border-input hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring',
      text: 'bg-transparent text-foreground/70 hover:text-foreground focus-visible:ring-ring shadow-none'
    },
    secondary: {
      normal: 'bg-secondary text-secondary-foreground hover:bg-secondary/80 focus-visible:ring-ring shadow-sm',
      outline: 'bg-transparent text-foreground/80 border-input hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring',
      text: 'bg-transparent text-muted-foreground hover:text-foreground focus-visible:ring-ring shadow-none'
    },
    danger: {
      normal: 'bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive shadow-sm',
      outline: 'bg-transparent text-destructive border-destructive/40 hover:bg-destructive/10 focus-visible:ring-destructive',
      text: 'bg-transparent text-destructive hover:text-destructive/80 focus-visible:ring-destructive shadow-none'
    }
  }

  return colors[props.variant][props.btnType]
})

const typeClasses = computed(() => {
  if (props.btnType === 'outline') {
    return 'border'
  }
  return 'border border-transparent'
})

const sizeClasses = computed(() => {
  if (props.btnType === 'text') {
    return {
      sm: 'h-auto px-0 py-0 text-xs gap-1',
      md: 'h-auto px-0 py-0 text-sm gap-1.5',
      lg: 'h-auto px-0 py-0 text-base gap-2'
    }[props.size]
  }
  return {
    sm: 'h-8 px-3 text-xs rounded-md gap-1.5',
    md: 'h-auto px-3 py-1.5 text-sm rounded-md gap-2',
    lg: 'h-12 px-6 text-base rounded-md gap-2.5'
  }[props.size]
})
</script>

<template>
  <Primitive
    :as="as"
    :as-child="asChild"
    :class="[
      'inline-flex items-center justify-center font-medium transition-all duration-200',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      'disabled:pointer-events-none disabled:opacity-50',
      'active:scale-[0.98]',
      variantClasses,
      typeClasses,
      sizeClasses
    ]"
    :disabled="disabled || loading"
    @click="$emit('click', $event)"
  >
    <svg
      v-if="loading"
      class="animate-spin -ml-1 h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24">
      <circle
        class="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        stroke-width="4"/>
      <path
        class="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
    </svg>
    <slot />
  </Primitive>
</template>
